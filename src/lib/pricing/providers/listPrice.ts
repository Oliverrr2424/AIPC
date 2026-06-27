// Always-available fallback provider that returns the static list price
// from parts.ts. Used when no live provider is configured so the historical
// chart still has a baseline, and the UI can always show *something*.

import type { PriceProvider, PriceQuote, PriceProviderResult } from "./types";
import { partById } from "@/data/parts";

export class ListPriceProvider implements PriceProvider {
  readonly name = "list";
  readonly region = "US";
  requiresKey = false;

  isConfigured(): boolean {
    return true;
  }

  async fetchQuote(part: { id: string; name: string; brand: string; category: string }): Promise<PriceQuote | null> {
    const record = partById(part.id);
    if (!record) return null;
    return {
      partId: part.id,
      retailer: this.name,
      region: this.region,
      priceUsd: record.price,
      currency: record.currency,
      inStock: true,
    };
  }

  async fetchMany(parts: { id: string; name: string; brand: string; category: string }[]): Promise<PriceProviderResult> {
    const quotes: PriceQuote[] = [];
    const errors: string[] = [];
    for (const part of parts) {
      const quote = await this.fetchQuote(part);
      if (quote) quotes.push(quote);
      else errors.push(`${part.id}: not in parts.ts`);
    }
    return { quotes, errors, provider: this.name };
  }
}
