"use client";

import { Check, CircleNotch } from "@phosphor-icons/react";
import { BuildCurveLoader } from "./CurveLoader";

interface LoadingStage {
  id: string;
  label: string;
}

interface BuildLoadingPanelProps {
  title: string;
  detail: string;
  progress: number;
  stages?: LoadingStage[];
  activeStage?: string;
  size?: number;
  continuous?: boolean;
}

export function BuildLoadingPanel({ title, detail, progress, stages, activeStage, size = 420, continuous = false }: BuildLoadingPanelProps) {
  const safeProgress = Math.min(100, Math.max(0, progress));
  const activeIndex = stages?.findIndex(stage => stage.id === activeStage) ?? -1;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center py-2 sm:py-4">
      <BuildCurveLoader size={size} />
      <div className="mt-2 w-full max-w-xl text-center sm:mt-3">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        <p className="mt-1 text-xs text-[var(--muted)] sm:text-sm">{detail}</p>

        {stages?.length ? (
          <div className="mx-auto mt-4 grid max-w-lg grid-cols-3 gap-2" aria-label="Pipeline stages">
            {stages.map((stage, index) => {
              const complete = index < activeIndex || safeProgress === 100;
              const active = index === activeIndex && safeProgress < 100;
              return (
                <div key={stage.id} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold sm:text-xs ${active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : complete ? "text-[var(--text)]" : "text-[var(--muted)] opacity-55"}`}>
                  {complete ? <Check weight="bold" /> : active ? <CircleNotch className="animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
                  {stage.label}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)] shadow-inner" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safeProgress)}>
            <div className={`h-full w-full origin-left rounded-full bg-[var(--accent)] transition-transform ${continuous ? "duration-100 ease-linear" : "duration-500 ease-out"}`} style={{ transform: `scaleX(${safeProgress / 100})` }} />
          </div>
          <span className="mono w-12 text-right text-sm font-semibold text-[var(--accent)]">{Math.round(safeProgress)}%</span>
        </div>
      </div>
    </div>
  );
}
