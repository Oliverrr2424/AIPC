"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Brain, CheckCircle, Database, MagnifyingGlass, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { RagBuildRecommendation } from "@/types/knowledge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BuildLoadingPanel } from "@/components/ui/BuildLoadingPanel";
import { formatPrice } from "@/lib/pricing/priceEstimator";
import { PartsTable } from "./PartsTable";
import { CompatibilityPanel } from "./CompatibilityPanel";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { AiExplanationPanel } from "./AiExplanationPanel";
import { AI_MODELS, DEFAULT_AI_OPTIONS, type AiModelId, type ThinkingMode } from "@/types/ai";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const PerformancePanel = dynamic(() => import("./PerformancePanel").then(m => m.PerformancePanel), { ssr: false, loading: () => null });

const examples = [
  "USD 2200，主要玩 1440p 144Hz 游戏，希望安静、方便以后升级，不要 RGB。",
  "CAD 3500，想在本地跑 LLM 和 Flux，优先 NVIDIA，至少 16GB 显存，也会用 Docker。",
  "预算 1800 美元，做后端开发、Docker 和数据库，已经有 WD Black SN850X 1TB。",
];

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; thinking?: boolean };
const chatMessage = (role: ChatMessage["role"], content: string, thinking = false): ChatMessage => ({ id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content, thinking });

type RagProgressStage = "llm-intent" | "rag-retrieval" | "llm-explanation";

async function fetchRagBuild(body: Record<string, unknown>, onStage: (stage: RagProgressStage) => void): Promise<RagBuildRecommendation> {
  const response = await fetch("/api/rag/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, progressStream: true }) });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Unable to generate a build.");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: RagBuildRecommendation | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as { type: "stage"; stage: RagProgressStage } | { type: "result"; data: RagBuildRecommendation } | { type: "error"; error: string };
      if (message.type === "stage") onStage(message.stage);
      if (message.type === "result") result = message.data;
      if (message.type === "error") throw new Error(message.error);
    }
    if (done) break;
  }
  if (!result) throw new Error("The RAG pipeline ended without a result.");
  return result;
}

export function RagChat() {
  const { t, locale } = useLocale();
  const loadingRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(examples[0]);
  const [followUp, setFollowUp] = useState("");
  const [result, setResult] = useState<RagBuildRecommendation>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState<AiModelId>(DEFAULT_AI_OPTIONS.model);
  const [thinking, setThinking] = useState<ThinkingMode>(DEFAULT_AI_OPTIONS.thinking);
  const [loading, setLoading] = useState(false);
  const [ragStage, setRagStage] = useState<RagProgressStage>("llm-intent");
  const [ragProgress, setRagProgress] = useState(8);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading || result) return;
    const frame = requestAnimationFrame(() => loadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [loading, result]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setRagStage("llm-intent"); setRagProgress(8); setError("");
    try {
      const data = await fetchRagBuild({ query, model, thinking }, stage => { setRagStage(stage); setRagProgress(stage === "llm-intent" ? 8 : stage === "rag-retrieval" ? 40 : 74); });
      setRagProgress(100);
      setResult(data);
      setMessages([chatMessage("user", query), chatMessage("assistant", data.interaction?.message || "Baseline build created.")]);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to generate a build."); }
    finally { setLoading(false); }
  }

  async function refine(event: React.FormEvent) {
    event.preventDefault();
    if (!result || followUp.trim().length < 2) return;
    const message = followUp.trim();
    setFollowUp(""); setError("");
    setMessages(current => [...current, chatMessage("user", message), chatMessage("assistant", "", true)]);
    setLoading(true);
    try {
      const response = await fetch("/api/rag/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: message, currentBuild: result, model, thinking }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the build.");
      setResult(data);
      setMessages(current => {
        const next = [...current];
        next[next.length - 1] = chatMessage("assistant", data.interaction?.message || "Build updated.");
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the build.");
      setMessages(current => current.slice(0, -2));
      setFollowUp(message);
    } finally { setLoading(false); }
  }

  function reset() {
    setResult(undefined); setMessages([]); setFollowUp(""); setError("");
  }

  return <div>
    {!result && <form onSubmit={submit} className="surface overflow-hidden rounded-2xl shadow-panel">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col justify-center p-5 sm:p-8 lg:p-10">
          <label htmlFor="build-query" className="flex items-center gap-2 text-sm font-semibold"><Brain size={19} className="text-[var(--accent)]"/>{t("chat.describe")}</label>
          <textarea id="build-query" value={query} onChange={event => setQuery(event.target.value)} rows={8} className="mt-4 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-base leading-7 text-[var(--text)] placeholder:text-[var(--muted)]" placeholder={t("chat.placeholder")} />
          <div className="mt-4 flex flex-wrap gap-2">{examples.map((example, index) => <button type="button" key={example} onClick={() => setQuery(example)} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-left text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]">{t("chat.example")} {index + 1}</button>)}</div>
        </div>
        <aside className="border-t border-[var(--line)] bg-[var(--panel-2)] p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="mono text-xs font-semibold text-[var(--accent)]">{t("chat.pipeline")}</div>
          <label className="mt-5 grid gap-2 text-xs font-semibold text-[var(--text)]">{t("chat.model")}
            <select value={model} onChange={event => { const next = event.target.value as AiModelId; setModel(next); if (next === "gemini-2.5-flash") setThinking("disabled"); }} className="h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--text)]">
              {AI_MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="mt-4">
            <div className="text-xs font-semibold text-[var(--text)]">{t("chat.mode")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={model === "gemini-2.5-flash"} onClick={() => setThinking("disabled")} className={`rounded-lg border px-3 py-2 text-xs font-medium ${thinking === "disabled" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"} disabled:cursor-not-allowed disabled:opacity-45`}>{t("chat.nonThinking")}</button>
              <button type="button" disabled={model === "gemini-2.5-flash"} onClick={() => setThinking("enabled")} className={`rounded-lg border px-3 py-2 text-xs font-medium ${thinking === "enabled" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"} disabled:cursor-not-allowed disabled:opacity-45`}>{t("chat.thinking")}</button>
            </div>
            {model === "gemini-2.5-flash" && <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">{t("chat.modeHint")}</p>}
          </div>
          <div className="mt-5 space-y-4 text-sm text-[var(--muted)]">
            <div className="flex items-center gap-3"><Brain/>{t("chat.parse")}</div><div className="flex items-center gap-3"><MagnifyingGlass/>{t("chat.embed")}</div><div className="flex items-center gap-3"><Database/>{t("chat.score")}</div><div className="flex items-center gap-3"><CheckCircle/>{t("chat.compatibility")}</div>
          </div>
          <Button disabled={loading || query.trim().length < 8} className="mt-7 w-full">{loading ? <><SpinnerGap className="animate-spin"/>{t("chat.retrieving")}</> : <>{t("chat.build")} <ArrowRight/></>}</Button>
          {error && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-[var(--danger)]">{error}</p>}
        </aside>
      </div>
    </form>}
    {result && <Conversation result={result} messages={messages} value={followUp} onChange={setFollowUp} onSubmit={refine} onReset={reset} loading={loading} error={error}/>}
    {loading && !result && <div ref={loadingRef} className="mt-6 surface min-h-[560px] scroll-mt-24 rounded-3xl p-4 sm:p-6"><BuildLoadingPanel title={locale === "zh" ? "正在构建你的电脑" : "Building your PC"} detail={ragStage === "llm-intent" ? (locale === "zh" ? "LLM 正在理解预算、用途与偏好。" : "The LLM is interpreting your budget, workload, and preferences.") : ragStage === "rag-retrieval" ? (locale === "zh" ? "RAG 正在检索证据、评分配件并验证兼容性。" : "RAG is retrieving evidence, scoring parts, and checking compatibility.") : (locale === "zh" ? "LLM 正在汇总最终配置与选择依据。" : "The LLM is writing the final configuration and rationale.")} progress={ragProgress} activeStage={ragStage} stages={[{id:"llm-intent",label:"LLM · Intent"},{id:"rag-retrieval",label:"RAG · Retrieve"},{id:"llm-explanation",label:"LLM · Explain"}]} size={420}/></div>}
    {result && <div key={result.id} className="result-reveal"><RagResult result={result}/></div>}
  </div>;
}

function Conversation({ result, messages, value, onChange, onSubmit, onReset, loading, error }: {
  result: RagBuildRecommendation;
  messages: ChatMessage[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onReset: () => void;
  loading: boolean;
  error: string;
}) {
  const { t } = useLocale();
  const interaction = result.interaction;
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content]);
  const defaultSuggestions: Array<[string, string]> = [
    [t("conversation.suggestion.cheaper"), "Make it cheaper"],
    [t("conversation.suggestion.quiet"), "Make it quieter"],
    [t("conversation.suggestion.explain"), "Explain the GPU choice"],
  ];
  const activeCompatibilitySuggestion = result.compatibilitySuggestion && result.compatibility.some(item => item.id === result.compatibilitySuggestion?.issueId && item.status !== "PASS")
    ? result.compatibilitySuggestion
    : undefined;
  const suggestions: Array<[string, string]> = activeCompatibilitySuggestion
    ? [[activeCompatibilitySuggestion.action, activeCompatibilitySuggestion.action], ...defaultSuggestions.slice(0, 2)]
    : defaultSuggestions;
  return <section className="surface overflow-hidden rounded-2xl shadow-panel">
    <div className="border-b border-[var(--line)] px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="mono text-xs font-semibold text-[var(--accent)]">{t("conversation.eyebrow")}</div><h2 className="mt-2 text-xl font-semibold">{t("conversation.title")}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{t("conversation.subtitle")}</p></div>
        <div className="flex items-center gap-3"><span className="mono rounded-md bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--muted)]">{Math.ceil(messages.length / 2)} {t("conversation.turn")}</span><button type="button" disabled={loading} onClick={onReset} className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)] disabled:opacity-40">{t("conversation.reset")}</button></div>
      </div>
    </div>
    <div className="relative">
      <div ref={transcriptRef} aria-live="polite" className="chat-scroll max-h-[420px] min-h-48 space-y-4 overflow-y-auto px-5 py-6 sm:px-7">
        {messages.map(message => message.thinking ? <div key={message.id} className="chat-message-enter flex max-w-3xl gap-3">
          <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Brain size={15} weight="bold"/></span>
          <div className="rounded-2xl rounded-tl-md bg-[var(--panel-2)] px-4 py-3 text-sm leading-6 text-[var(--text)]"><div className="mono mb-1 text-[10px] uppercase opacity-65">{t("conversation.agent")}</div><div className="flex items-center gap-2 text-[var(--muted)]"><span>{t("conversation.thinking")}</span><span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span></div></div>
        </div> : <div key={message.id} className={`chat-message-enter flex max-w-3xl gap-3 ${message.role === "user" ? "ml-auto flex-row-reverse" : ""}`}>
          <span className={`mt-1 grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${message.role === "user" ? "bg-[var(--accent)] text-white" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{message.role === "user" ? "U" : "AI"}</span>
          <div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-tr-md bg-[var(--accent)] text-white" : "rounded-tl-md bg-[var(--panel-2)] text-[var(--text)]"}`}><div className="mono mb-1 text-[10px] uppercase opacity-65">{message.role === "user" ? t("conversation.you") : t("conversation.agent")}</div><div className="whitespace-pre-wrap">{message.content}</div></div>
        </div>)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[var(--panel)] to-transparent"/>
    </div>
    {interaction?.changedParts.length ? <div className="border-t border-[var(--line)] px-5 py-3 sm:px-7"><div className="flex flex-wrap gap-2">{interaction.changedParts.map(change => <Badge key={change.category} tone={change.inducedByCompatibility ? "warning" : "accent"}>{change.category.toUpperCase()} {change.inducedByCompatibility ? t("conversation.linked") : t("conversation.changed")}</Badge>)}</div></div> : null}
    <form onSubmit={onSubmit} className="border-t border-[var(--line)] bg-[var(--panel-2)] p-4 sm:p-5">
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map(([label, prompt]) => <button key={prompt} type="button" disabled={loading} onClick={() => onChange(prompt)} className="whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-40">{label}</button>)}</div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start">
        <div><textarea rows={1} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={loading} className="h-12 min-h-12 w-full resize-none overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-[11px] text-sm leading-6 text-[var(--text)] placeholder:text-[var(--muted)]" placeholder={t("conversation.placeholder")}/><p className="mt-1.5 px-1 text-[10px] text-[var(--muted)]">{t("conversation.hint")}</p></div>
        <Button className="h-12 w-full" disabled={loading || value.trim().length < 2}>{loading ? <><SpinnerGap className="animate-spin"/>{t("conversation.updating")}</> : <>{t("conversation.update")}<ArrowRight/></>}</Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
      {interaction?.tokenUsage && <p className="mono mt-3 text-[10px] text-[var(--muted)]">DeepSeek input {interaction.tokenUsage.promptTokens} tokens, cache hit {interaction.tokenUsage.cacheHitTokens}, cache miss {interaction.tokenUsage.cacheMissTokens}</p>}
    </form>
  </section>;
}

function RagResult({ result }: { result: RagBuildRecommendation }) {
  const { t } = useLocale();
  const fails = result.compatibility.filter(item => item.status === "FAIL").length, warnings = result.compatibility.filter(item => item.status === "WARNING").length, unknowns = result.compatibility.filter(item => item.status === "UNKNOWN").length;
  const status = fails ? "FAIL" : warnings ? "WARNING" : unknowns ? "UNKNOWN" : "PASS";
  const modelLabel = AI_MODELS.find(model => model.id === result.aiModel)?.label || result.aiModel;
  const parserLabel = result.parserMode === "deepseek" ? "DEEPSEEK INTENT" : result.parserMode === "gemini" ? "GEMINI INTENT" : "LOCAL INTENT";
  const usedLocalParser = result.parserMode === "heuristic";
  const budgetRatio = result.request.budget > 0 ? result.totalPrice / result.request.budget : 0;
  const overBudget = budgetRatio > 1.2;
  const retrieval = result.retrieval || { mode: result.retrievedChunks.some(chunk => chunk.retrievalMode === "vector") ? "vector" : "keyword-fallback", vectorChunkCount: 0 };
  const retrievalFallback = retrieval.mode === "keyword-fallback";
  return <div className="mt-10 space-y-6">
    <header className="grid gap-6 border-b border-[var(--line)] pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
      <div><div className="flex flex-wrap gap-2"><Badge tone="accent">{parserLabel}</Badge><Badge tone={retrievalFallback ? "warning" : "success"}>{retrieval.mode === "vector" ? `VECTOR RAG · ${retrieval.embeddingModel || "EMBEDDINGS"}` : retrieval.mode === "keyword" ? "KEYWORD MODE" : "KEYWORD FALLBACK"}</Badge><Badge tone="neutral">{modelLabel} · {result.thinkingMode === "enabled" ? "THINKING" : "NON-THINKING"}</Badge><Badge tone={status === "PASS" ? "success" : status === "WARNING" ? "warning" : status === "UNKNOWN" ? "neutral" : "danger"}>{status === "PASS" ? <CheckCircle/> : <WarningCircle/>}{status} COMPATIBILITY</Badge></div><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{result.title}</h2><p className="mt-3 max-w-3xl text-[var(--muted)]">Parsed as {result.request.useCase} with a {formatPrice(result.request.budget, result.request.currency)} budget. Retrieved {result.retrievedChunks.length} evidence chunks before deterministic selection.</p></div>
      <div><div className="text-sm text-[var(--muted)]">{t("result.estimated")}</div><div className="mono mt-1 text-4xl font-semibold">{formatPrice(result.totalPrice, result.request.currency)}</div></div>
    </header>
    {(usedLocalParser || overBudget || retrievalFallback) && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 sm:p-6">
      <div className="flex items-start gap-3"><WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-[var(--warning)]"/><div className="space-y-1.5 text-sm leading-6">
        {usedLocalParser && <p><strong className="text-[var(--warning)]">LLM intent parser unavailable.</strong> No API key configured, so intent was parsed with local keyword rules. Set <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">DEEPSEEK_API_KEY</code> or <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">GEMINI_API_KEY</code> in <code className="mono rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-xs">.env.local</code> for richer constraint extraction. The deterministic pipeline (candidate scoring + compatibility) still ran on the parsed request.</p>}
        {retrievalFallback && <p><strong className="text-[var(--warning)]">Semantic retrieval unavailable.</strong> This response used the explicit keyword fallback, not vector RAG. {retrieval.fallbackReason || "Run the PostgreSQL migration and knowledge indexing command."}</p>}
        {overBudget && <p><strong className="text-[var(--warning)]">Build exceeds budget by {Math.round((budgetRatio - 1) * 100)}%.</strong> The budget optimizer could not reach {formatPrice(result.request.budget, result.request.currency)}. Even the cheapest valid configuration in the candidate pool costs more.</p>}
      </div></div>
    </section>}
    {result.request.constraints?.length ? <section className="surface rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">{t("result.constraints")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("result.constraintsHint")}</p></div><Badge tone="neutral">{result.request.constraints.length} {t("result.rules")}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{result.request.constraints.map((item, index) => <span key={`${item.id}-${index}`} title={`${item.sourceText}: ${item.interpretation}`} className={`rounded-lg border px-3 py-2 text-xs ${item.strength === "required" ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300" : item.strength === "excluded" ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)]"}`}><strong className="uppercase">{item.strength}</strong> / {item.target}: {item.value}<span className="ml-1 opacity-60">({item.origin || "llm"})</span></span>)}</div></section> : null}
    <section className="surface rounded-2xl p-6 sm:p-8"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><MagnifyingGlass/></span><div><h2 className="text-xl font-semibold">{t("result.reasoning")}</h2><p className="text-sm text-[var(--muted)]">{t("result.reasoningHint")}</p></div></div><div className="mt-7 grid gap-3 lg:grid-cols-2">{result.reasoning.map(item => <div key={item.category} className="rounded-xl bg-[var(--panel-2)] p-4"><div className="mono text-[10px] uppercase text-[var(--accent)]">{item.category}</div><div className="mt-2 font-semibold">{item.selected}</div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.reason}</p><details className="mt-3 text-xs text-[var(--muted)]"><summary className="cursor-pointer font-medium text-[var(--text)]">{t("result.candidates")}</summary><p className="mt-2 leading-5">{item.considered.join(", ")}</p></details></div>)}</div></section>
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]"><div className="space-y-6"><PartsTable build={result}/><CompatibilityPanel results={result.compatibility}/></div><div className="space-y-6"><PerformancePanel build={result}/>{result.performance&&<BenchmarkPanel performance={result.performance}/>}</div></div>
    <section className="surface rounded-2xl p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{t("result.evidence")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("result.evidenceHint")}</p></div><Badge tone="neutral">{result.retrievedChunks.length} {t("result.chunks")}</Badge></div><div className="mt-6 grid gap-3 lg:grid-cols-2">{result.retrievedChunks.slice(0, 10).map((chunk, index) => <article key={chunk.id} className="rounded-xl border border-[var(--line)] p-4"><div className="flex items-center justify-between gap-3"><span className="mono text-xs font-semibold text-[var(--accent)]">K{index + 1} / {chunk.retrievalMode === "vector" ? "VECTOR" : "KEYWORD"}</span><span className="mono text-[10px] text-[var(--muted)]">{chunk.similarityScore != null ? `${Math.round(chunk.similarityScore * 100)}% cosine` : `${chunk.relevanceScore}% relevance`}</span></div><h3 className="mt-3 font-semibold">{chunk.title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{chunk.content}</p>{chunk.sourceTitle && <p className="mono mt-3 text-[10px] text-[var(--muted)]">Source: {chunk.sourceUrl ? <a className="underline" href={chunk.sourceUrl} target="_blank" rel="noreferrer">{chunk.sourceTitle}</a> : chunk.sourceTitle}</p>}<div className="mt-3 flex flex-wrap gap-1.5">{chunk.tags.slice(0, 5).map(tag => <span key={tag} className="rounded bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--muted)]">{tag}</span>)}</div></article>)}</div></section>
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]"><AiExplanationPanel text={result.explanation}/><section className="surface rounded-2xl p-6"><h2 className="text-lg font-semibold">{t("result.alternatives")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("result.alternativesHint")}</p><div className="mt-5 space-y-5">{result.alternativeBuilds.map(variant => <div key={variant.title} className="rounded-xl bg-[var(--panel-2)] p-4"><div className="font-semibold">{variant.title}</div><div className="mono mt-2 text-sm text-[var(--accent)]">{formatPrice(variant.totalPrice, result.request.currency)}</div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{variant.changes.map(change => `${change.from} to ${change.to}`).join("; ")}. {variant.tradeoff}</p></div>)}</div></section></div>
  </div>;
}
