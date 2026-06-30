import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { marketRegion, summarizeBuildMarket } from "@/lib/pricing/marketSignals";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildRequest } from "@/types/build";
import type { BuildParts, Currency, Part, PartCategory } from "@/types/parts";
import type { AlternativeBuildSummary, IntentParseResult, PartCandidate, RagBuildRecommendation, RagReasoningItem } from "@/types/knowledge";
import { evidenceFor, retrieveCandidatePools, scoreCandidateForDisplay } from "./candidateRetriever";
import { optimizeBuild } from "./buildOptimizer";
import { parseBuildIntent } from "./intentParser";
import { generateRagExplanation } from "./ragExplanation";

export type RagProgressStage = "llm-intent" | "rag-retrieval" | "llm-explanation";
type ProgressReporter = (stage: RagProgressStage) => void;

const selectedCandidate = (candidates: PartCandidate[], part: Part) => candidates.find(candidate => candidate.part.id === part.id) || candidates[0];

function makeAlternatives(parts: BuildParts, pools: Awaited<ReturnType<typeof retrieveCandidatePools>>["pools"], currency: Currency): AlternativeBuildSummary[] {
  const currentTotal = Object.values(parts).reduce((sum, part) => sum + priceIn(part, currency), 0);
  const alternatives: AlternativeBuildSummary[] = [];
  const valueGpu = [...pools.gpu].reverse().find(candidate => priceIn(candidate.part, currency) < priceIn(parts.gpu, currency));
  if (valueGpu) alternatives.push({ title: "Value-focused variant", totalPrice: currentTotal - priceIn(parts.gpu, currency) + priceIn(valueGpu.part, currency), changes: [{ category: "gpu", from: parts.gpu.name, to: valueGpu.part.name, priceDifference: priceIn(valueGpu.part, currency) - priceIn(parts.gpu, currency) }], tradeoff: "Lower cost with reduced graphics or compute headroom." });
  const upgradeGpu = pools.gpu.find(candidate => priceIn(candidate.part, currency) > priceIn(parts.gpu, currency));
  if (upgradeGpu) alternatives.push({ title: "Performance variant", totalPrice: currentTotal - priceIn(parts.gpu, currency) + priceIn(upgradeGpu.part, currency), changes: [{ category: "gpu", from: parts.gpu.name, to: upgradeGpu.part.name, priceDifference: priceIn(upgradeGpu.part, currency) - priceIn(parts.gpu, currency) }], tradeoff: "Higher GPU performance or VRAM at increased cost and power." });
  const memory = pools.ram.find(candidate => priceIn(candidate.part, currency) > priceIn(parts.ram, currency));
  if (memory) alternatives.push({ title: "Capacity variant", totalPrice: currentTotal - priceIn(parts.ram, currency) + priceIn(memory.part, currency), changes: [{ category: "ram", from: parts.ram.name, to: memory.part.name, priceDifference: priceIn(memory.part, currency) - priceIn(parts.ram, currency) }], tradeoff: "More multitasking and dataset headroom with no direct gaming uplift." });
  return alternatives.slice(0, 3);
}

export async function generateRagBuildFromRequest(sourceQuery: string, ai: AiGenerationOptions, request: BuildRequest, parserMode: IntentParseResult["mode"], reportProgress?: ProgressReporter): Promise<RagBuildRecommendation> {
  const { pools, chunks, retrieval, marketSignals } = await retrieveCandidatePools(request, sourceQuery);
  // Whole-build optimizer: maximize total capability/quality subject to the
  // budget (hard) and all compatibility rules. Replaces the old greedy "pool
  // top + downsize", which under-spent now that value rewards cheapness.
  const parts = optimizeBuild({ pools, request, marketSignals, chunks });
  // Coolers/PSUs (and owned parts) may have been chosen from outside the scored
  // pool; surface them in their pool so reasoning and alternatives can describe
  // the selection and its evidence.
  for (const [category, part] of Object.entries(parts) as Array<[PartCategory, Part]>) {
    if (!pools[category].some(candidate => candidate.part.id === part.id)) {
      const market = marketSignals.get(part.id)!;
      pools[category].unshift({ part, market, evidence: evidenceFor(part, category, chunks).slice(0, 3), score: scoreCandidateForDisplay(part, request, category, chunks, market) });
    }
  }
  const totalPrice = Object.values(parts).reduce((sum, part) => sum + priceIn(part, request.currency), 0);
  const compatibility = checkCompatibility(parts), performance = await estimatePerformance(parts, request), estimatedWattage = estimateWattage(parts);
  const selected = Object.entries(parts) as Array<[PartCategory, Part]>;
  const reasoning: RagReasoningItem[] = selected.map(([category, part]) => {
    const candidate = selectedCandidate(pools[category], part);
    const strongest = candidate?.evidence[0];
    const hardConstraint = category === "cpu" && request.preferredCpuBrand !== "none" ? `${request.preferredCpuBrand?.toUpperCase()} CPU hard constraint. ` : category === "gpu" && request.preferredGpuBrand !== "none" ? `${request.preferredGpuBrand?.toUpperCase()} GPU hard constraint. ` : request.preferredColor !== "none" && part.tags.includes(request.preferredColor || "") ? `${request.preferredColor} appearance constraint. ` : "";
    const marketReason = candidate ? `${candidate.market.availability.replace("_", " ")}, ${candidate.market.usedFallback ? "catalog-price fallback" : `${candidate.market.retailer} market price`}, market score ${candidate.score.marketScore.toFixed(1)}.` : "Existing owned part.";
    return { category, considered: pools[category].slice(0, 4).map(item => item.part.name), selected: part.name, reason: `${hardConstraint}Weighted score ${candidate?.score.totalScore.toFixed(1) || "existing"}. ${marketReason} ${strongest ? strongest.title : "Selected from structured specifications and deterministic constraints."}`, evidenceIds: candidate?.evidence.map(item => item.id) || [] };
  });
  const title = request.useCase === "ai" ? "RAG Local AI Workstation" : request.useCase === "gaming" ? `RAG ${request.resolution === "4k" ? "4K" : request.resolution || "1440p"} Gaming Build` : request.useCase === "development" ? "RAG Developer Workstation" : request.useCase === "video" ? "RAG Creator Workstation" : "RAG Balanced Build";
  const baselineSummary = JSON.stringify({
    budget: `${request.currency} ${request.budget}`,
    useCase: request.useCase,
    parts: Object.fromEntries(selected.map(([category, part]) => [category, part.id])),
  });
  const raw = {
    id: `rag-${Date.now().toString(36)}`, title, request, parts, totalPrice, estimatedWattage, compatibility, performance, alternatives: [], generatedAt: new Date().toISOString(), parserMode, aiModel: ai.model, thinkingMode: ai.thinking, sourceQuery, retrievedChunks: chunks, retrieval, reasoning, alternativeBuilds: makeAlternatives(parts, pools, request.currency), market: summarizeBuildMarket(Object.values(parts), marketSignals, marketRegion(request.country)),
    interaction: {
      action: "draft" as const,
      message: "Baseline build created. Tell me what you want to change; unchanged parts will stay locked unless compatibility requires a linked adjustment.",
      changedParts: [],
      preservedCategories: [] as PartCategory[],
      affectedCategories: selected.map(([category]) => category),
      context: [
        { role: "user" as const, content: sourceQuery },
        { role: "assistant" as const, content: `BASELINE_CREATED ${baselineSummary}` },
      ],
    },
  };
  reportProgress?.("llm-explanation");
  return { ...raw, explanation: await generateRagExplanation(raw, ai) };
}

export async function generateRagBuild(sourceQuery: string, ai: AiGenerationOptions, reportProgress?: ProgressReporter): Promise<RagBuildRecommendation> {
  reportProgress?.("llm-intent");
  const intent = await parseBuildIntent(sourceQuery, ai);
  reportProgress?.("rag-retrieval");
  return generateRagBuildFromRequest(sourceQuery, ai, intent.request, intent.mode, reportProgress);
}
