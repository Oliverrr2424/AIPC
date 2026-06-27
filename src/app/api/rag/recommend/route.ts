import { NextResponse } from "next/server";
import { generateRagBuild } from "@/lib/rag/ragBuildGenerator";
import { DEFAULT_AI_OPTIONS, isAiModelId, type ThinkingMode } from "@/types/ai";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; model?: unknown; thinking?: ThinkingMode };
    if (!body.query || body.query.trim().length < 8) return NextResponse.json({ error: "Please describe your budget and intended workload." }, { status: 400 });
    const ai = {
      model: isAiModelId(body.model) ? body.model : DEFAULT_AI_OPTIONS.model,
      thinking: body.thinking === "enabled" ? "enabled" as const : "disabled" as const,
    };
    return NextResponse.json(await generateRagBuild(body.query.trim(), ai));
  } catch (error) {
    console.error("RAG recommendation failed:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Unable to generate a RAG recommendation." }, { status: 500 });
  }
}
