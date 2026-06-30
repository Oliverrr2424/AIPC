import { generateModelText } from "@/lib/ai/modelGateway";
import type { AiGenerationOptions } from "@/types/ai";
import type { RagBuildRecommendation } from "@/types/knowledge";

export async function generateRagExplanation(build: Omit<RagBuildRecommendation, "explanation">, ai: AiGenerationOptions) {
  const evidence = build.retrievedChunks.slice(0, 5).map((chunk, index) => `[K${index + 1}] ${chunk.title}: ${chunk.content}`).join("\n");
  const prompt = `You are a PC hardware expert. The per-part rationale and retrieved evidence are already shown to the user above, so do NOT repeat them.

Hard rules:
- Write all prose in English regardless of the user's input language.
- Never change or invent parts, prices, compatibility, benchmarks, inventory, or availability.
- Output ONLY three short Markdown sections with these exact headings: ## Summary, ## Trade-offs, ## Upgrade path.
- Each section: 1-3 concise sentences. No bullet lists, no per-part breakdowns.
- Cite evidence with [K#] only when a trade-off or upgrade claim depends on it.
- Respect hard constraints (CPU/GPU brand, color, existing parts); never propose a trade-off or upgrade that violates them.
- Compatibility comes only from the provided deterministic results.

Build data:
${JSON.stringify({ request: build.request, totalPrice: build.totalPrice, estimatedWattage: build.estimatedWattage, compatibility: build.compatibility.map(c => ({ rule: c.rule, status: c.status })) })}

Retrieved evidence:
${evidence}`;
  const generated = await generateModelText(prompt, ai);
  if (generated) return generated;
  const issues = build.compatibility.filter(result => result.status !== "PASS");
  return `## Summary\n${build.title} targets ${build.request.useCase} within ${build.request.currency} ${build.request.budget}. The deterministic engine selected parts from retrieved evidence [K1].\n\n## Trade-offs\nThe build prioritizes the stated workload and budget; cheaper options reduce performance or capacity, pricier ones add headroom.${issues.length ? ` Note: ${issues.map(i => i.message).join(" ")}` : ""}\n\n## Upgrade path\nKeep the platform and power headroom, then upgrade the GPU, memory, or storage per the workload evidence.`;
}
