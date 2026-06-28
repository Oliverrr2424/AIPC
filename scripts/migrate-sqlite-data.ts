import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

interface LegacyPrice {
  id: string;
  partId: string;
  retailer: string;
  region: string;
  priceUsd: number;
  currency: string;
  inStock: number;
  url: string | null;
  capturedAt: number | string;
}

interface LegacySyncRun {
  id: string;
  source: string;
  status: string;
  partsTouched: number;
  error: string | null;
  startedAt: number | string;
  finishedAt: number | string | null;
}

function readJson<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function date(value: number | string) {
  return new Date(typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : value);
}

async function main() {
  const database = resolve(process.argv.find(arg => arg.startsWith("--from="))?.slice(7) || "prisma/dev.db");
  if (!existsSync(database)) throw new Error(`Legacy SQLite database not found: ${database}`);
  const prices = readJson<LegacyPrice>(database, "SELECT * FROM PriceSnapshot ORDER BY capturedAt");
  const runs = readJson<LegacySyncRun>(database, "SELECT * FROM SyncRun ORDER BY startedAt");
  const prisma = new PrismaClient();
  try {
    const priceResult = await prisma.priceSnapshot.createMany({
      data: prices.map(row => ({
        id: row.id, partId: row.partId, retailer: row.retailer, region: row.region,
        priceUsd: row.priceUsd, currency: row.currency, inStock: Boolean(row.inStock),
        url: row.url, capturedAt: date(row.capturedAt),
      })),
      skipDuplicates: true,
    });
    const runResult = await prisma.syncRun.createMany({
      data: runs.map(row => ({
        id: row.id, source: row.source, status: row.status, partsTouched: row.partsTouched,
        error: row.error, startedAt: date(row.startedAt), finishedAt: row.finishedAt == null ? null : date(row.finishedAt),
      })),
      skipDuplicates: true,
    });
    console.log(`[db:import-sqlite] ${priceResult.count}/${prices.length} price snapshots and ${runResult.count}/${runs.length} sync runs imported.`);
    console.log("[db:import-sqlite] Parts and benchmark rows intentionally come from the canonical seed to avoid duplicates.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(`[db:import-sqlite] failed: ${error instanceof Error ? error.message : error}`); process.exit(1); });
