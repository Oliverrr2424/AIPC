import { parts } from "@/data/parts";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { getMarketSignals, withMarketPrice } from "@/lib/pricing/marketSignals";
import type { BuildRequest } from "@/types/build";
import type { Part, PartCategory } from "@/types/parts";
import type { CandidatePools, CandidateScore, PartCandidate, RetrievalSummary, RetrievedKnowledgeChunk } from "@/types/knowledge";
import type { MarketSignal } from "@/types/market";
import { retrieveKnowledgeChunks, summarizeRetrieval } from "./retrieval";
import { ConstraintConflictError, type CategoryConflict, type ConflictingConstraint } from "./constraintConflict";

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];

// Per-category scoring weights. Unlike a single use-case weight vector, each
// category weighs the objectives differently (a case is dominated by user
// aesthetics, a GPU by raw workload performance). These only ever rank parts
// that have ALREADY passed every hard constraint — they can never override a
// hard constraint. Evidence (RAG) is capped at 5%: it informs the explanation
// and breaks near-ties, but it must not reorder hardware on its own.
type ScoreWeights = Omit<CandidateScore, "totalScore">;
const categoryWeights: Record<PartCategory, ScoreWeights> = {
  cpu: { performanceScore: .35, valueScore: .25, marketScore: .15, preferenceScore: .10, upgradeabilityScore: .10, ragRelevanceScore: .05 },
  gpu: { performanceScore: .45, valueScore: .25, marketScore: .15, preferenceScore: .08, upgradeabilityScore: .02, ragRelevanceScore: .05 },
  motherboard: { performanceScore: .20, valueScore: .15, marketScore: .15, preferenceScore: .15, upgradeabilityScore: .30, ragRelevanceScore: .05 },
  ram: { performanceScore: .25, valueScore: .30, marketScore: .20, preferenceScore: .10, upgradeabilityScore: .10, ragRelevanceScore: .05 },
  storage: { performanceScore: .30, valueScore: .30, marketScore: .20, preferenceScore: .05, upgradeabilityScore: .10, ragRelevanceScore: .05 },
  cooler: { performanceScore: .30, valueScore: .25, marketScore: .15, preferenceScore: .20, upgradeabilityScore: .05, ragRelevanceScore: .05 },
  psu: { performanceScore: .25, valueScore: .20, marketScore: .20, preferenceScore: .10, upgradeabilityScore: .20, ragRelevanceScore: .05 },
  case: { performanceScore: .15, valueScore: .20, marketScore: .15, preferenceScore: .35, upgradeabilityScore: .10, ragRelevanceScore: .05 },
};

export function buildRetrievalQueries(request: BuildRequest) {
  const sourceWorkloads = [...(request.aiWorkloads || []), ...(request.developerWorkloads || [])].join(" ").toLowerCase();
  const workloadTerms = request.useCase === "ai"
    ? ["local ai inference", /llm|大模型|语言模型/.test(sourceWorkloads) && "local llm inference", /flux|diffusion|图像|绘图|生图/.test(sourceWorkloads) && "stable diffusion image generation", /train|training|训练|微调/.test(sourceWorkloads) && "machine learning training"]
    : request.useCase === "development"
      ? ["software development", /docker|container|容器|kubernetes|k8s/.test(sourceWorkloads) && "containers docker kubernetes", /database|数据库|sql/.test(sourceWorkloads) && "local databases", /compile|build|编译/.test(sourceWorkloads) && "large code compilation", /android|ios|mobile|移动/.test(sourceWorkloads) && "mobile application development"]
      : request.useCase === "video"
        ? ["video editing content creation"]
        : request.useCase === "gaming"
          ? ["pc gaming"]
          : ["balanced desktop workloads"];
  const goals = [request.useCase, request.resolution, request.targetFps && `${request.targetFps} fps`, ...workloadTerms];
  const categoryTerms: Record<PartCategory, unknown[]> = {
    cpu: [request.preferredCpuBrand && request.preferredCpuBrand !== "none" && `${request.preferredCpuBrand} cpu`, request.preferQuiet && "quiet", request.preferLowPower && "efficient low power", request.preferUpgradeability && "upgradeability"],
    gpu: [request.preferredGpuBrand && request.preferredGpuBrand !== "none" && `${request.preferredGpuBrand} gpu`, request.useCase === "ai" && `cuda vram ${request.vramPreference || 16}gb`, request.preferLowPower && "efficient low power"],
    motherboard: [request.preferredCpuBrand && request.preferredCpuBrand !== "none" && request.preferredCpuBrand, request.preferSmallFormFactor && "sff mini-itx", request.preferUpgradeability && "upgradeability", request.preferredColor && request.preferredColor !== "none" && request.preferredColor],
    ram: [request.useCase, request.preferredColor && request.preferredColor !== "none" && request.preferredColor, request.preferRgb && "rgb"],
    storage: [request.useCase, ...workloadTerms],
    cooler: [request.preferredCooling && request.preferredCooling !== "none" && request.preferredCooling, request.preferQuiet && "quiet", request.preferredColor && request.preferredColor !== "none" && request.preferredColor, request.preferRgb && "rgb"],
    psu: [request.preferQuiet && "quiet", request.preferUpgradeability && "headroom upgradeability", request.preferredColor && request.preferredColor !== "none" && request.preferredColor],
    case: [request.preferSmallFormFactor && "sff mini-itx", request.preferredCaseStyle && request.preferredCaseStyle !== "none" && request.preferredCaseStyle, request.preferredColor && request.preferredColor !== "none" && request.preferredColor, request.preferRgb && "rgb", request.preferQuiet && "airflow quiet"],
  };
  return categories.map(category => ({
    category,
    // Never pass user-authored free text to the English-only embedding model.
    query: [...goals, ...categoryTerms[category], category].filter(Boolean).join(" ").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim(),
  }));
}

function performance(part: Part, request: BuildRequest) {
  switch (part.category) {
    case "gpu": return request.useCase === "ai" ? Math.min(100, part.aiScore + (part.cuda ? 8 : -12) + (part.vramGb >= (request.vramPreference || 12) ? 8 : -15)) : request.resolution === "4k" ? part.gamingScore4k : request.resolution === "1080p" ? part.gamingScore1080p : part.gamingScore1440p;
    case "cpu": return request.useCase === "gaming" ? part.gamingScore : part.productivityScore;
    case "motherboard": return Math.min(100, 48 + part.m2Slots * 9 + part.maxMemoryGb / 8);
    case "ram": return Math.min(100, part.capacityGb * (request.useCase === "gaming" ? 1.8 : 1.2) + part.speedMt / 300);
    case "storage": return Math.min(100, part.capacityTb * 20 + (part.readSpeedMb || 500) / 100);
    // A cooler's merit is thermal headroom over the CPU, but capacity past ~250W
    // is irrelevant; do not let a 420mm AIO outscore an adequate tower on size.
    case "cooler": return Math.min(100, 45 + Math.min(part.tdpRatingWatts, 250) / 5);
    // PSU "performance" is efficiency/quality, NOT raw wattage. Headroom is
    // rewarded by the upgradeability dimension and enforced at assembly time,
    // so we no longer bias the pool toward oversized supplies.
    case "psu": return part.efficiency === "Titanium" ? 95 : part.efficiency === "Platinum" ? 88 : part.efficiency === "Gold" ? 78 : 60;
    // Case "performance" is airflow/acoustics, NOT physical size. Clearance is a
    // hard compatibility check, not a score, so a huge case earns nothing extra.
    case "case": return Math.min(100, 62 + (part.tags.includes("airflow") ? 18 : 0) + (part.tags.includes("quiet") ? 8 : 0));
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
  if (request.preferredCooling === "air" && part.category === "cooler" && part.type === "air") score += 35;
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

// Raw, un-normalized objective values for one part. value is performance per
// effective dollar (a Pareto-style "cheaper at equal performance is better"),
// and is later min-max normalized within the category pool. We never reward a
// part for merely costing close to its category budget allocation.
interface RawMetrics {
  performanceScore: number;
  marketScore: number;
  preferenceScore: number;
  upgradeabilityScore: number;
  ragRelevanceScore: number;
  valuePerDollar: number;
}

function rawMetrics(part: Part, request: BuildRequest, evidence: RetrievedKnowledgeChunk[], market: MarketSignal): RawMetrics {
  const performanceScore = performance(part, request);
  const price = priceIn(part, request.currency);
  return {
    performanceScore,
    marketScore: market.marketScore,
    preferenceScore: preference(part, request),
    upgradeabilityScore: upgradeability(part),
    // Absence of a hand-authored knowledge chunk must be neutral, not a penalty,
    // otherwise the ~30 documented SKUs beat the other ~370 purely on coverage.
    ragRelevanceScore: evidence.length ? Math.max(...evidence.map(e => e.relevanceScore)) : 50,
    valuePerDollar: performanceScore / Math.max(price, 1),
  };
}

function combine(metrics: RawMetrics, valueScore: number, category: PartCategory): CandidateScore {
  const w = categoryWeights[category];
  const totalScore =
    metrics.performanceScore * w.performanceScore +
    valueScore * w.valueScore +
    metrics.marketScore * w.marketScore +
    metrics.ragRelevanceScore * w.ragRelevanceScore +
    metrics.preferenceScore * w.preferenceScore +
    metrics.upgradeabilityScore * w.upgradeabilityScore;
  return {
    performanceScore: metrics.performanceScore,
    valueScore,
    marketScore: metrics.marketScore,
    ragRelevanceScore: metrics.ragRelevanceScore,
    preferenceScore: metrics.preferenceScore,
    upgradeabilityScore: metrics.upgradeabilityScore,
    totalScore,
  };
}

export function evidenceFor(part: Part, category: PartCategory, chunks: RetrievedKnowledgeChunk[]): RetrievedKnowledgeChunk[] {
  return chunks.filter(chunk => chunk.partId === part.id || (!chunk.partId && (chunk.category === category || chunk.tags.includes(category))));
}

function evidenceScoreOf(evidence: RetrievedKnowledgeChunk[]): number {
  return evidence.length ? Math.max(...evidence.map(e => e.relevanceScore)) : 50;
}

// Whole-build optimizer weights = per-category weights with the value
// (cheaper-is-better) term removed and the remaining five renormalized to 1.
// In the global optimizer, price is a hard budget CONSTRAINT, not a reward, so
// rewarding cheapness inside the objective would fight against spending the
// budget on capability. The objective should rank capability/quality only.
const optimizerWeights: Record<PartCategory, ScoreWeights> = Object.fromEntries(categories.map(category => {
  const w = categoryWeights[category];
  const keep = { performanceScore: w.performanceScore, marketScore: w.marketScore, preferenceScore: w.preferenceScore, upgradeabilityScore: w.upgradeabilityScore, ragRelevanceScore: w.ragRelevanceScore };
  const sum = keep.performanceScore + keep.marketScore + keep.preferenceScore + keep.upgradeabilityScore + keep.ragRelevanceScore;
  return [category, { performanceScore: keep.performanceScore / sum, valueScore: 0, marketScore: keep.marketScore / sum, preferenceScore: keep.preferenceScore / sum, upgradeabilityScore: keep.upgradeabilityScore / sum, ragRelevanceScore: keep.ragRelevanceScore / sum }];
})) as Record<PartCategory, ScoreWeights>;

// Capability/quality utility of a single part for the whole-build optimizer.
// Excludes price entirely — the optimizer maximizes this subject to the budget.
export function scorePartForOptimizer(part: Part, request: BuildRequest, category: PartCategory, chunks: RetrievedKnowledgeChunk[], market: MarketSignal): number {
  const w = optimizerWeights[category];
  return performance(part, request) * w.performanceScore
    + market.marketScore * w.marketScore
    + preference(part, request) * w.preferenceScore
    + upgradeability(part) * w.upgradeabilityScore
    + evidenceScoreOf(evidenceFor(part, category, chunks)) * w.ragRelevanceScore;
}

// Full per-part score for display/reasoning of parts that were not part of a
// scored pool (e.g. owned parts, or coolers/PSUs pulled from the full catalog).
export function scoreCandidateForDisplay(part: Part, request: BuildRequest, category: PartCategory, chunks: RetrievedKnowledgeChunk[], market: MarketSignal): CandidateScore {
  return combine(rawMetrics(part, request, evidenceFor(part, category, chunks), market), 60, category);
}

// Apply one required hard filter. If it empties the pool, record the offending
// constraint and keep the (now empty) pool — we surface a conflict rather than
// silently keeping non-matching parts.
function applyRequired(eligible: Part[], predicate: (part: Part) => boolean, constraint: ConflictingConstraint, applied: ConflictingConstraint[]): Part[] {
  const next = eligible.filter(predicate);
  applied.push(constraint);
  return next;
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

  // Resolve which hard constraints are user-stated as required (strength), so a
  // mere preference is never enforced as a hard filter.
  const colorIsRequired = request.constraints?.some(item => item.target === "color" && item.value === request.preferredColor && item.strength === "required");
  const rgbIsExcluded = request.constraints?.some(item => item.target === "lighting" && item.strength === "excluded");
  const coolingIsRequired = request.constraints?.some(item => item.target === "cooling" && item.strength === "required");
  const caseStyleIsRequired = request.constraints?.some(item => item.target === "caseStyle" && item.value === request.preferredCaseStyle && item.strength === "required");
  const sffIsRequired = request.preferSmallFormFactor && request.constraints?.some(item => item.target === "formFactor" && item.value === "sff" && item.strength === "required");
  const explicitVramMinimum = request.constraints?.some(item => item.target === "workloadTarget" && item.strength === "required" && /vram|显存/i.test(`${item.value} ${item.sourceText}`));
  const sourceTextFor = (target: string) => request.constraints?.find(item => item.target === target)?.sourceText;

  const conflicts: CategoryConflict[] = [];
  const pools = Object.fromEntries(categories.map(category => {
    const applied: ConflictingConstraint[] = [];
    let eligible = marketCatalog.filter(part => part.category === category);

    if (category === "cpu" && request.preferredCpuBrand && request.preferredCpuBrand !== "none") {
      eligible = applyRequired(eligible, part => part.brand.toLowerCase() === request.preferredCpuBrand, { target: "cpuBrand", value: request.preferredCpuBrand, sourceText: sourceTextFor("cpuBrand") }, applied);
    }
    if (category === "gpu" && request.preferredGpuBrand && request.preferredGpuBrand !== "none") {
      eligible = applyRequired(eligible, part => part.brand.toLowerCase() === request.preferredGpuBrand, { target: "gpuBrand", value: request.preferredGpuBrand, sourceText: sourceTextFor("gpuBrand") }, applied);
    }
    if (category === "gpu" && request.vramPreference && explicitVramMinimum) {
      eligible = applyRequired(eligible, part => part.category === "gpu" && part.vramGb >= request.vramPreference!, { target: "minVram", value: `${request.vramPreference}GB`, sourceText: sourceTextFor("workloadTarget") }, applied);
    }
    if (category === "ram" && request.ramCapacityGb) {
      eligible = applyRequired(eligible, part => part.category === "ram" && part.capacityGb >= request.ramCapacityGb!, { target: "minRam", value: `${request.ramCapacityGb}GB` }, applied);
    }
    if (category === "storage" && request.storageCapacityTb) {
      eligible = applyRequired(eligible, part => part.category === "storage" && part.capacityTb >= request.storageCapacityTb!, { target: "minStorage", value: `${request.storageCapacityTb}TB` }, applied);
    }
    const exactPartId = request.constraints?.find(item => item.target === "workloadTarget" && item.strength === "required" && item.value.startsWith("part:") && parts.find(part => part.id === item.value.slice(5))?.category === category)?.value.slice(5);
    if (exactPartId) {
      eligible = applyRequired(eligible, part => part.id === exactPartId, { target: "exactPart", value: exactPartId, sourceText: sourceTextFor("workloadTarget") }, applied);
    }
    if (category === "cooler" && request.preferredCooling && request.preferredCooling !== "none" && coolingIsRequired) {
      eligible = applyRequired(eligible, part => part.category === "cooler" && part.type === request.preferredCooling, { target: "cooling", value: request.preferredCooling, sourceText: sourceTextFor("cooling") }, applied);
    }
    if (rgbIsExcluded) {
      // Excluding RGB only conflicts if every part in the category is RGB-only,
      // which is not the case for our catalog; keep silent only when there is at
      // least one compliant part.
      const nonRgb = eligible.filter(part => !part.tags.includes("rgb"));
      if (nonRgb.length) eligible = nonRgb;
    }
    if (colorIsRequired && request.preferredColor && request.preferredColor !== "none") {
      // Color is only enforceable where the category actually offers that color.
      const categoryOffersColor = marketCatalog.some(part => part.category === category && part.tags.includes(request.preferredColor as string));
      if (categoryOffersColor) {
        eligible = applyRequired(eligible, part => part.tags.includes(request.preferredColor as string), { target: "color", value: request.preferredColor, sourceText: sourceTextFor("color") }, applied);
      }
    }
    if (sffIsRequired && category === "motherboard") {
      eligible = applyRequired(eligible, part => part.category === "motherboard" && part.formFactor === "Mini-ITX", { target: "formFactor", value: "Mini-ITX", sourceText: sourceTextFor("formFactor") }, applied);
    }
    if (sffIsRequired && category === "case") {
      eligible = applyRequired(eligible, part => part.category === "case" && part.supportedMotherboardFormFactors.length === 1 && part.supportedMotherboardFormFactors[0] === "Mini-ITX", { target: "formFactor", value: "Mini-ITX", sourceText: sourceTextFor("formFactor") }, applied);
    }
    if (sffIsRequired && category === "psu") {
      eligible = applyRequired(eligible, part => part.category === "psu" && part.formFactor === "SFX", { target: "formFactor", value: "SFX", sourceText: sourceTextFor("formFactor") }, applied);
    }
    if (caseStyleIsRequired && category === "case" && request.preferredCaseStyle && request.preferredCaseStyle !== "none") {
      const categoryOffersStyle = marketCatalog.some(part => part.category === "case" && part.tags.includes(request.preferredCaseStyle as string));
      if (categoryOffersStyle) {
        eligible = applyRequired(eligible, part => part.category === "case" && part.tags.includes(request.preferredCaseStyle as string), { target: "caseStyle", value: request.preferredCaseStyle, sourceText: sourceTextFor("caseStyle") }, applied);
      }
    }

    if (!eligible.length) {
      // Hard constraints have no joint solution for this category. Record it and
      // keep going so we can report every infeasible category at once.
      conflicts.push({ category, constraints: applied.length ? applied : [{ target: category, value: "no candidate" }] });
      return [category, [] as PartCandidate[]];
    }

    // Out-of-stock SKUs should not beat buyable/unknown candidates, but only
    // demote them when the category would not become too sparse (soft signal).
    const buyable = eligible.filter(part => marketSignals.get(part.id)?.availability !== "out_of_stock");
    if (buyable.length >= 3) eligible = buyable;

    // First pass: raw objective values; then min-max normalize value-per-dollar
    // within the pool so "cheaper at equal performance" wins without rewarding
    // proximity to the category budget allocation.
    const measured = eligible.map(part => {
      const evidence = evidenceFor(part, category, chunks);
      const market = marketSignals.get(part.id)!;
      return { part, market, evidence: evidence.slice(0, 3), metrics: rawMetrics(part, request, evidence, market) };
    });
    const values = measured.map(item => item.metrics.valuePerDollar);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const scored: PartCandidate[] = measured.map(item => {
      const valueScore = range > 0 ? ((item.metrics.valuePerDollar - minValue) / range) * 100 : 60;
      return { part: item.part, market: item.market, evidence: item.evidence, score: combine(item.metrics, valueScore, category) };
    }).sort((a, b) => b.score.totalScore - a.score.totalScore);

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
    if (category === "psu") {
      for (const form of ["ATX", "SFX"] as const) {
        const candidate = scored.find(item => item.part.category === "psu" && item.part.formFactor === form);
        if (candidate) selected.set(candidate.part.id, candidate);
      }
      // Wattage coverage: keep the highest-wattage compliant supplies so the
      // whole-build optimizer can size up for high-draw GPUs without resorting
      // to unfiltered catalog parts.
      [...scored].sort((a, b) => (b.part.category === "psu" ? b.part.wattage : 0) - (a.part.category === "psu" ? a.part.wattage : 0)).slice(0, 4).forEach(candidate => selected.set(candidate.part.id, candidate));
    }
    if (category === "cooler") {
      // Thermal-headroom coverage: keep the highest-capacity compliant coolers so
      // the optimizer can always mount an adequate cooler for hot CPUs.
      [...scored].sort((a, b) => (b.part.category === "cooler" ? b.part.tdpRatingWatts : 0) - (a.part.category === "cooler" ? a.part.tdpRatingWatts : 0)).slice(0, 4).forEach(candidate => selected.set(candidate.part.id, candidate));
    }
    const candidates = [...selected.values()].sort((a, b) => b.score.totalScore - a.score.totalScore);
    return [category, candidates];
  })) as CandidatePools;

  if (conflicts.length) throw new ConstraintConflictError(conflicts);

  return { pools, chunks, retrieval: summarizeRetrieval(chunks), marketSignals };
}
