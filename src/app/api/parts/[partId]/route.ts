import { NextResponse } from "next/server";
import { getPriceStats } from "@/lib/pricing/priceHistory";
import { getBenchmarksForPart } from "@/lib/benchmarks/benchmarkDb";

export const dynamic = "force-dynamic";

// GET /api/parts/[partId] — current price, 30d stats, price history, benchmarks.
export async function GET(_req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const { partId } = await params;
  if (!partId) return NextResponse.json({ error: "partId required" }, { status: 400 });
  const [priceStats, benchmarks] = await Promise.all([
    getPriceStats(partId, 30),
    getBenchmarksForPart(partId),
  ]);
  return NextResponse.json({ partId, price: priceStats, benchmarks });
}
