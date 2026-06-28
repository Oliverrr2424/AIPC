import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import rawKnowledge from "../src/data/knowledge.json";
import type { KnowledgeChunk } from "../src/types/knowledge";

loadEnvConfig(process.cwd());

function contentHash(chunk: KnowledgeChunk) {
  return createHash("sha256").update(JSON.stringify({ title: chunk.title, content: chunk.content, tags: chunk.tags, category: chunk.category, partId: chunk.partId })).digest("hex");
}

async function main() {
  const [{ Prisma, PrismaClient }, embedding] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/rag/embeddings"),
  ]);
  const prisma = new PrismaClient();
  const chunks = rawKnowledge as KnowledgeChunk[];
  const model = embedding.embeddingModel();
  let embedded = 0;
  let skipped = 0;

  try {
    if (!embedding.embeddingsConfigured()) throw new Error("Embeddings not configured. Set EMBEDDING_PROVIDER and the matching credentials (GEMINI_API_KEY for gemini, OLLAMA_EMBEDDING_URL for ollama) in .env.local before running rag:index.");
    for (const chunk of chunks) {
      const hash = contentHash(chunk);
      const state = await prisma.$queryRaw<Array<{ current: boolean }>>(Prisma.sql`
        SELECT ("embedding" IS NOT NULL AND "contentHash" = ${hash} AND "embeddingModel" = ${model}) AS "current"
        FROM "KnowledgeChunk" WHERE "id" = ${chunk.id}
      `);
      await prisma.knowledgeChunk.upsert({
        where: { id: chunk.id },
        create: {
          id: chunk.id, title: chunk.title, content: chunk.content, tags: chunk.tags,
          category: chunk.category || null, partId: chunk.partId || null,
          sourceUrl: chunk.sourceUrl || null, sourceTitle: chunk.sourceTitle || "AIPC curated knowledge base",
          contentHash: hash,
        },
        update: {
          title: chunk.title, content: chunk.content, tags: chunk.tags,
          category: chunk.category || null, partId: chunk.partId || null,
          sourceUrl: chunk.sourceUrl || null, sourceTitle: chunk.sourceTitle || "AIPC curated knowledge base",
          contentHash: hash,
        },
      });
      if (state[0]?.current) { skipped++; continue; }
      const values = await embedding.embedText(embedding.chunkEmbeddingText(chunk), "document");
      const vector = embedding.vectorLiteral(values);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "KnowledgeChunk" SET "embedding" = ${vector}::vector, "embeddingModel" = ${model}, "updatedAt" = NOW()
        WHERE "id" = ${chunk.id}
      `);
      embedded++;
      console.log(`[rag:index] ${embedded}/${chunks.length} ${chunk.id}`);
    }
    console.log(`[rag:index] complete: ${embedded} embedded, ${skipped} unchanged, model=${model}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(`[rag:index] failed: ${error instanceof Error ? error.message : error}`); process.exit(1); });
