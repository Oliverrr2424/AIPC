// Seed the DB with canonical parts from parts.ts and write an initial
// price snapshot (using list prices) so the historical chart has a baseline.
// Run with: DATABASE_URL="file:./dev.db" npx tsx scripts/seed.ts

import { PrismaClient } from "@prisma/client";
import { parts } from "../src/data/parts";
import benchmarkSeed from "../src/data/benchmarks.json";

const prisma = new PrismaClient();

function specsJson(part: typeof parts[number]): string {
  // Strip top-level catalog fields, keep category-specific spec fields.
  const { id, category, name, brand, price, currency, imageUrl, productUrl, tags, summary, ...rest } = part;
  void id; void category; void name; void brand; void price; void currency; void imageUrl; void productUrl; void tags; void summary;
  return JSON.stringify(rest);
}

async function main() {
  console.log("Seeding parts...");
  for (const part of parts) {
    await prisma.part.upsert({
      where: { id: part.id },
      create: {
        id: part.id,
        category: part.category,
        name: part.name,
        brand: part.brand,
        chipset: "chipset" in part ? (part as { chipset?: string }).chipset ?? null : null,
        imageUrl: part.imageUrl ?? null,
        productUrl: part.productUrl ?? null,
        tags: part.tags.join(","),
        summary: part.summary,
        specsJson: specsJson(part),
        listPriceUsd: part.currency === "USD" ? part.price : part.price,
      },
      update: {
        name: part.name,
        brand: part.brand,
        tags: part.tags.join(","),
        summary: part.summary,
        specsJson: specsJson(part),
        listPriceUsd: part.price,
      },
    });
  }
  console.log(`✓ ${parts.length} parts seeded`);

  // Write a baseline "list" price snapshot so the chart has a starting point.
  console.log("Writing baseline price snapshots...");
  const now = new Date();
  for (const part of parts) {
    await prisma.priceSnapshot.create({
      data: {
        partId: part.id,
        retailer: "list",
        region: "US",
        priceUsd: part.price,
        currency: "USD",
        inStock: true,
        capturedAt: now,
      },
    });
  }
  console.log(`✓ ${parts.length} baseline snapshots written`);

  // Seed benchmark data.
  console.log("Seeding benchmark data...");
  const seedRows = (benchmarkSeed as { results: Array<Record<string, unknown>> }).results;
  let written = 0;
  let skipped = 0;
  for (const row of seedRows) {
    const existing = await prisma.benchmarkResult.findFirst({
      where: {
        partId: row.partId as string,
        benchmarkKey: row.benchmarkKey as string,
        resolution: (row.resolution as string | undefined) ?? null,
        quality: (row.quality as string | undefined) ?? null,
      },
    });
    if (existing) { skipped++; continue; }
    await prisma.benchmarkResult.create({
      data: {
        partId: row.partId as string,
        benchmarkKey: row.benchmarkKey as string,
        benchmarkKind: row.benchmarkKind as string,
        workload: row.workload as string,
        resolution: (row.resolution as string | undefined) ?? null,
        quality: (row.quality as string | undefined) ?? null,
        value: row.value as number,
        unit: row.unit as string,
        sourceName: row.sourceName as string,
        sourceUrl: (row.sourceUrl as string | undefined) ?? null,
      },
    });
    written++;
  }
  console.log(`✓ ${written} benchmark rows written, ${skipped} skipped (already present)`);

  await prisma.syncRun.create({
    data: { source: "seed-script", status: "ok", partsTouched: parts.length, finishedAt: new Date() },
  });
  console.log("✓ Seed complete.");
}

main()
  .catch((err) => { console.error("Seed failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
