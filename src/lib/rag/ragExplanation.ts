import { generateModelJson } from "@/lib/ai/modelGateway";
import type { AiGenerationOptions } from "@/types/ai";
import type { CompatibilityResult } from "@/types/compatibility";
import type { CompatibilitySuggestion, RagBuildRecommendation } from "@/types/knowledge";

interface GeneratedExplanation {
  explanation: string;
  compatibilityAction: string;
}

export interface RagExplanationResult {
  explanation: string;
  compatibilitySuggestion?: CompatibilitySuggestion;
}

const schema = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    compatibilityAction: { type: "string" },
  },
  required: ["explanation", "compatibilityAction"],
};

function primaryCompatibilityIssue(results: CompatibilityResult[]) {
  return results.find(result => result.status === "FAIL") || results.find(result => result.status === "WARNING") || results.find(result => result.status === "UNKNOWN");
}

function fallbackCompatibilityAction(issue: CompatibilityResult) {
  const actions: Record<string, string> = {
    socket: "Choose a motherboard with the correct CPU socket",
    "cpu-support": "Verify the motherboard CPU support list and required BIOS version",
    memory: "Choose RAM that matches the motherboard memory type",
    "memory-slots": "Verify the motherboard DIMM count for this memory kit",
    "memory-capacity": "Choose a memory capacity within the motherboard limit",
    "memory-qvl": "Verify this exact memory kit on the motherboard QVL",
    form: "Choose a case that supports this motherboard size",
    "gpu-length": "Choose a case with enough GPU clearance",
    "gpu-thickness": "Verify the case slot-thickness clearance for this GPU",
    "cooler-height": "Choose a case with enough CPU cooler clearance",
    "cooler-clearance": "Verify the case mount and clearance for this cooler",
    "cooler-socket": "Choose a cooler with the correct CPU mounting kit",
    power: "Replace the PSU with a compatible higher-wattage model",
    "gpu-power-connector": "Verify the PSU has the GPU's required native power cable",
    "psu-form": "Choose a PSU form factor supported by this case",
    "psu-length": "Verify PSU length and cable clearance in the selected case",
    cooling: "Replace the cooler with one rated for this CPU",
    chipset: "Upgrade to a motherboard better matched to this CPU",
    storage: "Choose storage supported by this motherboard",
  };
  return actions[issue.id] || `Resolve the ${issue.rule.toLowerCase()} compatibility issue`;
}

function validExplanation(value: string | undefined) {
  const text = value?.trim();
  return text && text.includes("## Summary") && text.includes("## Trade-offs") && text.includes("## Upgrade path") ? text : undefined;
}

export async function generateRagExplanation(build: Omit<RagBuildRecommendation, "explanation" | "compatibilitySuggestion">, ai: AiGenerationOptions): Promise<RagExplanationResult> {
  const evidence = build.retrievedChunks.slice(0, 5).map((chunk, index) => `[K${index + 1}] ${chunk.title}: ${chunk.content}`).join("\n");
  const primaryIssue = primaryCompatibilityIssue(build.compatibility);
  const prompt = `You are a PC hardware expert. The per-part rationale and retrieved evidence are already shown to the user above, so do NOT repeat them.

Hard rules:
- Write all prose in English regardless of the user's input language.
- Never change or invent parts, prices, compatibility, benchmarks, inventory, or availability.
- Return a JSON object with exactly two strings: explanation and compatibilityAction.
- explanation must contain only three short Markdown sections with these exact headings: ## Summary, ## Trade-offs, ## Upgrade path.
- Each explanation section: 1-3 concise sentences. No bullet lists, no per-part breakdowns.
- Cite evidence with [K#] only when a trade-off or upgrade claim depends on it.
- Respect hard constraints (CPU/GPU brand, color, existing parts); never propose a trade-off or upgrade that violates them.
- Compatibility comes only from the provided deterministic results.
- If PRIMARY_COMPATIBILITY_ISSUE is present, compatibilityAction must be one concise imperative follow-up the user can send to fix that exact issue. Keep it under 90 characters and do not invent a specific catalog model.
- If PRIMARY_COMPATIBILITY_ISSUE is null, compatibilityAction must be an empty string.

Build data:
${JSON.stringify({ request: build.request, totalPrice: build.totalPrice, estimatedWattage: build.estimatedWattage, compatibility: build.compatibility.map(c => ({ id: c.id, rule: c.rule, status: c.status, message: c.message })), primaryCompatibilityIssue: primaryIssue || null })}

Retrieved evidence:
${evidence}`;
  const generated = await generateModelJson<GeneratedExplanation>(prompt, schema, ai);
  const issues = build.compatibility.filter(result => result.status !== "PASS");
  const fallbackExplanation = `## Summary\n${build.title} targets ${build.request.useCase} within ${build.request.currency} ${build.request.budget}. The deterministic engine selected parts from retrieved evidence [K1].\n\n## Trade-offs\nThe build prioritizes the stated workload and budget; cheaper options reduce performance or capacity, pricier ones add headroom.${issues.length ? ` Note: ${issues.map(i => i.message).join(" ")}` : ""}\n\n## Upgrade path\nKeep the platform and power headroom, then upgrade the GPU, memory, or storage per the workload evidence.`;
  const action = primaryIssue ? generated?.compatibilityAction?.trim().slice(0, 120) || fallbackCompatibilityAction(primaryIssue) : undefined;
  return {
    explanation: validExplanation(generated?.explanation) || fallbackExplanation,
    ...(primaryIssue && action ? { compatibilitySuggestion: { issueId: primaryIssue.id, action } } : {}),
  };
}
