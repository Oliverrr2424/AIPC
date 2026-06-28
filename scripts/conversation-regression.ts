import { generateRagBuild } from "../src/lib/rag/ragBuildGenerator";
import { reviseRagBuild } from "../src/lib/rag/conversationAgent";
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

console.log("Conversation regressions passed: patch scope, compatibility dependencies, explanation immutability, minimal optimization, and explicit rebuild routing.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
