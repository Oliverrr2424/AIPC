import { partById } from "@/data/parts";
import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { priceIn } from "@/lib/pricing/priceEstimator";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildParts, Currency, Part, PartCategory } from "@/types/parts";
import type { AlternativeBuildSummary, PartCandidate, RagBuildRecommendation, RagReasoningItem } from "@/types/knowledge";
import { retrieveCandidatePools } from "./candidateRetriever";
import { parseBuildIntent } from "./intentParser";
import { generateRagExplanation } from "./ragExplanation";

const selectedCandidate = (candidates: PartCandidate[], part: Part) => candidates.find(candidate => candidate.part.id === part.id) || candidates[0];
const existing = <T extends Part>(ids: string[] | undefined, category: T["category"]) => (ids || []).map(partById).find(part => part?.category === category) as T | undefined;
const first = <T extends Part>(candidates: PartCandidate[], predicate: (part: T) => boolean = () => true) => candidates.map(candidate => candidate.part as T).find(predicate);

function optimizeToBudget(initial: BuildParts, pools: Awaited<ReturnType<typeof retrieveCandidatePools>>["pools"], request: RagBuildRecommendation["request"]) {
  const owned = new Set(request.existingPartIds || []);
  const total = (build: BuildParts) => Object.values(build).reduce((sum, part) => sum + (owned.has(part.id) ? 0 : priceIn(part, request.currency)), 0);
  const adjustable: PartCategory[] = ["gpu", "ram", "storage", "cooler", "case", "psu"];
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

export async function generateRagBuild(sourceQuery: string, ai: AiGenerationOptions): Promise<RagBuildRecommendation> {
  const intent = await parseBuildIntent(sourceQuery, ai), request = intent.request;
  const { pools, chunks } = await retrieveCandidatePools(request, sourceQuery);
  const gpu = existing<BuildParts["gpu"]>(request.existingPartIds, "gpu") || first<BuildParts["gpu"]>(pools.gpu)!;
  const cpu = existing<BuildParts["cpu"]>(request.existingPartIds, "cpu") || first<BuildParts["cpu"]>(pools.cpu)!;
  const motherboard = existing<BuildParts["motherboard"]>(request.existingPartIds, "motherboard") || first<BuildParts["motherboard"]>(pools.motherboard, part => part.socket === cpu.socket && (!request.preferSmallFormFactor || part.formFactor === "Mini-ITX")) || first<BuildParts["motherboard"]>(pools.motherboard, part => part.socket === cpu.socket)!;
  const ram = existing<BuildParts["ram"]>(request.existingPartIds, "ram") || first<BuildParts["ram"]>(pools.ram, part => part.memoryType === motherboard.memoryType)!;
  const storage = existing<BuildParts["storage"]>(request.existingPartIds, "storage") || first<BuildParts["storage"]>(pools.storage, part => motherboard.storageInterfaces.includes(part.interface))!;
  const pcCase = existing<BuildParts["case"]>(request.existingPartIds, "case") || first<BuildParts["case"]>(pools.case, part => part.supportedMotherboardFormFactors.includes(motherboard.formFactor) && part.maxGpuLengthMm >= gpu.lengthMm && (!request.preferSmallFormFactor || part.id === "case-nr200")) || first<BuildParts["case"]>(pools.case, part => part.supportedMotherboardFormFactors.includes(motherboard.formFactor) && part.maxGpuLengthMm >= gpu.lengthMm)!;
  const cooler = existing<BuildParts["cooler"]>(request.existingPartIds, "cooler") || first<BuildParts["cooler"]>(pools.cooler, part => part.supportedSockets.includes(cpu.socket) && part.tdpRatingWatts >= cpu.tdpWatts && (part.type === "aio" || !part.heightMm || part.heightMm <= pcCase.maxCoolerHeightMm))!;
  const provisional = { cpu, gpu, motherboard, ram, storage, cooler, case: pcCase };
  const load = Math.round(cpu.tdpWatts + gpu.tdpWatts + 85 + (ram.capacityGb / 8) * 3 + storage.capacityTb * 5), minimumPsu = Math.ceil(load * 1.35 / 50) * 50;
  const psu = existing<BuildParts["psu"]>(request.existingPartIds, "psu") || first<BuildParts["psu"]>(pools.psu, part => part.wattage >= minimumPsu && pcCase.psuFormFactors.includes(part.formFactor)) || first<BuildParts["psu"]>(pools.psu, part => pcCase.psuFormFactors.includes(part.formFactor))!;
  const parts = optimizeToBudget({ ...provisional, psu }, pools, request);
  const totalPrice = Object.values(parts).reduce((sum, part) => sum + priceIn(part, request.currency), 0);
  const compatibility = checkCompatibility(parts), performance = estimatePerformance(parts, request), estimatedWattage = estimateWattage(parts);
  const selected = Object.entries(parts) as Array<[PartCategory, Part]>;
  const reasoning: RagReasoningItem[] = selected.map(([category, part]) => {
    const candidate = selectedCandidate(pools[category], part);
    const strongest = candidate?.evidence[0];
    const hardConstraint = category === "cpu" && request.preferredCpuBrand !== "none" ? `${request.preferredCpuBrand?.toUpperCase()} CPU hard constraint. ` : category === "gpu" && request.preferredGpuBrand !== "none" ? `${request.preferredGpuBrand?.toUpperCase()} GPU hard constraint. ` : request.preferredColor !== "none" && part.tags.includes(request.preferredColor || "") ? `${request.preferredColor} appearance constraint. ` : "";
    return { category, considered: pools[category].slice(0, 4).map(item => item.part.name), selected: part.name, reason: `${hardConstraint}Weighted score ${candidate?.score.totalScore.toFixed(1) || "existing"}. ${strongest ? strongest.title : "Selected from structured specifications and deterministic constraints."}`, evidenceIds: candidate?.evidence.map(item => item.id) || [] };
  });
  const title = request.useCase === "ai" ? "RAG Local AI Workstation" : request.useCase === "gaming" ? `RAG ${request.resolution === "4k" ? "4K" : request.resolution || "1440p"} Gaming Build` : request.useCase === "development" ? "RAG Developer Workstation" : request.useCase === "video" ? "RAG Creator Workstation" : "RAG Balanced Build";
  const raw = { id: `rag-${Date.now().toString(36)}`, title, request, parts, totalPrice, estimatedWattage, compatibility, performance, alternatives: [], generatedAt: new Date().toISOString(), parserMode: intent.mode, aiModel: ai.model, thinkingMode: ai.thinking, sourceQuery, retrievedChunks: chunks, reasoning, alternativeBuilds: makeAlternatives(parts, pools, request.currency) };
  return { ...raw, explanation: await generateRagExplanation(raw, ai) };
}
