"use client";

import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { BuildRecommendation } from "@/types/build";
import { capabilityScore } from "@/lib/rag/utilityModel";

export function PerformancePanel({ build }: { build: BuildRecommendation }) {
  const { t } = useLocale();
  const p = build.parts;
  const data = [
    { subject: "CPU", value: capabilityScore(p.cpu, build.request) },
    { subject: "GPU", value: capabilityScore(p.gpu, build.request) },
    { subject: "Memory", value: capabilityScore(p.ram, build.request) },
    { subject: "Storage", value: capabilityScore(p.storage, build.request) },
    { subject: "Platform", value: capabilityScore(p.motherboard, build.request) },
  ];
  const perf = build.performance;

  return <section className="surface rounded-2xl p-6">
    <div className="flex items-start justify-between">
      <div>
        <h2 className="text-lg font-semibold">{t("performance.title")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("performance.subtitle")}</p>
      </div>
      <span className="mono text-xs text-[var(--muted)]">0-100</span>
    </div>
    <div className="mt-3 h-64"><ResponsiveContainer width="100%" height="100%"><RadarChart data={data} outerRadius="70%"><PolarGrid stroke="var(--line)"/><PolarAngleAxis dataKey="subject" tick={{ fill: "var(--muted)", fontSize: 11 }}/><Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={.18} strokeWidth={2}/></RadarChart></ResponsiveContainer></div>
    <div className="grid grid-cols-2 gap-3">
      {perf.gaming && <div className="rounded-xl bg-[var(--panel-2)] p-4"><div className="text-xs text-[var(--muted)]">{perf.gaming.resolution} gaming</div><strong className="mt-1 block">{perf.gaming.estimatedFps != null ? `~${perf.gaming.estimatedFps} FPS` : perf.gaming.estimatedFpsTier}</strong>{perf.gaming.targetFps && <span className={`mt-1 block text-[10px] uppercase ${perf.gaming.targetStatus === "met" ? "text-[var(--success)]" : perf.gaming.targetStatus === "below" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}>target {perf.gaming.targetFps}: {perf.gaming.targetStatus}</span>}</div>}
      {perf.ai && <div className="rounded-xl bg-[var(--panel-2)] p-4"><div className="text-xs text-[var(--muted)]">Local AI</div><strong className="mt-1 block">{perf.ai.localLlmTier}</strong></div>}
    </div>
  </section>;
}
