"use client";
import { useEffect, useRef } from "react";

// Fourier Flow — ported from Paidax01/math-curve-loaders (MIT-style gallery).
// Multi-component sine/cosine interference; the outline mutates like a living
// waveform. Used as the build-generation waiting state. All animation is done
// via imperative SVG attribute writes (92 particles/frame would thrash React).

interface FourierConfig {
  fourierX1: number; fourierX3: number; fourierX5: number;
  fourierY1: number; fourierY2: number; fourierY4: number;
  fourierMixBase: number; fourierMixPulse: number;
  particleCount: number; trailSpan: number;
  durationMs: number; pulseDurationMs: number; strokeWidth: number;
}

const DEFAULT_CONFIG: FourierConfig = {
  fourierX1: 17, fourierX3: 7.5, fourierX5: 3.2,
  fourierY1: 15, fourierY2: 8.2, fourierY4: 4.2,
  fourierMixBase: 1, fourierMixPulse: 0.16,
  particleCount: 92, trailSpan: 0.31,
  durationMs: 8400, pulseDurationMs: 6800, strokeWidth: 4.2,
};

function point(progress: number, detailScale: number, c: FourierConfig) {
  const t = progress * Math.PI * 2;
  const mix = c.fourierMixBase + detailScale * c.fourierMixPulse;
  const x = c.fourierX1 * Math.cos(t) + c.fourierX3 * Math.cos(3 * t + 0.6 * mix) + c.fourierX5 * Math.sin(5 * t - 0.4);
  const y = c.fourierY1 * Math.sin(t) + c.fourierY2 * Math.sin(2 * t + 0.25) - c.fourierY4 * Math.cos(4 * t - 0.5 * mix);
  return { x: 50 + x, y: 50 + y };
}

function buildPath(c: FourierConfig, detailScale: number, steps = 480): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const p = point(i / steps, detailScale, c);
    d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
  }
  return d.trim();
}

function normalizeProgress(v: number): number {
  return v - Math.floor(v);
}

function getDetailScale(time: number, c: FourierConfig, phaseOffset: number): number {
  const pulseProgress = ((time + phaseOffset * c.pulseDurationMs) % c.pulseDurationMs) / c.pulseDurationMs;
  const pulseAngle = pulseProgress * Math.PI * 2;
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

export interface CurveLoaderProps {
  label?: string;
  /** Size in px (square). Default 220. */
  size?: number;
  /** Override the default Fourier Flow config (rarely needed). */
  config?: Partial<FourierConfig>;
  className?: string;
}

export function CurveLoader({ label, size = 220, config, className }: CurveLoaderProps) {
  const cfg: FourierConfig = { ...DEFAULT_CONFIG, ...config };
  const groupRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const particlesRef = useRef<SVGCircleElement[]>([]);
  const startRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      // Static frame: draw the curve at mid-pulse, park particles along it.
      if (pathRef.current) pathRef.current.setAttribute("d", buildPath(cfg, 0.76));
      particlesRef.current.forEach((node, index) => {
        if (!node) return;
        const tailOffset = index / (cfg.particleCount - 1);
        const p = point(normalizeProgress(0.5 - tailOffset * cfg.trailSpan), 0.76, cfg);
        const fade = Math.pow(1 - tailOffset, 0.56);
        node.setAttribute("cx", p.x.toFixed(2));
        node.setAttribute("cy", p.y.toFixed(2));
        node.setAttribute("r", (0.9 + fade * 2.7).toFixed(2));
        node.setAttribute("opacity", (0.04 + fade * 0.96).toFixed(3));
      });
      return;
    }

    startRef.current = performance.now();
    phaseRef.current = Math.random();
    let raf = 0;

    const tick = (now: number) => {
      const time = now - startRef.current;
      const phaseOffset = phaseRef.current;
      const progress = ((time + phaseOffset * cfg.durationMs) % cfg.durationMs) / cfg.durationMs;
      const detailScale = getDetailScale(time, cfg, phaseOffset);

      if (pathRef.current) pathRef.current.setAttribute("d", buildPath(cfg, detailScale));

      const particles = particlesRef.current;
      for (let index = 0; index < particles.length; index++) {
        const node = particles[index];
        if (!node) continue;
        const tailOffset = index / (cfg.particleCount - 1);
        const p = point(normalizeProgress(progress - tailOffset * cfg.trailSpan), detailScale, cfg);
        const fade = Math.pow(1 - tailOffset, 0.56);
        node.setAttribute("cx", p.x.toFixed(2));
        node.setAttribute("cy", p.y.toFixed(2));
        node.setAttribute("r", (0.9 + fade * 2.7).toFixed(2));
        node.setAttribute("opacity", (0.04 + fade * 0.96).toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center gap-5 ${className ?? ""}`} role="status" aria-live="polite">
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <g ref={groupRef}>
          <path
            ref={pathRef}
            fill="none"
            stroke="currentColor"
            strokeWidth={cfg.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.1}
          />
          {Array.from({ length: cfg.particleCount }).map((_, i) => (
            <circle
              key={i}
              ref={(el) => { if (el) particlesRef.current[i] = el; }}
              fill="currentColor"
              cx={50}
              cy={50}
              r={1}
              opacity={0}
            />
          ))}
        </g>
      </svg>
      {label && (
        <div className="text-center">
          <div className="text-sm font-medium text-[var(--text)]">{label}</div>
          <div className="mt-1 text-xs text-[var(--muted)] mono">Fourier Flow · synthesizing build</div>
        </div>
      )}
    </div>
  );
}
