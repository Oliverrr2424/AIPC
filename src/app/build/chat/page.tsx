import type { Metadata } from "next";
import { RagChat } from "@/components/build/RagChat";

export const metadata: Metadata = { title: "RAG PC Builder", description: "Describe a PC in natural language and inspect the retrieved evidence behind every recommendation." };

export default function RagBuilderPage() {
  return <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
    <div className="mb-10 max-w-3xl"><p className="mono text-xs font-semibold text-[var(--accent)]">RAG-AUGMENTED BUILDER</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Describe the work. Inspect the evidence.</h1><p className="mt-4 text-lg leading-8 text-[var(--muted)]">Natural-language intent parsing meets retrieved hardware knowledge, weighted candidate scoring, and deterministic compatibility checks.</p></div>
    <RagChat/>
  </div>;
}
