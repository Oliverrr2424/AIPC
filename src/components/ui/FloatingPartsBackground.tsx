"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cpu,
  GraphicsCard,
  HardDrive,
  HardDrives,
  Fan,
  Desktop,
  DesktopTower,
  ComputerTower,
  Monitor,
  Keyboard,
  Mouse,
  MouseSimple,
  Power,
  Memory,
  Circuitry,
  Lightning,
  Usb,
  Plug,
  Plugs,
  Disc,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

const ICONS: Icon[] = [
  Cpu,
  GraphicsCard,
  HardDrive,
  HardDrives,
  Fan,
  Desktop,
  DesktopTower,
  ComputerTower,
  Monitor,
  Keyboard,
  Mouse,
  MouseSimple,
  Power,
  Memory,
  Circuitry,
  Lightning,
  Usb,
  Plug,
  Plugs,
  Disc,
];

// Deterministic pseudo-random generator so server/client markup match (no hydration mismatch).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FloatingPartsBackgroundProps {
  /** How many icons to scatter. Default is intentionally high for a busy sketch field. */
  count?: number;
  className?: string;
}

interface PartState {
  Comp: Icon;
  size: number;
  opacity: number;
  vrot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
}

export function FloatingPartsBackground({ count = 90, className }: FloatingPartsBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const stateRef = useRef<PartState[]>([]);
  const [ready, setReady] = useState(false);

  // Static per-icon descriptors (deterministic so SSR/CSR markup match).
  const descriptors = useMemo(() => {
    const rand = mulberry32(20260701);
    return Array.from({ length: count }, (_, i) => ({
      Comp: ICONS[Math.floor(rand() * ICONS.length)],
      key: i,
      size: 14 + Math.round(rand() * 26), // 14 - 40px small parts
      opacity: 0.05 + rand() * 0.09, // subtle black/white lines
    }));
  }, [count]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rand = mulberry32(99001122);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const init = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      stateRef.current = descriptors.map((d) => {
        const speed = reduced ? 0 : 22 + rand() * 46; // px/s
        const angle = rand() * Math.PI * 2;
        return {
          Comp: d.Comp,
          size: d.size,
          opacity: d.opacity,
          x: rand() * Math.max(1, w - d.size),
          y: rand() * Math.max(1, h - d.size),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: rand() * 360,
          vrot: reduced ? 0 : (rand() * 2 - 1) * 18, // deg/s
        };
      });
      setReady(true);
    };
    init();

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const states = stateRef.current;
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.vrot * dt;
        const maxX = w - s.size;
        const maxY = h - s.size;
        if (s.x <= 0) { s.x = 0; s.vx = Math.abs(s.vx); }
        else if (s.x >= maxX) { s.x = maxX; s.vx = -Math.abs(s.vx); }
        if (s.y <= 0) { s.y = 0; s.vy = Math.abs(s.vy); }
        else if (s.y >= maxY) { s.y = maxY; s.vy = -Math.abs(s.vy); }
        const el = spanRefs.current[i];
        if (el) el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}deg)`;
      }
      raf = requestAnimationFrame(step);
    };
    if (!reduced) raf = requestAnimationFrame(step);
    else {
      // Place once without animating.
      stateRef.current.forEach((s, i) => {
        const el = spanRefs.current[i];
        if (el) el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
      });
    }

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      stateRef.current.forEach((s) => {
        s.x = Math.min(s.x, Math.max(0, w - s.size));
        s.y = Math.min(s.y, Math.max(0, h - s.size));
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [descriptors]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden text-[var(--text)] ${className ?? ""}`}
    >
      {descriptors.map(({ Comp, key, size, opacity }, i) => (
        <span
          key={key}
          ref={(el) => { spanRefs.current[i] = el; }}
          className="absolute left-0 top-0 will-change-transform"
          style={{ opacity: ready ? opacity : 0 }}
        >
          <Comp size={size} weight="regular" />
        </span>
      ))}
    </div>
  );
}
