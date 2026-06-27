// Sync orchestrator: pulls quotes from configured providers, writes one
// PriceSnapshot per (part, retailer, timestamp), and logs a SyncRun.
// Designed to be called by the cron script OR the /api/sync route.

import { prisma } from "@/lib/db/client";
import { parts } from "@/data/parts";
import type { PriceProvider, PriceQuote } from "./providers/types";
import { BestBuyProvider } from "./providers/bestbuy";
import { PCPartPickerProvider } from "./providers/pcpartpicker";
import { ListPriceProvider } from "./providers/listPrice";

export interface SyncPricesResult {
  source: string;
  status: "ok" | "partial" | "failed";
  partsTouched: number;
  quotesWritten: number;
  errors: string[];
}

function pickProviders(): PriceProvider[] {
  const list: PriceProvider[] = [];
  const bb = new BestBuyProvider();
  if (bb.isConfigured()) list.push(bb);
  list.push(new PCPartPickerProvider()); // fallback (no key needed)
  list.push(new ListPriceProvider());    // last-resort baseline
  return list;
}

export async function syncPrices(opts: { partIds?: string[]; provider?: string } = {}): Promise<SyncPricesResult[]> {
  const targets = opts.partIds
    ? parts.filter(p => opts.partIds!.includes(p.id))
    : parts;
  const providers = pickProviders().filter(p => !opts.provider || p.name === opts.provider);
  const results: SyncPricesResult[] = [];

  for (const provider of providers) {
    const startedAt = new Date();
    const result = await provider.fetchMany(targets.map(p => ({ id: p.id, name: p.name, brand: p.brand, category: p.category })));
    let written = 0;
    for (const quote of result.quotes) {
      await writeSnapshot(quote);
      written++;
    }
    const status = result.errors.length === 0 ? "ok" : (written === 0 ? "failed" : "partial");
    await prisma.syncRun.create({
      data: {
        source: `prices-${provider.name}`,
        status,
        partsTouched: written,
        error: result.errors.slice(0, 5).join(" | ") || null,
        startedAt,
        finishedAt: new Date(),
      },
    });
    results.push({
      source: provider.name,
      status,
      partsTouched: written,
      quotesWritten: written,
      errors: result.errors,
    });
  }
  return results;
}

export async function writeSnapshot(quote: PriceQuote): Promise<void> {
  await prisma.priceSnapshot.create({
    data: {
      partId: quote.partId,
      retailer: quote.retailer,
      region: quote.region,
      priceUsd: quote.priceUsd,
      currency: quote.currency,
      inStock: quote.inStock,
      url: quote.url,
      capturedAt: quote.capturedAt ?? new Date(),
    },
  });
}
