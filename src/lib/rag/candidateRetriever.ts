import { parts } from "@/data/parts";
import { allocations } from "@/lib/recommendation/budgetAllocation";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { getMarketSignals, withMarketPrice } from "@/lib/pricing/marketSignals";
import type { BuildRequest, UseCase } from "@/types/build";
import type { Part, PartCategory } from "@/types/parts";
import type { CandidatePools, CandidateScore, PartCandidate, RetrievalSummary, RetrievedKnowledgeChunk } from "@/types/knowledge";
import type { MarketSignal } from "@/types/market";
import { retrieveKnowledgeChunks, summarizeRetrieval } from "./retrieval";

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];
const weights: Record<UseCase, Omit<CandidateScore, "totalScore">> = {
  gaming: { performanceScore: .35, valueScore: .19, marketScore: .14, ragRelevanceScore: .13, preferenceScore: .11, upgradeabilityScore: .08 },
  ai: { performanceScore: .32, valueScore: .15, marketScore: .12, ragRelevanceScore: .20, preferenceScore: .14, upgradeabilityScore: .07 },
  development: { performanceScore: .28, valueScore: .18, marketScore: .13, ragRelevanceScore: .16, preferenceScore: .10, upgradeabilityScore: .15 },
  video: { performanceScore: .31, valueScore: .17, marketScore: .13, ragRelevanceScore: .17, preferenceScore: .11, upgradeabilityScore: .11 },
  balanced: { performanceScore: .29, valueScore: .20, marketScore: .14, ragRelevanceScore: .16, preferenceScore: .11, upgradeabilityScore: .10 },
};

export function buildRetrievalQueries(request: BuildRequest) {
  const goals = [request.useCase, request.resolution, request.targetFps && `${request.targetFps} fps`, ...(request.aiWorkloads || []), ...(request.developerWorkloads || [])];
  const categoryTerms: Record<PartCategory, unknown[]> = {
    cpu: [request.preferredCpuBrand && `${request.preferredCpuBrand} cpu`, request.preferQuiet && "quiet", request.preferLowPower && "efficient low power", request.preferUpgradeability && "upgradeability"],
    gpu: [request.preferredGpuBrand && `${request.preferredGpuBrand} gpu`, request.useCase === "ai" && `cuda vram ${request.vramPreference || 16}gb`, request.preferLowPower && "efficient low power"],
    motherboard: [request.preferredCpuBrand, request.preferSmallFormFactor && "sff mini-itx", request.preferUpgradeability && "upgradeability", request.preferredColor],
    ram: [request.useCase, request.preferredColor, request.preferRgb && "rgb"],
    storage: [request.useCase, ...(request.developerWorkloads || [])],
    cooler: [request.preferredCooling, request.preferQuiet && "quiet", request.preferredColor, request.preferRgb && "rgb"],
    psu: [request.preferQuiet && "quiet", request.preferUpgradeability && "headroom upgradeability", request.preferredColor],
    case: [request.preferSmallFormFactor && "sff mini-itx", request.preferredCaseStyle, request.preferredColor, request.preferRgb && "rgb", request.preferQuiet && "airflow quiet"],
  };
  return categories.map(category => ({ category, query: [...goals, ...categoryTerms[category], category].filter(Boolean).join(" ") }));
}

function performance(part: Part, request: BuildRequest) {
  switch (part.category) {
    case "gpu": return request.useCase === "ai" ? Math.min(100, part.aiScore + (part.cuda ? 8 : -12) + (part.vramGb >= (request.vramPreference || 12) ? 8 : -15)) : request.resolution === "4k" ? part.gamingScore4k : request.resolution === "1080p" ? part.gamingScore1080p : part.gamingScore1440p;
    case "cpu": return request.useCase === "gaming" ? part.gamingScore : part.productivityScore;
    case "motherboard": return Math.min(100, 48 + part.m2Slots * 9 + part.maxMemoryGb / 8);
    case "ram": return Math.min(100, part.capacityGb * (request.useCase === "gaming" ? 1.8 : 1.2) + part.speedMt / 300);
    case "storage": return Math.min(100, part.capacityTb * 20 + (part.readSpeedMb || 500) / 100);
    case "cooler": return Math.min(100, part.tdpRatingWatts / 3);
    case "psu": return Math.min(100, part.wattage / 12 + (part.efficiency === "Gold" ? 10 : part.efficiency === "Platinum" ? 15 : 5));
    case "case": return Math.min(100, part.maxGpuLengthMm / 5 + part.maxCoolerHeightMm / 8);
  }
}

function preference(part: Part, request: BuildRequest) {
  let score = 50;
  if (part.category === "cpu" && request.preferredCpuBrand !== "none") score += part.brand.toLowerCase() === request.preferredCpuBrand ? 45 : -100;
  if (part.category === "gpu" && request.preferredGpuBrand !== "none") score += part.brand.toLowerCase() === request.preferredGpuBrand ? 45 : -35;
  if (part.category === "motherboard" && request.preferredCpuBrand && request.preferredCpuBrand !== "none") {
    const socketMatchesBrand = request.preferredCpuBrand === "amd" ? part.socket === "AM5" : part.socket.startsWith("LGA");
    score += socketMatchesBrand ? 45 : -100;
  }
  if (request.preferredColor !== "none" && part.tags.includes(request.preferredColor || "")) score += 35;
  if (request.preferRgb && part.tags.includes("rgb")) score += 25;
  if (request.preferredCooling === "aio" && part.category === "cooler" && part.type === "aio") score += 35;
  if (request.preferredCaseStyle === "panoramic" && part.category === "case" && part.tags.includes("panoramic")) score += 35;
  if (request.preferSmallFormFactor) score += (part.category === "case" && part.supportedMotherboardFormFactors.length === 1 && part.supportedMotherboardFormFactors[0] === "Mini-ITX") || (part.category === "motherboard" && part.formFactor === "Mini-ITX") || (part.category === "psu" && part.formFactor === "SFX") ? 45 : part.category === "case" || part.category === "motherboard" || part.category === "psu" ? -40 : 0;
  if (request.preferQuiet && part.tags.includes("quiet")) score += 25;
  if (request.preferLowPower && ((part.category === "cpu" && part.tdpWatts <= 65) || (part.category === "gpu" && part.tdpWatts <= 220))) score += 30;
  return Math.max(0, Math.min(100, score));
}

function upgradeability(part: Part) {
  if (part.category === "cpu") return part.socket === "AM5" ? 95 : 50;
  if (part.category === "motherboard") return Math.min(100, 45 + part.m2Slots * 10 + part.maxMemoryGb / 8 + (part.socket === "AM5" ? 15 : 0));
  if (part.category === "psu") return Math.min(100, part.wattage / 10);
  if (part.category === "case") return Math.min(100, part.maxGpuLengthMm / 4.5);
  if (part.category === "ram") return part.sticks === 2 ? 80 : 45;
  return 60;
}

function scorePart(part: Part, request: BuildRequest, evidence: RetrievedKnowledgeChunk[], market: MarketSignal): CandidateScore {
  const target = request.budget * allocations[request.useCase][part.category];
  const actual = priceIn(part, request.currency);
  const performanceScore = performance(part, request);
  const affordability = actual <= target ? 100 - Math.abs(actual - target) / Math.max(target, 1) * 35 : Math.max(0, 100 - (actual - target) / Math.max(target, 1) * 100);
  const valueScore = Math.max(0, Math.min(100, performanceScore * .55 + affordability * .45));
  const ragRelevanceScore = evidence.length ? Math.max(...evidence.map(e => e.relevanceScore)) : 8;
  const preferenceScore = preference(part, request), upgradeabilityScore = upgradeability(part);
  const w = weights[request.useCase];
  const marketScore = market.marketScore;
  const totalScore = performanceScore*w.performanceScore + valueScore*w.valueScore + marketScore*w.marketScore + ragRelevanceScore*w.ragRelevanceScore + preferenceScore*w.preferenceScore + upgradeabilityScore*w.upgradeabilityScore;
  return { performanceScore, valueScore, marketScore, ragRelevanceScore, preferenceScore, upgradeabilityScore, totalScore };
}

export async function retrieveCandidatePools(request: BuildRequest, _sourceQuery = "", retrievalCategories: PartCategory[] = categories): Promise<{ pools: CandidatePools; chunks: RetrievedKnowledgeChunk[]; retrieval: RetrievalSummary; marketSignals: Map<string, MarketSignal> }> {
  const marketSignals = await getMarketSignals(parts, request.country);
  const marketCatalog = parts.map(part => withMarketPrice(part, marketSignals.get(part.id)));
  const requested = new Set(retrievalCategories);
  const queryResults = await Promise.all(buildRetrievalQueries(request).filter(({ category }) => requested.has(category)).map(({ category, query }) => retrieveKnowledgeChunks(query, { tags: [category, request.useCase, request.resolution || ""].filter(Boolean), limit: 8 })));
  const unique = new Map<string, RetrievedKnowledgeChunk>();
  queryResults.flat().forEach(chunk => { const prior = unique.get(chunk.id); if (!prior || prior.relevanceScore < chunk.relevanceScore) unique.set(chunk.id, chunk); });
  const chunks = [...unique.values()].filter(chunk => {
    const linkedPart = chunk.partId ? parts.find(part => part.id === chunk.partId) : undefined;
    if (request.preferredCpuBrand && request.preferredCpuBrand !== "none" && chunk.category === "cpu") {
      if (linkedPart?.category === "cpu" && linkedPart.brand.toLowerCase() !== request.preferredCpuBrand) return false;
      if (request.preferredCpuBrand === "intel" && (chunk.tags.includes("am5") || /ryzen/i.test(chunk.title))) return false;
      if (request.preferredCpuBrand === "amd" && (chunk.tags.includes("lga1700") || /core i[3579]/i.test(chunk.title))) return false;
    }
    if (request.preferredGpuBrand && request.preferredGpuBrand !== "none" && chunk.category === "gpu") {
      if (linkedPart?.category === "gpu" && linkedPart.brand.toLowerCase() !== request.preferredGpuBrand) return false;
      if (request.preferredGpuBrand === "nvidia" && chunk.tags.includes("amd")) return false;
      if (request.preferredGpuBrand === "amd" && chunk.tags.includes("nvidia")) return false;
    }
    return true;
  }).sort((a,b) => b.relevanceScore-a.relevanceScore).slice(0, 18);
  const pools = Object.fromEntries(categories.map(category => {
    let eligible = marketCatalog.filter(part => part.category === category);
    if (category === "cpu" && request.preferredCpuBrand && request.preferredCpuBrand !== "none") eligible = eligible.filter(part => part.brand.toLowerCase() === request.preferredCpuBrand);
    if (category === "gpu" && request.preferredGpuBrand && request.preferredGpuBrand !== "none") eligible = eligible.filter(part => part.brand.toLowerCase() === request.preferredGpuBrand);
    const explicitVramMinimum = request.constraints?.some(item => item.target === "workloadTarget" && item.strength === "required" && /vram|显存/i.test(`${item.value} ${item.sourceText}`));
    if (category === "gpu" && request.vramPreference && explicitVramMinimum) eligible = eligible.filter(part => part.category === "gpu" && part.vramGb >= request.vramPreference!);
    if (category === "ram" && request.ramCapacityGb) eligible = eligible.filter(part => part.category === "ram" && part.capacityGb >= request.ramCapacityGb!);
    if (category === "storage" && request.storageCapacityTb) eligible = eligible.filter(part => part.category === "storage" && part.capacityTb >= request.storageCapacityTb!);
    const exactPartId = request.constraints?.find(item => item.target === "workloadTarget" && item.strength === "required" && item.value.startsWith("part:") && parts.find(part => part.id === item.value.slice(5))?.category === category)?.value.slice(5);
    if (exactPartId) eligible = eligible.filter(part => part.id === exactPartId);
    if (category === "cooler" && request.preferredCooling && request.preferredCooling !== "none") eligible = eligible.filter(part => part.category === "cooler" && part.type === request.preferredCooling);
    const colorIsRequired = request.constraints?.some(item => item.target === "color" && item.value === request.preferredColor && item.strength === "required");
    if (colorIsRequired && request.preferredColor && request.preferredColor !== "none") {
      const colorMatches = eligible.filter(part => part.tags.includes(request.preferredColor as string));
      if (colorMatches.length) eligible = colorMatches;
    }
    const rgbIsExcluded = request.constraints?.some(item => item.target === "lighting" && item.strength === "excluded");
    if (rgbIsExcluded) {
      const nonRgbMatches = eligible.filter(part => !part.tags.includes("rgb"));
      if (nonRgbMatches.length) eligible = nonRgbMatches;
    }
    const sffIsRequired = request.preferSmallFormFactor && request.constraints?.some(item => item.target === "formFactor" && item.value === "sff" && item.strength === "required");
    if (sffIsRequired && category === "motherboard") eligible = eligible.filter(part => part.category === "motherboard" && part.formFactor === "Mini-ITX");
    if (sffIsRequired && category === "case") eligible = eligible.filter(part => part.category === "case" && part.supportedMotherboardFormFactors.length === 1 && part.supportedMotherboardFormFactors[0] === "Mini-ITX");
    if (sffIsRequired && category === "psu") eligible = eligible.filter(part => part.category === "psu" && part.formFactor === "SFX");
    const caseStyleIsRequired = category === "case" && request.constraints?.some(item => item.target === "caseStyle" && item.value === request.preferredCaseStyle && item.strength === "required");
    if (caseStyleIsRequired && request.preferredCaseStyle && request.preferredCaseStyle !== "none") {
      const styleMatches = eligible.filter(part => part.category === "case" && part.tags.includes(request.preferredCaseStyle as string));
      if (styleMatches.length) eligible = styleMatches;
    }
    // A confirmed out-of-stock SKU should not beat buyable or unknown-fallback
    // candidates. Keep it only when the category would otherwise be too sparse.
    const buyable = eligible.filter(part => marketSignals.get(part.id)?.availability !== "out_of_stock");
    if (buyable.length >= 3) eligible = buyable;
    const scored: PartCandidate[] = eligible.map(part => {
      const evidence = chunks.filter(chunk => chunk.partId === part.id || (!chunk.partId && (chunk.category === category || chunk.tags.includes(category))));
      const market = marketSignals.get(part.id)!;
      return { part, market, evidence: evidence.slice(0,3), score: scorePart(part, request, evidence, market) };
    }).sort((a,b) => b.score.totalScore-a.score.totalScore);
    const limit = ({ cpu: 12, gpu: 12, motherboard: 24, ram: 16, storage: 16, cooler: 24, psu: 24, case: 24 } satisfies Record<PartCategory, number>)[category];
    const selected = new Map(scored.slice(0, limit).map(candidate => [candidate.part.id, candidate]));
    [...scored].sort((a, b) => priceIn(a.part, request.currency) - priceIn(b.part, request.currency)).slice(0, 8).forEach(candidate => selected.set(candidate.part.id, candidate));
    if (category === "motherboard") {
      const structural = new Set<string>();
      for (const candidate of scored) {
        const part = candidate.part;
        if (part.category !== "motherboard") continue;
        const key = `${part.socket}:${part.formFactor}`;
        if (!structural.has(key)) { structural.add(key); selected.set(part.id, candidate); }
      }
    }
    if (category === "psu") for (const form of ["ATX", "SFX"] as const) {
      const candidate = scored.find(item => item.part.category === "psu" && item.part.formFactor === form);
      if (candidate) selected.set(candidate.part.id, candidate);
    }
    const candidates = [...selected.values()].sort((a, b) => b.score.totalScore - a.score.totalScore);
    return [category, candidates];
  })) as CandidatePools;
  return { pools, chunks, retrieval: summarizeRetrieval(chunks), marketSignals };
}
