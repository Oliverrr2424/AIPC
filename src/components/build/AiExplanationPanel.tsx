import { Sparkle } from "@phosphor-icons/react/dist/ssr";

function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index} className="font-semibold text-[var(--text)]">{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>)}</>;
}

export function AiExplanationPanel({ text }: { text: string }) {
  const lines = text.split("\n");
  return <section className="surface rounded-2xl p-6 sm:p-8">
    <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Sparkle weight="fill"/></span><div><h2 className="text-xl font-semibold">Build explanation</h2><p className="text-sm text-[var(--muted)]">Summary, trade-offs, and upgrade path</p></div></div>
    <div className="mt-7 max-w-3xl space-y-2 text-sm leading-7 text-[var(--muted)]">
      {lines.map((line, index) => {
        const value = line.trim();
        if (!value) return <div key={index} className="h-2"/>;
        if (value.startsWith("## ")) return <h3 key={index} className="pt-3 text-lg font-semibold text-[var(--text)] first:pt-0">{value.slice(3)}</h3>;
        if (/^[-*]\s/.test(value)) return <p key={index} className="flex gap-2 pl-1"><span className="text-[var(--accent)]">•</span><span><Inline text={value.slice(2)}/></span></p>;
        return <p key={index}><Inline text={value}/></p>;
      })}
    </div>
  </section>;
}
