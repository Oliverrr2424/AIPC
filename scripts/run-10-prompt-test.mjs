const baseUrl = process.env.AIPC_BASE_URL || "http://localhost:3000";

const tests = [
  {
    id: "T01", persona: "新手玩家", language: "中文",
    query: "预算 1200 美元，想配一台玩 2K 144Hz 游戏的电脑，性价比优先，不要 RGB，黑色普通机箱就行。",
    expected: { currency: "USD", budget: 1200, useCase: "gaming", resolution: "1440p", noRgb: true },
  },
  {
    id: "T02", persona: "高刷游戏玩家", language: "English",
    query: "US$2,800 tower for 4K 165 Hz gaming. AMD CPU is mandatory, NVIDIA GPU is mandatory. Prefer a quiet all-black build, no lighting, and leave sensible upgrade headroom.",
    expected: { currency: "USD", budget: 2800, useCase: "gaming", cpuBrand: "AMD", gpuBrand: "NVIDIA", noRgb: true },
  },
  {
    id: "T03", persona: "本地 AI 工程师", language: "English",
    query: "Budget USD 5,000 for a local AI workstation: CUDA is required, target 70B Q4 inference plus FLUX image generation, at least 32 GB VRAM and 128 GB system RAM. Linux, quiet operation, no aesthetic priority.",
    expected: { currency: "USD", budget: 5000, useCase: "ai", gpuBrand: "NVIDIA", minVram: 32, minRam: 128 },
  },
  {
    id: "T04", persona: "学生创作者", language: "中文",
    query: "我有 1600 美元，平时玩游戏也跑 Stable Diffusion。显卡一定要英伟达而且至少 16GB 显存，别整灯，稳定好用就行。",
    expected: { currency: "USD", budget: 1600, gpuBrand: "NVIDIA", minVram: 16, noRgb: true },
  },
  {
    id: "T05", persona: "平台开发者", language: "中文 + English",
    query: "CAD 4,000，主要 Docker/Kubernetes、Android Studio、多服务本地开发和大型编译。必须 Intel CPU，至少 96GB RAM，安静、低功耗并且后续好升级；不需要 RGB。",
    expected: { currency: "CAD", budget: 4000, useCase: "development", cpuBrand: "Intel", minRam: 96, noRgb: true },
  },
  {
    id: "T06", persona: "视频工作室", language: "中文",
    query: "3500 美元做 Premiere Pro、DaVinci Resolve 的 4K 剪辑和调色，英伟达显卡，至少 4TB SSD。外观要纯白、海景房、RGB，可以上 360 水冷。",
    expected: { currency: "USD", budget: 3500, useCase: "video", gpuBrand: "NVIDIA", minStorage: 4, white: true, rgb: true, panoramic: true, cooling: "aio" },
  },
  {
    id: "T07", persona: "SFF 发烧友", language: "English",
    query: "Build an actually compact Mini-ITX/SFF PC under USD 2,600 for 1440p gaming and coding. Air cooling only, SFX PSU, no RGB, low noise. Do not sacrifice compatibility just to hit the size target.",
    expected: { currency: "USD", budget: 2600, resolution: "1440p", sff: true, noRgb: true, cooling: "air" },
  },
  {
    id: "T08", persona: "节能开发者", language: "English",
    query: "I need an efficient, low-noise Linux development desktop around $1,300 for VS Code, databases, Docker and occasional 1080p gaming. 64 GB RAM, no RGB, prioritize low power over peak FPS.",
    expected: { currency: "USD", budget: 1300, useCase: "development", minRam: 64, noRgb: true },
  },
  {
    id: "T09", persona: "中国游戏小白", language: "中文",
    query: "人民币 15000 元，主要打 2K 144 帧游戏。我喜欢白色带灯，CPU 和显卡都想用 AMD，别太吵，预算不要爆。",
    expected: { currency: "CNY", budget: 15000, useCase: "gaming", resolution: "1440p", cpuBrand: "AMD", gpuBrand: "AMD", white: true, rgb: true },
  },
  {
    id: "T10", persona: "3D/引擎工作站用户", language: "English",
    query: "USD 6,500 workstation for Unreal Engine 5 shader compilation, Blender Cycles and large C++ builds. Use a Ryzen 9 9950X3D and GeForce RTX 5090, 128 GB RAM and 4 TB NVMe. Reliability and cooling matter more than looks.",
    expected: { currency: "USD", budget: 6500, cpuBrand: "AMD", gpuBrand: "NVIDIA", minRam: 128, minStorage: 4 },
  },
];

function audit(test, r) {
  const parts = r.parts || {};
  const req = r.request || {};
  const exp = test.expected;
  const fails = [];
  const warnings = [];

  if (exp.currency && req.currency !== exp.currency) fails.push(`currency: ${req.currency} ≠ ${exp.currency}`);
  if (exp.budget && req.budget !== exp.budget) fails.push(`budget: ${req.budget} ≠ ${exp.budget}`);
  if (exp.useCase && req.useCase !== exp.useCase) fails.push(`useCase: ${req.useCase} ≠ ${exp.useCase}`);
  if (exp.acceptedUseCases && !exp.acceptedUseCases.includes(req.useCase)) fails.push(`useCase: ${req.useCase}`);
  if (exp.resolution && req.resolution !== exp.resolution) fails.push(`resolution: ${req.resolution} ≠ ${exp.resolution}`);
  if (exp.cpuBrand && req.preferredCpuBrand !== exp.cpuBrand.toLowerCase()) fails.push(`cpuBrand: ${req.preferredCpuBrand} ≠ ${exp.cpuBrand}`);
  if (exp.gpuBrand && req.preferredGpuBrand !== exp.gpuBrand.toLowerCase()) fails.push(`gpuBrand: ${req.preferredGpuBrand} ≠ ${exp.gpuBrand}`);
  if (exp.minVram && parts.gpu && parts.gpu.vramGb < exp.minVram) fails.push(`vram: ${parts.gpu.vramGb}GB < ${exp.minVram}GB`);
  if (exp.minRam && parts.ram && parts.ram.capacityGb < exp.minRam) fails.push(`ram: ${parts.ram.capacityGb}GB < ${exp.minRam}GB`);
  if (exp.minStorage && parts.storage && parts.storage.capacityTb < exp.minStorage) fails.push(`ssd: ${parts.storage.capacityTb}TB < ${exp.minStorage}TB`);
  if (exp.noRgb && req.preferRgb) fails.push(`rgb: true (expected false)`);
  if (exp.rgb && !req.preferRgb) fails.push(`rgb: false (expected true)`);
  if (exp.white && req.preferredColor !== "white") fails.push(`color: ${req.preferredColor} ≠ white`);
  if (exp.cooling && req.preferredCooling !== exp.cooling) fails.push(`cooling: ${req.preferredCooling} ≠ ${exp.cooling}`);
  if (exp.sff && !req.preferSmallFormFactor) fails.push(`sff: false (expected true)`);
  if (exp.panoramic && req.preferredCaseStyle !== "panoramic") fails.push(`caseStyle: ${req.preferredCaseStyle} ≠ panoramic`);

  const compatFails = (r.compatibility || []).filter(c => c.status === "FAIL");
  if (compatFails.length) fails.push(`compat: ${compatFails.length} FAIL`);

  const overBudget = r.totalPrice > req.budget;
  if (overBudget) warnings.push(`over-budget: $${r.totalPrice} > $${req.budget}`);

  return { fails, warnings, overBudget };
}

async function runOne(test) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/api/rag/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: test.query, model: "deepseek-v4-flash", thinking: "disabled" }),
  });
  const latency = Date.now() - t0;
  const json = await res.json();
  return { ...json, latencyMs: latency, httpStatus: res.status };
}

async function main() {
  const results = [];
  for (const test of tests) {
    process.stdout.write(`Running ${test.id} (${test.persona})... `);
    try {
      const r = await runOne(test);
      const auditResult = audit(test, r);
      results.push({ test, result: r, audit: auditResult });
      const status = auditResult.fails.length === 0 ? (auditResult.warnings.length ? "WARNING" : "PASS") : "FAIL";
      console.log(`${status} (${r.latencyMs}ms)${auditResult.fails.length ? " → " + auditResult.fails.join("; ") : ""}${auditResult.warnings.length ? " ⚠ " + auditResult.warnings.join("; ") : ""}`);
    } catch (err) {
      console.log(`ERROR → ${err.message}`);
      results.push({ test, error: err.message });
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("DETAILED RESULTS");
  console.log("=".repeat(100));
  for (const { test, result: r, audit: a, error } of results) {
    if (error) {
      console.log(`\n${test.id} ${test.persona}: ERROR — ${error}`);
      continue;
    }
    const parts = r.parts || {};
    const req = r.request || {};
    const status = a.fails.length === 0 ? (a.warnings.length ? "⚠ WARNING" : "✓ PASS") : "✗ FAIL";
    console.log(`\n${test.id} ${test.persona} — ${status} (${r.latencyMs}ms)`);
    console.log(`  budget=${req.currency} ${req.budget}  total=$${r.totalPrice}  useCase=${req.useCase}  res=${req.resolution}`);
    console.log(`  CPU: ${parts.cpu?.name?.slice(0, 50) || "?"}  (${parts.cpu?.brand})`);
    console.log(`  GPU: ${parts.gpu?.name?.slice(0, 50) || "?"}  (${parts.gpu?.chipset}, ${parts.gpu?.vramGb}GB)`);
    console.log(`  RAM: ${parts.ram?.capacityGb}GB  SSD: ${parts.storage?.capacityTb}TB  Cooler: ${parts.cooler?.type}`);
    console.log(`  rgb=${req.preferRgb}  color=${req.preferredColor}  cooling=${req.preferredCooling}  sff=${req.preferSmallFormFactor}  caseStyle=${req.preferredCaseStyle}`);
    if (a.fails.length) console.log(`  FAILS: ${a.fails.join("; ")}`);
    if (a.warnings.length) console.log(`  WARN: ${a.warnings.join("; ")}`);
  }

  const pass = results.filter(r => r.audit && r.audit.fails.length === 0 && r.audit.warnings.length === 0).length;
  const warn = results.filter(r => r.audit && r.audit.fails.length === 0 && r.audit.warnings.length > 0).length;
  const fail = results.filter(r => r.audit && r.audit.fails.length > 0).length;
  const err = results.filter(r => r.error).length;
  console.log(`\n${"=".repeat(100)}`);
  console.log(`SUMMARY: ${pass} PASS, ${warn} WARNING, ${fail} FAIL, ${err} ERROR out of ${results.length}`);
  console.log("=".repeat(100));
}

main().catch(e => { console.error(e); process.exit(1); });
