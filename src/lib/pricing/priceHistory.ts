// Read-side helpers for current price + historical price series.
// Used by the UI (PriceChart) and the API routes.

import { prisma } from "@/lib/db/client";

export interface PricePoint {
  date: string;       // ISO date (YYYY-MM-DD)
  retailer: string;
  priceUsd: number;
  inStock: boolean;
}

export interface CurrentPrice {
  partId: string;
  retailer: string;
  priceUsd: number;
  inStock: boolean;
  url?: string | null;
  capturedAt: string;
  isStale: boolean;     // true if older than 24h
}

const STALE_MS = 24 * 60 * 60 * 1000;

export async function getCurrentPrice(partId: string): Promise<CurrentPrice | null> {
  const latest = await prisma.priceSnapshot.findFirst({
    where: { partId },
    orderBy: { capturedAt: "desc" },
  });
  if (!latest) return null;
  const age = Date.now() - latest.capturedAt.getTime();
  return {
    partId,
    retailer: latest.retailer,
    priceUsd: latest.priceUsd,
    inStock: latest.inStock,
    url: latest.url,
    capturedAt: latest.capturedAt.toISOString(),
    isStale: age > STALE_MS,
  };
}

export async function getCurrentPrices(partIds: string[]): Promise<Map<string, CurrentPrice>> {
  const map = new Map<string, CurrentPrice>();
  // One query per part would be slow; Prisma supports distinct ordering via raw SQL on SQLite.
  // Simpler: fetch recent and dedupe in JS.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.priceSnapshot.findMany({
    where: { partId: { in: partIds }, capturedAt: { gte: since } },
    orderBy: { capturedAt: "desc" },
  });
  for (const row of rows) {
    if (map.has(row.partId)) continue;
    const age = Date.now() - row.capturedAt.getTime();
    map.set(row.partId, {
      partId: row.partId,
      retailer: row.retailer,
      priceUsd: row.priceUsd,
      inStock: row.inStock,
      url: row.url,
      capturedAt: row.capturedAt.toISOString(),
      isStale: age > STALE_MS,
    });
  }
  return map;
}

export async function getPriceHistory(partId: string, days = 30): Promise<PricePoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.priceSnapshot.findMany({
    where: { partId, capturedAt: { gte: since } },
    orderBy: { capturedAt: "asc" },
  });
  return rows.map(r => ({
    date: r.capturedAt.toISOString().slice(0, 10),
    retailer: r.retailer,
    priceUsd: r.priceUsd,
    inStock: r.inStock,
  }));
}

export interface PriceStats {
  current: number | null;
  min30d: number | null;
  max30d: number | null;
  avg30d: number | null;
  change30d: number | null;   // percent vs 30d ago, null if not enough data
  history: PricePoint[];
}

export async function getPriceStats(partId: string, days = 30): Promise<PriceStats> {
  const [history, currentRow] = await Promise.all([
    getPriceHistory(partId, days),
    prisma.priceSnapshot.findFirst({ where: { partId }, orderBy: { capturedAt: "desc" } }),
  ]);
  const prices = history.map(h => h.priceUsd);
  const current = currentRow?.priceUsd ?? null;
  if (prices.length === 0) {
    return { current, min30d: null, max30d: null, avg30d: null, change30d: null, history: [] };
  }
  const min30d = Math.min(...prices);
  const max30d = Math.max(...prices);
  const avg30d = prices.reduce((a, b) => a + b, 0) / prices.length;
  let change30d: number | null = null;
  if (current != null && prices.length >= 2) {
    const earliest = prices[0];
    if (earliest > 0) change30d = Math.round(((current - earliest) / earliest) * 1000) / 10;
  }
  return { current, min30d, max30d, avg30d, change30d, history };
}
