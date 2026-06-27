import type { BuildRecommendation, BuildRequest } from "./build";
import type { Part, PartCategory } from "./parts";
import type { AiModelId, ThinkingMode } from "./ai";

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: PartCategory | "workload" | "compatibility" | "planning" | "intent";
  partId?: string;
}

export interface RetrievalOptions {
  tags?: string[];
  category?: KnowledgeChunk["category"];
  limit?: number;
}

export interface RetrievedKnowledgeChunk extends KnowledgeChunk {
  relevanceScore: number;
  matchedTerms: string[];
}

export interface CandidateScore {
  performanceScore: number;
  valueScore: number;
  ragRelevanceScore: number;
  preferenceScore: number;
  upgradeabilityScore: number;
  totalScore: number;
}

export interface PartCandidate {
  part: Part;
  score: CandidateScore;
  evidence: RetrievedKnowledgeChunk[];
}

export type CandidatePools = Record<PartCategory, PartCandidate[]>;

export interface RagReasoningItem {
  category: PartCategory;
  considered: string[];
  selected: string;
  reason: string;
  evidenceIds: string[];
}

export interface AlternativeBuildSummary {
  title: string;
  totalPrice: number;
  changes: Array<{ category: PartCategory; from: string; to: string; priceDifference: number }>;
  tradeoff: string;
}

export interface RagBuildRecommendation extends BuildRecommendation {
  parserMode: "deepseek" | "gemini" | "heuristic";
  aiModel: AiModelId;
  thinkingMode: ThinkingMode;
  sourceQuery: string;
  retrievedChunks: RetrievedKnowledgeChunk[];
  reasoning: RagReasoningItem[];
  alternativeBuilds: AlternativeBuildSummary[];
}

export interface IntentParseResult {
  request: BuildRequest;
  mode: "deepseek" | "gemini" | "heuristic";
  summary: string;
}
