import { prisma } from "@/lib/db/client";
import type { BuildMarketSummary, MarketSignal, MarketTrend } from "@/types/market";
import type { Part } from "@/types/parts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;

type Snapshot = {
  partId: string;
  retailer: string;
  region: string;
  priceUsd: number;
  inStock: boolean;
  url: string | null;
  capturedAt: Date;
};

export function marketRegion(country: "Canada" | "US" | "China") {
  return country === "Canada" ? "CA" : country === "China" ? "CN" : "US";
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fallbackSignal(part: Part): MarketSignal {
  return {
    partId: part.id,
    effectivePriceUsd: part.price,
    listPriceUsd: part.price,
    availability: "unknown",
    isStale: true,
    usedFallback: true,
    sampleCount30d: 0,
    trend: "insufficient",
    confidence: 0.15,
    marketScore: 25,
  };
}

function latestPerRetailer(rows: Snapshot[]) {
  const latest = new Map<string, Snapshot>();
  for (const row of rows) {
    const key = `${row.region}:${row.retailer}`;
    const prior = latest.get(key);
    if (!prior || prior.capturedAt < row.capturedAt) latest.set(key, row);
  }
  return [...latest.values()];
}

function trendFor(prices: number[], current: number): { trend: MarketTrend; change?: number } {
  if (prices.length < 2 || prices[0] <= 0) return { trend: "insufficient" };
  const change = round(((current - prices[0]) / prices[0]) * 100, 1);
  return { trend: change <= -3 ? "falling" : change >= 3 ? "rising" : "stable", change };
}

function buildSignal(part: Part, inputRows: Snapshot[], requestedRegion: string): MarketSignal {
  if (!inputRows.length) return fallbackSignal(part);

  // Only the requested region's snapshots are a valid market price. A US request
  // with no US data must NOT adopt a Canadian retailer price as the effective
  // price — fall back to the region-neutral catalog price with low confidence.
  const regional = inputRows.filter(row => row.region === requestedRegion);
  if (!regional.length) return fallbackSignal(part);
  const rows = regional;
  const latest = latestPerRetailer(rows);
  const realLatest = latest.filter(row => row.retailer !== "list");
  const stocked = realLatest.filter(row => row.inStock);
  const chosen = [...(stocked.length ? stocked : realLatest)].sort((a, b) => a.priceUsd - b.priceUsd || b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  if (!chosen) return fallbackSignal(part);

  const history = rows
    .filter(row => row.retailer === chosen.retailer && row.priceUsd > 0)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const prices = history.map(row => row.priceUsd);
  const min30d = prices.length ? Math.min(...prices) : undefined;
  const max30d = prices.length ? Math.max(...prices) : undefined;
  const avg30d = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : undefined;
  const { trend, change } = trendFor(prices, chosen.priceUsd);
  const discount = avg30d && avg30d > 0 ? round(((avg30d - chosen.priceUsd) / avg30d) * 100, 1) : undefined;
  const ageDays = Math.max(0, (Date.now() - chosen.capturedAt.getTime()) / DAY_MS);
  const isStale = ageDays > 1;
  const freshness = ageDays <= 1 ? 100 : ageDays <= 3 ? 78 : ageDays <= 7 ? 52 : 20;
  const availability = chosen.inStock ? "in_stock" as const : "out_of_stock" as const;
  const availabilityScore = chosen.inStock ? 100 : 0;
  const dealScore = Math.max(0, Math.min(100, 50 + (discount ?? 0) * 2 + (trend === "falling" ? 8 : trend === "rising" ? -8 : 0)));
  const regionConfidence = 1;
  const historyConfidence = Math.min(1, 0.45 + prices.length / 10);
  const confidence = round(regionConfidence * historyConfidence * (isStale ? 0.72 : 1), 2);
  const marketScore = round(availabilityScore * 0.5 + freshness * 0.25 + dealScore * 0.15 + confidence * 100 * 0.1, 1);

  return {
    partId: part.id,
    effectivePriceUsd: round(chosen.priceUsd),
    listPriceUsd: part.price,
    retailer: chosen.retailer,
    region: chosen.region,
    url: chosen.url,
    capturedAt: chosen.capturedAt.toISOString(),
    availability,
    isStale,
    usedFallback: false,
    sampleCount30d: prices.length,
    min30d: min30d == null ? undefined : round(min30d),
    max30d: max30d == null ? undefined : round(max30d),
    avg30d: avg30d == null ? undefined : round(avg30d),
    change30dPct: change,
    discountVs30dAvgPct: discount,
    trend,
    confidence,
    marketScore,
  };
}

export async function getMarketSignals(catalog: Part[], country: "Canada" | "US" | "China"): Promise<Map<string, MarketSignal>> {
  const requestedRegion = marketRegion(country);
  const fallback = new Map(catalog.map(part => [part.id, fallbackSignal(part)]));
  if (!catalog.length) return fallback;
  try {
    const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
    const rows = await prisma.priceSnapshot.findMany({
      where: { partId: { in: catalog.map(part => part.id) }, capturedAt: { gte: since } },
      orderBy: { capturedAt: "desc" },
    });
    const grouped = new Map<string, Snapshot[]>();
    for (const row of rows) {
      const group = grouped.get(row.partId) ?? [];
      group.push(row);
      grouped.set(row.partId, group);
    }
    return new Map(catalog.map(part => [part.id, buildSignal(part, grouped.get(part.id) ?? [], requestedRegion)]));
  } catch {
    // Recommendation remains available during DB outages, but every fallback is
    // explicitly low-confidence and receives no live-stock advantage.
    return fallback;
  }
}

export function withMarketPrice<T extends Part>(part: T, signal?: MarketSignal): T {
  return signal && !signal.usedFallback ? { ...part, price: signal.effectivePriceUsd } : part;
}

export function summarizeBuildMarket(parts: Part[], signals: Map<string, MarketSignal>, region: string): BuildMarketSummary {
  const selected = Object.fromEntries(parts.map(part => [part.id, signals.get(part.id) ?? fallbackSignal(part)]));
  const values = Object.values(selected);
  return {
    asOf: new Date().toISOString(),
    region,
    livePricedParts: values.filter(signal => !signal.usedFallback).length,
    fallbackPricedParts: values.filter(signal => signal.usedFallback).length,
    parts: selected,
  };
}
