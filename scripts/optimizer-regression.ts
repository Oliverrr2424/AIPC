import { parts } from "@/data/parts";
import { checkCompatibility } from "@/lib/compatibility/compatibilityChecker";
import { catalogMarketSignal, isPartEligibleForRegion, marketRegion } from "@/lib/pricing/marketSignals";
import { optimizeBuild } from "@/lib/rag/buildOptimizer";
import { BuildOptimizationError } from "@/lib/rag/buildOptimizer";
import { capabilityScore, gamingGpuGoalSatisfaction } from "@/lib/rag/utilityModel";
import { extractIntentConstraints, semanticRequestPatch } from "@/lib/rag/constraintExtractor";
import { isCatalogPartSelectable } from "@/lib/catalog/catalogQuality";
import type { BuildRequest } from "@/types/build";
import type { CandidatePools, CandidateScore } from "@/types/knowledge";
import type { MarketSignal } from "@/types/market";
import type { Part, PartCategory } from "@/types/parts";

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];
const neutralScore: CandidateScore = { performanceScore: 50, valueScore: 50, ragRelevanceScore: 50, preferenceScore: 50, upgradeabilityScore: 50, marketScore: 25, totalScore: 50 };
const market = (part: Part): MarketSignal => ({ partId: part.id, effectivePriceUsd: part.price, listPriceUsd: part.price, availability: "unknown", isStale: true, usedFallback: true, priceSource: "global_reference", sampleCount30d: 0, trend: "insufficient", confidence: .15, marketScore: 25 });

function setup(request: BuildRequest) {
  const region = marketRegion(request.country);
  const catalog = parts.filter(part => isPartEligibleForRegion(part, region) && isCatalogPartSelectable(part)).filter(part => {
    if (request.constraints?.some(item => item.target === "lighting" && item.strength === "excluded") && part.tags.includes("rgb")) return false;
    if (part.category === "cpu" && request.preferredCpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredCpuBrand) return false;
    if (part.category === "gpu" && request.preferredGpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredGpuBrand) return false;
    if (part.category === "gpu" && request.vramPreference && request.constraints?.some(item => item.target === "workloadTarget" && /vram/i.test(item.value)) && part.vramGb < request.vramPreference) return false;
    if (part.category === "ram" && request.ramCapacityGb && part.capacityGb < request.ramCapacityGb) return false;
    if (part.category === "storage" && request.storageCapacityTb && part.capacityTb < request.storageCapacityTb) return false;
    const coolingRequired = request.constraints?.some(item => item.target === "cooling" && item.strength === "required");
    if (part.category === "cooler" && coolingRequired && request.preferredCooling !== "none" && part.type !== request.preferredCooling) return false;
    const sff = request.constraints?.some(item => item.target === "formFactor" && item.value === "sff" && item.strength === "required");
    if (sff && part.category === "motherboard" && part.formFactor !== "Mini-ITX") return false;
    if (sff && part.category === "case" && !(part.supportedMotherboardFormFactors.length === 1 && part.supportedMotherboardFormFactors[0] === "Mini-ITX")) return false;
    if (sff && part.category === "psu" && part.formFactor !== "SFX") return false;
    return true;
  });
  const marketSignals = new Map(catalog.map(part => [part.id, market(part)]));
  const pools = Object.fromEntries(categories.map(category => [category, catalog.filter(part => part.category === category).map(part => ({ part, market: market(part), evidence: [], score: neutralScore }))])) as unknown as CandidatePools;
  return { catalog, marketSignals, pools };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function optimize(request: BuildRequest) {
  const { pools, marketSignals } = setup(request);
  return optimizeBuild({ pools, request, marketSignals, chunks: [] });
}

const valueGaming: BuildRequest = {
  budget: 1200, currency: "USD", country: "US", useCase: "gaming", resolution: "1440p", targetFps: 144,
  preferredCpuBrand: "none", preferredGpuBrand: "none", preferredColor: "black", preferredCooling: "none", preferredCaseStyle: "traditional",
  preferQuiet: false, preferRgb: false, preferSmallFormFactor: false, preferUpgradeability: false, preferLowPower: false, preferValue: true, preferReliability: false,
  constraints: [{ id: "no-rgb", target: "lighting", value: "rgb", strength: "excluded", sourceText: "不要 RGB", interpretation: "No RGB" }],
};
const gamingBuild = optimize(valueGaming);
const gamingTotal = Object.values(gamingBuild).reduce((sum, part) => sum + part.price, 0);
assert(gamingTotal <= valueGaming.budget, `Value gaming build exceeded budget: ${gamingTotal}`);
assert(gamingBuild.ram.capacityGb <= 32, `Gaming capacity failed to saturate at 32GB: ${gamingBuild.ram.name}`);
assert(gamingBuild.psu.wattage <= 850, `Value build selected an oversized ${gamingBuild.psu.wattage}W PSU`);
assert(!Object.values(gamingBuild).some(part => part.id.startsWith("ca-")), "US build selected a CA-only catalog entry");
assert(!checkCompatibility(gamingBuild).some(item => item.status === "FAIL"), "Value gaming build has a known compatibility failure");

const aiRequest: BuildRequest = {
  budget: 5000, currency: "USD", country: "US", useCase: "ai", vramPreference: 32, ramCapacityGb: 128, operatingSystem: "linux",
  preferredCpuBrand: "none", preferredGpuBrand: "nvidia", preferredColor: "none", preferredCooling: "none", preferredCaseStyle: "none",
  preferQuiet: true, preferRgb: false, preferSmallFormFactor: false, preferUpgradeability: false, preferLowPower: false, preferValue: false, preferReliability: true,
  constraints: [{ id: "cuda", target: "gpuBrand", value: "nvidia", strength: "required", sourceText: "CUDA", interpretation: "CUDA required" }, { id: "vram", target: "workloadTarget", value: "vram>=32", strength: "required", sourceText: "32GB VRAM", interpretation: "32GB VRAM minimum" }],
};
const aiBuild = optimize(aiRequest);
const aiTotal = Object.values(aiBuild).reduce((sum, part) => sum + part.price, 0);
assert(aiTotal <= aiRequest.budget, `AI build exceeded budget: ${aiTotal}`);
assert(aiBuild.gpu.cuda && aiBuild.gpu.vramGb >= 32, "AI build violated CUDA/VRAM requirements");
assert(aiBuild.ram.capacityGb >= 128 && aiBuild.ram.price < 800, `AI build wasted budget on RAM: ${aiBuild.ram.name} at ${aiBuild.ram.price}`);
assert(!checkCompatibility(aiBuild).some(item => item.status === "FAIL"), "AI build has a known compatibility failure");

let budgetConflict = false;
try { optimize({ ...aiRequest, budget: 2500 }); } catch (error) { budgetConflict = error instanceof BuildOptimizationError && error.reason === "budget"; }
assert(budgetConflict, "An infeasible hard budget did not return a budget conflict");

const unknownCase = parts.find(part => part.category === "case" && part.supportedRadiatorSizesMm == null);
assert(unknownCase?.category === "case", "Unknown-radiator case fixture missing");
const unknownRadiator = checkCompatibility({ ...aiBuild, case: unknownCase }).find(item => item.id === "cooler-clearance");
assert(unknownRadiator?.status === "UNKNOWN", "Missing radiator data was optimistically marked PASS");

const developmentRequest: BuildRequest = {
  budget: 1300, currency: "USD", country: "US", useCase: "development", resolution: "1080p", ramCapacityGb: 64, operatingSystem: "linux",
  preferredCpuBrand: "none", preferredGpuBrand: "none", preferredColor: "none", preferredCooling: "none", preferredCaseStyle: "none",
  preferQuiet: true, preferRgb: false, preferSmallFormFactor: false, preferUpgradeability: false, preferLowPower: true, preferValue: true, preferReliability: true,
  constraints: [{ id: "no-rgb-dev", target: "lighting", value: "rgb", strength: "excluded", sourceText: "no RGB", interpretation: "No RGB" }],
};
const developmentBuild = optimize(developmentRequest);
const developmentTotal = Object.values(developmentBuild).reduce((sum, part) => sum + part.price, 0);
assert(developmentTotal <= developmentRequest.budget, "Development build exceeded budget");
assert(developmentBuild.ram.capacityGb >= 64, "Development build missed the 64GB RAM requirement");
assert(developmentBuild.gpu.price < developmentBuild.cpu.price * 1.8, "Development utility over-allocated budget to the GPU");
assert(!checkCompatibility(developmentBuild).some(item => item.status === "FAIL"), "Development build has a known compatibility failure");

const sffRequest: BuildRequest = {
  ...valueGaming, budget: 2600, preferValue: false, preferQuiet: true, preferSmallFormFactor: true, preferredCooling: "air",
  constraints: [...(valueGaming.constraints || []), { id: "sff", target: "formFactor", value: "sff", strength: "required", sourceText: "SFF", interpretation: "Mini-ITX build" }, { id: "air", target: "cooling", value: "air", strength: "required", sourceText: "air cooling only", interpretation: "Air cooling only" }],
};
const sffBuild = optimize(sffRequest);
assert(sffBuild.motherboard.formFactor === "Mini-ITX" && sffBuild.psu.formFactor === "SFX" && sffBuild.case.supportedMotherboardFormFactors.length === 1, "SFF structural constraints were not jointly enforced");
assert(sffBuild.cooler.type === "air" && !checkCompatibility(sffBuild).some(item => item.status === "FAIL"), "SFF air-cooled build is not feasible");

const highRefresh4k: BuildRequest = {
  ...valueGaming, budget: 2800, resolution: "4k", targetFps: 165, preferValue: false, preferQuiet: true, preferUpgradeability: true,
  preferredCpuBrand: "amd", preferredGpuBrand: "nvidia", ramCapacityGb: 32, storageCapacityTb: 2,
  constraints: [{ id: "amd", target: "cpuBrand", value: "amd", strength: "required", sourceText: "AMD CPU", interpretation: "AMD CPU" }, { id: "nvidia", target: "gpuBrand", value: "nvidia", strength: "required", sourceText: "NVIDIA GPU", interpretation: "NVIDIA GPU" }, ...(valueGaming.constraints || [])],
};
const highRefreshBuild = optimize(highRefresh4k);
assert(Number.isFinite(capabilityScore(highRefreshBuild.gpu, highRefresh4k)), "Arbitrary 165Hz target produced a non-finite GPU utility");
assert(gamingGpuGoalSatisfaction(highRefreshBuild.gpu, highRefresh4k) >= 85, `4K 165Hz build underfunded the GPU: ${highRefreshBuild.gpu.name}`);
assert(!checkCompatibility(highRefreshBuild).some(item => item.status === "FAIL"), "4K high-refresh build has a known compatibility failure");

const cpuRequest = { ...valueGaming, budget: 3000, preferValue: false };
const x3d = parts.find(part => part.id === "cpu-r7-9800x3d");
const nonX3d = parts.find(part => part.id === "cpu-r7-9700x");
assert(x3d?.category === "cpu" && nonX3d?.category === "cpu", "CPU fixtures missing");
assert(capabilityScore(x3d, cpuRequest) > capabilityScore(nonX3d, cpuRequest), "High-refresh utility did not recognize 3D V-Cache gaming value");

const ram32 = parts.find(part => part.id === "ram-32");
const ram64 = parts.find(part => part.id === "ram-64");
assert(ram32?.category === "ram" && ram64?.category === "ram", "RAM fixtures missing");
assert(Math.abs(capabilityScore(ram32, valueGaming) - capabilityScore(ram64, valueGaming)) < 1, "Gaming RAM capacity did not saturate after 32GB");

const caPart = parts.find(part => part.id.startsWith("ca-") && part.priceKind === "retail");
assert(caPart, "CA regional fixture missing");
assert(isPartEligibleForRegion(caPart, "CA") && !isPartEligibleForRegion(caPart, "US"), "Regional catalog isolation failed");
assert(catalogMarketSignal(caPart, "CA").priceSource === "regional_catalog", "CA retail price was not labeled as a regional catalog price");
assert(catalogMarketSignal(gamingBuild.gpu, "US").priceSource === "global_reference", "Global/MSRP price was mislabeled as regional");
const cudaPatch = semanticRequestPatch(extractIntentConstraints("CUDA is required for this workstation"));
assert(cudaPatch.preferredGpuBrand === "nvidia", "Explicit CUDA requirement did not become a hard NVIDIA GPU constraint");
const badLegacyCpu = parts.find(part => part.category === "cpu" && part.name === "Intel Core i5-4590");
assert(badLegacyCpu && !isCatalogPartSelectable(badLegacyCpu), "Structurally mis-normalized legacy CPU was not quarantined");

console.log(JSON.stringify({
  valueGaming: { total: gamingTotal, cpu: gamingBuild.cpu.name, gpu: gamingBuild.gpu.name, ram: gamingBuild.ram.name, cooler: gamingBuild.cooler.name, psu: gamingBuild.psu.name, case: gamingBuild.case.name, compatibility: checkCompatibility(gamingBuild).reduce((count, item) => ({ ...count, [item.status]: (count[item.status] || 0) + 1 }), {} as Record<string, number>), unknown: checkCompatibility(gamingBuild).filter(item => item.status === "UNKNOWN").map(item => item.rule) },
  ai: { total: aiTotal, cpu: aiBuild.cpu.name, gpu: aiBuild.gpu.name, ram: aiBuild.ram.name, cooler: aiBuild.cooler.name, psu: aiBuild.psu.name, case: aiBuild.case.name, compatibility: checkCompatibility(aiBuild).reduce((count, item) => ({ ...count, [item.status]: (count[item.status] || 0) + 1 }), {} as Record<string, number>), unknown: checkCompatibility(aiBuild).filter(item => item.status === "UNKNOWN").map(item => item.rule) },
  development: { total: developmentTotal, cpu: developmentBuild.cpu.name, gpu: developmentBuild.gpu.name, ram: developmentBuild.ram.name, storage: developmentBuild.storage.name },
  sff: { total: Object.values(sffBuild).reduce((sum, part) => sum + part.price, 0), cpu: sffBuild.cpu.name, gpu: sffBuild.gpu.name, case: sffBuild.case.name, psu: sffBuild.psu.name },
  highRefresh4k: { total: Object.values(highRefreshBuild).reduce((sum, part) => sum + part.price, 0), cpu: highRefreshBuild.cpu.name, gpu: highRefreshBuild.gpu.name, goalSatisfaction: gamingGpuGoalSatisfaction(highRefreshBuild.gpu, highRefresh4k) },
}, null, 2));
