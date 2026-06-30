import rawRules from "@/data/intentKnowledge.json";
import type { BuildRequest, ConstraintStrength, ConstraintTarget, InterpretedConstraint } from "@/types/build";
import type { KnowledgeChunk } from "@/types/knowledge";

export interface IntentKnowledgeRule extends KnowledgeChunk {
  patterns: string[];
  constraint: { target: ConstraintTarget; value: string; strength: ConstraintStrength };
}

export const intentKnowledgeRules = rawRules as IntentKnowledgeRule[];
const strengthRank: Record<ConstraintStrength, number> = { preferred: 1, required: 2, excluded: 3 };

export function extractIntentConstraints(query: string): InterpretedConstraint[] {
  const found = intentKnowledgeRules.flatMap(rule => {
    const match = rule.patterns.map(pattern => new RegExp(pattern, "i").exec(query)).find(Boolean);
    if (!match) return [];
    return [{ id: rule.id, ...rule.constraint, sourceText: match[0], interpretation: rule.content, origin: "fallback" as const }];
  });
  const strongest = new Map<string, InterpretedConstraint>();
  for (const constraint of found) {
    const key = `${constraint.target}:${constraint.value}`;
    const prior = strongest.get(key);
    if (!prior || strengthRank[constraint.strength] > strengthRank[prior.strength]) strongest.set(key, constraint);
  }
  return [...strongest.values()].filter(constraint => {
    if (constraint.target !== "lighting" || constraint.strength !== "preferred") return true;
    return ![...strongest.values()].some(other => other.target === "lighting" && other.value === constraint.value && other.strength === "excluded");
  });
}

const targets = new Set<ConstraintTarget>(["cpuBrand", "gpuBrand", "color", "lighting", "cooling", "caseStyle", "noise", "formFactor", "upgradeability", "workloadTarget"]);
const strengths = new Set<ConstraintStrength>(["required", "preferred", "excluded"]);

function canonicalValue(target: ConstraintTarget, value: string, sourceText: string) {
  const text = `${value} ${sourceText}`.toLowerCase();
  if (target === "cpuBrand") return /intel|英特尔/.test(text) ? "intel" : /amd|ryzen|锐龙/.test(text) ? "amd" : undefined;
  if (target === "gpuBrand") return /nvidia|geforce|rtx|英伟达|n卡|cuda/.test(text) ? "nvidia" : /amd|radeon|a卡/.test(text) ? "amd" : /intel|arc|英特尔/.test(text) ? "intel" : undefined;
  if (target === "color") return /white|白/.test(text) ? "white" : /black|黑/.test(text) ? "black" : undefined;
  if (target === "lighting") return "rgb";
  if (target === "cooling") return /air|风冷/.test(text) ? "air" : /aio|liquid|water|水冷/.test(text) ? "aio" : undefined;
  if (target === "caseStyle") return /panoramic|dual.?chamber|海景房/.test(text) ? "panoramic" : /traditional|传统/.test(text) ? "traditional" : undefined;
  if (target === "noise") return "quiet";
  if (target === "formFactor") return /sff|itx|small|小/.test(text) ? "sff" : value.toLowerCase();
  if (target === "upgradeability") return "high";
  return value.toLowerCase();
}

export function validateLlmConstraints(value: unknown): InterpretedConstraint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<InterpretedConstraint>;
    if (!targets.has(candidate.target as ConstraintTarget) || !strengths.has(candidate.strength as ConstraintStrength) || typeof candidate.value !== "string") return [];
    const target = candidate.target as ConstraintTarget;
    const sourceText = typeof candidate.sourceText === "string" ? candidate.sourceText : "";
    const value = canonicalValue(target, candidate.value, sourceText);
    if (!value) return [];
    return [{
      id: `llm-${target}-${index}`,
      target,
      value,
      strength: candidate.strength as ConstraintStrength,
      sourceText,
      interpretation: typeof candidate.interpretation === "string" ? candidate.interpretation : "Parsed from the user's request.",
      origin: "llm" as const,
    }];
  });
}

export function semanticRequestPatch(constraints: InterpretedConstraint[]): Partial<BuildRequest> {
  const patch: Partial<BuildRequest> = { constraints };
  for (const item of constraints) {
    if (item.target === "cpuBrand" && item.strength === "required") patch.preferredCpuBrand = item.value as BuildRequest["preferredCpuBrand"];
    if (item.target === "gpuBrand" && item.strength === "required") patch.preferredGpuBrand = item.value as BuildRequest["preferredGpuBrand"];
    if (item.target === "color") patch.preferredColor = item.value as BuildRequest["preferredColor"];
    if (item.target === "lighting") patch.preferRgb = item.strength !== "excluded";
    if (item.target === "cooling") patch.preferredCooling = item.strength === "excluded" ? (item.value === "air" ? "aio" : "air") : item.value as BuildRequest["preferredCooling"];
    if (item.target === "caseStyle") patch.preferredCaseStyle = item.value as BuildRequest["preferredCaseStyle"];
    if (item.target === "noise") patch.preferQuiet = true;
    if (item.target === "formFactor") patch.preferSmallFormFactor = true;
    if (item.target === "upgradeability") patch.preferUpgradeability = true;
  }
  return patch;
}
