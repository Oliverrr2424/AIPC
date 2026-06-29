import { partById } from "@/data/parts";
import { checkCompatibility } from "@/lib/compatibility/compatibilityChecker";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { withMarketPrice } from "@/lib/pricing/marketSignals";
import type { BuildRequest } from "@/types/build";
import type { BuildParts, MotherboardPart, Part, PartCategory } from "@/types/parts";
import type { MarketSignal } from "@/types/market";
import type { CandidatePools, RetrievedKnowledgeChunk } from "@/types/knowledge";
import { scorePartForOptimizer } from "./candidateRetriever";

const ORDER: PartCategory[] = ["cpu", "motherboard", "ram", "cooler", "gpu", "case", "storage", "psu"];
const BEAM_WIDTH = 48;

interface BeamState {
  parts: Partial<BuildParts>;
  price: number; // excludes user-owned parts
  utility: number; // pure capability/quality, price-independent
}

export interface OptimizeArgs {
  pools: CandidatePools;
  request: BuildRequest;
  marketSignals: Map<string, MarketSignal>;
  chunks: RetrievedKnowledgeChunk[];
}

function estimateLoad(p: BuildParts) {
  return Math.round(p.cpu.tdpWatts + p.gpu.tdpWatts + 85 + (p.ram.capacityGb / 8) * 3 + p.storage.capacityTb * 5);
}

function requiredWattage(p: BuildParts) {
  return Math.ceil(estimateLoad(p) * 1.35 / 50) * 50;
}

// Returns true if any HARD compatibility rule is violated among the parts that
// are already present. Rules involving a missing part are skipped (checked once
// all their parts are placed). Mirrors compatibilityChecker's FAIL rules and
// additionally rejects coolers that cannot mount the CPU socket.
function partialViolation(b: Partial<BuildParts>): boolean {
  const { cpu, gpu, motherboard, ram, storage, cooler, psu } = b;
  const pc = b.case;
  if (cpu && motherboard && cpu.socket !== motherboard.socket) return true;
  if (ram && motherboard && ram.memoryType !== motherboard.memoryType) return true;
  if (pc && motherboard && !pc.supportedMotherboardFormFactors.includes(motherboard.formFactor)) return true;
  if (gpu && pc && gpu.lengthMm > pc.maxGpuLengthMm) return true;
  if (cooler && pc && cooler.type !== "aio" && cooler.heightMm && cooler.heightMm > pc.maxCoolerHeightMm) return true;
  if (cooler && cpu && (!cooler.supportedSockets.includes(cpu.socket) || cooler.tdpRatingWatts < cpu.tdpWatts)) return true;
  if (storage && motherboard && !motherboard.storageInterfaces.includes(storage.interface)) return true;
  if (pc && psu && !pc.psuFormFactors.includes(psu.formFactor)) return true;
  if (psu && cpu && gpu && ram && storage && pc) {
    if (psu.wattage < requiredWattage(b as BuildParts)) return true;
  }
  return false;
}

export function optimizeBuild({ pools, request, marketSignals, chunks }: OptimizeArgs): BuildParts {
  const currency = request.currency;
  const marketPart = <T extends Part>(part: T): T => withMarketPrice(part, marketSignals.get(part.id));
  const marketFor = (part: Part): MarketSignal => marketSignals.get(part.id) ?? { partId: part.id, effectivePriceUsd: part.price, listPriceUsd: part.price, availability: "unknown", isStale: true, usedFallback: true, sampleCount30d: 0, trend: "insufficient", confidence: 0.15, marketScore: 25 };

  const owned: Partial<Record<PartCategory, Part>> = {};
  for (const id of request.existingPartIds || []) {
    const part = partById(id);
    if (part && !owned[part.category]) owned[part.category] = marketPart(part);
  }

  // Every category draws from its constraint-filtered scored pool, so all hard
  // user constraints (no-RGB, color, cooling type, brand, SFF, min VRAM/RAM…)
  // are already enforced. The pools include wattage/thermal coverage so the
  // optimizer can still size PSUs/coolers up for high-draw builds. Owned parts
  // lock their category.
  const candidatesFor = (category: PartCategory): Part[] => {
    const ownedPart = owned[category];
    if (ownedPart) return [ownedPart];
    return pools[category].map(candidate => candidate.part);
  };

  const utilCache = new Map<string, number>();
  const utilOf = (category: PartCategory, part: Part) => {
    const key = `${category}:${part.id}`;
    let value = utilCache.get(key);
    if (value === undefined) { value = scorePartForOptimizer(part, request, category, chunks, marketFor(part)); utilCache.set(key, value); }
    return value;
  };

  // Admissible lower bound on the cost still required to finish a partial, used
  // to drop partials that can no longer complete within budget so high-utility
  // but doomed partials cannot crowd out feasible ones. The PSU term is special:
  // a 5090 needs a high-wattage (pricier) supply, so once the CPU/GPU are known
  // we bound the PSU by the cheapest supply that can actually power them. This
  // prunes "expensive CPU + 5090" early and leaves room for "5090 + sane rest".
  const candidatesByCategory = Object.fromEntries(ORDER.map(category => [category, candidatesFor(category)])) as Record<PartCategory, Part[]>;
  const cheapestOf = (category: PartCategory) => owned[category] ? 0 : Math.min(...candidatesByCategory[category].map(part => priceIn(part, currency)));
  const psuIndex = ORDER.indexOf("psu");
  const suffixMinNoPsu = new Array(ORDER.length + 1).fill(0);
  for (let i = ORDER.length - 1; i >= 0; i--) suffixMinNoPsu[i] = suffixMinNoPsu[i + 1] + (i === psuIndex ? 0 : cheapestOf(ORDER[i]));
  const cheapestAdequatePsu = (requiredW: number) => {
    if (owned.psu) return 0;
    const adequate = candidatesByCategory.psu.filter(part => part.category === "psu" && part.wattage >= requiredW);
    const pool = adequate.length ? adequate : candidatesByCategory.psu;
    return Math.min(...pool.map(part => priceIn(part, currency)));
  };
  const partialRequiredW = (parts: Partial<BuildParts>) => {
    const load = Math.round((parts.cpu?.tdpWatts ?? 0) + (parts.gpu?.tdpWatts ?? 0) + 85 + (parts.ram ? (parts.ram.capacityGb / 8) * 3 : 0) + (parts.storage ? parts.storage.capacityTb * 5 : 0));
    return Math.ceil(load * 1.35 / 50) * 50;
  };

  let beams: BeamState[] = [{ parts: {}, price: 0, utility: 0 }];
  for (let ci = 0; ci < ORDER.length; ci++) {
    const category = ORDER[ci];
    const candidates = candidatesByCategory[category];
    const expanded: BeamState[] = [];
    const overBudgetOnly: BeamState[] = [];
    for (const beam of beams) {
      for (const part of candidates) {
        const parts = { ...beam.parts, [category]: part } as Partial<BuildParts>;
        if (partialViolation(parts)) continue;
        const addPrice = owned[category] ? 0 : priceIn(part, currency);
        let utility = beam.utility + utilOf(category, part);
        // Light synergy: a chipset that suits the CPU tier (a WARNING-level
        // pairing in the deterministic checker) is gently preferred.
        if (category === "motherboard" && parts.cpu && (part as MotherboardPart).cpuTiers.includes(parts.cpu.tier)) utility += 6;
        // Prefer a PSU with healthy (>=1.5x) headroom when it fits the budget,
        // matching the deterministic checker's "healthy headroom" threshold so we
        // avoid its modest-margin warning without making headroom a hard floor.
        if (category === "psu" && parts.cpu && parts.gpu && parts.ram && parts.storage && parts.psu!.wattage / estimateLoad(parts as BuildParts) >= 1.5) utility += 8;
        const state = { parts, price: beam.price + addPrice, utility };
        const remainingMin = suffixMinNoPsu[ci + 1] + (psuIndex > ci ? cheapestAdequatePsu(partialRequiredW(parts)) : 0);
        // Admissible budget pruning: keep only partials that can still complete
        // within budget.
        if (state.price + remainingMin <= request.budget) expanded.push(state);
        else overBudgetOnly.push(state);
      }
    }
    // If nothing can complete in budget (genuinely infeasible request), fall back
    // to the least-over-budget partials so we still return a build.
    const pool = expanded.length ? expanded : overBudgetOnly;
    if (!pool.length) break; // owned/required parts are mutually incompatible
    pool.sort((a, b) => b.utility - a.utility || a.price - b.price);
    const kept = pool.slice(0, BEAM_WIDTH);
    // Retain the single cheapest partial as a feasibility anchor.
    const cheapest = pool.reduce((min, state) => (state.price < min.price ? state : min), pool[0]);
    if (!kept.includes(cheapest)) kept.push(cheapest);
    beams = kept;
  }

  const complete = beams.filter(beam => ORDER.every(category => beam.parts[category]));
  const valid = complete.filter(beam => checkCompatibility(beam.parts as BuildParts).every(result => result.status !== "FAIL"));
  const inBudget = valid.filter(beam => beam.price <= request.budget);
  const pickFrom = inBudget.length ? inBudget : valid.length ? valid : complete;
  const best = [...pickFrom].sort((a, b) => b.utility - a.utility || a.price - b.price)[0];
  if (best) return best.parts as BuildParts;

  // Extremely defensive fallback: cheapest compatible part per category. Reached
  // only if the beam never completed (e.g. mutually incompatible owned parts).
  const fallback: Partial<BuildParts> = {};
  for (const category of ORDER) {
    const ordered = [...candidatesFor(category)].sort((a, b) => priceIn(a, currency) - priceIn(b, currency));
    fallback[category] = (ordered.find(part => !partialViolation({ ...fallback, [category]: part })) ?? ordered[0]) as never;
  }
  return fallback as BuildParts;
}
