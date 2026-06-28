import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const cases = [
  { query: "我需要在本地跑大模型，生态兼容优先并且要大显存", expected: ["vram", "cuda"] },
  { query: "想配一台纯白色带灯效的展示型主机", expected: ["white", "rgb"] },
  { query: "4K 240Hz 游戏应该怎样分配硬件预算", expected: ["4k", "240fps"] },
  { query: "以后想继续升级 CPU，平台寿命很重要", expected: ["upgradeability", "am5"] },
];

async function main() {
  const { retrieveKnowledgeChunks } = await import("../src/lib/rag/retrieval");
  const { embeddingModel, embeddingProvider } = await import("../src/lib/rag/embeddings");
  if (embeddingProvider() !== "ollama") throw new Error(`Expected ollama embeddings, got ${embeddingProvider()}.`);
  let passed = 0;
  for (const test of cases) {
    const rows = await retrieveKnowledgeChunks(test.query, { limit: 6 });
    if (!rows.length || rows[0].retrievalMode !== "vector") throw new Error(`Vector retrieval unavailable for: ${test.query}`);
    if (rows.some(row => row.embeddingProvider !== "ollama" || row.embeddingModel !== embeddingModel())) throw new Error(`Non-Ollama embedding detected for: ${test.query}`);
    const tags = new Set(rows.flatMap(row => row.tags));
    const hit = test.expected.some(tag => tags.has(tag));
    console.log(`${hit ? "PASS" : "FAIL"} ${test.query} -> ${rows.slice(0, 3).map(row => `${row.id}:${row.similarityScore}`).join(", ")}`);
    if (!hit) throw new Error(`Expected one of [${test.expected.join(", ")}] in retrieved evidence.`);
    passed++;
  }
  console.log(`[rag:eval] ${passed}/${cases.length} semantic retrieval cases passed.`);
}

main().catch(error => { console.error(`[rag:eval] failed: ${error instanceof Error ? error.message : error}`); process.exit(1); });
