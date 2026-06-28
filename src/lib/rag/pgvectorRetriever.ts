import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { KnowledgeRetriever } from "./retrieval";
import type { RetrievalOptions, RetrievedKnowledgeChunk } from "@/types/knowledge";
import { embedText, embeddingModel, embeddingProvider, embeddingsConfigured, vectorLiteral } from "./embeddings";

interface VectorRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: string | null;
  partId: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  similarity: number;
}

const expansions: Record<string, string[]> = {
  "升级": ["upgradeability", "planning", "motherboard", "am5"],
  "平台": ["motherboard", "planning", "upgradeability"],
  "白色": ["white"], "纯白": ["white"], "灯效": ["rgb"],
  "大模型": ["local-llm", "ai", "vram"], "显存": ["vram"],
  "高刷": ["high-fps"], "静音": ["quiet"], "小机箱": ["sff", "compact"],
};

function queryTerms(query: string) {
  const normalized = query.toLowerCase();
  const terms = new Set(normalized.match(/[\p{L}\p{N}]+/gu) || []);
  for (const [phrase, values] of Object.entries(expansions)) if (normalized.includes(phrase)) values.forEach(value => terms.add(value));
  if (/\b4k\b/i.test(query)) terms.add("4k");
  if (/240\s*(?:hz|fps)/i.test(query)) terms.add("240fps");
  return [...terms];
}

function lexicalTerms(query: string, row: VectorRow) {
  const terms = queryTerms(query);
  const haystack = `${row.title} ${row.content} ${row.tags.join(" ")}`.toLowerCase();
  return [...new Set(terms.filter(term => term.length > 1 && haystack.includes(term)))];
}

export function vectorDatabaseConfigured() {
  return /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "");
}

export function semanticRetrievalConfigured() {
  return vectorDatabaseConfigured() && embeddingsConfigured();
}

export class PgVectorKnowledgeRetriever implements KnowledgeRetriever {
  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievedKnowledgeChunk[]> {
    if (!semanticRetrievalConfigured()) throw new Error("Semantic retrieval requires PostgreSQL and GEMINI_API_KEY.");
    const embedding = await embedText(query, "query");
    const vector = vectorLiteral(embedding);
    const model = embeddingModel();
    const tags = (options.tags || []).map(tag => tag.toLowerCase()).filter(Boolean);
    const categoryFilter = options.category ? Prisma.sql`AND "category" = ${options.category}` : Prisma.empty;
    const tagFilter = tags.length ? Prisma.sql`AND "tags" && ${tags}::text[]` : Prisma.empty;
    const limit = Math.min(50, Math.max(1, options.limit || 12));
    const candidateLimit = Math.min(100, limit * 4);
    const rows = await prisma.$queryRaw<VectorRow[]>(Prisma.sql`
      SELECT "id", "title", "content", "tags", "category", "partId", "sourceUrl", "sourceTitle",
             1 - ("embedding" <=> ${vector}::vector) AS "similarity"
      FROM "KnowledgeChunk"
      WHERE "embedding" IS NOT NULL AND "embeddingModel" = ${model}
      ${categoryFilter}
      ${tagFilter}
      ORDER BY "embedding" <=> ${vector}::vector
      LIMIT ${candidateLimit}
    `);
    const minimum = Number(process.env.RAG_MIN_SIMILARITY || 0.2);
    return rows
      .filter(row => Number(row.similarity) >= minimum)
      .map(row => {
        const matchedTerms = lexicalTerms(query, row);
        const lexicalBoost = Math.min(8, matchedTerms.length * 1.5);
        return {
          id: row.id,
          title: row.title,
          content: row.content,
          tags: row.tags,
          category: row.category as RetrievedKnowledgeChunk["category"],
          partId: row.partId || undefined,
          sourceUrl: row.sourceUrl || undefined,
          sourceTitle: row.sourceTitle || undefined,
          similarityScore: Math.round(Number(row.similarity) * 1000) / 1000,
          relevanceScore: Math.min(100, Math.round(Number(row.similarity) * 100 + lexicalBoost)),
          matchedTerms,
          retrievalMode: "vector" as const,
          embeddingModel: model,
          embeddingProvider: embeddingProvider(),
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore || (b.similarityScore || 0) - (a.similarityScore || 0))
      .slice(0, limit);
  }
}
