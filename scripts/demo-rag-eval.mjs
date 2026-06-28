import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.AIPC_BASE_URL || "http://localhost:3000";
const outputDir = process.env.AIPC_EVAL_OUTPUT || path.join(process.cwd(), "outputs", "rag-5090-demo-20260628");

const tests = [
  {
    id: "T01", persona: "新手玩家", expertise: "Beginner", language: "中文",
    query: "预算 1200 美元，想配一台玩 2K 144Hz 游戏的电脑，性价比优先，不要 RGB，黑色普通机箱就行。",
    expected: { currency: "USD", budget: 1200, useCase: "gaming", resolution: "1440p", targetFps: 144, noRgb: true },
  },
  {
    id: "T02", persona: "高刷游戏玩家", expertise: "Enthusiast", language: "English",
    query: "US$2,800 tower for 4K 165 Hz gaming. AMD CPU is mandatory, NVIDIA GPU is mandatory. Prefer a quiet all-black build, no lighting, and leave sensible upgrade headroom.",
    expected: { currency: "USD", budget: 2800, useCase: "gaming", resolution: "4k", cpuBrand: "AMD", gpuBrand: "NVIDIA", noRgb: true },
  },
  {
    id: "T03", persona: "本地 AI 工程师", expertise: "Professional", language: "English",
    query: "Budget USD 5,000 for a local AI workstation: CUDA is required, target 70B Q4 inference plus FLUX image generation, at least 32 GB VRAM and 128 GB system RAM. Linux, quiet operation, no aesthetic priority.",
    expected: { currency: "USD", budget: 5000, useCase: "ai", gpuBrand: "NVIDIA", minVram: 32, minRam: 128 },
  },
  {
    id: "T04", persona: "学生创作者", expertise: "Intermediate", language: "中文",
    query: "我有 1600 美元，平时玩游戏也跑 Stable Diffusion。显卡一定要英伟达而且至少 16GB 显存，别整灯，稳定好用就行。",
    expected: { currency: "USD", budget: 1600, acceptedUseCases: ["ai", "balanced"], gpuBrand: "NVIDIA", minVram: 16, noRgb: true },
  },
  {
    id: "T05", persona: "平台开发者", expertise: "Professional", language: "中文 + English",
    query: "CAD 4,000，主要 Docker/Kubernetes、Android Studio、多服务本地开发和大型编译。必须 Intel CPU，至少 96GB RAM，安静、低功耗并且后续好升级；不需要 RGB。",
    expected: { currency: "CAD", budget: 4000, useCase: "development", cpuBrand: "Intel", minRam: 96, noRgb: true },
  },
  {
    id: "T06", persona: "视频工作室", expertise: "Intermediate", language: "中文",
    query: "3500 美元做 Premiere Pro、DaVinci Resolve 的 4K 剪辑和调色，英伟达显卡，至少 4TB SSD。外观要纯白、海景房、RGB，可以上 360 水冷。",
    expected: { currency: "USD", budget: 3500, useCase: "video", gpuBrand: "NVIDIA", minStorage: 4, white: true, rgb: true, panoramic: true, cooling: "aio" },
  },
  {
    id: "T07", persona: "SFF 发烧友", expertise: "Expert", language: "English",
    query: "Build an actually compact Mini-ITX/SFF PC under USD 2,600 for 1440p gaming and coding. Air cooling only, SFX PSU, no RGB, low noise. Do not sacrifice compatibility just to hit the size target.",
    expected: { currency: "USD", budget: 2600, acceptedUseCases: ["gaming", "balanced"], resolution: "1440p", sff: true, noRgb: true, cooling: "air" },
  },
  {
    id: "T08", persona: "节能开发者", expertise: "Intermediate", language: "English",
    query: "I need an efficient, low-noise Linux development desktop around $1,300 for VS Code, databases, Docker and occasional 1080p gaming. 64 GB RAM, no RGB, prioritize low power over peak FPS.",
    expected: { currency: "USD", budget: 1300, useCase: "development", minRam: 64, noRgb: true },
  },
  {
    id: "T09", persona: "中国游戏小白", expertise: "Beginner", language: "中文",
    query: "人民币 15000 元，主要打 2K 144 帧游戏。我喜欢白色带灯，CPU 和显卡都想用 AMD，别太吵，预算不要爆。",
    expected: { currency: "CNY", budget: 15000, useCase: "gaming", resolution: "1440p", cpuBrand: "AMD", gpuBrand: "AMD", caseWhite: true, rgb: true },
  },
  {
    id: "T10", persona: "3D/引擎工作站用户", expertise: "Expert", language: "English",
    query: "USD 6,500 workstation for Unreal Engine 5 shader compilation, Blender Cycles and large C++ builds. Use a Ryzen 9 9950X3D and GeForce RTX 5090, 128 GB RAM and 4 TB NVMe. Reliability and cooling matter more than looks.",
    expected: { currency: "USD", budget: 6500, useCase: "balanced", cpuBrand: "AMD", gpuBrand: "NVIDIA", exactCpu: "Ryzen 9 9950X3D", exactGpu: "GeForce RTX 5090", minRam: 128, minStorage: 4 },
  },
];

function audit(test, result) {
  const errors = [];
  const warnings = [];
  const req = result.request || {};
  const parts = result.parts || {};
  const expected = test.expected;
  const lowerTags = part => (part?.tags || []).map(tag => String(tag).toLowerCase());
  const rgbParts = Object.values(parts).filter(part => lowerTags(part).includes("rgb"));

  if (result.parserMode !== "deepseek") errors.push(`Intent parser fell back to ${result.parserMode || "unknown"}`);
  if (result.aiModel !== "deepseek-v4-flash") errors.push(`Wrong model: ${result.aiModel || "unknown"}`);
  if (result.thinkingMode !== "disabled") errors.push(`Thinking mode is ${result.thinkingMode || "unknown"}`);
  if (result.retrieval?.mode !== "vector") errors.push(`Retrieval mode is ${result.retrieval?.mode || "unknown"}`);
  if (result.retrieval?.embeddingProvider !== "ollama") errors.push(`Embedding provider is ${result.retrieval?.embeddingProvider || "unknown"}`);
  if (!String(result.retrieval?.embeddingModel || "").startsWith("nomic-embed-text")) errors.push(`Embedding model is ${result.retrieval?.embeddingModel || "unknown"}`);
  if (req.currency !== expected.currency) errors.push(`Currency parsed as ${req.currency}, expected ${expected.currency}`);
  if (Math.abs(Number(req.budget) - expected.budget) > 1) errors.push(`Budget parsed as ${req.budget}, expected ${expected.budget}`);
  if (expected.acceptedUseCases && !expected.acceptedUseCases.includes(req.useCase)) errors.push(`Use case parsed as ${req.useCase}, expected one of ${expected.acceptedUseCases.join(", ")}`);
  else if (expected.useCase && req.useCase !== expected.useCase) {
    const acceptableMixed = test.id === "T10" && ["development", "video", "balanced"].includes(req.useCase);
    (acceptableMixed ? warnings : errors).push(`Use case parsed as ${req.useCase}, expected ${expected.useCase}`);
  }
  if (expected.resolution && req.resolution !== expected.resolution) errors.push(`Resolution parsed as ${req.resolution || "none"}, expected ${expected.resolution}`);
  if (expected.targetFps && req.targetFps !== expected.targetFps) errors.push(`Target FPS parsed as ${req.targetFps || "none"}, expected ${expected.targetFps}`);
  if (expected.cpuBrand && String(parts.cpu?.brand || "").toLowerCase() !== expected.cpuBrand.toLowerCase()) errors.push(`CPU brand is ${parts.cpu?.brand || "missing"}, expected ${expected.cpuBrand}`);
  if (expected.gpuBrand && String(parts.gpu?.brand || "").toLowerCase() !== expected.gpuBrand.toLowerCase()) errors.push(`GPU brand is ${parts.gpu?.brand || "missing"}, expected ${expected.gpuBrand}`);
  if (expected.minVram && Number(parts.gpu?.vramGb || 0) < expected.minVram) errors.push(`VRAM ${parts.gpu?.vramGb || 0}GB is below ${expected.minVram}GB`);
  if (expected.minRam && Number(parts.ram?.capacityGb || 0) < expected.minRam) errors.push(`RAM ${parts.ram?.capacityGb || 0}GB is below ${expected.minRam}GB`);
  if (expected.minStorage && Number(parts.storage?.capacityTb || 0) < expected.minStorage) errors.push(`Storage ${parts.storage?.capacityTb || 0}TB is below ${expected.minStorage}TB`);
  if (expected.cooling && parts.cooler?.type !== expected.cooling) errors.push(`Cooling is ${parts.cooler?.type || "missing"}, expected ${expected.cooling}`);
  if (expected.sff) {
    if (parts.motherboard?.formFactor !== "Mini-ITX") errors.push(`SFF board is ${parts.motherboard?.formFactor || "missing"}`);
    if (parts.psu?.formFactor !== "SFX") errors.push(`SFF PSU is ${parts.psu?.formFactor || "missing"}`);
    if (!(parts.case?.supportedMotherboardFormFactors?.length === 1 && parts.case.supportedMotherboardFormFactors[0] === "Mini-ITX")) errors.push(`Case is not compact-only: ${parts.case?.name || "missing"}`);
  }
  if (expected.white) {
    for (const category of ["case", "motherboard", "ram", "cooler"]) {
      if (!lowerTags(parts[category]).includes("white")) errors.push(`${category} is not tagged white: ${parts[category]?.name || "missing"}`);
    }
  }
  if (expected.caseWhite && !lowerTags(parts.case).includes("white")) errors.push(`Case is not tagged white: ${parts.case?.name || "missing"}`);
  if (expected.panoramic && !lowerTags(parts.case).includes("panoramic")) errors.push(`Case is not panoramic: ${parts.case?.name || "missing"}`);
  if (expected.rgb && !rgbParts.length) errors.push("RGB requested but no selected part is tagged RGB");
  if (expected.noRgb && rgbParts.length) errors.push(`No-RGB request violated by ${rgbParts.map(part => part.name).join(", ")}`);
  if (expected.exactCpu && !String(parts.cpu?.name || "").includes(expected.exactCpu)) errors.push(`Exact CPU not honored: ${parts.cpu?.name || "missing"}`);
  if (expected.exactGpu && !String(parts.gpu?.name || "").includes(expected.exactGpu)) errors.push(`Exact GPU not honored: ${parts.gpu?.name || "missing"}`);

  const failedCompatibility = (result.compatibility || []).filter(item => item.status === "FAIL");
  if (failedCompatibility.length) errors.push(`Compatibility FAIL: ${failedCompatibility.map(item => item.rule).join(", ")}`);
  const compatibilityWarnings = (result.compatibility || []).filter(item => item.status === "WARNING");
  if (compatibilityWarnings.length) warnings.push(`Compatibility warning: ${compatibilityWarnings.map(item => item.rule).join(", ")}`);
  const utilization = Number(result.totalPrice || 0) / Number(req.budget || 1);
  if (utilization > 1.2) errors.push(`Total is ${(utilization * 100).toFixed(1)}% of budget`);
  else if (utilization > 1.0) warnings.push(`Total is ${(utilization * 100).toFixed(1)}% of budget`);
  if (!(result.retrievedChunks || []).length) errors.push("No RAG evidence returned");
  if ((result.retrievedChunks || []).some(chunk => chunk.embeddingProvider !== "ollama")) errors.push("At least one evidence row did not use Ollama");

  return {
    verdict: errors.length ? "FAIL" : warnings.length ? "WARNING" : "PASS",
    errors,
    warnings,
    budgetUtilization: utilization,
  };
}

async function run() {
  await fs.mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = [];
  for (const test of tests) {
    const started = performance.now();
    let response;
    let body;
    try {
      response = await fetch(`${baseUrl}/api/rag/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: test.query, model: "deepseek-v4-flash", thinking: "disabled" }),
        signal: AbortSignal.timeout(120_000),
      });
      body = await response.json();
    } catch (error) {
      body = { error: error instanceof Error ? error.message : String(error) };
    }
    const latencyMs = Math.round(performance.now() - started);
    if (!response?.ok || body.error) {
      results.push({ ...test, latencyMs, httpStatus: response?.status || 0, result: body, audit: { verdict: "FAIL", errors: [`API error: ${body.error || response?.status}`], warnings: [], budgetUtilization: 0 } });
    } else {
      results.push({ ...test, latencyMs, httpStatus: response.status, result: body, audit: audit(test, body) });
    }
    const last = results.at(-1);
    console.log(`${test.id} ${last.audit.verdict} ${(latencyMs / 1000).toFixed(1)}s | parser=${body.parserMode || "n/a"} retrieval=${body.retrieval?.mode || "n/a"}/${body.retrieval?.embeddingProvider || "n/a"} | ${(last.audit.errors || []).join("; ") || "no obvious errors"}`);
  }
  const finishedAt = new Date().toISOString();
  const payload = {
    metadata: {
      startedAt, finishedAt, baseUrl,
      model: "deepseek-v4-flash", thinking: "disabled",
      requiredEmbeddingProvider: "ollama", requiredEmbeddingModel: "nomic-embed-text",
      testCount: tests.length,
    },
    summary: {
      pass: results.filter(item => item.audit.verdict === "PASS").length,
      warning: results.filter(item => item.audit.verdict === "WARNING").length,
      fail: results.filter(item => item.audit.verdict === "FAIL").length,
      averageLatencyMs: Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length),
    },
    results,
  };
  const outputPath = path.join(outputDir, "rag-demo-results.json");
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Saved ${outputPath}`);
  if (results.some(item => item.result?.retrieval?.embeddingProvider !== "ollama" || item.result?.retrieval?.mode !== "vector")) process.exitCode = 2;
}

await run();
