// One representative curve per mathematical type from Paidax01/math-curve-loaders.
// https://github.com/Paidax01/math-curve-loaders

export type CurveLoaderVariant =
  | "original-thinking"
  | "rose-orbit"
  | "rose-curve"
  | "lissajous-drift"
  | "lemniscate-bloom"
  | "hypotrochoid-loop"
  | "spiral-petal"
  | "butterfly-phase"
  | "cardioid-glow"
  | "heart-wave"
  | "spiral-search"
  | "fourier-flow";

export interface CurvePoint { x: number; y: number; }

export interface CurveVariantDefinition {
  id: CurveLoaderVariant;
  name: string;
  tag: string;
  rotate: boolean;
  particleCount: number;
  trailSpan: number;
  durationMs: number;
  rotationDurationMs: number;
  pulseDurationMs: number;
  strokeWidth: number;
  point: (progress: number, detailScale: number) => CurvePoint;
}

export const LOADER_VARIANT_STORAGE_KEY = "aipc:loader-variant";
export const DEFAULT_LOADER_VARIANT: CurveLoaderVariant = "fourier-flow";

export const CURVE_VARIANTS: Record<CurveLoaderVariant, CurveVariantDefinition> = {
  "original-thinking": {
    id: "original-thinking",
    name: "Original Thinking",
    tag: "Custom Rose Trail",
    rotate: true,
    particleCount: 64,
    trailSpan: 0.38,
    durationMs: 4600,
    rotationDurationMs: 28000,
    pulseDurationMs: 4200,
    strokeWidth: 5.5,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const x = 7 * Math.cos(t) - 3 * s * Math.cos(7 * t);
      const y = 7 * Math.sin(t) - 3 * s * Math.sin(7 * t);
      return { x: 50 + x * 3.9, y: 50 + y * 3.9 };
    },
  },
  "rose-orbit": {
    id: "rose-orbit",
    name: "Rose Orbit",
    tag: "r = cos(kθ)",
    rotate: true,
    particleCount: 72,
    trailSpan: 0.42,
    durationMs: 5200,
    rotationDurationMs: 28000,
    pulseDurationMs: 4600,
    strokeWidth: 5.2,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const r = 7 - 2.7 * s * Math.cos(7 * t);
      return { x: 50 + Math.cos(t) * r * 3.9, y: 50 + Math.sin(t) * r * 3.9 };
    },
  },
  "rose-curve": {
    id: "rose-curve",
    name: "Rose Curve",
    tag: "r = a cos(kθ)",
    rotate: true,
    particleCount: 78,
    trailSpan: 0.32,
    durationMs: 5400,
    rotationDurationMs: 28000,
    pulseDurationMs: 4600,
    strokeWidth: 4.5,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const a = 9.2 + s * 0.6;
      const r = a * (0.72 + s * 0.28) * Math.cos(5 * t);
      return { x: 50 + Math.cos(t) * r * 3.25, y: 50 + Math.sin(t) * r * 3.25 };
    },
  },
  "lissajous-drift": {
    id: "lissajous-drift",
    name: "Lissajous Drift",
    tag: "Lissajous",
    rotate: false,
    particleCount: 68,
    trailSpan: 0.34,
    durationMs: 6000,
    rotationDurationMs: 36000,
    pulseDurationMs: 5400,
    strokeWidth: 4.7,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const amp = 24 + s * 6;
      return {
        x: 50 + Math.sin(3 * t + 1.57) * amp,
        y: 50 + Math.sin(4 * t) * (amp * 0.92),
      };
    },
  },
  "lemniscate-bloom": {
    id: "lemniscate-bloom",
    name: "Lemniscate Bloom",
    tag: "Bernoulli ∞",
    rotate: false,
    particleCount: 70,
    trailSpan: 0.4,
    durationMs: 5600,
    rotationDurationMs: 34000,
    pulseDurationMs: 5000,
    strokeWidth: 4.8,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const scale = 20 + s * 7;
      const denom = 1 + Math.sin(t) ** 2;
      return {
        x: 50 + (scale * Math.cos(t)) / denom,
        y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
      };
    },
  },
  "hypotrochoid-loop": {
    id: "hypotrochoid-loop",
    name: "Hypotrochoid Loop",
    tag: "Spirograph",
    rotate: false,
    particleCount: 82,
    trailSpan: 0.46,
    durationMs: 7600,
    rotationDurationMs: 42000,
    pulseDurationMs: 6200,
    strokeWidth: 4.6,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const r = 2.7 + s * 0.45;
      const d = 4.8 + s * 1.2;
      const x = (8.2 - r) * Math.cos(t) + d * Math.cos(((8.2 - r) / r) * t);
      const y = (8.2 - r) * Math.sin(t) - d * Math.sin(((8.2 - r) / r) * t);
      return { x: 50 + x * 3.05, y: 50 + y * 3.05 };
    },
  },
  "spiral-petal": {
    id: "spiral-petal",
    name: "Three-Petal Spiral",
    tag: "Rolling circle",
    rotate: true,
    particleCount: 82,
    trailSpan: 0.34,
    durationMs: 4600,
    rotationDurationMs: 28000,
    pulseDurationMs: 4200,
    strokeWidth: 4.4,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const d = 3 + s * 0.25;
      const baseX = 2 * Math.cos(t) + d * Math.cos(2 * t);
      const baseY = 2 * Math.sin(t) - d * Math.sin(2 * t);
      const scale = 2.2 + s * 0.45;
      return { x: 50 + baseX * scale, y: 50 + baseY * scale };
    },
  },
  "butterfly-phase": {
    id: "butterfly-phase",
    name: "Butterfly Phase",
    tag: "Butterfly curve",
    rotate: false,
    particleCount: 88,
    trailSpan: 0.32,
    durationMs: 9000,
    rotationDurationMs: 50000,
    pulseDurationMs: 7000,
    strokeWidth: 4.4,
    point(progress, s) {
      const t = progress * Math.PI * 12;
      const wing = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.sin(t / 12) ** 5;
      const scale = 4.6 + s * 0.45;
      return { x: 50 + Math.sin(t) * wing * scale, y: 50 + Math.cos(t) * wing * scale };
    },
  },
  "cardioid-glow": {
    id: "cardioid-glow",
    name: "Cardioid Glow",
    tag: "Cardioid",
    rotate: false,
    particleCount: 72,
    trailSpan: 0.36,
    durationMs: 6200,
    rotationDurationMs: 36000,
    pulseDurationMs: 5200,
    strokeWidth: 4.9,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const a = 8.4 + s * 0.8;
      const r = a * (1 - Math.cos(t));
      return { x: 50 + Math.cos(t) * r * 2.15, y: 50 + Math.sin(t) * r * 2.15 };
    },
  },
  "heart-wave": {
    id: "heart-wave",
    name: "Heart Wave",
    tag: "Heart function",
    rotate: false,
    particleCount: 104,
    trailSpan: 0.18,
    durationMs: 8400,
    rotationDurationMs: 22000,
    pulseDurationMs: 5600,
    strokeWidth: 3.9,
    point(progress, s) {
      const xLimit = Math.sqrt(3.3);
      const x = -xLimit + progress * xLimit * 2;
      const safeRoot = Math.max(0, 3.3 - x * x);
      const wave = 0.9 * Math.sqrt(safeRoot) * Math.sin(6.4 * Math.PI * x);
      const curve = Math.pow(Math.abs(x), 2 / 3);
      const y = curve + wave;
      const scaleY = 24.5 + s * 1.5;
      return { x: 50 + x * 23.2, y: 18 + (1.75 - y) * scaleY };
    },
  },
  "spiral-search": {
    id: "spiral-search",
    name: "Spiral Search",
    tag: "Archimedean",
    rotate: false,
    particleCount: 86,
    trailSpan: 0.28,
    durationMs: 7800,
    rotationDurationMs: 44000,
    pulseDurationMs: 6800,
    strokeWidth: 4.3,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const angle = t * 4;
      const radius = 8 + (1 - Math.cos(t)) * (8.5 + s * 2.4);
      return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
    },
  },
  "fourier-flow": {
    id: "fourier-flow",
    name: "Fourier Flow",
    tag: "Fourier curve",
    rotate: false,
    particleCount: 92,
    trailSpan: 0.31,
    durationMs: 8400,
    rotationDurationMs: 44000,
    pulseDurationMs: 6800,
    strokeWidth: 4.2,
    point(progress, s) {
      const t = progress * Math.PI * 2;
      const mix = 1 + s * 0.16;
      const x = 17 * Math.cos(t) + 7.5 * Math.cos(3 * t + 0.6 * mix) + 3.2 * Math.sin(5 * t - 0.4);
      const y = 15 * Math.sin(t) + 8.2 * Math.sin(2 * t + 0.25) - 4.2 * Math.cos(4 * t - 0.5 * mix);
      return { x: 50 + x, y: 50 + y };
    },
  },
};

export const CURVE_VARIANT_LIST = Object.values(CURVE_VARIANTS);

export function isCurveLoaderVariant(value: string): value is CurveLoaderVariant {
  return value in CURVE_VARIANTS;
}

export function resolveLoaderVariant(value: string | null | undefined): CurveLoaderVariant {
  if (value && isCurveLoaderVariant(value)) return value;
  return DEFAULT_LOADER_VARIANT;
}
