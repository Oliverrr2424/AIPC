// BestBuy official Products API — North American (US/CA) price source.
// Docs: https://developer.bestbuy.com/documentation/products-api
// Requires BESTBUY_API_KEY in env. Returns null gracefully when no key set,
// so the app still works in dev without a real key (falls back to list price).

import type { PriceProvider, PriceQuote, PriceProviderResult } from "./types";

const BASE = "https://api.bestbuy.com/v1";

interface BestBuyProduct {
  sku?: number;
  name?: string;
  regularPrice?: number;
  salePrice?: number;
  onSale?: boolean;
  inStoreAvailability?: boolean;
  onlineAvailability?: boolean;
  addToCartUrl?: string;
  url?: string;
}

function buildQuery(part: { name: string; brand: string }): string {
  // Best Buy filters are part of the URL path. Encode values individually,
  // rather than encoding the entire `(search=...)` expression.
  const source = part.name.toLowerCase().includes(part.brand.toLowerCase())
    ? part.name
    : `${part.brand} ${part.name}`;
  const terms = source
    .replace(/["()]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .slice(0, 8);
  return `(${terms.map((term) => `search=${encodeURIComponent(term)}`).join("&")})`;
}

export function buildBestBuyProductsUrl(
  part: { name: string; brand: string },
  apiKey: string,
): string {
  const params = new URLSearchParams({
    format: "json",
    apiKey,
    show: "sku,name,regularPrice,salePrice,onSale,onlineAvailability,addToCartUrl,url",
    pageSize: "1",
  });
  return `${BASE}/products${buildQuery(part)}?${params.toString()}`;
}

export class BestBuyProvider implements PriceProvider {
  readonly name = "bestbuy";
  readonly region = "US";
  requiresKey = true;

  constructor(private apiKey?: string) {
    this.apiKey = apiKey ?? process.env.BESTBUY_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 8);
  }

  async fetchQuote(part: { id: string; name: string; brand: string; category: string }): Promise<PriceQuote | null> {
    if (!this.isConfigured()) return null;
    const url = buildBestBuyProductsUrl(part, this.apiKey!);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = (await res.json()) as { products?: BestBuyProduct[] };
      const product = data.products?.[0];
      if (!product || product.regularPrice == null) return null;
      const price = product.salePrice ?? product.regularPrice;
      return {
        partId: part.id,
        retailer: this.name,
        region: this.region,
        priceUsd: Math.round(price * 100) / 100,
        currency: "USD",
        inStock: product.onlineAvailability !== false,
        url: product.addToCartUrl ?? product.url,
      };
    } catch {
      return null;
    }
  }

  async fetchMany(parts: { id: string; name: string; brand: string; category: string }[]): Promise<PriceProviderResult> {
    if (!this.isConfigured()) {
      return { quotes: [], errors: ["BESTBUY_API_KEY not configured"], provider: this.name };
    }
    const errors: string[] = [];
    const quotes: PriceQuote[] = [];
    for (const part of parts) {
      const quote = await this.fetchQuote(part);
      if (quote) quotes.push(quote);
      else errors.push(`${part.id}: no BestBuy match`);
    }
    return { quotes, errors, provider: this.name };
  }
}
