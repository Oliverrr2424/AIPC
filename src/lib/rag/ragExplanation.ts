import { generateModelText } from "@/lib/ai/modelGateway";
import type { AiGenerationOptions } from "@/types/ai";
import type { RagBuildRecommendation } from "@/types/knowledge";

export async function generateRagExplanation(build: Omit<RagBuildRecommendation, "explanation">, ai: AiGenerationOptions) {
  const evidence = build.retrievedChunks.slice(0, 8).map((chunk, index) => `[K${index + 1}] ${chunk.title}: ${chunk.content}`).join("\n");
  const prompt = `You are a PC hardware expert explaining a recommendation already selected by a deterministic engine.

Hard rules:
- Never change or invent parts, prices, compatibility, benchmarks, inventory, or availability.
- Treat explicit CPU brand, GPU brand, color, and existing-part requirements as hard constraints. Never propose a trade-off or alternative that violates them.
- Refer to evidence with citations like [K1]. Every major recommendation claim needs a citation.
- Compatibility comes only from the provided deterministic results.
- Explicitly explain trade-offs and the upgrade path.
- Use these exact Markdown headings: ## Build summary, ## Why these parts, ## Trade-offs, ## Compatibility, ## Upgrade path.
- Keep the answer concise and professional.

Build data:
${JSON.stringify({ request: build.request, parts: build.parts, totalPrice: build.totalPrice, estimatedWattage: build.estimatedWattage, compatibility: build.compatibility, performance: build.performance })}

Retrieved evidence:
${evidence}`;
  const generated = await generateModelText(prompt, ai);
  if (generated) return generated;
  const refs = build.retrievedChunks.slice(0, 3);
  return `## Build summary\nThis build applies retrieved workload guidance before deterministic selection. ${refs[0] ? `The main allocation follows ${refs[0].title} [K1].` : "The final selection is based on structured part data."}\n\n## Why these parts\n${build.reasoning.slice(0, 4).map(item => `${item.selected} led its ${item.category} candidate pool on weighted performance, value, preference, upgradeability, and retrieved relevance${item.evidenceIds[0] ? ` [K${Math.max(1, build.retrievedChunks.findIndex(c => c.id === item.evidenceIds[0]) + 1)}]` : ""}.`).join(" ")}\n\n## Trade-offs\nThe engine prioritizes the stated workload and budget. A lower price would reduce performance or capacity; a higher price would improve headroom.\n\n## Compatibility\n${build.compatibility.filter(result => result.status !== "PASS").map(result => result.message).join(" ") || "All deterministic compatibility checks passed."}\n\n## Upgrade path\nPreserve the selected platform and power headroom, then upgrade the GPU, memory, or storage according to the workload evidence.`;
}
