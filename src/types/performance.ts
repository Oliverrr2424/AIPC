export interface NumericBenchmark {
  benchmarkKey: string;
  value: number;
  unit: string;        // "fps" | "tok/s" | "s" | "pts"
  resolution?: string | null;
  quality?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
}

export interface PerformanceEstimate {
  gaming?: {
    resolution: "1080p" | "1440p" | "4k";
    estimatedFpsTier: "Entry" | "Good" | "High" | "Ultra";
    estimatedFps: number | null;
    targetFps?: number;
    targetStatus?: "met" | "below" | "unknown";
    targetGapFps?: number | null;
    benchmarks: NumericBenchmark[];
    explanation: string;
  };
  ai?: {
    vramGb: number;
    localLlmTier: "Small models" | "Medium models" | "Large models";
    diffusionTier: "Basic" | "Good" | "Excellent";
    tokensPerSecond: { model: string; value: number | null }[];
    benchmarks: NumericBenchmark[];
    explanation: string;
  };
  development?: {
    multitaskingTier: "Basic" | "Good" | "Excellent";
    dockerTier: "Basic" | "Good" | "Excellent";
    explanation: string;
  };
  video?: {
    editingTier: "Basic" | "Good" | "Excellent";
    benchmarks: NumericBenchmark[];
    explanation: string;
  };
  rendering?: {
    gpuRenderSeconds: number | null;
    cpuRenderSeconds: number | null;
    cinebenchMultiScore: number | null;
    benchmarks: NumericBenchmark[];
    explanation: string;
  };
}
