/**
 * Dedup + canonicalize pipeline for the parsed Supply demo workbook.
 *
 * Consumes the streaming parser in `./parse.ts`, collapses byte-identical
 * duplicate rows on the 5-tuple
 *   (mfrCatNo, manufacturerShort, mtfName, productSize, orderQty)
 * and writes three NDJSON staging files to `stagingDir`:
 *
 *   catalog.ndjson    one line per unique (mfrCatNo, manufacturerShort)
 *   facilities.ndjson one line per unique mtfName
 *   issues.ndjson     one line per unique (catalog key, facility key, qty)
 *                     after dedup, with `lineCount` and `totalQuantity`
 *                     denormalized per (catalog × facility) pair
 *
 * The pipeline is pure — it never opens a database connection or imports
 * anything from `lib/db`. It is intended to be driven from a CLI (see
 * `dedup-cli.ts`) and consumed by a separate downstream importer.
 *
 * ## Memory strategy
 *
 * The supply workbook has ~1 M source rows with hundreds of thousands of
 * unique 5-tuples surviving dedup. Holding either a `Set<string>` of those
 * keys or a `Map` of the issue records easily blows past the 512 MB heap
 * budget. The pipeline therefore uses the **on-disk sort fallback** the
 * task explicitly calls out:
 *
 *   1. Stream rows from the parser, write each as a TSV line to a temp
 *      file. The first column is the 5-tuple sort key; the second is the
 *      JSON-encoded row payload.
 *   2. Run POSIX `sort -t<TAB> -k1,1 -u` on the temp file. `sort` performs
 *      its own external merge sort with bounded RAM, and `-u` collapses
 *      adjacent rows sharing the 5-tuple key. The CLI uses the GNU-sort
 *      flags `--buffer-size` and `--temporary-directory`, so this pipeline
 *      currently assumes a GNU `sort` is on PATH (true on Linux, including
 *      the Replit runtime; macOS `sort` accepts the same flags via `gsort`).
 *   3. Stream the sorted-unique output. Because rows are sorted by
 *      `(catalog, facility, productSize, qty)`, all surviving rows for a
 *      given `(catalog × facility)` pair are contiguous, so per-pair
 *      `lineCount` and `totalQuantity` aggregates can be computed with a
 *      single small in-memory buffer.
 *
 * Peak Node-side heap on the full 1 M-row workbook stays in the tens of
 * MB; `sort` is allocated its own modest buffer (default ~256 MB) and
 * spills to disk above that.
 */

import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  rmSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

import { parseSupplyWorkbook, type SupplyRow } from "./parse.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DedupReport {
  /** Total data rows pulled from the parser (header excluded). */
  sourceRowsRead: number;
  /** Source rows that were exact duplicates of an already-seen 5-tuple. */
  duplicatesCollapsed: number;
  /** Distinct (mfrCatNo, manufacturerShort) entries written to catalog.ndjson. */
  uniqueCatalogEntries: number;
  /** Distinct mtfName values written to facilities.ndjson. */
  uniqueFacilities: number;
  /** Distinct (catalog, facility, quantity) triples written to issues.ndjson. */
  uniqueIssueLines: number;
}

export interface DedupOptions {
  /** Path to the source .xlsx workbook. */
  inputXlsx: string;
  /** Directory the three NDJSON staging files are written into. Created if missing. */
  stagingDir: string;
  /** Optional: stop after this many parser rows. Useful for tests / smoke runs. */
  maxRows?: number;
  /**
   * Optional buffer size hint passed to `sort` (e.g. "256M"). Defaults to
   * "256M" which keeps `sort`'s own heap modest while still exploiting
   * in-memory sorting for typical workbook sizes.
   */
  sortBufferSize?: string;
}

/** Catalog row written to catalog.ndjson. */
export interface CatalogRecord {
  mfrCatNo: string | null;
  manufacturerShort: string | null;
  productNoun: string | null;
  productType: string | null;
  itemDscShort: string | null;
  ghxCommodityType: string | null;
  ghxManufacturerLong: string | null;
  fullDescription: string | null;
  productNDC: string | null;
  sosTypeDescription: string | null;
  unspscCommodity: string | null;
  /** First-seen productSize for this catalog key (size varies by 5-tuple). */
  productSize: string | null;
}

/** Facility row written to facilities.ndjson. */
export interface FacilityRecord {
  mtfName: string;
}

/** Issue row written to issues.ndjson. */
export interface IssueRecord {
  mfrCatNo: string | null;
  manufacturerShort: string | null;
  mtfName: string | null;
  orderQty: number | null;
  /** Surviving (post-dedup) line count for this (catalog × facility) pair. */
  lineCount: number;
  /** Sum of orderQty across surviving lines for this (catalog × facility) pair. */
  totalQuantity: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const KEY_SEP = "\u0001"; // separates 5-tuple sub-fields inside the sort key
const TAB = "\t";
const LF = "\n";

function strOrEmpty(v: string | null | undefined): string {
  return v == null ? "" : v;
}

/**
 * Lossless escape of any character that would corrupt the TSV / `sort`
 * line layout (TAB, CR, LF, NUL, our KEY_SEP) or the escape itself.
 * Distinct inputs map to distinct outputs, so byte-identical 5-tuples
 * remain byte-identical post-escape and rows that merely *look* alike
 * after a destructive scrub are no longer collapsed together.
 */
function escapeKeyField(v: string | null | undefined): string {
  if (v == null) return "";
  // Order matters: backslash first.
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v.charCodeAt(i);
    switch (ch) {
      case 0x5c: // \
        out += "\\\\";
        break;
      case 0x09: // TAB
        out += "\\t";
        break;
      case 0x0a: // LF
        out += "\\n";
        break;
      case 0x0d: // CR
        out += "\\r";
        break;
      case 0x00: // NUL
        out += "\\0";
        break;
      case 0x01: // KEY_SEP
        out += "\\1";
        break;
      default:
        out += v[i];
    }
  }
  return out;
}

function buildSortKey(row: SupplyRow): string {
  return (
    escapeKeyField(row.mfrCatNo) +
    KEY_SEP +
    escapeKeyField(row.manufacturer) +
    KEY_SEP +
    escapeKeyField(row.mtfName) +
    KEY_SEP +
    escapeKeyField(row.productSize) +
    KEY_SEP +
    (row.orderQty == null ? "" : String(row.orderQty))
  );
}

function catalogKeyOf(row: { mfrCatNo: string | null; manufacturer: string | null }): string {
  return strOrEmpty(row.mfrCatNo) + KEY_SEP + strOrEmpty(row.manufacturer);
}

function facilityKeyOf(row: { mtfName: string | null }): string {
  return strOrEmpty(row.mtfName);
}

/** Backpressure-aware NDJSON appender. */
async function writeJsonLine(stream: Writable, obj: unknown): Promise<void> {
  const line = JSON.stringify(obj) + LF;
  if (!stream.write(line)) {
    await new Promise<void>((res) => stream.once("drain", () => res()));
  }
}

async function writeRaw(stream: Writable, chunk: string): Promise<void> {
  if (!stream.write(chunk)) {
    await new Promise<void>((res) => stream.once("drain", () => res()));
  }
}

function endStream(stream: Writable): Promise<void> {
  return new Promise((res, rej) => {
    stream.end((err?: Error | null) => (err ? rej(err) : res()));
  });
}

// ---------------------------------------------------------------------------
// Phase 1: stream parser → temp TSV (sortKey<TAB>JSON-row)
// ---------------------------------------------------------------------------

interface Phase1Result {
  /** Total parser rows written (header excluded). */
  sourceRowsRead: number;
  /** Path to the unsorted TSV file. */
  unsortedPath: string;
}

async function phase1WriteTsv(
  inputXlsx: string,
  workDir: string,
  maxRows: number | undefined,
): Promise<Phase1Result> {
  const unsortedPath = join(workDir, "rows.unsorted.tsv");
  const out = createWriteStream(unsortedPath, { encoding: "utf8" });
  let sourceRowsRead = 0;
  try {
    for await (const row of parseSupplyWorkbook(inputXlsx, { maxRows })) {
      sourceRowsRead++;
      const key = buildSortKey(row);
      const json = JSON.stringify(row);
      await writeRaw(out, key + TAB + json + LF);
    }
  } finally {
    await endStream(out);
  }
  return { sourceRowsRead, unsortedPath };
}

// ---------------------------------------------------------------------------
// Phase 2: external sort with `-k1,1 -u`
// ---------------------------------------------------------------------------

/**
 * Probe `sort --version` once and verify a GNU coreutils build is on
 * PATH. The pipeline relies on the GNU-specific flags `--buffer-size`
 * and `--temporary-directory`; other implementations (BSD `sort` on
 * macOS, busybox `sort`) would either reject the flags or silently
 * misbehave. Failing fast with a clear message saves a lot of operator
 * confusion.
 */
function assertGnuSortAvailable(): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn("sort", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.on("error", (err) => {
      rej(
        new Error(
          `Cannot invoke 'sort' on PATH: ${(err as Error).message}. ` +
            `This pipeline requires GNU coreutils 'sort' (Linux default; ` +
            `install 'gsort' on macOS).`,
        ),
      );
    });
    child.on("close", () => {
      if (/GNU coreutils/i.test(stdout)) res();
      else
        rej(
          new Error(
            `'sort' on PATH is not GNU coreutils. This pipeline requires the ` +
              `GNU 'sort' --buffer-size / --temporary-directory flags.`,
          ),
        );
    });
  });
}

function phase2Sort(
  unsortedPath: string,
  workDir: string,
  bufferSize: string,
): Promise<string> {
  const sortedPath = join(workDir, "rows.sorted.tsv");
  return new Promise((res, rej) => {
    const child = spawn(
      "sort",
      [
        "-t",
        TAB,
        "-k1,1",
        "-u",
        `--buffer-size=${bufferSize}`,
        `--temporary-directory=${workDir}`,
        "-o",
        sortedPath,
        unsortedPath,
      ],
      {
        stdio: ["ignore", "inherit", "pipe"],
        env: { ...process.env, LC_ALL: "C" }, // byte-wise sort, fastest + deterministic
      },
    );
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += String(b);
    });
    child.on("error", rej);
    child.on("close", (code) => {
      if (code === 0) res(sortedPath);
      else rej(new Error(`sort exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Phase 3: stream sorted lines → catalog / facilities / issues NDJSON
// ---------------------------------------------------------------------------

interface PairBufferEntry {
  orderQty: number | null;
}

interface Phase3Counts {
  uniqueCatalogEntries: number;
  uniqueFacilities: number;
  uniqueIssueLines: number;
  uniqueRows: number;
}

async function phase3Emit(
  sortedPath: string,
  stagingDir: string,
): Promise<Phase3Counts> {
  const catalogPath = resolve(stagingDir, "catalog.ndjson");
  const facilitiesPath = resolve(stagingDir, "facilities.ndjson");
  const issuesPath = resolve(stagingDir, "issues.ndjson");

  const catalogStream = createWriteStream(catalogPath, { encoding: "utf8" });
  const facilitiesStream = createWriteStream(facilitiesPath, {
    encoding: "utf8",
  });
  const issuesStream = createWriteStream(issuesPath, { encoding: "utf8" });

  const seenFacilities = new Set<string>();
  let lastCatalogKey: string | null = null;
  let lastPairKey: string | null = null;
  let pairBuffer: PairBufferEntry[] = [];
  let pairCatalogContext: { mfrCatNo: string | null; manufacturerShort: string | null } | null = null;
  let pairFacilityContext: { mtfName: string | null } | null = null;

  let uniqueCatalogEntries = 0;
  let uniqueFacilities = 0;
  let uniqueIssueLines = 0;
  let uniqueRows = 0;

  /**
   * Emit one issue line per distinct quantity in the buffered pair, with
   * `lineCount`/`totalQuantity` denormalized across the whole pair.
   */
  async function flushPair(): Promise<void> {
    if (pairBuffer.length === 0 || !pairCatalogContext || !pairFacilityContext) {
      pairBuffer = [];
      pairCatalogContext = null;
      pairFacilityContext = null;
      return;
    }
    const lineCount = pairBuffer.length;
    let totalQuantity = 0;
    for (const r of pairBuffer) totalQuantity += r.orderQty ?? 0;

    // Distinct quantities, preserving first-seen order.
    const seenQty = new Set<string>();
    for (const r of pairBuffer) {
      const k = r.orderQty == null ? "" : String(r.orderQty);
      if (seenQty.has(k)) continue;
      seenQty.add(k);
      const rec: IssueRecord = {
        mfrCatNo: pairCatalogContext.mfrCatNo,
        manufacturerShort: pairCatalogContext.manufacturerShort,
        mtfName: pairFacilityContext.mtfName,
        orderQty: r.orderQty,
        lineCount,
        totalQuantity,
      };
      await writeJsonLine(issuesStream, rec);
      uniqueIssueLines++;
    }
    pairBuffer = [];
    pairCatalogContext = null;
    pairFacilityContext = null;
  }

  const rl = createInterface({
    input: createReadStream(sortedPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  try {
    for await (const line of rl) {
      lineNo++;
      if (line.length === 0) continue;
      const tab = line.indexOf(TAB);
      if (tab < 0) {
        // The TSV format is produced by phase 1 of this same pipeline,
        // so a missing TAB indicates a bug or corrupted intermediate
        // file rather than dirty input. Fail fast for diagnosability.
        throw new Error(
          `Malformed sorted line ${lineNo} in ${sortedPath}: missing TAB separator`,
        );
      }
      const json = line.slice(tab + 1);
      let row: SupplyRow;
      try {
        row = JSON.parse(json) as SupplyRow;
      } catch (err) {
        throw new Error(
          `Malformed sorted line ${lineNo} in ${sortedPath}: invalid JSON (${
            (err as Error).message
          })`,
        );
      }
      uniqueRows++;

      const cKey = catalogKeyOf(row);
      const fKey = facilityKeyOf(row);
      const pKey = cKey + KEY_SEP + fKey;

      // New catalog (sort guarantees contiguity per catalogKey).
      if (cKey !== lastCatalogKey) {
        // Skip rows missing the catalog key entirely — they cannot be
        // meaningfully canonicalized into a catalog entry.
        if (row.mfrCatNo != null || row.manufacturer != null) {
          const rec: CatalogRecord = {
            mfrCatNo: row.mfrCatNo,
            manufacturerShort: row.manufacturer,
            productNoun: row.productNoun,
            productType: row.productType,
            itemDscShort: row.itemDscShort,
            ghxCommodityType: row.ghxCommodityType,
            ghxManufacturerLong: row.ghxManufacturerLong,
            fullDescription: row.fullDescription,
            productNDC: row.productNDC,
            sosTypeDescription: row.sosTypeDescription,
            unspscCommodity: row.unspscCommodity,
            productSize: row.productSize,
          };
          await writeJsonLine(catalogStream, rec);
          uniqueCatalogEntries++;
        }
        lastCatalogKey = cKey;
      }

      // Facilities recur across catalogs, so a small Set tracks dedup.
      if (row.mtfName != null && !seenFacilities.has(fKey)) {
        seenFacilities.add(fKey);
        const rec: FacilityRecord = { mtfName: row.mtfName };
        await writeJsonLine(facilitiesStream, rec);
        uniqueFacilities++;
      }

      // Buffer rows per (catalog × facility) pair so we can compute
      // denormalized aggregates before emitting issue lines.
      if (pKey !== lastPairKey) {
        await flushPair();
        lastPairKey = pKey;
        pairCatalogContext = {
          mfrCatNo: row.mfrCatNo,
          manufacturerShort: row.manufacturer,
        };
        pairFacilityContext = { mtfName: row.mtfName };
      }
      pairBuffer.push({ orderQty: row.orderQty });
    }
    await flushPair();
  } finally {
    await endStream(catalogStream);
    await endStream(facilitiesStream);
    await endStream(issuesStream);
  }

  return {
    uniqueCatalogEntries,
    uniqueFacilities,
    uniqueIssueLines,
    uniqueRows,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the dedup + canonicalization pipeline.
 *
 * Reads the workbook via the streaming parser, collapses byte-identical
 * duplicates on the 5-tuple key, and writes three NDJSON staging files
 * (catalog.ndjson, facilities.ndjson, issues.ndjson) into `stagingDir`.
 *
 * ## Null-key policy
 *
 * Surviving rows are *always* counted toward `sourceRowsRead`,
 * `duplicatesCollapsed`, and `uniqueIssueLines` regardless of which
 * fields are null — the issue stream is a faithful record of every
 * post-dedup line. The catalog / facility staging files are slightly
 * stricter:
 *   - `catalog.ndjson` skips rows where both `mfrCatNo` and
 *     `manufacturer` are null (no usable catalog identity).
 *   - `facilities.ndjson` skips rows where `mtfName` is null (no usable
 *     facility identity).
 * The downstream importer is therefore expected to tolerate issue rows
 * whose `mfrCatNo` / `manufacturerShort` / `mtfName` are null and
 * either drop them or carry them as "unknown" entities.
 *
 * Returns a {@link DedupReport} summarizing what was written.
 */
export async function runDedupPipeline(
  options: DedupOptions,
): Promise<DedupReport> {
  const { inputXlsx, stagingDir, maxRows, sortBufferSize = "256M" } = options;
  const absStaging = resolve(stagingDir);
  mkdirSync(absStaging, { recursive: true });

  await assertGnuSortAvailable();

  const workDir = await mkdtemp(join(tmpdir(), "supply-dedup-"));
  try {
    const inputAbs = resolve(inputXlsx);

    const { sourceRowsRead, unsortedPath } = await phase1WriteTsv(
      inputAbs,
      workDir,
      maxRows,
    );
    const sortedPath = await phase2Sort(unsortedPath, workDir, sortBufferSize);
    const counts = await phase3Emit(sortedPath, absStaging);

    return {
      sourceRowsRead,
      duplicatesCollapsed: sourceRowsRead - counts.uniqueRows,
      uniqueCatalogEntries: counts.uniqueCatalogEntries,
      uniqueFacilities: counts.uniqueFacilities,
      uniqueIssueLines: counts.uniqueIssueLines,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
