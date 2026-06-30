"use client";
import { Gauge, Cpu, Cube, Lightning } from "@phosphor-icons/react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import type { PerformanceEstimate, NumericBenchmark } from "@/types/performance";

// Shows concrete benchmark numbers (FPS, token/s, render seconds) sourced
// from the BenchmarkResult table / curated JSON. Replaces the old "tier only"
// panel with real numbers + sources.
export function BenchmarkPanel({ performance }: { performance: PerformanceEstimate }) {
  const { t } = useLocale();
  return (
    <section className="surface rounded-2xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("benchmark.title")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("benchmark.subtitle")}</p>
        </div>
        <Gauge size={22} className="text-[var(--accent)]" />
      </div>

      <div className="mt-5 space-y-4">
        {performance.gaming && (
          <Block icon={<Gauge size={18} />} title={`Gaming, ${performance.gaming.resolution}`}>
            {performance.gaming.estimatedFps != null ? (
              <Metric
                big={`${performance.gaming.estimatedFps}`}
                unit="fps"
                sub={`Cyberpunk 2077 Ultra · tier ${performance.gaming.estimatedFpsTier}`}
              />
            ) : (
              <Metric big={performance.gaming.estimatedFpsTier} unit="" sub="Relative tier only, no FPS benchmark" />
            )}
            <SourceRow rows={performance.gaming.benchmarks} />
          </Block>
        )}

        {performance.ai && (
          <Block icon={<Lightning size={18} />} title="Local AI inference (llama.cpp Q4)">
            <div className="grid grid-cols-3 gap-2">
              {performance.ai.tokensPerSecond.map(t => (
                <Metric key={t.model} big={t.value != null ? `${t.value}` : "N/A"} unit="tok/s" sub={t.model} compact />
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{performance.ai.explanation}</p>
            <SourceRow rows={performance.ai.benchmarks} />
          </Block>
        )}

        {performance.rendering && (
          <Block icon={<Cube size={18} />} title="Rendering (Blender Classroom)">
            <div className="grid grid-cols-3 gap-2">
              <Metric big={performance.rendering.gpuRenderSeconds != null ? `${performance.rendering.gpuRenderSeconds}` : "N/A"} unit="s" sub="GPU (Optix/HIP)" compact />
              <Metric big={performance.rendering.cpuRenderSeconds != null ? `${performance.rendering.cpuRenderSeconds}` : "N/A"} unit="s" sub="CPU" compact />
              <Metric big={performance.rendering.cinebenchMultiScore != null ? `${performance.rendering.cinebenchMultiScore}` : "N/A"} unit="pts" sub="Cinebench 2024" compact />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{performance.rendering.explanation}</p>
            <SourceRow rows={performance.rendering.benchmarks} />
          </Block>
        )}

        {performance.video && (
          <Block icon={<Cpu size={18} />} title="Video editing">
            <Metric big={performance.video.editingTier} unit="" sub="Editing capability tier" />
            <SourceRow rows={performance.video.benchmarks} />
          </Block>
        )}
      </div>
    </section>
  );
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--panel-2)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Metric({ big, unit, sub, compact }: { big: string; unit: string; sub: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg bg-[var(--panel)] ${compact ? "p-2.5" : "p-3.5"}`}>
      <div className="flex items-baseline gap-1">
        <span className="mono text-2xl font-semibold tracking-tight">{big}</span>
        {unit && <span className="text-xs text-[var(--muted)]">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--muted)]">{sub}</div>
    </div>
  );
}

function SourceRow({ rows }: { rows: NumericBenchmark[] }) {
  if (rows.length === 0) return null;
  const sources = Array.from(new Set(rows.map(r => r.sourceName)));
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map(s => (
        <span key={s} className="mono rounded bg-[var(--panel)] px-1.5 py-0.5 text-[9px] text-[var(--muted)]">{s}</span>
      ))}
    </div>
  );
}
