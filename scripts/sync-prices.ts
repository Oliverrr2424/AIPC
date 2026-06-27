// Price sync CLI — invoked by cron (vercel.json) or manually.
// Pulls live quotes from configured providers, writes PriceSnapshot rows,
// and logs a SyncRun. Idempotent: each run only appends new snapshots.
//
// Usage:
//   DATABASE_URL="file:./dev.db" npx tsx scripts/sync-prices.ts
//   DATABASE_URL="file:./dev.db" npx tsx scripts/sync-prices.ts --provider=bestbuy

import { syncPrices } from "../src/lib/pricing/syncPrices";

async function main() {
  const arg = process.argv.slice(2).find(a => a.startsWith("--provider="));
  const provider = arg?.split("=")[1];
  console.log(`[sync-prices] starting at ${new Date().toISOString()} provider=${provider ?? "all"}`);
  const results = await syncPrices({ provider });
  for (const r of results) {
    console.log(`  ${r.source}: ${r.status} | ${r.quotesWritten} quotes | ${r.errors.length} errors`);
    if (r.errors.length) console.log(`    first error: ${r.errors[0]}`);
  }
  console.log("[sync-prices] done.");
}

main().catch((err) => { console.error("[sync-prices] failed:", err); process.exit(1); });
