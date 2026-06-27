import { NextResponse } from "next/server";
import { getPriceHistory, getCurrentPrices } from "@/lib/pricing/priceHistory";

export const dynamic = "force-dynamic";

// GET /api/prices?partIds=a,b,c&days=30 — historical price series.
// GET /api/prices?partIds=a,b&current=1 — just current prices (cheaper).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const partIds = (url.searchParams.get("partIds") ?? "").split(",").filter(Boolean);
  if (partIds.length === 0) return NextResponse.json({ error: "partIds required" }, { status: 400 });
  if (url.searchParams.get("current") === "1") {
    const map = await getCurrentPrices(partIds);
    return NextResponse.json({ current: Object.fromEntries(map) });
  }
  const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days") ?? "30")));
  const history = await Promise.all(partIds.map(id => getPriceHistory(id, days)));
  const out: Record<string, { date: string; priceUsd: number; retailer: string; inStock: boolean }[]> = {};
  partIds.forEach((id, i) => { out[id] = history[i]; });
  return NextResponse.json({ history: out, days });
}
