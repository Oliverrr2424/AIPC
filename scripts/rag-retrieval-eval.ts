import { loadEnvConfig } from "@next/env";
import type { BuildRequest } from "../src/types/build";
import type { PartCategory } from "../src/types/parts";

loadEnvConfig(process.cwd());

const base: BuildRequest = { budget: 2500, currency: "USD", country: "US", useCase: "balanced", preferredCpuBrand: "none", preferredGpuBrand: "none", preferredColor: "none", preferredCooling: "none", preferredCaseStyle: "none" };
const cases: Array<{ label: string; request: BuildRequest; category: PartCategory; expected: string[] }> = [
  { label: "我需要在本地跑大模型，生态兼容优先并且要大显存", request: { ...base, useCase: "ai", preferredGpuBrand: "nvidia", vramPreference: 24, aiWorkloads: ["本地大模型"] }, category: "gpu", expected: ["vram", "cuda"] },
  { label: "想配一台纯白色带灯效的展示型主机", request: { ...base, preferredColor: "white", preferRgb: true }, category: "case", expected: ["white", "rgb"] },
  { label: "4K 240Hz 游戏应该怎样分配硬件预算", request: { ...base, useCase: "gaming", resolution: "4k", targetFps: 240 }, category: "gpu", expected: ["4k", "240fps"] },
  { label: "以后想继续升级 CPU，平台寿命很重要", request: { ...base, useCase: "development", preferUpgradeability: true, developerWorkloads: ["软件开发"] }, category: "cpu", expected: ["upgradeability", "am5"] },
];

async function main() {
  const { retrieveKnowledgeChunks } = await import("../src/lib/rag/retrieval");
  const { buildRetrievalQueries } = await import("../src/lib/rag/candidateRetriever");
  const { embeddingModel, embeddingProvider } = await import("../src/lib/rag/embeddings");
  if (embeddingProvider() !== "ollama") throw new Error(`Expected ollama embeddings, got ${embeddingProvider()}.`);
  let passed = 0;
  for (const test of cases) {
    const query = buildRetrievalQueries(test.request).find(item => item.category === test.category)!.query;
    if (/[^\x20-\x7E]/.test(query)) throw new Error(`Non-English embedding query generated for: ${test.label}`);
    const rows = await retrieveKnowledgeChunks(query, { category: test.category, limit: 6 });
    if (!rows.length || rows[0].retrievalMode !== "vector") throw new Error(`Vector retrieval unavailable for: ${test.label}`);
    if (rows.some(row => row.embeddingProvider !== "ollama" || row.embeddingModel !== embeddingModel())) throw new Error(`Non-Ollama embedding detected for: ${test.label}`);
    const tags = new Set(rows.flatMap(row => row.tags));
    const hit = test.expected.some(tag => tags.has(tag));
    console.log(`${hit ? "PASS" : "FAIL"} ${test.label} => ${query} -> ${rows.slice(0, 3).map(row => `${row.id}:${row.similarityScore}`).join(", ")}`);
    if (!hit) throw new Error(`Expected one of [${test.expected.join(", ")}] in retrieved evidence.`);
    passed++;
  }
  console.log(`[rag:eval] ${passed}/${cases.length} semantic retrieval cases passed.`);
}

main().catch(error => { console.error(`[rag:eval] failed: ${error instanceof Error ? error.message : error}`); process.exit(1); });
