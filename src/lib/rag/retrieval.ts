import rawKnowledge from "@/data/knowledge.json";
import type { KnowledgeChunk, RetrievalOptions, RetrievalSummary, RetrievedKnowledgeChunk } from "@/types/knowledge";
import { PgVectorKnowledgeRetriever, semanticRetrievalConfigured } from "./pgvectorRetriever";

export interface KnowledgeRetriever {
  retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedKnowledgeChunk[]>;
}

export const knowledgeChunks = rawKnowledge as KnowledgeChunk[];

const expansions: Record<string, string[]> = {
  "人工智能": ["ai", "local-llm", "cuda", "vram"], "本地模型": ["local-llm", "ai", "vram"],
  "大模型": ["local-llm", "ai", "vram"], "画图": ["diffusion", "ai", "vram"],
  "游戏": ["gaming"], "开发": ["development", "docker"], "剪辑": ["video", "storage"],
  "静音": ["quiet"], "小机箱": ["sff", "mini-itx", "compact"], "小钢炮": ["sff", "mini-itx"],
  "升级": ["upgradeability"], "显存": ["vram"], "内存": ["ram"], "电源": ["psu", "power"],
  "散热": ["cooler"], "机箱": ["case"], "预算": ["value"], "高刷": ["high-fps"],
};

function termsFor(query: string) {
  const normalized = query.toLowerCase().replace(/[\/,_-]/g, " ");
  const terms = new Set(normalized.match(/[\p{L}\p{N}]+/gu) || []);
  for (const [phrase, values] of Object.entries(expansions)) if (normalized.includes(phrase)) values.forEach(v => terms.add(v));
  if (/\b4k\b/.test(normalized)) terms.add("4k");
  if (/1440p|2k/.test(normalized)) terms.add("1440p");
  if (/1080p/.test(normalized)) terms.add("1080p");
  if (/24\s*gb/.test(normalized)) terms.add("24gb");
  if (/16\s*gb/.test(normalized)) terms.add("16gb");
  if (/64\s*gb/.test(normalized)) terms.add("64gb");
  return [...terms].filter(t => t.length > 1);
}

export class KeywordKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly mode: "keyword" | "keyword-fallback" = "keyword") {}

  async retrieve(query: string, options: RetrievalOptions = {}, retrievalNote?: string): Promise<RetrievedKnowledgeChunk[]> {
    const terms = termsFor(query);
    const requestedTags = (options.tags || []).map(t => t.toLowerCase());
    return knowledgeChunks
      .filter(chunk => !options.category || chunk.category === options.category)
      .filter(chunk => !requestedTags.length || requestedTags.some(tag => chunk.tags.includes(tag)))
      .map(chunk => {
        const title = chunk.title.toLowerCase(), content = chunk.content.toLowerCase();
        const matchedTerms = terms.filter(term => chunk.tags.some(tag => tag.includes(term) || term.includes(tag)) || title.includes(term) || content.includes(term));
        const tagHits = matchedTerms.filter(term => chunk.tags.some(tag => tag.includes(term) || term.includes(tag))).length;
        const titleHits = matchedTerms.filter(term => title.includes(term)).length;
        const relevanceScore = Math.min(100, matchedTerms.length * 13 + tagHits * 10 + titleHits * 7 + (chunk.partId ? 4 : 0));
        return { ...chunk, relevanceScore, matchedTerms, retrievalMode: this.mode, retrievalNote };
      })
      .filter(chunk => chunk.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, options.limit || 12);
  }
}

const keywordRetriever = new KeywordKnowledgeRetriever("keyword");
const fallbackRetriever = new KeywordKnowledgeRetriever("keyword-fallback");
const vectorRetriever = new PgVectorKnowledgeRetriever();

export async function retrieveKnowledgeChunks(query: string, options?: RetrievalOptions): Promise<RetrievedKnowledgeChunk[]> {
  if (/[^\x20-\x7E]/.test(query)) {
    throw new Error("Retrieval queries must be canonical English text; parse and normalize the user request before embedding.");
  }
  const requestedMode = process.env.RAG_RETRIEVAL_MODE?.toLowerCase();
  if (requestedMode === "keyword") return keywordRetriever.retrieve(query, options);
  if (!semanticRetrievalConfigured()) {
    return fallbackRetriever.retrieve(query, options, "PostgreSQL vector store or Gemini embeddings are not configured.");
  }
  try {
    return await vectorRetriever.retrieve(query, options);
  } catch (error) {
    const note = error instanceof Error ? error.message : "Semantic retrieval failed.";
    console.warn(`[rag] vector retrieval degraded to keyword: ${note}`);
    return fallbackRetriever.retrieve(query, options, note);
  }
}

export function summarizeRetrieval(chunks: RetrievedKnowledgeChunk[]): RetrievalSummary {
  const vectorChunks = chunks.filter(chunk => chunk.retrievalMode === "vector");
  const fallback = chunks.find(chunk => chunk.retrievalMode === "keyword-fallback");
  const keyword = chunks.find(chunk => chunk.retrievalMode === "keyword");
  return {
    mode: vectorChunks.length ? "vector" : fallback ? "keyword-fallback" : "keyword",
    embeddingModel: vectorChunks.find(chunk => chunk.embeddingModel)?.embeddingModel,
    embeddingProvider: vectorChunks.find(chunk => chunk.embeddingProvider)?.embeddingProvider,
    vectorChunkCount: vectorChunks.length,
    fallbackReason: fallback?.retrievalNote || (!vectorChunks.length && !keyword ? "No retrievable knowledge chunks were found." : undefined),
  };
}
