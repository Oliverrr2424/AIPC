import { partById, parts as catalogParts } from "@/data/parts";
import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { marketRegion, summarizeBuildMarket, withMarketPrice } from "@/lib/pricing/marketSignals";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildRequest } from "@/types/build";
import type { BuildParts, Currency, Part, PartCategory } from "@/types/parts";
import type { MarketSignal } from "@/types/market";
import type { AlternativeBuildSummary, IntentParseResult, PartCandidate, RagBuildRecommendation, RagReasoningItem } from "@/types/knowledge";
import { retrieveCandidatePools } from "./candidateRetriever";
import { parseBuildIntent } from "./intentParser";
import { generateRagExplanation } from "./ragExplanation";

const selectedCandidate = (candidates: PartCandidate[], part: Part) => candidates.find(candidate => candidate.part.id === part.id) || candidates[0];
const existing = <T extends Part>(ids: string[] | undefined, category: T["category"], marketSignals: Map<string, MarketSignal>) => {
  const part = (ids || []).map(partById).find(item => item?.category === category) as T | undefined;
  return part ? withMarketPrice(part, marketSignals.get(part.id)) : undefined;
};
const first = <T extends Part>(candidates: PartCandidate[], predicate: (part: T) => boolean = () => true) => candidates.map(candidate => candidate.part as T).find(predicate);

function optimizeToBudget(initial: BuildParts, pools: Awaited<ReturnType<typeof retrieveCandidatePools>>["pools"], request: RagBuildRecommendation["request"]) {
  const owned = new Set(request.existingPartIds || []);
  const total = (build: BuildParts) => Object.values(build).reduce((sum, part) => sum + (owned.has(part.id) ? 0 : priceIn(part, request.currency)), 0);
  const adjustable: PartCategory[] = ["gpu", "cpu", "motherboard", "ram", "storage", "cooler", "case", "psu"];
  let build = initial;

  while (total(build) > request.budget) {
    const moves = adjustable.flatMap(category => {
      const current = build[category];
      if (owned.has(current.id)) return [];
      const currentCandidate = selectedCandidate(pools[category], current);
      return pools[category].flatMap(candidate => {
        const saving = priceIn(current, request.currency) - priceIn(candidate.part, request.currency);
        if (saving <= 0) return [];
        const next = { ...build, [category]: candidate.part } as BuildParts;
        if (category === "motherboard" && !next.motherboard.cpuTiers.includes(next.cpu.tier)) return [];
        if (checkCompatibility(next).some(result => result.status === "FAIL")) return [];
        const scoreLoss = Math.max(0, (currentCandidate?.score.totalScore || 0) - candidate.score.totalScore);
        return [{ next, saving, utility: saving / (scoreLoss + 5) }];
      });
    }).sort((a, b) => b.utility - a.utility || b.saving - a.saving);
    if (!moves.length) break;
    build = moves[0].next;
  }
  return build;
}

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

export async function generateRagBuildFromRequest(sourceQuery: string, ai: AiGenerationOptions, request: BuildRequest, parserMode: IntentParseResult["mode"]): Promise<RagBuildRecommendation> {
  const { pools, chunks, retrieval, marketSignals } = await retrieveCandidatePools(request, sourceQuery);
  const gpu = existing<BuildParts["gpu"]>(request.existingPartIds, "gpu", marketSignals) || first<BuildParts["gpu"]>(pools.gpu)!;
  const cpu = existing<BuildParts["cpu"]>(request.existingPartIds, "cpu", marketSignals) || first<BuildParts["cpu"]>(pools.cpu)!;
  const motherboard = existing<BuildParts["motherboard"]>(request.existingPartIds, "motherboard", marketSignals) || first<BuildParts["motherboard"]>(pools.motherboard, part => part.socket === cpu.socket && part.cpuTiers.includes(cpu.tier) && (!request.preferSmallFormFactor || part.formFactor === "Mini-ITX")) || first<BuildParts["motherboard"]>(pools.motherboard, part => part.socket === cpu.socket && (!request.preferSmallFormFactor || part.formFactor === "Mini-ITX")) || first<BuildParts["motherboard"]>(pools.motherboard, part => part.socket === cpu.socket)!;
  const ram = existing<BuildParts["ram"]>(request.existingPartIds, "ram", marketSignals) || first<BuildParts["ram"]>(pools.ram, part => part.memoryType === motherboard.memoryType)!;
  const storage = existing<BuildParts["storage"]>(request.existingPartIds, "storage", marketSignals) || first<BuildParts["storage"]>(pools.storage, part => motherboard.storageInterfaces.includes(part.interface))!;
  const ownedCase = existing<BuildParts["case"]>(request.existingPartIds, "case", marketSignals);
  let pcCase = ownedCase || first<BuildParts["case"]>(pools.case, part => part.supportedMotherboardFormFactors.includes(motherboard.formFactor) && part.maxGpuLengthMm >= gpu.lengthMm && (!request.preferSmallFormFactor || (part.supportedMotherboardFormFactors.length === 1 && part.supportedMotherboardFormFactors[0] === "Mini-ITX"))) || first<BuildParts["case"]>(pools.case, part => part.supportedMotherboardFormFactors.includes(motherboard.formFactor) && part.maxGpuLengthMm >= gpu.lengthMm)!;
  let cooler = existing<BuildParts["cooler"]>(request.existingPartIds, "cooler", marketSignals) || first<BuildParts["cooler"]>(pools.cooler, part => part.supportedSockets.includes(cpu.socket) && part.tdpRatingWatts >= cpu.tdpWatts && (part.type === "aio" || !part.heightMm || part.heightMm <= pcCase.maxCoolerHeightMm));
  if (!cooler) {
    cooler = first<BuildParts["cooler"]>(pools.cooler, part => part.supportedSockets.includes(cpu.socket) && part.tdpRatingWatts >= cpu.tdpWatts);
    if (cooler && !ownedCase) pcCase = first<BuildParts["case"]>(pools.case, part => part.supportedMotherboardFormFactors.includes(motherboard.formFactor) && part.maxGpuLengthMm >= gpu.lengthMm && (cooler!.type === "aio" || !cooler!.heightMm || cooler!.heightMm <= part.maxCoolerHeightMm)) || pcCase;
  }
  if (!cooler) throw new Error(`No compatible ${request.preferredCooling === "air" ? "air " : ""}cooler is available for ${cpu.name}.`);
  const provisional = { cpu, gpu, motherboard, ram, storage, cooler, case: pcCase };
  const load = Math.round(cpu.tdpWatts + gpu.tdpWatts + 85 + (ram.capacityGb / 8) * 3 + storage.capacityTb * 5), minimumPsu = Math.ceil(load * 1.35 / 50) * 50;
  const fullCatalogPsu = catalogParts
    .filter((part): part is BuildParts["psu"] => part.category === "psu" && part.wattage >= minimumPsu && pcCase.psuFormFactors.includes(part.formFactor))
    .map(part => withMarketPrice(part, marketSignals.get(part.id)))
    .sort((a, b) => priceIn(a, request.currency) - priceIn(b, request.currency))[0];
  const psu = existing<BuildParts["psu"]>(request.existingPartIds, "psu", marketSignals) || first<BuildParts["psu"]>(pools.psu, part => part.wattage >= minimumPsu && pcCase.psuFormFactors.includes(part.formFactor)) || fullCatalogPsu || first<BuildParts["psu"]>(pools.psu, part => pcCase.psuFormFactors.includes(part.formFactor))!;
  const parts = optimizeToBudget({ ...provisional, psu }, pools, request);
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
  return { ...raw, explanation: await generateRagExplanation(raw, ai) };
}

export async function generateRagBuild(sourceQuery: string, ai: AiGenerationOptions): Promise<RagBuildRecommendation> {
  const intent = await parseBuildIntent(sourceQuery, ai);
  return generateRagBuildFromRequest(sourceQuery, ai, intent.request, intent.mode);
}
