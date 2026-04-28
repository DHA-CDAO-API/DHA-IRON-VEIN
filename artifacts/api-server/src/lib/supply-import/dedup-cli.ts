/**
 * CLI entry point for the dedup pipeline.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/lib/supply-import/dedup-cli.ts <xlsx> <stagingDir> [--max-rows N]
 *
 * Writes catalog.ndjson, facilities.ndjson, and issues.ndjson into
 * <stagingDir> and prints a small report to stdout. Does not touch the
 * database.
 */

import { resolve } from "node:path";

import { runDedupPipeline } from "./dedup.js";

interface CliArgs {
  xlsx: string;
  stagingDir: string;
  maxRows?: number;
}

function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let maxRows: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-rows" && argv[i + 1]) {
      maxRows = Number(argv[i + 1]);
      i++;
    } else if (a === "--help" || a === "-h") {
      printUsageAndExit(0);
    } else {
      positional.push(a);
    }
  }
  if (positional.length < 2) {
    printUsageAndExit(2);
  }
  return {
    xlsx: positional[0],
    stagingDir: positional[1],
    maxRows,
  };
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log(
    "Usage: dedup-cli.ts <xlsx> <stagingDir> [--max-rows N]\n" +
      "\n" +
      "Reads the supply workbook at <xlsx>, collapses byte-identical\n" +
      "duplicate rows, and writes catalog.ndjson, facilities.ndjson, and\n" +
      "issues.ndjson into <stagingDir>.",
  );
  process.exit(code);
}

async function main(): Promise<void> {
  const { xlsx, stagingDir, maxRows } = parseCliArgs(process.argv.slice(2));
  const inputAbs = resolve(xlsx);
  const stagingAbs = resolve(stagingDir);

  // eslint-disable-next-line no-console
  console.log(
    `Dedup pipeline starting\n  input:   ${inputAbs}\n  staging: ${stagingAbs}` +
      (maxRows !== undefined ? `\n  maxRows: ${maxRows}` : ""),
  );

  const started = Date.now();
  const report = await runDedupPipeline({
    inputXlsx: inputAbs,
    stagingDir: stagingAbs,
    maxRows,
  });
  const elapsedMs = Date.now() - started;
  const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

  // eslint-disable-next-line no-console
  console.log(
    `Done in ${elapsedMs}ms (heapUsedMB=${heapMB})\n` +
      `  sourceRowsRead:       ${report.sourceRowsRead}\n` +
      `  duplicatesCollapsed:  ${report.duplicatesCollapsed}\n` +
      `  uniqueCatalogEntries: ${report.uniqueCatalogEntries}\n` +
      `  uniqueFacilities:     ${report.uniqueFacilities}\n` +
      `  uniqueIssueLines:     ${report.uniqueIssueLines}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
