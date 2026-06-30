import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import type { BuildRequest, UseCase } from "@/types/build";
import type { BuildParts, Part, PartCategory } from "@/types/parts";

export const workloadCategoryWeights: Record<UseCase, Record<PartCategory, number>> = {
  gaming: { cpu: .18, gpu: .43, motherboard: .08, ram: .06, storage: .07, cooler: .05, psu: .07, case: .06 },
  ai: { cpu: .13, gpu: .48, motherboard: .08, ram: .12, storage: .08, cooler: .04, psu: .05, case: .02 },
  development: { cpu: .29, gpu: .08, motherboard: .12, ram: .20, storage: .13, cooler: .05, psu: .07, case: .06 },
  video: { cpu: .22, gpu: .29, motherboard: .08, ram: .12, storage: .13, cooler: .05, psu: .06, case: .05 },
  balanced: { cpu: .22, gpu: .25, motherboard: .10, ram: .12, storage: .10, cooler: .06, psu: .08, case: .07 },
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const ratioScore = (actual: number, target: number) => clamp(actual / Math.max(target, 1) * 100);
const evidenceAdjusted = (part: Part, value: number) => part.performanceDataKind === "derived" ? 50 + (value - 50) * .72 : value;

export function ramTargetGb(request: BuildRequest) {
  if (request.ramCapacityGb) return request.ramCapacityGb;
  if (request.useCase === "gaming" || request.useCase === "balanced") return 32;
  return 64;
}

export function storageTargetTb(request: BuildRequest) {
  if (request.storageCapacityTb) return request.storageCapacityTb;
  if (request.useCase === "video" || request.useCase === "ai") return 2;
  return 1;
}

function gamingGpuTargetScore(request: BuildRequest) {
  const fps = Math.max(30, Math.min(500, request.targetFps || 60));
  const byResolution = {
    "1080p": [[60,45],[120,70],[144,80],[240,100]],
    "1440p": [[60,55],[120,85],[144,95],[240,110]],
    "4k": [[60,75],[120,100],[144,108],[240,125]],
  } as const;
  const points = byResolution[request.resolution || "1440p"];
  if (fps <= points[0][0]) return points[0][1] * fps / points[0][0];
  for (let index = 1; index < points.length; index++) {
    const [rightFps, rightScore] = points[index], [leftFps, leftScore] = points[index - 1];
    if (fps <= rightFps) return leftScore + (rightScore - leftScore) * (fps - leftFps) / (rightFps - leftFps);
  }
  return Math.min(140, points[points.length - 1][1] + (fps - points[points.length - 1][0]) * .06);
}

function gpuGamingScore(part: Extract<Part, { category: "gpu" }>, request: BuildRequest) {
  const raw = request.resolution === "4k" ? part.gamingScore4k : request.resolution === "1080p" ? part.gamingScore1080p : part.gamingScore1440p;
  return evidenceAdjusted(part, raw);
}

export function gamingGpuGoalSatisfaction(part: Extract<Part, { category: "gpu" }>, request: BuildRequest) {
  return ratioScore(gpuGamingScore(part, request), gamingGpuTargetScore(request));
}

function gamingCpuTargetScore(request: BuildRequest) {
  const fps = request.targetFps || 60;
  if (fps <= 60) return 70;
  if (fps <= 120) return 70 + (fps - 60) * 14 / 60;
  if (fps <= 144) return 84 + (fps - 120) * 6 / 24;
  if (fps <= 240) return 90 + (fps - 144) * 8 / 96;
  return Math.min(108, 98 + (fps - 240) * .03);
}

export function gamingCpuGoalSatisfaction(part: Extract<Part, { category: "cpu" }>, request: BuildRequest) {
  const highRefresh = (request.targetFps || 60) >= 144;
  const resolutionFactor = request.resolution === "4k" ? .3 : request.resolution === "1440p" ? .7 : 1;
  const x3dBonus = part.has3dVCache || /x3d/i.test(part.name) ? (highRefresh ? 6 : 3) * resolutionFactor : 0;
  return ratioScore(evidenceAdjusted(part, part.gamingScore) + x3dBonus, gamingCpuTargetScore(request));
}

function gpuEcosystemScore(part: Extract<Part, { category: "gpu" }>, request: BuildRequest) {
  if (part.cuda) return 100;
  const ecosystems = part.computeEcosystems || [];
  if (ecosystems.includes("rocm") || ecosystems.includes("hip")) return request.operatingSystem === "linux" ? 72 : request.operatingSystem === "windows" ? 55 : 62;
  if (ecosystems.includes("oneapi")) return 52;
  return 35;
}

function storageQuality(part: Extract<Part, { category: "storage" }>, request: BuildRequest) {
  const read = ratioScore(part.readSpeedMb || 500, part.interface === "NVMe" ? 7000 : 550);
  const writeHeavy = request.useCase === "video" || request.useCase === "ai" || request.developerWorkloads?.some(item => /database|container|compile|build/i.test(item));
  if (!writeHeavy) return read * .75 + (part.warrantyYears ? ratioScore(part.warrantyYears, 5) : 50) * .25;
  const sustained = part.sustainedWriteMb != null ? ratioScore(part.sustainedWriteMb, 2500) : part.writeSpeedMb != null ? ratioScore(part.writeSpeedMb * .45, 2500) : 35;
  const enduranceTarget = Math.max(600, part.capacityTb * 600);
  const endurance = part.tbw != null ? ratioScore(part.tbw, enduranceTarget) : 45;
  const nand = part.nandType === "TLC" || part.nandType === "MLC" || part.nandType === "SLC" ? 90 : part.nandType === "QLC" ? 55 : 50;
  const cache = part.hasDram === true ? 90 : part.hasDram === false ? 55 : 50;
  return sustained * .35 + endurance * .25 + nand * .18 + cache * .12 + read * .10;
}

/** Workload capability with explicit saturation. This score intentionally does
 * not include price; price opportunity cost is applied at whole-build level. */
export function capabilityScore(part: Part, request: BuildRequest): number {
  switch (part.category) {
    case "gpu": {
      if (request.useCase === "gaming") return gamingGpuGoalSatisfaction(part, request) * .85 + clamp(gpuGamingScore(part, request)) * .15;
      if (request.useCase === "ai") {
        const targetVram = request.vramPreference || 16;
        return ratioScore(part.vramGb, targetVram) * .35 + clamp(part.aiScore) * .42 + gpuEcosystemScore(part, request) * .23;
      }
      if (request.useCase === "video") {
        const encoder = part.videoEncoders?.includes("av1") ? 100 : part.videoEncoders?.length ? 78 : 45;
        return clamp(part.aiScore * .45 + gpuGamingScore(part, request) * .35 + encoder * .20);
      }
      if (request.useCase === "development") return clamp(45 + part.vramGb * 1.2 + (part.videoEncoders?.includes("av1") ? 8 : 0));
      return clamp(gpuGamingScore(part, request) * .65 + part.aiScore * .20 + gpuEcosystemScore(part, request) * .15);
    }
    case "cpu": {
      if (request.useCase === "gaming") return gamingCpuGoalSatisfaction(part, request) * .88 + clamp(part.gamingScore) * .12;
      const heavy = request.useCase === "development" && request.developerWorkloads?.some(item => /compile|build|android|container|docker/i.test(item));
      const target = request.useCase === "video" ? 92 : heavy ? 95 : request.useCase === "development" ? 86 : request.useCase === "ai" ? 84 : 88;
      const measured = ratioScore(evidenceAdjusted(part, part.productivityScore), target);
      const threadTarget = heavy || request.useCase === "video" ? 24 : 16;
      const threading = ratioScore(part.threads, threadTarget);
      return measured * .78 + threading * .22;
    }
    case "motherboard": {
      const m2Target = request.useCase === "video" || request.useCase === "development" ? 3 : 2;
      const expansion = ratioScore(part.m2Slots, m2Target);
      const memory = ratioScore(part.maxMemoryGb, ramTargetGb(request));
      const slots = part.ramSlots == null ? 50 : ratioScore(part.ramSlots, 4);
      const platform = part.socket === "AM5" ? 88 : part.socket === "LGA1851" ? 80 : 62;
      return expansion * .32 + memory * .24 + slots * .14 + platform * .30;
    }
    case "ram": {
      const capacity = ratioScore(part.capacityGb, ramTargetGb(request));
      const speedTarget = part.memoryType === "DDR5" ? 6000 : 3600;
      const speed = ratioScore(part.speedMt, speedTarget);
      const topology = part.sticks === 2 ? 92 : part.sticks === 1 ? 62 : part.sticks === 4 ? 55 : 45;
      const profileConfidence = part.profile === "JEDEC" ? 88 : part.profile ? 72 : 55;
      return capacity * .72 + speed * .13 + topology * .10 + profileConfidence * .05;
    }
    case "storage": {
      const capacity = ratioScore(part.capacityTb, storageTargetTb(request));
      return capacity * (request.useCase === "video" || request.useCase === "ai" ? .62 : .72) + storageQuality(part, request) * (request.useCase === "video" || request.useCase === "ai" ? .38 : .28);
    }
    case "cooler": {
      const construction = part.type === "aio" ? (part.radiatorSizeMm ? ratioScore(part.radiatorSizeMm, 360) : 55) : (part.heightMm ? 75 : 50);
      const acoustics = part.tags.includes("quiet") ? 90 : 58;
      return construction * .55 + acoustics * .45;
    }
    case "psu": {
      const efficiency = part.efficiency === "Titanium" ? 96 : part.efficiency === "Platinum" ? 90 : part.efficiency === "Gold" ? 82 : 65;
      const modern = part.atxVersion === "3.1" ? 95 : part.atxVersion === "3.0" ? 84 : part.atxVersion ? 60 : 50;
      const cable = (part.twelveV2x6Connectors ?? 0) > 0 ? 92 : part.pcie8PinConnectors != null ? 75 : 50;
      return efficiency * .55 + modern * .25 + cable * .20;
    }
    case "case": {
      const airflow = part.tags.includes("airflow") ? 82 : 60;
      const acoustics = part.tags.includes("quiet") ? 88 : 58;
      const knownFit = [part.maxGpuThicknessSlots, part.supportedRadiatorSizesMm, part.maxPsuLengthMm].filter(value => value != null).length / 3 * 100;
      return airflow * .50 + acoustics * .20 + knownFit * .30;
    }
  }
}

export function categoryImportance(request: BuildRequest, category: PartCategory) {
  return workloadCategoryWeights[request.useCase][category];
}

export interface CompleteUtilityBreakdown {
  capability: number;
  goalAdjustment: number;
  compatibilityAdjustment: number;
  powerAdjustment: number;
  costAdjustment: number;
  total: number;
}

/** Final portfolio score. Inputs in `partUtilities` are local 0..100 scores that
 * already include bounded preference/evidence/market terms. */
export function scoreCompleteBuild(parts: BuildParts, request: BuildRequest, partUtilities: Record<PartCategory, number>, price: number): CompleteUtilityBreakdown {
  const weights = workloadCategoryWeights[request.useCase];
  const capability = (Object.keys(weights) as PartCategory[]).reduce((sum, category) => sum + partUtilities[category] * weights[category], 0);
  let goalAdjustment = 0;
  if (request.useCase === "gaming") {
    const gpuGap = 100 - gamingGpuGoalSatisfaction(parts.gpu, request);
    const cpuGap = 100 - gamingCpuGoalSatisfaction(parts.cpu, request);
    goalAdjustment -= gpuGap * .18 + cpuGap * .07;
    if (gpuGap > 8 && cpuGap < gpuGap - 12) goalAdjustment -= 2.5;
  }
  if (request.useCase === "ai") {
    const vramGap = 100 - ratioScore(parts.gpu.vramGb, request.vramPreference || 16);
    goalAdjustment -= vramGap * .12;
    if (!parts.gpu.cuda && !parts.gpu.computeEcosystems?.some(item => item === "rocm" || item === "hip")) goalAdjustment -= 5;
  }

  const compatibility = checkCompatibility(parts);
  const unknowns = compatibility.filter(item => item.status === "UNKNOWN").length;
  const warnings = compatibility.filter(item => item.status === "WARNING").length;
  const compatibilityAdjustment = -Math.min(5, unknowns * .45) - warnings * .25;

  const headroom = parts.psu.wattage / Math.max(estimateWattage(parts), 1);
  const healthyHeadroom = clamp((headroom - 1.35) / .15 * 100);
  const coolerHeadroom = clamp((parts.cooler.tdpRatingWatts / Math.max(parts.cpu.tdpWatts, 1) - 1) / .6 * 100);
  const excessHeadroomPenalty = Math.max(0, headroom - 1.7) * 2.5;
  const powerAdjustment = healthyHeadroom * .012 + coolerHeadroom * .008 - excessHeadroomPenalty;

  const spendRatio = price / Math.max(request.budget, 1);
  const costAdjustment = -spendRatio * (request.preferValue ? 12 : 5);
  return { capability, goalAdjustment, compatibilityAdjustment, powerAdjustment, costAdjustment, total: capability + goalAdjustment + compatibilityAdjustment + powerAdjustment + costAdjustment };
}
