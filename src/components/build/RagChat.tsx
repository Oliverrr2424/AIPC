"use client";
import { useState } from "react";
import { ArrowRight, Brain, CheckCircle, Database, MagnifyingGlass, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { RagBuildRecommendation } from "@/types/knowledge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CurveLoader } from "@/components/ui/CurveLoader";
import { formatPrice } from "@/lib/pricing/priceEstimator";
import { PartsTable } from "./PartsTable";
import { CompatibilityPanel } from "./CompatibilityPanel";
import { PerformancePanel } from "./PerformancePanel";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { AiExplanationPanel } from "./AiExplanationPanel";
import { AI_MODELS, DEFAULT_AI_OPTIONS, type AiModelId, type ThinkingMode } from "@/types/ai";

const examples = [
  "USD 2200，主要玩 1440p 144Hz 游戏，希望安静、方便以后升级，不要 RGB。",
  "CAD 3500，想在本地跑 LLM 和 Flux，优先 NVIDIA，至少 16GB 显存，也会用 Docker。",
  "预算 1800 美元，做后端开发、Docker 和数据库，已经有 WD Black SN850X 1TB。",
];

export function RagChat() {
  const [query, setQuery] = useState(examples[0]);
  const [result, setResult] = useState<RagBuildRecommendation>();
  const [model, setModel] = useState<AiModelId>(DEFAULT_AI_OPTIONS.model);
  const [thinking, setThinking] = useState<ThinkingMode>(DEFAULT_AI_OPTIONS.thinking);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setResult(undefined);
    try {
      const response = await fetch("/api/rag/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, model, thinking }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to generate a build.");
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to generate a build."); }
    finally { setLoading(false); }
  }

  return <div>
    <form onSubmit={submit} className="surface overflow-hidden rounded-2xl shadow-panel">
      <div className="grid lg:grid-cols-[1fr_320px]">
        <div className="p-5 sm:p-7">
          <label htmlFor="build-query" className="flex items-center gap-2 text-sm font-semibold"><Brain size={19} className="text-[var(--accent)]"/>Describe the machine you need</label>
          <textarea id="build-query" value={query} onChange={event => setQuery(event.target.value)} rows={5} className="mt-4 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-base leading-7 text-[var(--text)] placeholder:text-[var(--muted)]" placeholder="Include budget, currency, workloads, preferences, and any parts you already own." />
          <div className="mt-4 flex flex-wrap gap-2">{examples.map((example, index) => <button type="button" key={example} onClick={() => setQuery(example)} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-left text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]">Example {index + 1}</button>)}</div>
        </div>
        <aside className="border-t border-[var(--line)] bg-[var(--panel-2)] p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="mono text-xs font-semibold text-[var(--accent)]">RAG PIPELINE</div>
          <label className="mt-5 grid gap-2 text-xs font-semibold text-[var(--text)]">MODEL
            <select value={model} onChange={event => { const next = event.target.value as AiModelId; setModel(next); if (next === "gemini-2.5-flash") setThinking("disabled"); }} className="h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--text)]">
              {AI_MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="mt-4">
            <div className="text-xs font-semibold text-[var(--text)]">MODE</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={model === "gemini-2.5-flash"} onClick={() => setThinking("disabled")} className={`rounded-lg border px-3 py-2 text-xs font-medium ${thinking === "disabled" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"} disabled:cursor-not-allowed disabled:opacity-45`}>非思考</button>
              <button type="button" disabled={model === "gemini-2.5-flash"} onClick={() => setThinking("enabled")} className={`rounded-lg border px-3 py-2 text-xs font-medium ${thinking === "enabled" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"} disabled:cursor-not-allowed disabled:opacity-45`}>思考</button>
            </div>
            {model === "gemini-2.5-flash" && <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Mode switch applies to DeepSeek V4 models.</p>}
          </div>
          <div className="mt-5 space-y-4 text-sm text-[var(--muted)]">
            <div className="flex items-center gap-3"><Brain/>Parse intent</div><div className="flex items-center gap-3"><MagnifyingGlass/>Retrieve evidence</div><div className="flex items-center gap-3"><Database/>Score candidates</div><div className="flex items-center gap-3"><CheckCircle/>Validate compatibility</div>
          </div>
          <Button disabled={loading || query.trim().length < 8} className="mt-7 w-full">{loading ? <><SpinnerGap className="animate-spin"/>Retrieving evidence</> : <>Build with RAG <ArrowRight/></>}</Button>
          {error && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-[var(--danger)]">{error}</p>}
        </aside>
      </div>
    </form>
    {loading && <div className="mt-10 surface rounded-2xl p-10 sm:p-16"><CurveLoader label="Synthesizing your build" size={240}/></div>}
    {result && <RagResult result={result}/>} 
  </div>;
}

function RagResult({ result }: { result: RagBuildRecommendation }) {
  const fails = result.compatibility.filter(item => item.status === "FAIL").length, warnings = result.compatibility.filter(item => item.status === "WARNING").length;
  const status = fails ? "FAIL" : warnings ? "WARNING" : "PASS";
  const modelLabel = AI_MODELS.find(model => model.id === result.aiModel)?.label || result.aiModel;
  const parserLabel = result.parserMode === "deepseek" ? "DEEPSEEK INTENT" : result.parserMode === "gemini" ? "GEMINI INTENT" : "LOCAL INTENT";
  const usedLocalParser = result.parserMode === "heuristic";
  const budgetRatio = result.request.budget > 0 ? result.totalPrice / result.request.budget : 0;
  const overBudget = budgetRatio > 1.2;
  return <div className="mt-10 space-y-6">
    <header className="grid gap-6 border-b border-[var(--line)] pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
      <div><div className="flex flex-wrap gap-2"><Badge tone="accent">{parserLabel}</Badge><Badge tone="neutral">{modelLabel} · {result.thinkingMode === "enabled" ? "THINKING" : "NON-THINKING"}</Badge><Badge tone={status === "PASS" ? "success" : status === "WARNING" ? "warning" : "danger"}>{status === "PASS" ? <CheckCircle/> : <WarningCircle/>}{status} COMPATIBILITY</Badge></div><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{result.title}</h2><p className="mt-3 max-w-3xl text-[var(--muted)]">Parsed as {result.request.useCase} with a {formatPrice(result.request.budget, result.request.currency)} budget. Retrieved {result.retrievedChunks.length} evidence chunks before selection.</p></div>
      <div><div className="text-sm text-[var(--muted)]">Estimated total</div><div className="mono mt-1 text-4xl font-semibold">{formatPrice(result.totalPrice, result.request.currency)}</div></div>
    </header>
    {(usedLocalParser || overBudget) && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 sm:p-6">
      <div className="flex items-start gap-3"><WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-[var(--warning)]"/><div className="space-y-1.5 text-sm leading-6">
        {usedLocalParser && <p><strong className="text-[var(--warning)]">LLM intent parser unavailable.</strong> No API key configured, so intent was parsed with local keyword rules. Set <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">DEEPSEEK_API_KEY</code> or <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">GEMINI_API_KEY</code> in <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">.env.local</code> for richer constraint extraction. The deterministic pipeline (candidate scoring + compatibility) still ran on the parsed request.</p>}
        {overBudget && <p><strong className="text-[var(--warning)]">Build exceeds budget by {Math.round((budgetRatio - 1) * 100)}%.</strong> The budget optimizer could not reach {formatPrice(result.request.budget, result.request.currency)} — even the cheapest valid configuration in the candidate pool costs more. Check that the budget and currency were parsed correctly, or raise the budget.</p>}
      </div></div>
    </section>}
    {result.request.constraints?.length ? <section className="surface rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Interpreted constraints</h2><p className="mt-1 text-sm text-[var(--muted)]">LLM structured output, schema-validated before retrieval</p></div><Badge tone="neutral">{result.request.constraints.length} RULES</Badge></div><div className="mt-4 flex flex-wrap gap-2">{result.request.constraints.map(item => <span key={item.id} title={`${item.sourceText}: ${item.interpretation}`} className={`rounded-lg border px-3 py-2 text-xs ${item.strength === "required" ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300" : item.strength === "excluded" ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)]"}`}><strong className="uppercase">{item.strength}</strong> · {item.target}: {item.value}<span className="ml-1 opacity-60">({item.origin || "llm"})</span></span>)}</div></section> : null}
    <section className="surface rounded-2xl p-6 sm:p-8"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><MagnifyingGlass/></span><div><h2 className="text-xl font-semibold">Retrieved reasoning</h2><p className="text-sm text-[var(--muted)]">Why candidates entered the pool and why the winner survived scoring</p></div></div><div className="mt-7 grid gap-3 lg:grid-cols-2">{result.reasoning.map(item => <div key={item.category} className="rounded-xl bg-[var(--panel-2)] p-4"><div className="mono text-[10px] uppercase text-[var(--accent)]">{item.category}</div><div className="mt-2 font-semibold">{item.selected}</div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.reason}</p><details className="mt-3 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-medium text-[var(--text)]">Candidates considered</summary><p className="mt-2 leading-5">{item.considered.join(", ")}</p></details></div>)}</div></section>
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]"><PartsTable build={result}/><div className="space-y-6"><PerformancePanel build={result}/>{result.performance&&<BenchmarkPanel performance={result.performance}/>}<CompatibilityPanel results={result.compatibility}/></div></div>
    <section className="surface rounded-2xl p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">RAG evidence</h2><p className="mt-1 text-sm text-[var(--muted)]">Local knowledge snippets cited by the explanation</p></div><Badge tone="neutral">{result.retrievedChunks.length} CHUNKS</Badge></div><div className="mt-6 grid gap-3 lg:grid-cols-2">{result.retrievedChunks.slice(0, 10).map((chunk, index) => <article key={chunk.id} className="rounded-xl border border-[var(--line)] p-4"><div className="flex items-center justify-between gap-3"><span className="mono text-xs font-semibold text-[var(--accent)]">K{index + 1}</span><span className="mono text-[10px] text-[var(--muted)]">{chunk.relevanceScore}% relevance</span></div><h3 className="mt-3 font-semibold">{chunk.title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{chunk.content}</p><div className="mt-3 flex flex-wrap gap-1.5">{chunk.tags.slice(0, 5).map(tag => <span key={tag} className="rounded bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--muted)]">{tag}</span>)}</div></article>)}</div></section>
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]"><AiExplanationPanel text={result.explanation}/><section className="surface rounded-2xl p-6"><h2 className="text-lg font-semibold">Alternative builds</h2><p className="mt-1 text-sm text-[var(--muted)]">Nearby paths from the same candidate pools</p><div className="mt-5 space-y-5">{result.alternativeBuilds.map(variant => <div key={variant.title} className="rounded-xl bg-[var(--panel-2)] p-4"><div className="font-semibold">{variant.title}</div><div className="mono mt-2 text-sm text-[var(--accent)]">{formatPrice(variant.totalPrice, result.request.currency)}</div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{variant.changes.map(change => `${change.from} to ${change.to}`).join("; ")}. {variant.tradeoff}</p></div>)}</div></section></div>
  </div>;
}

function RagSkeleton() { return <div className="mt-10 surface rounded-2xl p-10 sm:p-16 flex justify-center"><CurveLoader label="Synthesizing your build" size={240}/></div>; }
