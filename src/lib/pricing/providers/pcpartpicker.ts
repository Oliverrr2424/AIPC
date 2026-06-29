// PCPartPicker public-list price provider.
// PCPartPicker exposes a public per-category product listing with "buy" links
// aggregated from Newegg/Amazon/B&H/BestBuy. There is no official API, so we
// parse the public HTML/JSON the site already renders. This is a fallback for
// when BESTBUY_API_KEY is not configured. Treat responsibly and back off.

import type { PriceProvider, PriceQuote, PriceProviderResult } from "./types";

const BASE = process.env.PCPARTPARSER_BASE_URL ?? "https://pcpartpicker.com";

interface PcppRow {
  name: string;
  price: string | null;
  region: string;
  inStock: boolean;
  url?: string;
}

function categoryPath(category: string): string | null {
  switch (category) {
    case "cpu": return "cpu";
    case "gpu": return "video-card";
    case "motherboard": return "motherboard";
    case "ram": return "memory";
    case "storage": return "internal-hard-drive";
    case "cooler": return "cpu-cooler";
    case "psu": return "power-supply";
    case "case": return "case";
    default: return null;
  }
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/(\d+\.\d{2})/);
  return match ? Number(match[1]) : null;
}

// Very small HTML scraper that targets the product list rows.
// PCPartPicker renders a table with class "tr__product".
async function fetchCategoryRows(category: string): Promise<PcppRow[]> {
  const path = categoryPath(category);
  if (!path) return [];
  const url = `${BASE}/products/${path}/?sort=price&page=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AIPC-bot/1.0 (+https://github.com/Oliverrr2424/AIPC)" },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const rows: PcppRow[] = [];
    // Match a price + a name. Best-effort regex; not a full HTML parser.
    const rowRegex = /<tr[^>]*class="[^"]*tr__product[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRegex.exec(html)) !== null) {
      const rowHtml = m[1];
      const nameMatch = rowHtml.match(/<a[^>]*class="[^"]*td__name[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const priceMatch = rowHtml.match(/<td[^>]*class="[^"]*td__price[^"]*"[^>]*>[\s\S]*?(\$[\d,.]+)[\s\S]*?<\/td>/);
      const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      const price = priceMatch ? parsePrice(priceMatch[1]) : null;
      if (name) {
        rows.push({ name, price: price ? String(price) : null, region: "US", inStock: price != null });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function fuzzyMatch(part: { name: string; brand: string }, row: PcppRow): boolean {
  const target = `${part.brand} ${part.name}`.toLowerCase();
  const candidate = row.name.toLowerCase();
  // Require brand + first significant token of name to appear.
  const brandOk = candidate.includes(part.brand.toLowerCase());
  const token = part.name.toLowerCase().split(/\s+/).find(t => t.length > 2) ?? "";
  return brandOk && (token === "" || candidate.includes(token));
}

export class PCPartPickerProvider implements PriceProvider {
  readonly name = "pcpartpicker";
  readonly region = "US";
  requiresKey = false;

  isConfigured(): boolean {
    // Disabled by default. Catalog expansion uses a separately published,
    // MIT-licensed dataset instead of crawling retailer pages.
    return process.env.ENABLE_PCPARTPICKER_SCRAPE === "true";
  }

  async fetchQuote(part: { id: string; name: string; brand: string; category: string }): Promise<PriceQuote | null> {
    const rows = await fetchCategoryRows(part.category);
    const match = rows.find(row => fuzzyMatch(part, row));
    if (!match || !match.price) return null;
    const price = Number(match.price);
    if (!isFinite(price)) return null;
    return {
      partId: part.id,
      retailer: this.name,
      region: this.region,
      priceUsd: Math.round(price * 100) / 100,
      currency: "USD",
      inStock: match.inStock,
    };
  }

  async fetchMany(parts: { id: string; name: string; brand: string; category: string }[]): Promise<PriceProviderResult> {
    if (!this.isConfigured()) return { quotes: [], errors: ["PCPartPicker HTML scraping is disabled"], provider: this.name };
    const errors: string[] = [];
    const quotes: PriceQuote[] = [];
    // Group by category to reuse one fetch per category (be polite to the site).
    const byCategory = new Map<string, typeof parts>();
    for (const p of parts) {
      const arr = byCategory.get(p.category) ?? [];
      arr.push(p);
      byCategory.set(p.category, arr);
    }
    for (const [category, group] of byCategory) {
      const rows = await fetchCategoryRows(category);
      if (rows.length === 0) {
        errors.push(`${category}: PCPartPicker returned no rows`);
        continue;
      }
      for (const part of group) {
        const match = rows.find(row => fuzzyMatch(part, row));
        if (match && match.price) {
          const price = Number(match.price);
          if (isFinite(price)) {
            quotes.push({
              partId: part.id,
              retailer: this.name,
              region: this.region,
              priceUsd: Math.round(price * 100) / 100,
              currency: "USD",
              inStock: match.inStock,
            });
          } else errors.push(`${part.id}: unparseable price`);
        } else errors.push(`${part.id}: no PCPartPicker match`);
      }
    }
    return { quotes, errors, provider: this.name };
  }
}
