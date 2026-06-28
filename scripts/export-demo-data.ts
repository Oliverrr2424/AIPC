import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import knowledge from "../src/data/knowledge.json";
import { parts } from "../src/data/parts";

const outputDir = process.env.AIPC_EVAL_OUTPUT || path.join(process.cwd(), "outputs", "rag-5090-demo-20260628");
const prisma = new PrismaClient();

function specs(part: (typeof parts)[number]) {
  return Object.fromEntries(Object.entries(part).filter(([key]) => !["id", "category", "name", "brand", "price", "currency", "tags", "summary", "productUrl", "specSourceUrl", "priceSourceUrl", "priceKind", "priceAsOf", "imageUrl"].includes(key)));
}

async function main() {
try {
  const [partCount, priceCount, benchmarkCount, knowledgeCount] = await Promise.all([
    prisma.part.count(), prisma.priceSnapshot.count(), prisma.benchmarkResult.count(), prisma.knowledgeChunk.count(),
  ]);
  const payload = {
    generatedAt: new Date().toISOString(),
    database: { partCount, priceSnapshotCount: priceCount, benchmarkCount, knowledgeChunkCount: knowledgeCount },
    catalog: parts.map(part => ({
      id: part.id, category: part.category, name: part.name, brand: part.brand,
      referencePrice: part.price, currency: part.currency, priceKind: part.priceKind || "reference",
      priceAsOf: part.priceAsOf || "baseline seed", tags: part.tags.join(", "), summary: part.summary,
      specifications: specs(part), specSourceUrl: part.specSourceUrl || part.productUrl || "",
      priceSourceUrl: part.priceSourceUrl || part.productUrl || "",
    })),
    knowledge,
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "demo-catalog.json"), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.database));
} finally {
  await prisma.$disconnect();
}
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
