import { partById } from "@/data/parts";
import { checkCompatibility, hasKnownCompatibilityFailure } from "@/lib/compatibility/compatibilityChecker";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { withMarketPrice } from "@/lib/pricing/marketSignals";
import type { BuildRequest } from "@/types/build";
import type { BuildParts, MotherboardPart, Part, PartCategory } from "@/types/parts";
import type { MarketSignal } from "@/types/market";
import type { CandidatePools, RetrievedKnowledgeChunk } from "@/types/knowledge";
import { scorePartForOptimizer } from "./candidateRetriever";
import { categoryImportance, scoreCompleteBuild } from "./utilityModel";

const ORDER: PartCategory[] = ["cpu", "motherboard", "ram", "cooler", "gpu", "case", "storage", "psu"];
const BEAM_WIDTH = 72;

interface BeamState {
  parts: Partial<BuildParts>;
  price: number; // excludes user-owned parts
  utility: number; // workload-weighted capability, before portfolio adjustments
}

export interface OptimizeArgs {
  pools: CandidatePools;
  request: BuildRequest;
  marketSignals: Map<string, MarketSignal>;
  chunks: RetrievedKnowledgeChunk[];
}

export class BuildOptimizationError extends Error {
  constructor(public readonly reason: "budget" | "compatibility", message: string) {
    super(message);
    this.name = "BuildOptimizationError";
  }
}

export function optimizeBuild({ pools, request, marketSignals, chunks }: OptimizeArgs): BuildParts {
  const currency = request.currency;
  const marketPart = <T extends Part>(part: T): T => withMarketPrice(part, marketSignals.get(part.id));
  const marketFor = (part: Part): MarketSignal => marketSignals.get(part.id) ?? { partId: part.id, effectivePriceUsd: part.price, listPriceUsd: part.price, availability: "unknown", isStale: true, usedFallback: true, priceSource: "global_reference", sampleCount30d: 0, trend: "insufficient", confidence: 0.15, marketScore: 25 };

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
        if (hasKnownCompatibilityFailure(parts)) continue;
        const addPrice = owned[category] ? 0 : priceIn(part, currency);
        let utility = beam.utility + utilOf(category, part) * categoryImportance(request, category);
        // A sensible chipset is a small within-platform nudge. It is deliberately
        // scaled to the whole-build 0..100 objective rather than adding six raw
        // points as the old equal-category objective did.
        if (category === "motherboard" && parts.cpu && (part as MotherboardPart).cpuTiers.includes(parts.cpu.tier)) utility += .35;
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
    const partialPriority = (state: BeamState) => state.utility - (state.price / Math.max(request.budget, 1)) * (request.preferValue ? 7 : 2.5);
    pool.sort((a, b) => partialPriority(b) - partialPriority(a) || a.price - b.price);
    const kept = pool.slice(0, BEAM_WIDTH);
    // Retain several low-cost states so tiny local score differences cannot
    // erase the eventual value/Pareto knee before complete-build scoring.
    [...pool].sort((a, b) => a.price - b.price || b.utility - a.utility).slice(0, 8).forEach(state => { if (!kept.includes(state)) kept.push(state); });
    beams = kept;
  }

  const complete = beams.filter(beam => ORDER.every(category => beam.parts[category]));
  const valid = complete.filter(beam => checkCompatibility(beam.parts as BuildParts).every(result => result.status !== "FAIL"));
  const inBudget = valid.filter(beam => beam.price <= request.budget);
  if (!inBudget.length) {
    const cheapestValid = [...valid].sort((a, b) => a.price - b.price)[0];
    if (cheapestValid) throw new BuildOptimizationError("budget", `No compatible build fits the hard ${request.currency} ${request.budget} budget. The cheapest feasible candidate is ${request.currency} ${cheapestValid.price}.`);
    throw new BuildOptimizationError("compatibility", "No complete build satisfies the stated hard constraints and known compatibility rules.");
  }

  const scored = inBudget.map(state => {
    const build = state.parts as BuildParts;
    const utilities = Object.fromEntries(ORDER.map(category => [category, utilOf(category, build[category])])) as Record<PartCategory, number>;
    return { state, breakdown: scoreCompleteBuild(build, request, utilities, state.price) };
  }).sort((a, b) => b.breakdown.total - a.breakdown.total || a.state.price - b.state.price);
  return scored[0].state.parts as BuildParts;
}
