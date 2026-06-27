import type { BuildRequest } from "@/types/build";
import type { BuildParts } from "@/types/parts";
import type { PerformanceEstimate, NumericBenchmark } from "@/types/performance";
import { getBenchmarksForPart } from "@/lib/benchmarks/benchmarkDb";

const tier = (v: number): "Entry" | "Good" | "High" | "Ultra" => (v >= 92 ? "Ultra" : v >= 78 ? "High" : v >= 60 ? "Good" : "Entry");

function toNumeric(rows: Awaited<ReturnType<typeof getBenchmarksForPart>>): NumericBenchmark[] {
  return rows.map(r => ({
    benchmarkKey: r.benchmarkKey,
    value: r.value,
    unit: r.unit,
    resolution: r.resolution,
    quality: r.quality,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
  }));
}

export async function estimatePerformance(parts: BuildParts, request: BuildRequest): Promise<PerformanceEstimate> {
  const r = request.resolution || "1440p";
  const gpuScore = r === "4k" ? parts.gpu.gamingScore4k : r === "1440p" ? parts.gpu.gamingScore1440p : parts.gpu.gamingScore1080p;
  const combined = gpuScore * 0.78 + parts.cpu.gamingScore * 0.22;
  const v = parts.gpu.vramGb;
  const mem = parts.ram.capacityGb;

  // Pull real benchmark rows for the GPU and CPU in this build.
  const [gpuBench, cpuBench] = await Promise.all([
    getBenchmarksForPart(parts.gpu.id),
    getBenchmarksForPart(parts.cpu.id),
  ]);

  // Gaming: real FPS numbers from Cyberpunk 2077 (representative AAA title).
  const cyberpunk = gpuBench.filter(b => b.benchmarkKey === "cyberpunk-2077");
  const fpsRow = cyberpunk.find(b => b.resolution === r) ?? cyberpunk.find(b => b.resolution === "1440p") ?? null;
  const estimatedFps = fpsRow?.value ?? null;
  const fpsTier = estimatedFps != null
    ? (estimatedFps >= 120 ? "Ultra" : estimatedFps >= 80 ? "High" : estimatedFps >= 50 ? "Good" : "Entry")
    : tier(combined);

  // AI: token/s from llama.cpp runs at various model sizes.
  const llamaRows = gpuBench.filter(b => b.benchmarkKind === "tokens-per-second");
  const tokensPerSecond = [
    { model: "Llama 7B Q4", value: llamaRows.find(b => b.benchmarkKey === "llama-7b-q4")?.value ?? null },
    { model: "Llama 13B Q4", value: llamaRows.find(b => b.benchmarkKey === "llama-13b-q4")?.value ?? null },
    { model: "Llama 70B Q4", value: llamaRows.find(b => b.benchmarkKey === "llama-70b-q4")?.value ?? null },
  ];

  // Rendering: Blender Classroom (GPU + CPU), plus Cinebench 2024 multi.
  const gpuRender = gpuBench.find(b => b.benchmarkKey === "blender-classroom")?.value ?? null;
  const cpuRender = cpuBench.find(b => b.benchmarkKey === "blender-classroom-cpu")?.value ?? null;
  const cinebench = cpuBench.find(b => b.benchmarkKey === "cinebench-2024-multi")?.value ?? null;

  return {
    gaming: {
      resolution: r,
      estimatedFpsTier: fpsTier,
      estimatedFps,
      benchmarks: toNumeric(cyberpunk),
      explanation: estimatedFps != null
        ? `${parts.gpu.name} delivers ~${estimatedFps} fps in Cyberpunk 2077 at ${r} Ultra (public benchmark, ${fpsRow?.sourceName}). Tier: ${fpsTier}.`
        : `${parts.gpu.name} drives the ${r} tier while ${parts.cpu.name} keeps frame delivery balanced. No FPS benchmark available — relative tier only.`,
    },
    ai: {
      vramGb: v,
      localLlmTier: v >= 24 ? "Large models" : v >= 16 ? "Medium models" : "Small models",
      diffusionTier: v >= 24 ? "Excellent" : v >= 12 ? "Good" : "Basic",
      tokensPerSecond,
      benchmarks: toNumeric(llamaRows),
      explanation: `${v}GB VRAM supports ${v >= 24 ? "large local experiments" : v >= 16 ? "strong hobbyist workloads" : "smaller models and image generation"}${parts.gpu.cuda ? " with CUDA acceleration" : ""}. Token/s measured with llama.cpp Q4 on the listed models.`,
    },
    development: {
      multitaskingTier: mem >= 64 && parts.cpu.cores >= 8 ? "Excellent" : mem >= 32 ? "Good" : "Basic",
      dockerTier: mem >= 64 ? "Excellent" : mem >= 32 ? "Good" : "Basic",
      explanation: `${parts.cpu.cores} CPU cores and ${mem}GB RAM define the available headroom for containers, builds, and local services.`,
    },
    video: {
      editingTier: parts.cpu.productivityScore >= 90 && mem >= 64 ? "Excellent" : parts.cpu.productivityScore >= 75 && mem >= 32 ? "Good" : "Basic",
      benchmarks: toNumeric(cpuBench.filter(b => b.benchmarkKey === "cinebench-2024-multi")),
      explanation: "Editing tier combines CPU productivity, GPU capability, memory capacity, and NVMe storage speed.",
    },
    rendering: {
      gpuRenderSeconds: gpuRender,
      cpuRenderSeconds: cpuRender,
      cinebenchMultiScore: cinebench,
      benchmarks: toNumeric([
        ...gpuBench.filter(b => b.benchmarkKey === "blender-classroom"),
        ...cpuBench.filter(b => b.benchmarkKey === "blender-classroom-cpu" || b.benchmarkKey === "cinebench-2024-multi"),
      ]),
      explanation: gpuRender != null && cpuRender != null
        ? `Blender Classroom: ${gpuRender}s on GPU (Optix/HIP), ${cpuRender}s on CPU. Cinebench 2024 multi: ${cinebench ?? "n/a"} pts. Lower is better for render seconds.`
        : "No Blender render benchmark available for this configuration.",
    },
  };
}
