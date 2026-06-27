const baseUrl = process.env.RAG_TEST_URL || "http://localhost:3000";

async function recommend(query) {
  const response = await fetch(`${baseUrl}/api/rag/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, model: "deepseek-v4-flash", thinking: "disabled" }),
  });
  return { response, result: await response.json() };
}

const [{ response, result }, negative] = await Promise.all([
  recommend("USD 5000，主要玩 4k 240Hz 游戏，希望有 RGB，纯白主机，英伟达显卡，intel cpu。"),
  recommend("USD 2600，AMD CPU，NVIDIA GPU，不要 RGB，只要风冷，安静，方便升级。"),
]);

const visibleCategories = ["gpu", "motherboard", "ram", "cooler", "psu", "case"];
const assertions = [
  [response.ok, `API returned ${response.status}`],
  [result.parserMode === "deepseek", "LLM must be the primary parser"],
  [result.request?.constraints?.every(item => item.origin === "llm"), "successful LLM parsing must not be overwritten by fallback rules"],
  [result.request?.constraints?.some(item => item.sourceText.toLowerCase() === "intel cpu"), "constraints must retain supporting source text"],
  [result.request?.preferredCpuBrand === "intel", "intent must preserve Intel CPU"],
  [result.request?.preferredGpuBrand === "nvidia", "intent must preserve NVIDIA GPU"],
  [result.parts?.cpu?.brand === "Intel", "selected CPU must be Intel"],
  [result.parts?.gpu?.brand === "NVIDIA", "selected GPU must be NVIDIA"],
  [result.request?.preferredColor === "white", "intent must preserve white color"],
  [result.request?.preferRgb === true, "intent must preserve RGB"],
  [visibleCategories.every(category => result.parts?.[category]?.tags?.includes("white")), "visible parts must use available white variants"],
  [!result.retrievedChunks?.some(chunk => /Ryzen|Radeon|RX 7/i.test(chunk.title)), "retrieval must exclude conflicting AMD evidence"],
  [!/Ryzen|Radeon|RX 7900/i.test(result.explanation || ""), "explanation must not violate explicit brand constraints"],
  [result.compatibility?.every(item => item.status !== "FAIL"), "compatibility must have no failures"],
  [negative.response.ok, `negative-constraint API returned ${negative.response.status}`],
  [negative.result.request?.constraints?.some(item => item.target === "lighting" && item.value === "rgb" && item.strength === "excluded"), "no-RGB must canonicalize to an RGB exclusion"],
  [negative.result.request?.preferredCooling === "air", "air-only language must compile to air cooling"],
  [negative.result.parts?.cooler?.type === "air", "selected cooler must satisfy the air-only constraint"],
  [!Object.values(negative.result.parts || {}).some(part => part.tags?.includes("rgb")), "excluded RGB must not appear in selected parts"],
];

const failure = assertions.find(([passed]) => !passed);
if (failure) throw new Error(`RAG regression failed: ${failure[1]}`);
console.log(`RAG regressions passed: ${result.parts.cpu.name} + ${result.parts.gpu.name}; negative constraints enforced.`);
