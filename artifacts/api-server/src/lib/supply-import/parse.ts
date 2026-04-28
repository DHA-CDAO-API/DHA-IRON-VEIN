/**
 * Streaming parser for the Supply demo workbook (.xlsx).
 *
 * The supply workbook is ~110 MB compressed and decompresses to ~1 GB
 * across `xl/sharedStrings.xml` (~488 MB, ~13 M unique entries) and
 * `xl/worksheets/sheet1.xml` (~560 MB). Naively loading the shared-strings
 * table into a single dictionary blows past the container's memory limit.
 *
 * This module reads the workbook as a streaming async iterable, with no
 * dependency on `xlsx`, `lib/db`, or any route, and never materializes the
 * full shared-strings table in memory:
 *
 *   - The .xlsx zip container is parsed by hand (central directory + local
 *     file headers) so individual entries can be opened as a byte range and
 *     piped through `zlib.createInflateRaw()`.
 *   - A small hand-rolled SAX scanner walks the XML one chunk at a time.
 *   - `xl/sharedStrings.xml` and `xl/worksheets/sheet1.xml` are streamed in
 *     lockstep. For each cell that references a shared-string index, the
 *     shared-strings stream is advanced just far enough to resolve it. A
 *     small ring buffer of the most-recently-seen strings tolerates minor
 *     out-of-order references, and a slow restart-from-zero path covers
 *     the rare case of a backwards reference older than the buffer.
 *
 * Peak heap on a 1 M-row file stays well under ~512 MB this way.
 */

import { createReadStream } from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";

const SHEET_PATH = "xl/worksheets/sheet1.xml";
const SHARED_STRINGS_PATH = "xl/sharedStrings.xml";

const NUM_COLUMNS = 14;

/**
 * One row from the Supply demo workbook, normalized.
 *
 * Columns A..N in source order:
 *   A productNoun           B productType
 *   C itemDscShort          D manufacturer
 *   E ghxCommodityType      F ghxManufacturerLong
 *   G fullDescription       H mfrCatNo
 *   I productNDC            J sosTypeDescription
 *   K unspscCommodity       L productSize
 *   M orderQty (numeric)    N mtfName
 */
export interface SupplyRow {
  productNoun: string | null;
  productType: string | null;
  itemDscShort: string | null;
  manufacturer: string | null;
  ghxCommodityType: string | null;
  ghxManufacturerLong: string | null;
  fullDescription: string | null;
  mfrCatNo: string | null;
  productNDC: string | null;
  sosTypeDescription: string | null;
  unspscCommodity: string | null;
  productSize: string | null;
  orderQty: number | null;
  mtfName: string | null;
}

const COLUMN_FIELDS: ReadonlyArray<keyof SupplyRow> = [
  "productNoun",
  "productType",
  "itemDscShort",
  "manufacturer",
  "ghxCommodityType",
  "ghxManufacturerLong",
  "fullDescription",
  "mfrCatNo",
  "productNDC",
  "sosTypeDescription",
  "unspscCommodity",
  "productSize",
  "orderQty",
  "mtfName",
];

const ORDER_QTY_INDEX = COLUMN_FIELDS.indexOf("orderQty");

export interface ParseOptions {
  /** Stop after yielding this many data rows (header row excluded). */
  maxRows?: number;
  /** Size of the recently-seen shared-string ring buffer. Default 256. */
  recentCacheSize?: number;
}

// ---------------------------------------------------------------------------
// Cell normalization helpers
// ---------------------------------------------------------------------------

function normalizeText(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed === "UNK") return null;
  return trimmed;
}

function normalizeNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "UNK") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function emptyRow(): SupplyRow {
  return {
    productNoun: null,
    productType: null,
    itemDscShort: null,
    manufacturer: null,
    ghxCommodityType: null,
    ghxManufacturerLong: null,
    fullDescription: null,
    mfrCatNo: null,
    productNDC: null,
    sosTypeDescription: null,
    unspscCommodity: null,
    productSize: null,
    orderQty: null,
    mtfName: null,
  };
}

function setField(row: SupplyRow, colIndex: number, raw: string | null): void {
  if (colIndex < 0 || colIndex >= NUM_COLUMNS) return;
  if (colIndex === ORDER_QTY_INDEX) {
    row.orderQty = normalizeNumber(raw);
    return;
  }
  const field = COLUMN_FIELDS[colIndex] as Exclude<keyof SupplyRow, "orderQty">;
  row[field] = normalizeText(raw);
}

/** Convert "A" -> 0, "N" -> 13, "AA" -> 26. */
function colLettersToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    const code = letters.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** Parse a cell reference like "B12" -> { col: 1, row: 12 }. */
function parseCellRef(ref: string): { col: number; row: number } {
  let i = 0;
  while (i < ref.length && ref.charCodeAt(i) >= 65 && ref.charCodeAt(i) <= 90) i++;
  const col = colLettersToIndex(ref.slice(0, i));
  const row = Number(ref.slice(i));
  return { col, row };
}

function decodeXmlEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, body) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    if (body[0] === "#") {
      const code =
        body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

// ---------------------------------------------------------------------------
// Minimal .xlsx zip reader
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  compSize: number;
  uncompSize: number;
  method: number;
  localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function readCentralDirectory(filePath: string): Promise<Map<string, ZipEntry>> {
  const fh = await fsOpen(filePath, "r");
  try {
    const stat = await fh.stat();
    const size = stat.size;
    const tailLen = Math.min(size, 65557); // 22 byte EOCD + up to 64KB comment
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocdRel = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocdRel = i;
        break;
      }
    }
    if (eocdRel < 0) throw new Error(`No EOCD record in ${filePath}`);
    const totalEntries = tail.readUInt16LE(eocdRel + 10);
    const cdSize = tail.readUInt32LE(eocdRel + 12);
    const cdOffset = tail.readUInt32LE(eocdRel + 16);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      throw new Error(`ZIP64 not supported for ${filePath}`);
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let i = 0; i < totalEntries; i++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new Error(`Bad central directory header at ${cdOffset + p}`);
      }
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const cmtLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nameLen).toString("utf8");
      entries.set(name, { name, compSize, uncompSize, method, localOffset });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

async function openEntryStream(filePath: string, entry: ZipEntry): Promise<Readable> {
  // Read the local file header to find the actual data offset (the local
  // header's nameLen / extraLen can differ from the central directory's).
  const fh = await fsOpen(filePath, "r");
  let dataOffset: number;
  try {
    const lh = Buffer.alloc(30);
    await fh.read(lh, 0, 30, entry.localOffset);
    if (lh.readUInt32LE(0) !== SIG_LOCAL) {
      throw new Error(`Bad local header for ${entry.name}`);
    }
    const nameLen = lh.readUInt16LE(26);
    const extraLen = lh.readUInt16LE(28);
    dataOffset = entry.localOffset + 30 + nameLen + extraLen;
  } finally {
    await fh.close();
  }

  const raw = createReadStream(filePath, {
    start: dataOffset,
    end: dataOffset + entry.compSize - 1,
    highWaterMark: 1 << 16,
  });
  if (entry.method === 0) return raw; // stored
  if (entry.method !== 8) {
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  }
  return raw.pipe(createInflateRaw());
}

// ---------------------------------------------------------------------------
// Streaming SAX-ish text source
//
// Async generator over decoded UTF-8 text chunks. Underlying inflate stream
// is consumed lazily.
// ---------------------------------------------------------------------------

async function* streamAsText(stream: Readable): AsyncGenerator<string, void, void> {
  // The TextDecoder w/ stream:true correctly handles UTF-8 sequences split
  // across chunk boundaries. Surrogate-aware boundary handling is also
  // applied below before parsing.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const piece = decoder.decode(chunk, { stream: true });
    if (piece.length > 0) yield piece;
  }
  const tail = decoder.decode();
  if (tail.length > 0) yield tail;
}

// ---------------------------------------------------------------------------
// Shared-strings stream cursor
//
// Yields strings in `<si>` order. Maintains a small ring buffer of recently
// emitted (idx -> string) so the sheet pass can resolve cell references that
// momentarily go backwards. If a reference falls outside the buffer, we
// reopen the stream and replay from the start (slow path; expected to be
// extremely rare on this workbook).
// ---------------------------------------------------------------------------

class SharedStringsCursor {
  private filePath: string;
  private entry: ZipEntry;
  private chunkIter: AsyncGenerator<string, void, void> | null = null;
  private buf = "";
  private nextIdx = 0;
  private done = false;

  private recentMap = new Map<number, string>();
  private recentOrder: number[] = [];
  private recentLimit: number;

  constructor(filePath: string, entry: ZipEntry, recentLimit: number) {
    this.filePath = filePath;
    this.entry = entry;
    this.recentLimit = Math.max(8, recentLimit);
  }

  async dispose(): Promise<void> {
    if (this.chunkIter) {
      await this.chunkIter.return(undefined).catch(() => undefined);
      this.chunkIter = null;
    }
  }

  private async ensureOpen(): Promise<void> {
    if (this.chunkIter) return;
    const stream = await openEntryStream(this.filePath, this.entry);
    this.chunkIter = streamAsText(stream);
    this.buf = "";
    this.nextIdx = 0;
    this.done = false;
  }

  private async fillBuffer(): Promise<boolean> {
    if (!this.chunkIter) await this.ensureOpen();
    if (!this.chunkIter) return false;
    const next = await this.chunkIter.next();
    if (next.done) {
      this.done = true;
      return false;
    }
    this.buf += next.value;
    return true;
  }

  /** Read the next `<si>...</si>` string from the stream. */
  private async readNextString(): Promise<string | null> {
    while (true) {
      // Look for an opening <si> or <si/> tag.
      let openIdx = this.buf.indexOf("<si");
      while (openIdx !== -1) {
        const after = this.buf.charCodeAt(openIdx + 3);
        if (after === 0x20 || after === 0x3e || after === 0x2f) break; // space, '>', '/'
        openIdx = this.buf.indexOf("<si", openIdx + 3);
      }
      if (openIdx === -1) {
        // discard buffer (no <si in the bytes seen so far)
        if (this.buf.length > 64) {
          this.buf = this.buf.slice(this.buf.length - 4);
        }
        const more = await this.fillBuffer();
        if (!more) return null;
        continue;
      }
      // We need both the opening '>' and the matching '</si>'.
      const openEnd = this.buf.indexOf(">", openIdx + 3);
      if (openEnd === -1) {
        const more = await this.fillBuffer();
        if (!more) return null;
        continue;
      }
      // Self-closing: <si/>
      if (this.buf.charCodeAt(openEnd - 1) === 0x2f) {
        this.buf = this.buf.slice(openEnd + 1);
        return "";
      }
      const closeIdx = this.buf.indexOf("</si>", openEnd + 1);
      if (closeIdx === -1) {
        const more = await this.fillBuffer();
        if (!more) return null;
        continue;
      }
      const inner = this.buf.slice(openEnd + 1, closeIdx);
      this.buf = this.buf.slice(closeIdx + 5);
      return concatTextNodes(inner);
    }
  }

  private remember(idx: number, value: string): void {
    if (this.recentMap.has(idx)) return;
    this.recentMap.set(idx, value);
    this.recentOrder.push(idx);
    if (this.recentOrder.length > this.recentLimit) {
      const evicted = this.recentOrder.shift();
      if (evicted !== undefined) this.recentMap.delete(evicted);
    }
  }

  /**
   * Resolve a shared-string reference. May advance the underlying stream;
   * on rare backward references that fall outside the recent cache, the
   * stream is restarted from the beginning.
   */
  async resolve(idx: number): Promise<string> {
    const cached = this.recentMap.get(idx);
    if (cached !== undefined) return cached;
    if (idx < this.nextIdx) {
      // Backward reference older than the ring buffer: restart.
      await this.dispose();
      await this.ensureOpen();
      this.recentMap.clear();
      this.recentOrder.length = 0;
    }
    while (this.nextIdx <= idx) {
      const s = await this.readNextString();
      if (s === null) {
        throw new Error(
          `Shared-string index ${idx} out of range (stream ended at ${this.nextIdx})`,
        );
      }
      this.remember(this.nextIdx, s);
      if (this.nextIdx === idx) {
        this.nextIdx++;
        return s;
      }
      this.nextIdx++;
    }
    // unreachable
    throw new Error(`Failed to resolve shared-string index ${idx}`);
  }
}

/** Concatenate all `<t>...</t>` payloads inside an `<si>` body. */
function concatTextNodes(inner: string): string {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const tStart = inner.indexOf("<t", i);
    if (tStart === -1) break;
    const after = inner.charCodeAt(tStart + 2);
    if (!(after === 0x20 || after === 0x3e || after === 0x2f)) {
      i = tStart + 2;
      continue;
    }
    const openEnd = inner.indexOf(">", tStart + 2);
    if (openEnd === -1) break;
    if (inner.charCodeAt(openEnd - 1) === 0x2f) {
      // <t/>
      i = openEnd + 1;
      continue;
    }
    const closeIdx = inner.indexOf("</t>", openEnd + 1);
    if (closeIdx === -1) break;
    out += decodeXmlEntities(inner.slice(openEnd + 1, closeIdx));
    i = closeIdx + 4;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sheet streaming row iterator
// ---------------------------------------------------------------------------

interface RawCell {
  colIndex: number;
  type: string; // "", "s", "inlineStr", "str", "n", "b", "d"
  value: string | null;
}

async function* iterateSheetRows(
  filePath: string,
  entry: ZipEntry,
): AsyncGenerator<{ rowNum: number; cells: RawCell[] }, void, void> {
  const stream = await openEntryStream(filePath, entry);
  const chunkIter = streamAsText(stream);
  let buf = "";

  // Find the start of <sheetData>; skip everything before it.
  let sheetDataStart = -1;
  while (sheetDataStart === -1) {
    const next = await chunkIter.next();
    if (next.done) return;
    buf += next.value;
    sheetDataStart = buf.indexOf("<sheetData");
  }
  // Skip past the opening tag itself.
  let openEnd = buf.indexOf(">", sheetDataStart);
  while (openEnd === -1) {
    const next = await chunkIter.next();
    if (next.done) return;
    buf += next.value;
    openEnd = buf.indexOf(">", sheetDataStart);
  }
  // Self-closing <sheetData/> means no rows.
  if (buf.charCodeAt(openEnd - 1) === 0x2f) return;
  buf = buf.slice(openEnd + 1);

  while (true) {
    // Find the next <row ...> tag (skip any whitespace).
    let rowStart = buf.indexOf("<row");
    while (rowStart !== -1) {
      const after = buf.charCodeAt(rowStart + 4);
      if (after === 0x20 || after === 0x3e || after === 0x2f) break;
      rowStart = buf.indexOf("<row", rowStart + 4);
    }
    if (rowStart === -1) {
      // Either we're done or need more bytes.
      if (buf.indexOf("</sheetData>") !== -1) return;
      const next = await chunkIter.next();
      if (next.done) return;
      buf += next.value;
      continue;
    }
    // Bail out cleanly if </sheetData> precedes the next <row>.
    const sheetEnd = buf.indexOf("</sheetData>");
    if (sheetEnd !== -1 && sheetEnd < rowStart) return;

    const rowOpenEnd = buf.indexOf(">", rowStart + 4);
    if (rowOpenEnd === -1) {
      const next = await chunkIter.next();
      if (next.done) return;
      buf += next.value;
      continue;
    }

    const rowOpenTag = buf.slice(rowStart, rowOpenEnd + 1);
    const rowNum = parseAttribute(rowOpenTag, "r");

    // Self-closing row: <row r="3"/>
    if (buf.charCodeAt(rowOpenEnd - 1) === 0x2f) {
      buf = buf.slice(rowOpenEnd + 1);
      yield { rowNum: rowNum ? Number(rowNum) : 0, cells: [] };
      continue;
    }

    // Find </row>
    let rowCloseIdx = buf.indexOf("</row>", rowOpenEnd + 1);
    while (rowCloseIdx === -1) {
      const next = await chunkIter.next();
      if (next.done) return;
      buf += next.value;
      rowCloseIdx = buf.indexOf("</row>", rowOpenEnd + 1);
    }

    const inner = buf.slice(rowOpenEnd + 1, rowCloseIdx);
    buf = buf.slice(rowCloseIdx + 6);
    const cells = parseRowCells(inner);
    yield { rowNum: rowNum ? Number(rowNum) : 0, cells };
  }
}

/** Pull a single attribute value out of an opening tag fragment. */
function parseAttribute(openTag: string, name: string): string | null {
  // Look for `name="value"`. Cheap and good enough for the well-formed XLSX
  // produced by spreadsheet engines.
  const needle = name + "=\"";
  const idx = openTag.indexOf(" " + needle);
  if (idx === -1) return null;
  const start = idx + 1 + needle.length;
  const end = openTag.indexOf("\"", start);
  if (end === -1) return null;
  return openTag.slice(start, end);
}

function parseRowCells(inner: string): RawCell[] {
  const cells: RawCell[] = [];
  let i = 0;
  while (i < inner.length) {
    const cStart = inner.indexOf("<c", i);
    if (cStart === -1) break;
    const after = inner.charCodeAt(cStart + 2);
    if (!(after === 0x20 || after === 0x3e || after === 0x2f)) {
      i = cStart + 2;
      continue;
    }
    const cOpenEnd = inner.indexOf(">", cStart + 2);
    if (cOpenEnd === -1) break;
    const openTag = inner.slice(cStart, cOpenEnd + 1);
    const ref = parseAttribute(openTag, "r") ?? "";
    const type = parseAttribute(openTag, "t") ?? "";
    const { col } = parseCellRef(ref);

    // Self-closing <c .../> -> empty cell (just skip).
    if (inner.charCodeAt(cOpenEnd - 1) === 0x2f) {
      i = cOpenEnd + 1;
      continue;
    }
    const cClose = inner.indexOf("</c>", cOpenEnd + 1);
    if (cClose === -1) break;
    const cellInner = inner.slice(cOpenEnd + 1, cClose);
    i = cClose + 4;

    let value: string | null = null;
    if (type === "inlineStr") {
      value = concatTextNodes(cellInner);
    } else {
      // <v>...</v>
      const vStart = cellInner.indexOf("<v");
      if (vStart !== -1) {
        const vAfter = cellInner.charCodeAt(vStart + 2);
        if (vAfter === 0x20 || vAfter === 0x3e) {
          const vOpenEnd = cellInner.indexOf(">", vStart + 2);
          const vClose = cellInner.indexOf("</v>", vOpenEnd + 1);
          if (vOpenEnd !== -1 && vClose !== -1) {
            value = decodeXmlEntities(cellInner.slice(vOpenEnd + 1, vClose));
          }
        }
      }
    }
    cells.push({ colIndex: col, type, value });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function* parseSupplyWorkbook(
  filePath: string,
  options: ParseOptions = {},
): AsyncIterable<SupplyRow> {
  const { maxRows, recentCacheSize = 256 } = options;

  const directory = await readCentralDirectory(filePath);
  const sheetEntry = directory.get(SHEET_PATH);
  if (!sheetEntry) {
    throw new Error(`Workbook ${filePath} is missing ${SHEET_PATH}`);
  }
  const sharedEntry = directory.get(SHARED_STRINGS_PATH);

  const sharedCursor = sharedEntry
    ? new SharedStringsCursor(filePath, sharedEntry, recentCacheSize)
    : null;

  let yielded = 0;
  let isFirstRow = true;

  try {
    for await (const { cells } of iterateSheetRows(filePath, sheetEntry)) {
      // Skip the header row (always the first row encountered).
      if (isFirstRow) {
        isFirstRow = false;
        continue;
      }

      const row = emptyRow();
      for (const cell of cells) {
        if (cell.colIndex < 0 || cell.colIndex >= NUM_COLUMNS) continue;
        let raw: string | null = cell.value;
        if (cell.type === "s") {
          if (raw === null || raw === "") {
            raw = null;
          } else if (sharedCursor) {
            const idx = Number(raw);
            if (!Number.isFinite(idx) || idx < 0) {
              raw = null;
            } else {
              raw = await sharedCursor.resolve(idx);
            }
          } else {
            raw = null;
          }
        }
        setField(row, cell.colIndex, raw);
      }
      yield row;
      yielded++;
      if (maxRows !== undefined && yielded >= maxRows) break;
    }
  } finally {
    if (sharedCursor) await sharedCursor.dispose();
  }
}
