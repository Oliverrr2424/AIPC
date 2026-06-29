// Import normalized CA retailer crawl data into the local PostgreSQL catalog.
//
// Reads <dir>/parts.json and <dir>/snapshots.json (produced by normalize.mjs
// and scp'd back from the Canadian host). For each part: upsert into the Part
// table (so PriceSnapshot foreign keys resolve and the catalog is complete).
// For each snapshot: append a PriceSnapshot row tagged region="CA",
// currency="CAD" (priceUsd holds the Frankfurter-converted USD value; the raw
// CAD amount is kept in the archived source file). Records a SyncRun.
//
// Usage: npm run import:ca -- --dir=outputs/ca-crawl-20260629

import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

function specsJson(part: Record<string, unknown>) {
  const {
    id, category, name, brand, price, currency, imageUrl, productUrl,
    specSourceUrl, priceSourceUrl, priceKind, priceAsOf, tags, summary,
    ...rest
  } = part as Record<string, unknown>;
  void id; void category; void name; void brand; void price; void currency;
  void imageUrl; void productUrl; void specSourceUrl; void priceSourceUrl;
  void priceKind; void priceAsOf; void tags; void summary;
  return rest as object;
}

async function readJson(file: string): Promise<any[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`[import:ca] could not read ${file} — treating as empty`);
    return [];
  }
}

async function main() {
  const arg = process.argv.find(a => a.startsWith("--dir="));
  const dir = arg ? path.resolve(arg.slice(6)) : path.resolve(`outputs/ca-crawl-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  console.log(`[import:ca] reading from ${dir}`);
  const partsFile = path.join(dir, "parts.json");
  const snapshotsFile = path.join(dir, "snapshots.json");
  const parts = await readJson(partsFile);
  const snapshots = await readJson(snapshotsFile);
  console.log(`[import:ca] ${parts.length} parts, ${snapshots.length} snapshots`);

  // Reset previously imported CA data so re-runs don't accumulate duplicate
  // append-only snapshots. Removing ca-* Parts also cascades to their snapshots.
  const delSnaps = await prisma.priceSnapshot.deleteMany({ where: { region: "CA", retailer: { in: ["newegg", "canadacomputers"] } } });
  const delParts = await prisma.part.deleteMany({ where: { id: { startsWith: "ca-" } } });
  console.log(`[import:ca] reset: removed ${delParts.count} ca-* parts, ${delSnaps.count} CA snapshots`);

  const startedAt = new Date();
  let partsWritten = 0;
  let partsSkipped = 0;

  // 1) Upsert Parts so the PriceSnapshot FK is satisfied. Mirrors scripts/seed.ts.
  for (const part of parts) {
    if (!part || !part.id || !part.category) { partsSkipped++; continue; }
    const listPriceUsd = typeof part.price === "number" ? part.price : 0;
    await prisma.part.upsert({
      where: { id: part.id },
      create: {
        id: part.id,
        category: part.category,
        name: part.name,
        brand: part.brand ?? "Unknown",
        chipset: "chipset" in part ? (part as { chipset?: string }).chipset ?? null : null,
        imageUrl: part.imageUrl ?? null,
        productUrl: part.productUrl ?? null,
        specSourceUrl: part.specSourceUrl ?? null,
        priceSourceUrl: part.priceSourceUrl ?? null,
        priceKind: part.priceKind ?? "retail",
        priceAsOf: part.priceAsOf ? new Date(part.priceAsOf) : null,
        tags: part.tags ?? [],
        summary: part.summary ?? "",
        specsJson: specsJson(part),
        listPriceUsd,
      },
      update: {
        name: part.name,
        brand: part.brand ?? "Unknown",
        chipset: "chipset" in part ? (part as { chipset?: string }).chipset ?? null : null,
        imageUrl: part.imageUrl ?? null,
        productUrl: part.productUrl ?? null,
        specSourceUrl: part.specSourceUrl ?? null,
        priceSourceUrl: part.priceSourceUrl ?? null,
        priceKind: part.priceKind ?? "retail",
        priceAsOf: part.priceAsOf ? new Date(part.priceAsOf) : null,
        tags: part.tags ?? [],
        summary: part.summary ?? "",
        specsJson: specsJson(part),
        listPriceUsd,
      },
    });
    partsWritten++;
  }
  console.log(`[import:ca] parts upserted=${partsWritten} skipped=${partsSkipped}`);

  // 2) Append PriceSnapshot rows (region=CA, currency=CAD). Append-only by design.
  let snapshotsWritten = 0;
  for (const s of snapshots) {
    if (!s || !s.partId || !s.retailer) continue;
    await prisma.priceSnapshot.create({
      data: {
        partId: s.partId,
        retailer: s.retailer,
        region: s.region ?? "CA",
        priceUsd: s.priceUsd,
        currency: s.currency ?? "CAD",
        inStock: s.inStock ?? true,
        url: s.url ?? null,
        capturedAt: s.capturedAt ? new Date(s.capturedAt) : new Date(),
      },
    });
    snapshotsWritten++;
  }
  console.log(`[import:ca] price snapshots written=${snapshotsWritten}`);

  // 3) Record the sync run.
  await prisma.syncRun.create({
    data: {
      source: "ca-crawl-newegg+canadacomputers",
      status: snapshotsWritten > 0 ? "ok" : "partial",
      partsTouched: partsWritten,
      error: snapshotsWritten === 0 ? "no snapshots written" : null,
      startedAt,
      finishedAt: new Date(),
    },
  });

  // 4) Quick verification: count CA-region snapshots now in the DB.
  const caCount = await prisma.priceSnapshot.count({ where: { region: "CA" } });
  console.log(`[import:ca] total PriceSnapshot rows with region=CA in DB: ${caCount}`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
