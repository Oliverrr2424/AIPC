"use client";
import { useEffect, useRef, useState } from "react";
import { CURVE_VARIANT_LIST, CURVE_VARIANTS, type CurveLoaderVariant } from "@/lib/loaders/curveVariants";
import { useLoaderVariant } from "@/lib/loaders/useLoaderVariant";

function normalizeProgress(v: number): number {
  return v - Math.floor(v);
}

function buildStaticPath(variant: CurveLoaderVariant): string {
  const def = CURVE_VARIANTS[variant];
  const s = 0.76;
  let d = "";
  for (let i = 0; i <= 120; i++) {
    const p = def.point(i / 120, s);
    d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
  }
  return d.trim();
}

function MiniCurvePreview({ variant, animate }: { variant: CurveLoaderVariant; animate: boolean }) {
  const def = CURVE_VARIANTS[variant];
  const groupRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      if (pathRef.current) pathRef.current.setAttribute("d", buildStaticPath(variant));
      return;
    }
    startRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const time = now - startRef.current;
      const progress = (time % def.durationMs) / def.durationMs;
      const pulseProgress = (time % def.pulseDurationMs) / def.pulseDurationMs;
      const s = 0.52 + ((Math.sin(pulseProgress * Math.PI * 2 + 0.55) + 1) / 2) * 0.48;
      const rotation = def.rotate ? -((time % def.rotationDurationMs) / def.rotationDurationMs) * 360 : 0;
      if (groupRef.current) groupRef.current.setAttribute("transform", `rotate(${rotation} 50 50)`);
      if (pathRef.current) {
        let d = "";
        for (let i = 0; i <= 80; i++) {
          const p = def.point(i / 80, s);
          d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
        }
        pathRef.current.setAttribute("d", d.trim());
      }
      // Head particle only
      const head = def.point(normalizeProgress(progress), s);
      const dot = groupRef.current?.querySelector("circle");
      if (dot) {
        dot.setAttribute("cx", head.x.toFixed(1));
        dot.setAttribute("cy", head.y.toFixed(1));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, def, variant]);

  return (
    <svg viewBox="0 0 100 100" width={52} height={52} className="text-[var(--accent)]" aria-hidden="true">
      <g ref={groupRef}>
        <path ref={pathRef} fill="none" stroke="currentColor" strokeWidth={def.strokeWidth * 0.85} strokeLinecap="round" opacity={0.35} d={buildStaticPath(variant)} />
        <circle fill="currentColor" cx={50} cy={50} r={2.2} opacity={0.95} />
      </g>
    </svg>
  );
}

/** Compact grid to pick a math-curve loading animation. Persists to localStorage. */
export function LoaderVariantPicker({ compact = false }: { compact?: boolean }) {
  const { variant, setVariant, ready } = useLoaderVariant();
  const [hovered, setHovered] = useState<CurveLoaderVariant | null>(null);

  if (!ready) return null;

  const current = CURVE_VARIANT_LIST.find(v => v.id === variant);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <div className="text-xs font-semibold text-[var(--text)]">加载动画</div>
        <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">12 种数学曲线，生成配置时显示</p>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
        {CURVE_VARIANT_LIST.map(item => {
          const active = variant === item.id;
          const animate = active || hovered === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setVariant(item.id)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              title={`${item.name} — ${item.tag}`}
              className={`flex flex-col items-center rounded-xl border p-2 transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]/40 hover:bg-[var(--panel-2)]"
              }`}
            >
              <MiniCurvePreview variant={item.id} animate={animate} />
              <span className={`mt-1 w-full truncate text-center text-[9px] leading-3 ${active ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                {item.name.replace(" ", "\u00a0")}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mono text-[10px] text-[var(--muted)]">
        当前：<span className="text-[var(--text)]">{current?.name}</span>
        <span className="opacity-60"> · {current?.tag}</span>
      </p>
    </div>
  );
}
