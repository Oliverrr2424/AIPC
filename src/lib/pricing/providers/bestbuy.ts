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
  // BestBuy query syntax: (search=foo&manufacturer=bar)
  const name = part.name.replace(/["()]/g, "").slice(0, 60);
  const brand = part.brand.slice(0, 30);
  const escaped = encodeURIComponent(`(search=${name})`);
  return `(${escaped})`;
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
    const url = `${BASE}/products${buildQuery(part)}?format=json&apiKey=${this.apiKey}&show=sku,name,regularPrice,salePrice,onSale,onlineAvailability,addToCartUrl,url&pageSize=1`;
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
