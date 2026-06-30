import type { BuildRecommendation, BuildRequest } from "./build";
import type { Part, PartCategory } from "./parts";
import type { AiModelId, ThinkingMode } from "./ai";
import type { MarketSignal } from "./market";

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category?: PartCategory | "workload" | "compatibility" | "planning" | "intent";
  partId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

export interface RetrievalOptions {
  tags?: string[];
  category?: KnowledgeChunk["category"];
  limit?: number;
}

export interface RetrievedKnowledgeChunk extends KnowledgeChunk {
  relevanceScore: number;
  matchedTerms: string[];
  retrievalMode: "vector" | "keyword" | "keyword-fallback";
  similarityScore?: number;
  embeddingModel?: string;
  embeddingProvider?: "local" | "gemini" | "ollama";
  retrievalNote?: string;
}

export interface RetrievalSummary {
  mode: "vector" | "keyword" | "keyword-fallback";
  embeddingModel?: string;
  embeddingProvider?: "local" | "gemini" | "ollama";
  vectorChunkCount: number;
  fallbackReason?: string;
}

export interface CandidateScore {
  performanceScore: number;
  valueScore: number;
  ragRelevanceScore: number;
  preferenceScore: number;
  upgradeabilityScore: number;
  marketScore: number;
  totalScore: number;
}

export interface PartCandidate {
  part: Part;
  score: CandidateScore;
  evidence: RetrievedKnowledgeChunk[];
  market: MarketSignal;
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
  retrieval: RetrievalSummary;
  compatibilitySuggestion?: CompatibilitySuggestion;
  interaction?: AgentInteraction;
}

export interface CompatibilitySuggestion {
  issueId: string;
  action: string;
}

export type BuildTurnAction = "draft" | "patch" | "optimize" | "rebuild" | "explain";

export interface AgentContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BuildPartChange {
  category: PartCategory;
  from: string;
  to: string;
  reason: string;
  inducedByCompatibility: boolean;
}

export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface AgentInteraction {
  action: BuildTurnAction;
  message: string;
  changedParts: BuildPartChange[];
  preservedCategories: PartCategory[];
  affectedCategories: PartCategory[];
  context: AgentContextMessage[];
  tokenUsage?: AgentTokenUsage;
}

export interface IntentParseResult {
  request: BuildRequest;
  mode: "deepseek" | "gemini" | "heuristic";
  summary: string;
}
