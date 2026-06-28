import { NextResponse } from "next/server";
import { syncPrices } from "@/lib/pricing/syncPrices";
import { syncBenchmarks } from "@/lib/benchmarks/benchmarkDb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const tokens = [process.env.CRON_SECRET, process.env.SYNC_API_TOKEN].filter(Boolean);
  if (tokens.length === 0) return process.env.NODE_ENV === "development";
  const auth = req.headers.get("authorization") ?? "";
  return tokens.some((token) => auth === `Bearer ${token}`);
}

async function handleSync(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? "all";
  if (!new Set(["prices", "benchmarks", "all"]).has(source)) {
    return NextResponse.json({ error: "source must be prices, benchmarks, or all" }, { status: 400 });
  }
  const result: Record<string, unknown> = {};
  if (source === "prices" || source === "all") {
    result.prices = await syncPrices();
  }
  if (source === "benchmarks" || source === "all") {
    result.benchmarks = await syncBenchmarks();
  }
  return NextResponse.json({ ok: true, source, result });
}

// Vercel Cron invokes GET; POST remains available for manual/admin triggers.
export const GET = handleSync;
export const POST = handleSync;
