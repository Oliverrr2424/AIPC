"use client";
import { useEffect, useRef } from "react";
import {
  CURVE_VARIANTS,
  DEFAULT_LOADER_VARIANT,
  type CurveLoaderVariant,
  type CurveVariantDefinition,
} from "@/lib/loaders/curveVariants";
import { useLoaderVariant } from "@/lib/loaders/useLoaderVariant";

function normalizeProgress(v: number): number {
  return v - Math.floor(v);
}

function getDetailScale(time: number, def: CurveVariantDefinition, phaseOffset: number): number {
  const pulseProgress = ((time + phaseOffset * def.pulseDurationMs) % def.pulseDurationMs) / def.pulseDurationMs;
  const pulseAngle = pulseProgress * Math.PI * 2;
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

function getRotation(time: number, def: CurveVariantDefinition, phaseOffset: number): number {
  if (!def.rotate) return 0;
  return -(((time + phaseOffset * def.rotationDurationMs) % def.rotationDurationMs) / def.rotationDurationMs) * 360;
}

function buildPath(def: CurveVariantDefinition, detailScale: number, steps = 480): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const p = def.point(i / steps, detailScale);
    d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
  }
  return d.trim();
}

export interface CurveLoaderProps {
  label?: string;
  size?: number;
  variant?: CurveLoaderVariant;
  className?: string;
  /** Hide the variant name subtitle under the label. */
  hideVariantTag?: boolean;
}

export function CurveLoader({
  label,
  size = 220,
  variant = DEFAULT_LOADER_VARIANT,
  className,
  hideVariantTag = false,
}: CurveLoaderProps) {
  const def = CURVE_VARIANTS[variant];
  const groupRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const particlesRef = useRef<SVGCircleElement[]>([]);
  const startRef = useRef(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const staticScale = 0.76;

    if (reduceMotion) {
      if (pathRef.current) pathRef.current.setAttribute("d", buildPath(def, staticScale));
      particlesRef.current.forEach((node, index) => {
        if (!node) return;
        const tailOffset = index / (def.particleCount - 1);
        const p = def.point(normalizeProgress(0.5 - tailOffset * def.trailSpan), staticScale);
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
      const progress = ((time + phaseOffset * def.durationMs) % def.durationMs) / def.durationMs;
      const detailScale = getDetailScale(time, def, phaseOffset);
      const rotation = getRotation(time, def, phaseOffset);

      if (groupRef.current) groupRef.current.setAttribute("transform", `rotate(${rotation} 50 50)`);
      if (pathRef.current) pathRef.current.setAttribute("d", buildPath(def, detailScale));

      for (let index = 0; index < particlesRef.current.length; index++) {
        const node = particlesRef.current[index];
        if (!node) continue;
        const tailOffset = index / (def.particleCount - 1);
        const p = def.point(normalizeProgress(progress - tailOffset * def.trailSpan), detailScale);
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
  }, [def]);

  return (
    <div className={`flex flex-col items-center justify-center gap-5 ${className ?? ""}`} role="status" aria-live="polite">
      <svg viewBox="0 0 100 100" width={size} height={size} className="text-[var(--accent)]" aria-hidden="true">
        <g ref={groupRef}>
          <path
            ref={pathRef}
            fill="none"
            stroke="currentColor"
            strokeWidth={def.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.1}
          />
          {Array.from({ length: def.particleCount }).map((_, i) => (
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
          {!hideVariantTag && (
            <div className="mt-1 text-xs text-[var(--muted)] mono">{def.name} · {def.tag}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Reads the user's saved loader variant from localStorage. */
export function BuildCurveLoader(props: Omit<CurveLoaderProps, "variant">) {
  const { variant, ready } = useLoaderVariant();
  if (!ready) return <CurveLoader {...props} variant={DEFAULT_LOADER_VARIANT} />;
  return <CurveLoader {...props} variant={variant} />;
}
