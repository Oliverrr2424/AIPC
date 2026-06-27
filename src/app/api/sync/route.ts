import { NextResponse } from "next/server";
import { syncPrices } from "@/lib/pricing/syncPrices";
import { syncBenchmarks } from "@/lib/benchmarks/benchmarkDb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  // Vercel Cron sends "CRON" header, or bearer via SYNC_API_TOKEN env.
  const token = process.env.SYNC_API_TOKEN;
  if (!token) return process.env.NODE_ENV === "development"; // open in dev by default
  const auth = req.headers.get("authorization") ?? "";
  const cronHeader = req.headers.get("x-vercel-cron") ?? "";
  return auth === `Bearer ${token}` || cronHeader === "1";
}

// POST /api/sync?source=prices|benchmarks|all
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? "all";
  const result: Record<string, unknown> = {};
  if (source === "prices" || source === "all") {
    result.prices = await syncPrices();
  }
  if (source === "benchmarks" || source === "all") {
    result.benchmarks = await syncBenchmarks();
  }
  return NextResponse.json({ ok: true, source, result });
}
