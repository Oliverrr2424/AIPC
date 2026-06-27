// Price provider abstraction. Each retailer plugs in here so the sync
// orchestrator can mix sources without caring about their HTTP shape.

export interface PriceQuote {
  partId: string;
  retailer: string;
  region: string;
  priceUsd: number;
  currency: string;
  inStock: boolean;
  url?: string;
  capturedAt?: Date;
}

export interface PriceProvider {
  readonly name: string;
  readonly region: string;
  /** True when the provider needs an API key from env to function. */
  requiresKey: boolean;
  /** Whether the key/config is present and the provider is ready to call. */
  isConfigured(): boolean;
  /** Fetch a live quote for one part. Return null when no match is found. */
  fetchQuote(part: { id: string; name: string; brand: string; category: string }): Promise<PriceQuote | null>;
  /** Fetch quotes for many parts in one batch (usually one HTTP call per category). */
  fetchMany(parts: { id: string; name: string; brand: string; category: string }[]): Promise<PriceProviderResult>;
}

export interface PriceProviderResult {
  quotes: PriceQuote[];
  errors: string[];
  provider: string;
}
