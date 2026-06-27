import rawKnowledge from "@/data/knowledge.json";
import type { KnowledgeChunk, RetrievalOptions, RetrievedKnowledgeChunk } from "@/types/knowledge";

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
  async retrieve(query: string, options: RetrievalOptions = {}) {
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
        return { ...chunk, relevanceScore, matchedTerms };
      })
      .filter(chunk => chunk.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, options.limit || 12);
  }
}

const retriever: KnowledgeRetriever = new KeywordKnowledgeRetriever();

export function retrieveKnowledgeChunks(query: string, options?: RetrievalOptions) {
  return retriever.retrieve(query, options);
}
