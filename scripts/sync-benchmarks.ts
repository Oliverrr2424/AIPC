// Benchmark sync CLI — loads curated public benchmark data into the DB.
// Re-runnable: skips rows that already exist.
//
// Usage:
//   npm run sync:benchmarks

import { syncBenchmarks } from "../src/lib/benchmarks/benchmarkDb";

async function main() {
  console.log(`[sync-benchmarks] starting at ${new Date().toISOString()}`);
  const { written, skipped } = await syncBenchmarks();
  console.log(`[sync-benchmarks] ✓ ${written} written, ${skipped} skipped.`);
}

main().catch((err) => { console.error("[sync-benchmarks] failed:", err); process.exit(1); });
