/**
 * Smoke test for the streaming Supply workbook parser.
 *
 * Reads the first N rows (default 100) from the supply demo workbook,
 * prints them to stdout, and exits cleanly. Useful for local sanity
 * checking and for verifying that no full-sheet load is taking place.
 *
 * Run from the repo root with:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/lib/supply-import/smoke-test.ts
 *
 * Optional args:
 *   --file <path>    workbook path (defaults to attached_assets/...)
 *   --rows <n>       number of rows to print (default 100)
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSupplyWorkbook } from "./parse.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const DEFAULT_WORKBOOK = resolve(
  REPO_ROOT,
  "attached_assets/Supply_Demo_Data_2_1777401753577.xlsx",
);

function parseArgs(argv: string[]): { file: string; rows: number } {
  let file = DEFAULT_WORKBOOK;
  let rows = 100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) {
      file = argv[i + 1];
      i++;
    } else if (a === "--rows" && argv[i + 1]) {
      rows = Number(argv[i + 1]);
      i++;
    }
  }
  return { file, rows };
}

async function main(): Promise<void> {
  const { file, rows } = parseArgs(process.argv.slice(2));
  const filePath = resolve(file);

  // eslint-disable-next-line no-console
  console.log(`Streaming first ${rows} rows from ${filePath} ...`);
  const started = Date.now();

  let count = 0;
  for await (const row of parseSupplyWorkbook(filePath, { maxRows: rows })) {
    count++;
    // eslint-disable-next-line no-console
    console.log(`#${count}`, JSON.stringify(row));
  }

  const elapsedMs = Date.now() - started;
  const heap = process.memoryUsage().heapUsed;
  // eslint-disable-next-line no-console
  console.log(
    `Done. rows=${count} elapsed=${elapsedMs}ms heapUsedMB=${(heap / 1024 / 1024).toFixed(1)}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
