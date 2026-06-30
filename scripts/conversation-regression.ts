import { generateRagBuild } from "../src/lib/rag/ragBuildGenerator";
import { reviseRagBuild } from "../src/lib/rag/conversationAgent";
import { buildRetrievalQueries } from "../src/lib/rag/candidateRetriever";
import type { PartCategory } from "../src/types/parts";

delete process.env.DEEPSEEK_API_KEY;
delete process.env.GEMINI_API_KEY;

const ai = { model: "deepseek-v4-flash" as const, thinking: "disabled" as const };
const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];
const ids = (build: Awaited<ReturnType<typeof generateRagBuild>>) => Object.fromEntries(categories.map(category => [category, build.parts[category].id]));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(`Conversation regression failed: ${message}`); };

async function main() {
const baseline = await generateRagBuild("USD 5000，4K 240Hz，白色 RGB，Intel CPU + NVIDIA GPU。", ai);
const gpuEdit = await reviseRagBuild("换成 5090", baseline, ai);
assert(gpuEdit.parts.gpu.id === "gpu-5090", "an explicit RTX 5090 edit must be honored");
assert(gpuEdit.parts.cpu.id === baseline.parts.cpu.id && gpuEdit.parts.motherboard.id === baseline.parts.motherboard.id, "a GPU edit must preserve unrelated CPU and motherboard choices");
assert(gpuEdit.interaction?.changedParts.some(change => change.category === "gpu" && !change.inducedByCompatibility), "the GPU must be marked as the direct change");
assert(gpuEdit.interaction?.changedParts.filter(change => change.inducedByCompatibility).every(change => change.category === "psu" || change.category === "case"), "only physical or power dependencies may follow a GPU edit");
assert(gpuEdit.compatibility.every(result => result.status !== "FAIL"), "the edited GPU build must remain compatible");

const airEdit = await reviseRagBuild("不要水冷", gpuEdit, ai);
assert(airEdit.parts.cooler.type === "air", "no-liquid-cooling must select an air cooler");
assert(airEdit.parts.gpu.id === "gpu-5090", "a cooling edit must keep the explicitly selected GPU");
assert(airEdit.compatibility.every(result => result.status !== "FAIL"), "linked cooler/case changes must remain compatible");

const explanation = await reviseRagBuild("为什么不用 14900K", airEdit, ai);
assert(explanation.interaction?.action === "explain", "why questions must be routed to explanation");
assert(JSON.stringify(ids(explanation)) === JSON.stringify(ids(airEdit)), "explanation turns must not mutate any part");

const cheaper = await reviseRagBuild("便宜一点", airEdit, ai);
assert(cheaper.interaction?.action === "optimize", "a small cost request must use minimal-change optimization");
assert(cheaper.totalPrice < airEdit.totalPrice, "optimization must reduce the total");
assert(cheaper.parts.gpu.id === "gpu-5090", "minimal optimization must retain an explicitly locked part");
assert((cheaper.interaction?.changedParts.length || 0) <= 3, "minimal optimization must cap substitutions");

const rebuilt = await reviseRagBuild("太贵了，重新配", airEdit, ai);
assert(rebuilt.interaction?.action === "rebuild", "an explicit overall rejection must rebuild");
assert(rebuilt.request.budget < airEdit.request.budget, "too-expensive rebuilds must lower the working budget");
assert(rebuilt.compatibility.every(result => result.status !== "FAIL"), "rebuilt configuration must remain compatible");

const whiteBaseline = await generateRagBuild("build a white pc, 3500 cad budget, fps gaming only, with 64GB RAM and a Samsung 9100 Pro 2TB", ai);
const whiteRefine = await reviseRagBuild("i only need 32gb ram, and a cheaper ssd compared to samsung", whiteBaseline, ai);
assert(whiteRefine.parts.ram.capacityGb === 32, "a 32GB follow-up must update RAM capacity");
assert(whiteRefine.parts.ram.tags.includes("white"), "a RAM update must preserve the baseline white-build preference");
assert(whiteRefine.request.preferredColor === "white", "the baseline color preference must survive a later local patch");
assert(whiteRefine.request.ramCapacityGb === 32, "the updated RAM capacity must persist in structured request state");
assert(whiteRefine.parts.storage.price < whiteBaseline.parts.storage.price, "a category-scoped cheaper SSD request must reduce SSD price");
const constraintIds = (whiteRefine.request.constraints || []).map(item => item.id);
assert(new Set(constraintIds).size === constraintIds.length, "follow-up constraints must have unique React-safe IDs");
assert((whiteRefine.interaction?.context.length || 0) >= 4, "the turn must retain bounded multi-turn context");
const quietBaseline = await generateRagBuild("USD 2200，主要玩 1440p 144Hz 游戏，希望安静、方便以后升级，不要 RGB。", ai);
assert(quietBaseline.request.preferRgb !== true, "a no-RGB baseline must not prefer RGB");
const rgbReversal = await reviseRagBuild("改成一套有rgb的配置，不要静音了", quietBaseline, ai);
assert(rgbReversal.interaction?.action === "patch", "reversing an exclusion must patch rather than no-op");
assert((rgbReversal.interaction?.changedParts.length || 0) > 0, "reversing the no-RGB exclusion must actually swap parts");
assert(categories.some(category => rgbReversal.parts[category].tags.includes("rgb")), "an RGB reversal must introduce at least one RGB component");
assert(!(rgbReversal.request.constraints || []).some(item => item.target === "lighting" && item.strength === "excluded"), "the prior no-RGB exclusion must be cleared after reversal");
assert(rgbReversal.request.preferRgb === true && rgbReversal.request.preferQuiet === false, "the reversed preferences must persist in structured request state");
assert(rgbReversal.compatibility.every(result => result.status !== "FAIL"), "the RGB reversal must remain compatible");
assert(rgbReversal.parts.gpu.chipset === quietBaseline.parts.gpu.chipset, "an appearance-only change must not silently upgrade the GPU tier");
assert(rgbReversal.parts.ram.capacityGb === quietBaseline.parts.ram.capacityGb, "an appearance-only change must not silently change RAM capacity");
assert(rgbReversal.parts.storage.capacityTb === quietBaseline.parts.storage.capacityTb, "an appearance-only change must not silently change storage capacity");

const englishQueries = buildRetrievalQueries({
  ...whiteRefine.request,
  useCase: "development",
  aiWorkloads: ["本地大模型和图片生成"],
  developerWorkloads: ["Docker、数据库和大型编译"],
});
assert(englishQueries.every(item => /^[\x20-\x7E]+$/.test(item.query)), "every embedding query must be normalized to English ASCII terms");
assert(englishQueries.some(item => item.query.includes("containers docker kubernetes") && item.query.includes("local databases") && item.query.includes("large code compilation")), "non-English workload details must map to canonical English retrieval terms");

console.log("Conversation regressions passed: patch scope, persistent preferences, unique constraint IDs, context retention, compatibility dependencies, explanation immutability, minimal optimization, and explicit rebuild routing.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
