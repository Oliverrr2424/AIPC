// Single math-curve loading animation: Hypotrochoid Loop (Spirograph).
// Inspired by Paidax01/math-curve-loaders.

export interface CurvePoint { x: number; y: number; }

export interface CurveVariantDefinition {
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

export const LOADER_VARIANT: CurveVariantDefinition = {
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
};
