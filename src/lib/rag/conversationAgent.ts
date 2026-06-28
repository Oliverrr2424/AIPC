import { partById, parts, partsByCategory } from "@/data/parts";
import { generateDeepSeekJsonFromMessages, generateDeepSeekTextFromMessages, type DeepSeekChatMessage } from "@/lib/ai/deepseekClient";
import { generateModelJson, generateModelText } from "@/lib/ai/modelGateway";
import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { priceIn } from "@/lib/pricing/priceEstimator";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildRequest, InterpretedConstraint } from "@/types/build";
import type { AgentContextMessage, AgentInteraction, AgentTokenUsage, BuildPartChange, BuildTurnAction, CandidatePools, RagBuildRecommendation } from "@/types/knowledge";
import type { BuildParts, Part, PartCategory } from "@/types/parts";
import { retrieveCandidatePools } from "./candidateRetriever";
import { summarizeRetrieval } from "./retrieval";
import { generateRagBuildFromRequest } from "./ragBuildGenerator";

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];
const visibleCategories: PartCategory[] = ["gpu", "motherboard", "ram", "cooler", "psu", "case"];

interface TargetPart {
  category: PartCategory;
  partId: string;
}

interface TurnDecision {
  action: Exclude<BuildTurnAction, "draft">;
  affectedCategories: PartCategory[];
  exactPartId?: string;
  targetParts?: TargetPart[];
  direction?: "upgrade" | "downgrade" | "neutral";
  updates?: Partial<Pick<BuildRequest, "budget" | "preferredCpuBrand" | "preferredGpuBrand" | "preferredColor" | "preferredCooling" | "preferRgb" | "preferQuiet">>;
  answer?: string;
  reason: string;
  raw?: string;
  usage?: AgentTokenUsage;
}

const decisionSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["patch", "optimize", "rebuild", "explain"] },
    affectedCategories: { type: "array", items: { type: "string", enum: categories } },
    exactPartId: { type: "string" },
    targetParts: { type: "array", items: { type: "object", properties: {
      category: { type: "string", enum: categories },
      partId: { type: "string" },
    }, required: ["category", "partId"] } },
    direction: { type: "string", enum: ["upgrade", "downgrade", "neutral"] },
    updates: { type: "object", properties: {
      budget: { type: "number" }, preferredCpuBrand: { type: "string", enum: ["intel", "amd", "none"] },
      preferredGpuBrand: { type: "string", enum: ["nvidia", "amd", "intel", "none"] },
      preferredColor: { type: "string", enum: ["white", "black", "none"] },
      preferredCooling: { type: "string", enum: ["air", "aio", "none"] },
      preferRgb: { type: "boolean" }, preferQuiet: { type: "boolean" },
    } },
    answer: { type: "string" }, reason: { type: "string" },
  },
  required: ["action", "affectedCategories", "direction", "updates", "reason"],
};

const routerSystem = `You route follow-up turns for a PC build agent. Return JSON only with keys action, affectedCategories, exactPartId (optional), targetParts (optional), direction, updates, answer (only for explain), and reason.
- patch: preserve every unaffected part; use for a named part, color, RGB, cooling, or category change.
- optimize: make the current build somewhat cheaper with the fewest substitutions.
- rebuild: only when the user clearly says the build is too expensive, wholly wrong, asks to start over, or gives a new total budget.
- explain: answer a question without changing parts.
When the user specifies a concrete spec (capacity, VRAM, wattage, form factor, model) or names a part, put the chosen catalog part(s) in targetParts (array of {category, partId}). targetParts drives direct replacement and overrides default scoring — use it whenever the user pins a specific part or spec, e.g. "1TB SSD" → the 1TB storage partId, "32GB RAM" → the 32GB ram partId, "850W gold PSU" → that psu partId. affectedCategories must include every category touched by targetParts. Never silently turn a local patch into a rebuild. exactPartId is the legacy single-part field; prefer targetParts when more than one part is pinned. Only use catalog partIds from CATALOG; never invent ids. Keep answers concise and do not invent catalog entries, prices, or benchmarks.`;

function compactBuild(build: RagBuildRecommendation) {
  return JSON.stringify({
    budget: `${build.request.currency} ${build.request.budget}`,
    total: build.totalPrice,
    useCase: build.request.useCase,
    constraints: build.request.constraints?.map(({ target, value, strength }) => ({ target, value, strength })),
    parts: Object.fromEntries(categories.map(category => [category, { id: build.parts[category].id, name: build.parts[category].name }])),
  });
}

function exactPartFromQuery(query: string) {
  const q = query.toLowerCase();
  const compact = q.replace(/[\s_-]+/g, "");
  const matches = parts.filter(part => {
    if (q.includes(part.id.toLowerCase()) || q.includes(part.name.toLowerCase())) return true;
    if (part.category === "gpu") {
      const model = part.chipset.toLowerCase().replace(/[\s_-]+/g, "");
      const digits = part.chipset.match(/\d{4}/)?.[0];
      return compact.includes(model) || Boolean(digits && new RegExp(`(?:^|\\D)${digits}(?:\\D|$)`).test(q));
    }
    if (part.category === "cpu") {
      const model = part.name.toLowerCase().replace(/[\s_-]+/g, "");
      return compact.includes(model) || compact.includes(model.replace(/^core/, ""));
    }
    return false;
  });
  return matches.sort((a, b) => b.name.length - a.name.length)[0];
}

function explicitBudget(query: string) {
  const match = query.match(/(?:预算|budget).{0,12}?(\d[\d,.]*)/i) || query.match(/(?:USD|CAD|CNY|\$)\s*(\d[\d,.]*)/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value >= 700 ? value : undefined;
}

function heuristicDecision(query: string): TurnDecision | undefined {
  const q = query.toLowerCase();
  const exact = exactPartFromQuery(query);
  if (/为什么|为何|解释|怎么选|区别|why\b|how come/i.test(q)) return { action: "explain", affectedCategories: [], direction: "neutral", reason: "The user asked for an explanation." };
  const budget = explicitBudget(query);
  if (budget || /重新生成|重新配|重配|推倒|从头|完全不符合|不符合预期|太贵了|贵太多|start over|rebuild|too expensive/i.test(q)) {
    return { action: "rebuild", affectedCategories: categories, direction: "neutral", updates: budget ? { budget } : {}, reason: budget ? "The user set a new total budget." : "The user explicitly rejected the baseline or its overall cost." };
  }
  if (/便宜(?:一|些|点)|省(?:一|些|点)|降(?:一|点|些)|cheaper|save money|cut cost/i.test(q)) return { action: "optimize", affectedCategories: [], direction: "downgrade", reason: "The user requested a minimal-change cost reduction." };

  const updates: TurnDecision["updates"] = {};
  const affected = new Set<PartCategory>();
  if (exact) affected.add(exact.category);
  if (/白色|纯白|全白|更白|white/i.test(q)) { updates.preferredColor = "white"; visibleCategories.forEach(category => affected.add(category)); }
  if (/黑色|纯黑|全黑|black/i.test(q)) { updates.preferredColor = "black"; visibleCategories.forEach(category => affected.add(category)); }
  if (/不要\s*rgb|无\s*rgb|关灯|no\s*rgb/i.test(q)) { updates.preferRgb = false; visibleCategories.forEach(category => affected.add(category)); }
  else if (/rgb|灯效|灯光/i.test(q)) { updates.preferRgb = true; visibleCategories.forEach(category => affected.add(category)); }
  if (/不要水冷|不用水冷|只要风冷|换风冷|air\s*cool/i.test(q)) { updates.preferredCooling = "air"; affected.add("cooler"); }
  else if (/水冷|aio|liquid cool/i.test(q)) { updates.preferredCooling = "aio"; affected.add("cooler"); }
  if (/intel|英特尔/i.test(q) && /cpu|处理器|14900|14700|14600/i.test(q)) { updates.preferredCpuBrand = "intel"; affected.add("cpu"); }
  if (/amd|ryzen|锐龙/i.test(q) && /cpu|处理器|ryzen|锐龙/i.test(q)) { updates.preferredCpuBrand = "amd"; affected.add("cpu"); }
  if (/nvidia|geforce|rtx|英伟达|n卡/i.test(q) && /gpu|显卡|geforce|rtx|英伟达|n卡/i.test(q)) { updates.preferredGpuBrand = "nvidia"; affected.add("gpu"); }
  if (/显卡|\bgpu\b/i.test(q)) affected.add("gpu");
  if (/处理器|\bcpu\b/i.test(q)) affected.add("cpu");
  if (/主板|motherboard/i.test(q)) affected.add("motherboard");
  if (/内存|\bram\b/i.test(q)) affected.add("ram");
  if (/硬盘|ssd|storage/i.test(q)) affected.add("storage");
  if (/机箱|\bcase\b/i.test(q)) affected.add("case");
  if (/电源|\bpsu\b/i.test(q)) affected.add("psu");
  if (/散热|风冷|水冷|cooler|\baio\b/i.test(q)) affected.add("cooler");
  const direction = /更强|升级|性能|快一点|upgrade|faster/i.test(q) ? "upgrade" : "neutral";
  if (affected.size) return { action: "patch", affectedCategories: [...affected], exactPartId: exact?.id, direction, updates, reason: "A local component or appearance preference was requested." };
  return undefined;
}

function initialContext(build: RagBuildRecommendation): AgentContextMessage[] {
  return build.interaction?.context?.length ? build.interaction.context : [
    { role: "user", content: build.sourceQuery },
    { role: "assistant", content: `BASELINE_CREATED ${compactBuild(build)}` },
  ];
}

function boundedContext(context: AgentContextMessage[]) {
  if (context.length <= 12) return context;
  return [...context.slice(0, 2), ...context.slice(-10)];
}

function normalizeDecision(value: Partial<TurnDecision> | undefined): TurnDecision | undefined {
  if (!value || !["patch", "optimize", "rebuild", "explain"].includes(value.action || "")) return undefined;
  const affectedRaw = Array.isArray(value.affectedCategories) ? value.affectedCategories.filter((item): item is PartCategory => categories.includes(item as PartCategory)) : [];
  const exact = typeof value.exactPartId === "string" && partById(value.exactPartId) ? value.exactPartId : undefined;
  const targetParts = Array.isArray(value.targetParts) ? value.targetParts.flatMap((item): TargetPart[] => {
    if (!item || typeof item !== "object") return [];
    const category = item.category as PartCategory;
    const partId = typeof item.partId === "string" ? item.partId : "";
    const part = partById(partId);
    if (!part || part.category !== category || !categories.includes(category)) return [];
    return [{ category, partId }];
  }) : [];
  const affectedSet = new Set(affectedRaw);
  targetParts.forEach(target => affectedSet.add(target.category));
  return { action: value.action!, affectedCategories: [...affectedSet], exactPartId: exact, targetParts: targetParts.length ? targetParts : undefined, direction: value.direction || "neutral", updates: value.updates || {}, answer: value.answer, reason: value.reason || "Classified from the follow-up request." };
}

function compactPartSpecs(): string {
  return parts.map(part => {
    const bits = [part.id, part.name];
    switch (part.category) {
      case "cpu": bits.push(part.socket, `${part.cores}c/${part.threads}t`, `${part.tdpWatts}W`); break;
      case "gpu": bits.push(part.chipset, `${part.vramGb}GB`, part.cuda ? "CUDA" : "raster", `${part.tdpWatts}W`); break;
      case "motherboard": bits.push(part.socket, part.chipset, part.formFactor, part.memoryType); break;
      case "ram": bits.push(`${part.capacityGb}GB`, `${part.speedMt}MT`, `${part.sticks}x`, part.memoryType); break;
      case "storage": bits.push(`${part.capacityTb}TB`, part.interface); break;
      case "cooler": bits.push(part.type, `${part.tdpRatingWatts}W`); break;
      case "psu": bits.push(`${part.wattage}W`, part.efficiency, part.formFactor); break;
      case "case": bits.push(part.supportedMotherboardFormFactors.join("/"), `gpu≤${part.maxGpuLengthMm}mm`); break;
    }
    if (part.tags.length) bits.push(`[${part.tags.join(",")}]`);
    return bits.join(" | ");
  }).join("\n");
}

async function modelDecision(query: string, build: RagBuildRecommendation, ai: AiGenerationOptions, context: AgentContextMessage[]) {
  const userContent = `CURRENT_BASELINE ${compactBuild(build)}\nCATALOG ${compactPartSpecs()}\nUSER_REQUEST ${query}`;
  if (ai.model.startsWith("deepseek-")) {
    const messages: DeepSeekChatMessage[] = [{ role: "system", content: routerSystem }, ...context, { role: "user", content: userContent }];
    const result = await generateDeepSeekJsonFromMessages<Partial<TurnDecision>>(messages, ai);
    const decision = normalizeDecision(result?.data);
    if (!decision || !result) return { decision: undefined, userContent };
    return { decision: { ...decision, raw: result.raw, usage: result.usage }, userContent };
  }
  const result = await generateModelJson<Partial<TurnDecision>>(`${routerSystem}\n\n${context.map(item => `${item.role}: ${item.content}`).join("\n")}\nuser: ${userContent}`, decisionSchema, ai);
  return { decision: normalizeDecision(result), userContent };
}

function constraintFor(target: InterpretedConstraint["target"], value: string, strength: InterpretedConstraint["strength"], sourceText: string): InterpretedConstraint {
  return { id: `turn-${target}-${Date.now().toString(36)}`, target, value, strength, sourceText, interpretation: "Updated in a follow-up turn.", origin: "fallback" };
}

function applyRequestUpdates(current: BuildRequest, decision: TurnDecision, query: string): BuildRequest {
  const updates = decision.updates || {};
  const replacedTargets = new Set<InterpretedConstraint["target"]>();
  const additions: InterpretedConstraint[] = [];
  if (updates.preferredCpuBrand && updates.preferredCpuBrand !== "none") { replacedTargets.add("cpuBrand"); additions.push(constraintFor("cpuBrand", updates.preferredCpuBrand, "required", query)); }
  if (updates.preferredGpuBrand && updates.preferredGpuBrand !== "none") { replacedTargets.add("gpuBrand"); additions.push(constraintFor("gpuBrand", updates.preferredGpuBrand, "required", query)); }
  if (updates.preferredColor && updates.preferredColor !== "none") { replacedTargets.add("color"); additions.push(constraintFor("color", updates.preferredColor, "required", query)); }
  if (typeof updates.preferRgb === "boolean") { replacedTargets.add("lighting"); additions.push(constraintFor("lighting", "rgb", updates.preferRgb ? "preferred" : "excluded", query)); }
  if (updates.preferredCooling && updates.preferredCooling !== "none") { replacedTargets.add("cooling"); additions.push(constraintFor("cooling", updates.preferredCooling, "required", query)); }
  const directlyEdited = new Set(decision.affectedCategories);
  const kept = (current.constraints || []).filter(item => {
    if (replacedTargets.has(item.target)) return false;
    if (item.target === "workloadTarget" && item.value.startsWith("part:")) {
      const locked = partById(item.value.slice(5));
      if (locked && directlyEdited.has(locked.category)) return false;
    }
    return true;
  });
  for (const target of decision.targetParts || []) additions.push(constraintFor("workloadTarget", `part:${target.partId}`, "required", query));
  if (decision.exactPartId) additions.push(constraintFor("workloadTarget", `part:${decision.exactPartId}`, "required", query));
  return { ...current, ...updates, constraints: [...kept, ...additions] };
}

function preferenceMatches(part: Part, decision: TurnDecision) {
  const updates = decision.updates || {};
  if (updates.preferredColor && updates.preferredColor !== "none" && !part.tags.includes(updates.preferredColor)) return false;
  if (updates.preferRgb === true && !part.tags.includes("rgb")) return false;
  if (updates.preferRgb === false && part.tags.includes("rgb")) return false;
  if (part.category === "cooler" && updates.preferredCooling && updates.preferredCooling !== "none" && part.type !== updates.preferredCooling) return false;
  if (part.category === "cpu" && updates.preferredCpuBrand && updates.preferredCpuBrand !== "none" && part.brand.toLowerCase() !== updates.preferredCpuBrand) return false;
  if (part.category === "gpu" && updates.preferredGpuBrand && updates.preferredGpuBrand !== "none" && part.brand.toLowerCase() !== updates.preferredGpuBrand) return false;
  return true;
}

function replacePart(build: BuildParts, category: PartCategory, part: Part) {
  return { ...build, [category]: part } as BuildParts;
}

function failCount(build: BuildParts) {
  return checkCompatibility(build).filter(result => result.status === "FAIL").length;
}

function chooseDirectReplacement(category: PartCategory, build: BuildParts, pools: CandidatePools, decision: TurnDecision) {
  const current = build[category];
  const preferred = pools[category].filter(candidate => preferenceMatches(candidate.part, decision));
  if (preferenceMatches(current, decision) && decision.direction !== "upgrade") return current;
  const candidates = preferred.length ? preferred : pools[category];
  const currentCandidate = pools[category].find(candidate => candidate.part.id === current.id);
  const eligible = decision.direction === "upgrade" ? candidates.filter(candidate => candidate.part.id !== current.id && candidate.score.performanceScore > (currentCandidate?.score.performanceScore || 0)) : candidates;
  return [...(eligible.length ? eligible : candidates)].sort((a, b) => {
    const failures = failCount(replacePart(build, category, a.part)) - failCount(replacePart(build, category, b.part));
    return failures || b.score.totalScore - a.score.totalScore;
  })[0]?.part || current;
}

function repairCategoryForFailure(id: string, direct: Set<PartCategory>): PartCategory | undefined {
  if (id === "socket") return direct.has("motherboard") ? "cpu" : "motherboard";
  if (id === "memory") return "ram";
  if (id === "form") return direct.has("case") ? "motherboard" : "case";
  if (id === "gpu-length") return "case";
  if (id === "cooler-height") return direct.has("cooler") ? "case" : "cooler";
  if (id === "cooling") return direct.has("cooler") ? "cpu" : "cooler";
  if (id === "power" || id === "psu-form") return "psu";
  if (id === "storage") return "storage";
  return undefined;
}

function repairCompatibility(build: BuildParts, request: BuildRequest, direct: Set<PartCategory>) {
  let next = build;
  const induced = new Set<PartCategory>();
  for (let pass = 0; pass < 10; pass++) {
    const failure = checkCompatibility(next).find(result => result.status === "FAIL");
    if (!failure) break;
    const category = repairCategoryForFailure(failure.id, direct);
    if (!category) break;
    const candidates = partsByCategory(category).filter(part => {
      if (category === "cpu" && request.preferredCpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredCpuBrand) return false;
      if (category === "gpu" && request.preferredGpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredGpuBrand) return false;
      if (part.category === "cooler" && request.preferredCooling !== "none" && part.type !== request.preferredCooling) return false;
      return true;
    }).map(part => ({ part, build: replacePart(next, category, part) }))
      .sort((a, b) => failCount(a.build) - failCount(b.build) || priceIn(a.part, request.currency) - priceIn(b.part, request.currency));
    const replacement = candidates.find(candidate => failCount(candidate.build) < failCount(next));
    if (!replacement) break;
    next = replacement.build;
    if (!direct.has(category)) induced.add(category);
  }
  return { parts: next, induced };
}

function allowedByHardConstraints(part: Part, request: BuildRequest) {
  const exactLock = request.constraints?.find(item => item.target === "workloadTarget" && item.strength === "required" && item.value.startsWith("part:") && partById(item.value.slice(5))?.category === part.category);
  if (exactLock && part.id !== exactLock.value.slice(5)) return false;
  if (part.category === "cpu" && request.preferredCpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredCpuBrand) return false;
  if (part.category === "gpu" && request.preferredGpuBrand !== "none" && part.brand.toLowerCase() !== request.preferredGpuBrand) return false;
  if (part.category === "cooler" && request.preferredCooling !== "none" && part.type !== request.preferredCooling) return false;
  const noRgb = request.constraints?.some(item => item.target === "lighting" && item.strength === "excluded");
  if (noRgb && part.tags.includes("rgb")) return false;
  const requiredColor = request.constraints?.find(item => item.target === "color" && item.strength === "required")?.value;
  if (requiredColor && visibleCategories.includes(part.category) && partsByCategory(part.category).some(item => item.tags.includes(requiredColor)) && !part.tags.includes(requiredColor)) return false;
  return true;
}

function economyPerformance(part: Part, request: BuildRequest) {
  switch (part.category) {
    case "gpu": return request.useCase === "ai" ? part.aiScore : part.gamingScore4k;
    case "cpu": return request.useCase === "gaming" ? part.gamingScore : part.productivityScore;
    case "ram": return part.capacityGb;
    case "storage": return part.capacityTb * 20;
    case "cooler": return part.tdpRatingWatts / 3;
    case "psu": return part.wattage / 12;
    case "case": return part.maxGpuLengthMm / 5;
    case "motherboard": return part.m2Slots * 10;
  }
}

function optimizeCheaper(initial: BuildParts, request: BuildRequest) {
  let build = initial;
  const changed = new Set<PartCategory>();
  const initialTotal = categories.reduce((sum, category) => sum + priceIn(initial[category], request.currency), 0);
  const target = initialTotal * 0.88;
  const adjustable: PartCategory[] = ["gpu", "ram", "storage", "cooler", "case", "psu", "cpu"];
  while (categories.reduce((sum, category) => sum + priceIn(build[category], request.currency), 0) > target && changed.size < 3) {
    const moves = adjustable.flatMap(category => {
      if (changed.has(category)) return [];
      const current = build[category];
      return partsByCategory(category).filter(part => allowedByHardConstraints(part, request)).flatMap(part => {
        const saving = priceIn(current, request.currency) - priceIn(part, request.currency);
        if (saving <= 0) return [];
        const candidate = replacePart(build, category, part);
        if (failCount(candidate)) return [];
        const loss = Math.max(0, economyPerformance(current, request) - economyPerformance(part, request));
        return [{ category, candidate, saving, utility: saving / (10 + loss * loss) }];
      });
    }).sort((a, b) => b.utility - a.utility || b.saving - a.saving);
    if (!moves.length) break;
    build = moves[0].candidate;
    changed.add(moves[0].category);
  }
  return { parts: build, direct: changed };
}

function changesBetween(before: BuildParts, after: BuildParts, induced: Set<PartCategory>, reason: string): BuildPartChange[] {
  return categories.flatMap(category => before[category].id === after[category].id ? [] : [{
    category, from: before[category].name, to: after[category].name,
    reason: induced.has(category) ? "Adjusted because the requested change created a compatibility dependency." : reason,
    inducedByCompatibility: induced.has(category),
  }]);
}

function interactionMessage(action: BuildTurnAction, changes: BuildPartChange[], answer?: string) {
  if (action === "explain") return answer || "The build was left unchanged.";
  if (!changes.length) return "I kept the current build unchanged because no compatible catalog part better matched that request.";
  const direct = changes.filter(change => !change.inducedByCompatibility).map(change => `${change.category}: ${change.from} → ${change.to}`);
  const linked = changes.filter(change => change.inducedByCompatibility).map(change => `${change.category}: ${change.from} → ${change.to}`);
  return `${action === "rebuild" ? "Rebuilt the configuration" : action === "optimize" ? "Reduced cost with minimal substitutions" : "Updated the requested parts"}: ${direct.join("; ") || "baseline recalculated"}.${linked.length ? ` Compatibility also required ${linked.join("; ")}.` : " All other parts were preserved."}`;
}

async function answerQuestion(query: string, build: RagBuildRecommendation, ai: AiGenerationOptions, context: AgentContextMessage[], userContent: string) {
  const system = `You answer questions about an existing PC build without modifying it. Be concise. Use only the supplied baseline and catalog facts. If a named component is absent from CATALOG, say it is not currently in the candidate catalog; do not invent a price or benchmark.`;
  if (ai.model.startsWith("deepseek-")) {
    const result = await generateDeepSeekTextFromMessages([{ role: "system", content: system }, ...context, { role: "user", content: userContent }], ai);
    if (result) return { answer: result.text, raw: result.raw, usage: result.usage };
  } else {
    const answer = await generateModelText(`${system}\n\nBASELINE ${compactBuild(build)}\nCATALOG ${compactPartSpecs()}\nQUESTION ${query}`, ai);
    if (answer) return { answer, raw: answer };
  }
  const modelLike = query.match(/(?:rtx\s*)?\d{4,5}(?:x3d|k|ks|kf|ti|super)?/i)?.[0];
  return { answer: modelLike && !exactPartFromQuery(modelLike) ? `${modelLike} is not in the current candidate catalog, so the deterministic selector could not choose it. The existing ${build.parts.cpu.name} was selected from the available parts while respecting the current constraints.` : `The current choice is ${build.parts.cpu.name} with ${build.parts.gpu.name}. It was selected from the available candidate pool under the stated budget and hard constraints; this explanation does not change the build.`, raw: "" };
}

function nextContext(prior: AgentContextMessage[], userContent: string, assistantContent: string) {
  return boundedContext([...prior, { role: "user", content: userContent }, { role: "assistant", content: assistantContent }]);
}

function withInteraction(build: RagBuildRecommendation, interaction: AgentInteraction): RagBuildRecommendation {
  return { ...build, interaction };
}

export async function reviseRagBuild(query: string, current: RagBuildRecommendation, ai: AiGenerationOptions): Promise<RagBuildRecommendation> {
  const context = boundedContext(initialContext(current));
  // LLM decision first; heuristics are the fallback when the model is unavailable or returns nothing.
  let decision: TurnDecision | undefined;
  let userContent = `CURRENT_BASELINE ${compactBuild(current)}\nCATALOG ${compactPartSpecs()}\nUSER_REQUEST ${query}`;
  try {
    const modeled = await modelDecision(query, current, ai, context);
    userContent = modeled.userContent;
    decision = modeled.decision;
  } catch {
    decision = undefined;
  }
  if (!decision) decision = heuristicDecision(query);
  decision ||= { action: "patch", affectedCategories: [], direction: "neutral", updates: {}, reason: "No destructive intent was detected, so the baseline remains locked." };

  if (decision.action === "explain") {
    const response = decision.answer ? { answer: decision.answer, raw: decision.raw || decision.answer, usage: decision.usage } : await answerQuestion(query, current, ai, context, userContent);
    const message = response.answer;
    const interaction: AgentInteraction = { action: "explain", message, changedParts: [], preservedCategories: categories, affectedCategories: [], context: nextContext(context, userContent, response.raw || message), tokenUsage: response.usage || decision.usage };
    return withInteraction(current, interaction);
  }

  const request = applyRequestUpdates(current.request, decision, query);
  if (decision.action === "rebuild") {
    if (!decision.updates?.budget) request.budget = Math.max(700, Math.min(request.budget, Math.floor(current.totalPrice * 0.8 / 100) * 100));
    const rebuilt = await generateRagBuildFromRequest(`${current.sourceQuery}\nFollow-up: ${query}`, ai, request, current.parserMode);
    const changes = changesBetween(current.parts, rebuilt.parts, new Set(), decision.reason);
    const message = interactionMessage("rebuild", changes);
    return withInteraction(rebuilt, { action: "rebuild", message, changedParts: changes, preservedCategories: categories.filter(category => current.parts[category].id === rebuilt.parts[category].id), affectedCategories: categories, context: nextContext(context, userContent, decision.raw || JSON.stringify({ action: "rebuild", changed: changes.map(change => change.category) })), tokenUsage: decision.usage });
  }

  const { pools, chunks } = await retrieveCandidatePools(request, query, decision.action === "optimize" ? [] : decision.affectedCategories);
  let direct = new Set(decision.affectedCategories);
  let nextParts = { ...current.parts } as BuildParts;
  if (decision.action === "optimize") {
    const optimized = optimizeCheaper(nextParts, request);
    nextParts = optimized.parts;
    direct = optimized.direct;
  } else {
    const exact = decision.exactPartId ? partById(decision.exactPartId) : undefined;
    const targetByCategory = new Map((decision.targetParts || []).map(target => [target.category, partById(target.partId)]));
    const ordered: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "case", "cooler", "psu", "storage"];
    for (const category of ordered.filter(item => direct.has(item))) {
      const target = targetByCategory.get(category);
      if (target && target.category === category) nextParts = replacePart(nextParts, category, target);
      else if (exact?.category === category) nextParts = replacePart(nextParts, category, exact);
      else nextParts = replacePart(nextParts, category, chooseDirectReplacement(category, nextParts, pools, decision));
    }
  }
  const repaired = repairCompatibility(nextParts, request, direct);
  nextParts = repaired.parts;
  const changes = changesBetween(current.parts, nextParts, repaired.induced, decision.reason);
  const totalPrice = categories.reduce((sum, category) => sum + priceIn(nextParts[category], request.currency), 0);
  const compatibility = checkCompatibility(nextParts);
  const performance = await estimatePerformance(nextParts, request);
  const affected = new Set([...direct, ...repaired.induced]);
  const reasoning = current.reasoning.map(item => {
    const changed = changes.find(change => change.category === item.category);
    if (!changed) return item;
    const part = nextParts[item.category];
    const candidate = pools[item.category].find(entry => entry.part.id === part.id);
    return { category: item.category, considered: pools[item.category].slice(0, 4).map(entry => entry.part.name), selected: part.name, reason: changed.reason, evidenceIds: candidate?.evidence.map(entry => entry.id) || [] };
  });
  const mergedChunks = [...chunks, ...current.retrievedChunks].filter((chunk, index, all) => all.findIndex(item => item.id === chunk.id) === index).slice(0, 18);
  const message = interactionMessage(decision.action, changes);
  const interaction: AgentInteraction = {
    action: decision.action, message, changedParts: changes,
    preservedCategories: categories.filter(category => current.parts[category].id === nextParts[category].id),
    affectedCategories: [...affected],
    context: nextContext(context, userContent, decision.raw || JSON.stringify({ action: decision.action, changed: changes.map(change => change.category) })),
    tokenUsage: decision.usage,
  };
  return {
    ...current, id: `rag-${Date.now().toString(36)}`, request, parts: nextParts, totalPrice, compatibility, performance,
    estimatedWattage: estimateWattage(nextParts), generatedAt: new Date().toISOString(), retrievedChunks: mergedChunks,
    retrieval: summarizeRetrieval(mergedChunks),
    reasoning, alternativeBuilds: [], interaction,
  };
}
