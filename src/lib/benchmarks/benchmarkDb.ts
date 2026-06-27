// Read-side helpers for benchmark data.
// Falls back to in-memory JSON when DB is empty (so the app works even
// before a sync has run). Always prefers DB rows when present.

import { prisma } from "@/lib/db/client";
import benchmarkSeed from "@/data/benchmarks.json";

export interface BenchmarkRow {
  partId: string;
  benchmarkKey: string;
  benchmarkKind: string;
  workload: string;
  resolution: string | null;
  quality: string | null;
  value: number;
  unit: string;
  sourceName: string;
  sourceUrl: string | null;
}

interface SeedRow {
  partId: string;
  benchmarkKey: string;
  benchmarkKind: string;
  workload: string;
  resolution?: string;
  quality?: string;
  value: number;
  unit: string;
  sourceName: string;
  sourceUrl?: string;
}

const seedRows: SeedRow[] = (benchmarkSeed as { results: SeedRow[] }).results;

export async function getBenchmarksForPart(partId: string): Promise<BenchmarkRow[]> {
  const dbRows = await prisma.benchmarkResult.findMany({ where: { partId } });
  if (dbRows.length > 0) {
    return dbRows.map(r => ({
      partId: r.partId,
      benchmarkKey: r.benchmarkKey,
      benchmarkKind: r.benchmarkKind,
      workload: r.workload,
      resolution: r.resolution,
      quality: r.quality,
      value: r.value,
      unit: r.unit,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
    }));
  }
  return seedRows.filter(r => r.partId === partId).map(r => ({
    partId: r.partId,
    benchmarkKey: r.benchmarkKey,
    benchmarkKind: r.benchmarkKind,
    workload: r.workload,
    resolution: r.resolution ?? null,
    quality: r.quality ?? null,
    value: r.value,
    unit: r.unit,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl ?? null,
  }));
}

export async function getBenchmark(partId: string, benchmarkKey: string, resolution?: string): Promise<BenchmarkRow | null> {
  const rows = await getBenchmarksForPart(partId);
  return rows.find(r => r.benchmarkKey === benchmarkKey && (resolution ? r.resolution === resolution : true)) ?? null;
}

export async function syncBenchmarks(): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const row of seedRows) {
    // Upsert by (partId, benchmarkKey, resolution, quality) composite.
    const existing = await prisma.benchmarkResult.findFirst({
      where: {
        partId: row.partId,
        benchmarkKey: row.benchmarkKey,
        resolution: row.resolution ?? null,
        quality: row.quality ?? null,
      },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.benchmarkResult.create({
      data: {
        partId: row.partId,
        benchmarkKey: row.benchmarkKey,
        benchmarkKind: row.benchmarkKind,
        workload: row.workload,
        resolution: row.resolution ?? null,
        quality: row.quality ?? null,
        value: row.value,
        unit: row.unit,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl ?? null,
      },
    });
    written++;
  }
  await prisma.syncRun.create({
    data: {
      source: "benchmarks-curated",
      status: "ok",
      partsTouched: written,
      finishedAt: new Date(),
    },
  });
  return { written, skipped };
}
