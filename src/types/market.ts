export type MarketAvailability = "in_stock" | "out_of_stock" | "unknown";
export type MarketTrend = "falling" | "stable" | "rising" | "insufficient";

export interface MarketSignal {
  partId: string;
  effectivePriceUsd: number;
  listPriceUsd: number;
  retailer?: string;
  region?: string;
  url?: string | null;
  capturedAt?: string;
  availability: MarketAvailability;
  isStale: boolean;
  usedFallback: boolean;
  sampleCount30d: number;
  min30d?: number;
  max30d?: number;
  avg30d?: number;
  change30dPct?: number;
  discountVs30dAvgPct?: number;
  trend: MarketTrend;
  confidence: number;
  marketScore: number;
}

export interface BuildMarketSummary {
  asOf: string;
  region: string;
  livePricedParts: number;
  fallbackPricedParts: number;
  parts: Record<string, MarketSignal>;
}
