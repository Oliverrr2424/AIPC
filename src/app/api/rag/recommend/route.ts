import { NextResponse } from "next/server";
import { generateRagBuild } from "@/lib/rag/ragBuildGenerator";
import { reviseRagBuild } from "@/lib/rag/conversationAgent";
import { partById } from "@/data/parts";
import { DEFAULT_AI_OPTIONS, isAiModelId, type ThinkingMode } from "@/types/ai";
import type { RagBuildRecommendation } from "@/types/knowledge";
import type { BuildParts, PartCategory } from "@/types/parts";

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];

function restoreKnownParts(value: unknown): RagBuildRecommendation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as RagBuildRecommendation;
  if (!candidate.parts || !candidate.request || !candidate.sourceQuery || !Array.isArray(candidate.compatibility) || !Array.isArray(candidate.reasoning) || !Array.isArray(candidate.retrievedChunks)) return undefined;
  const known = Object.fromEntries(categories.map(category => [category, partById(candidate.parts[category]?.id || "")])) as Partial<BuildParts>;
  if (categories.some(category => !known[category] || known[category]?.category !== category)) return undefined;
  return { ...candidate, parts: known as BuildParts };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; model?: unknown; thinking?: ThinkingMode; currentBuild?: unknown };
    const currentBuild = restoreKnownParts(body.currentBuild);
    const minimumLength = currentBuild ? 2 : 8;
    if (!body.query || body.query.trim().length < minimumLength) return NextResponse.json({ error: currentBuild ? "Tell me what to change or ask about the build." : "Please describe your budget and intended workload." }, { status: 400 });
    if (body.query.length > 2_000) return NextResponse.json({ error: "Please keep each message under 2,000 characters." }, { status: 400 });
    const ai = {
      model: isAiModelId(body.model) ? body.model : DEFAULT_AI_OPTIONS.model,
      thinking: body.thinking === "enabled" ? "enabled" as const : "disabled" as const,
    };
    return NextResponse.json(currentBuild ? await reviseRagBuild(body.query.trim(), currentBuild, ai) : await generateRagBuild(body.query.trim(), ai));
  } catch (error) {
    console.error("RAG recommendation failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Unable to generate a RAG recommendation." }, { status: 500 });
  }
}
