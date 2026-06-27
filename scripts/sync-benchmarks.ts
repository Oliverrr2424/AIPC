// Benchmark sync CLI — loads curated public benchmark data into the DB.
// Re-runnable: skips rows that already exist.
//
// Usage:
//   DATABASE_URL="file:./dev.db" npx tsx scripts/sync-benchmarks.ts

import { syncBenchmarks } from "../src/lib/benchmarks/benchmarkDb";

async function main() {
  console.log(`[sync-benchmarks] starting at ${new Date().toISOString()}`);
  const { written, skipped } = await syncBenchmarks();
  console.log(`[sync-benchmarks] ✓ ${written} written, ${skipped} skipped.`);
}

main().catch((err) => { console.error("[sync-benchmarks] failed:", err); process.exit(1); });
