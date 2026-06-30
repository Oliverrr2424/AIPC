import { parts } from "@/data/parts";
import { generateModelJson } from "@/lib/ai/modelGateway";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildRequest, InterpretedConstraint, UseCase } from "@/types/build";
import type { IntentParseResult } from "@/types/knowledge";
import { extractIntentConstraints, intentKnowledgeRules, semanticRequestPatch, validateLlmConstraints } from "./constraintExtractor";

type ParsedIntent = Partial<BuildRequest> & { summary?: string };

const schema = {
  type: "object",
  properties: {
    budget: { type: "number" }, currency: { type: "string", enum: ["CAD", "CNY", "USD"] },
    country: { type: "string", enum: ["Canada", "US", "China"] },
    useCase: { type: "string", enum: ["gaming", "ai", "development", "video", "balanced"] },
    resolution: { type: "string", enum: ["1080p", "1440p", "4k"] },
    targetFps: { type: "number" }, games: { type: "string" },
    aiWorkloads: { type: "array", items: { type: "string" } }, vramPreference: { type: "number", enum: [12, 16, 24, 32] },
    ramCapacityGb: { type: "number" }, storageCapacityTb: { type: "number" },
    developerWorkloads: { type: "array", items: { type: "string" } },
    operatingSystem: { type: "string", enum: ["windows", "linux", "none"] },
    preferredCpuBrand: { type: "string", enum: ["intel", "amd", "none"] },
    preferredGpuBrand: { type: "string", enum: ["nvidia", "amd", "intel", "none"] },
    preferredColor: { type: "string", enum: ["white", "black", "none"] },
    preferredCooling: { type: "string", enum: ["air", "aio", "none"] },
    preferredCaseStyle: { type: "string", enum: ["panoramic", "traditional", "none"] },
    preferQuiet: { type: "boolean" }, preferRgb: { type: "boolean" }, preferSmallFormFactor: { type: "boolean" },
    preferUpgradeability: { type: "boolean" }, preferLowPower: { type: "boolean" }, preferValue: { type: "boolean" }, preferReliability: { type: "boolean" },
    constraints: { type: "array", items: { type: "object", properties: {
      target: { type: "string", enum: ["cpuBrand", "gpuBrand", "color", "lighting", "cooling", "caseStyle", "noise", "formFactor", "upgradeability", "workloadTarget"] },
      value: { type: "string" }, strength: { type: "string", enum: ["required", "preferred", "excluded"] },
      sourceText: { type: "string" }, interpretation: { type: "string" },
    }, required: ["target", "value", "strength", "sourceText", "interpretation"] } },
    existingPartIds: { type: "array", items: { type: "string" } }, summary: { type: "string" },
  },
  required: ["budget", "currency", "country", "useCase", "operatingSystem", "preferredCpuBrand", "preferredGpuBrand", "preferredColor", "preferredCooling", "preferredCaseStyle", "preferQuiet", "preferRgb", "preferSmallFormFactor", "preferUpgradeability", "preferLowPower", "preferValue", "preferReliability", "constraints", "existingPartIds", "summary"],
};

function explicitCpuBrand(q: string): BuildRequest["preferredCpuBrand"] {
  if (/(?:intel|英特尔)\s*(?:cpu|processor|处理器)|(?:cpu|processor|处理器).{0,8}(?:intel|英特尔)/i.test(q)) return "intel";
  if (/(?:amd|ryzen|锐龙)\s*(?:cpu|processor|处理器)|(?:cpu|processor|处理器).{0,8}(?:amd|ryzen|锐龙)/i.test(q)) return "amd";
  return "none";
}

function explicitGpuBrand(q: string): BuildRequest["preferredGpuBrand"] {
  if (/(?:nvidia|geforce|rtx|英伟达)\s*(?:gpu|graphics|显卡)?|(?:gpu|graphics|显卡).{0,8}(?:nvidia|geforce|rtx|英伟达)|\bcuda\s*(?:is\s*)?(?:required|mandatory|only)\b|(?:必须|需要|限定)\s*cuda/i.test(q)) return "nvidia";
  if (/(?:radeon|a卡)\s*(?:gpu|graphics|显卡)?|(?:gpu|graphics|显卡).{0,8}(?:amd|radeon|a卡)/i.test(q)) return "amd";
  if (/(?:arc)\s*(?:gpu|graphics|显卡)|(?:gpu|graphics|显卡).{0,8}(?:intel|英特尔|arc)/i.test(q)) return "intel";
  return "none";
}

function heuristic(query: string): ParsedIntent {
  const q = query.toLowerCase();
  const money = q.match(/(?:cad|usd|\$|预算|预算是|大概)\s*([\d,.]+)/i) || q.match(/([\d,.]+)\s*(?:cad|usd|加币|美元|块|元)/i);
  const budget = money ? Number(money[1].replace(/,/g, "")) : 2000;
  const useCase: UseCase = /ai|llm|cuda|stable diffusion|flux|机器学习|人工智能|大模型|模型训练/.test(q) ? "ai" : /剪辑|视频|davinci|premiere/.test(q) ? "video" : /开发|docker|编译|数据库|android|ios/.test(q) ? "development" : /游戏|gaming|fps|4k|1440p|1080p/.test(q) ? "gaming" : "balanced";
  const existingPartIds = parts.filter(part => q.includes(part.name.toLowerCase()) || q.includes(part.id)).map(part => part.id);
  const ramCapacity = q.match(/(?:at least\s*)?(\d+)\s*gb\s*(?:of\s*)?(?:system\s*)?(?:ram|memory|内存)/i) || q.match(/(?:ram|memory|内存)[^\d]{0,12}(\d+)\s*gb/i);
  const storageCapacity = q.match(/(?:at least\s*)?(\d+(?:\.\d+)?)\s*tb\s*(?:nvme|ssd|storage|硬盘|固态)?/i) || q.match(/(?:nvme|ssd|storage|硬盘|固态)[^\d]{0,12}(\d+(?:\.\d+)?)\s*tb/i);
  // Currency detection — check USD FIRST so "美元" (which contains the
  // character 元) is not misread as CNY. Order: CAD → USD → CNY → default USD.
  const isCad = /cad|加币|加拿大/.test(q);
  const isUsd = /美元|usd|\$|美金|刀/.test(q);
  const isCny = /cny|人民币|rmb|(^|[^\u4e00])元([^\u4e00]|$)|块/.test(q);
  const currency: "CAD" | "USD" | "CNY" = isCad ? "CAD" : isUsd ? "USD" : isCny ? "CNY" : "USD";
  const country: "Canada" | "US" | "China" = isCad ? "Canada" : isUsd ? "US" : /中国|china|人民币|cny/.test(q) ? "China" : "US";
  const fpsMatch = q.match(/(\d{2,3})\s*(?:fps|hz|帧)/);
  const targetFps = fpsMatch ? Math.max(30, Math.min(500, Number(fpsMatch[1]))) : undefined;
  return {
    budget: Number.isFinite(budget) && budget >= 700 ? budget : 2000,
    currency, country,
    useCase, resolution: /4k/.test(q) ? "4k" : /1440p|2k/.test(q) ? "1440p" : /1080p/.test(q) ? "1080p" : undefined,
    targetFps,
    vramPreference: /32\s*gb/.test(q) ? 32 : /24\s*gb/.test(q) ? 24 : /16\s*gb/.test(q) ? 16 : /12\s*gb/.test(q) ? 12 : undefined,
    preferredCpuBrand: explicitCpuBrand(q), preferredGpuBrand: explicitGpuBrand(q),
    preferredColor: /纯白|全白|白色|white/.test(q) ? "white" : /纯黑|全黑|黑色|black/.test(q) ? "black" : "none",
    preferQuiet: /静音|安静|quiet/.test(q), preferRgb: /rgb|灯效/.test(q) && !/不要rgb|无rgb|no rgb/.test(q),
    operatingSystem: /linux|ubuntu|debian|fedora|arch\b/.test(q) ? "linux" : /windows|win11|win 11/.test(q) ? "windows" : "none",
    preferSmallFormFactor: /小机箱|小钢炮|sff|mini.?itx|itx/.test(q), preferUpgradeability: /升级|upgrade/.test(q), preferLowPower: /低功耗|省电|low power|efficient/.test(q), preferValue: /性价比|value|bang for (?:the )?buck|cost.?effective/.test(q), preferReliability: /稳定|可靠|耐用|reliab|stable/.test(q), existingPartIds,
    ramCapacityGb: ramCapacity ? Number(ramCapacity[1]) : undefined,
    storageCapacityTb: storageCapacity ? Number(storageCapacity[1]) : undefined,
    aiWorkloads: useCase === "ai" ? [q.includes("diffusion") || q.includes("flux") ? "Stable Diffusion / Flux" : "Local LLM inference"] : undefined,
    developerWorkloads: useCase === "development" ? [q.includes("docker") ? "Docker" : "Software development"] : undefined,
    summary: "Parsed locally from budget, workload, resolution, brand, and preference keywords.",
  };
}

function normalize(parsed: ParsedIntent, fallback: ParsedIntent): BuildRequest {
  const existingIds = new Set(parts.map(p => p.id));
  return {
    budget: Math.max(700, Number(parsed.budget) || Number(fallback.budget) || 2000),
    currency: parsed.currency === "CAD" || parsed.currency === "CNY" ? parsed.currency : "USD", country: parsed.country === "Canada" || parsed.country === "China" ? parsed.country : "US",
    useCase: (["gaming", "ai", "development", "video", "balanced"] as const).includes(parsed.useCase as UseCase) ? parsed.useCase as UseCase : "balanced",
    resolution: parsed.resolution, targetFps: Number(parsed.targetFps) >= 30 && Number(parsed.targetFps) <= 500 ? Math.round(Number(parsed.targetFps)) : fallback.targetFps, games: parsed.games,
    aiWorkloads: parsed.aiWorkloads, vramPreference: parsed.vramPreference,
    ramCapacityGb: Number(parsed.ramCapacityGb) > 0 ? Number(parsed.ramCapacityGb) : Number(fallback.ramCapacityGb) > 0 ? Number(fallback.ramCapacityGb) : undefined,
    storageCapacityTb: Number(parsed.storageCapacityTb) > 0 ? Number(parsed.storageCapacityTb) : Number(fallback.storageCapacityTb) > 0 ? Number(fallback.storageCapacityTb) : undefined,
    developerWorkloads: parsed.developerWorkloads,
    operatingSystem: parsed.operatingSystem ?? fallback.operatingSystem ?? "none",
    preferredCpuBrand: parsed.preferredCpuBrand ?? fallback.preferredCpuBrand ?? "none",
    preferredGpuBrand: parsed.preferredGpuBrand ?? fallback.preferredGpuBrand ?? "none",
    preferredColor: parsed.preferredColor ?? fallback.preferredColor ?? "none",
    preferredCooling: parsed.preferredCooling ?? fallback.preferredCooling ?? "none", preferredCaseStyle: parsed.preferredCaseStyle ?? fallback.preferredCaseStyle ?? "none",
    preferQuiet: Boolean(parsed.preferQuiet ?? fallback.preferQuiet), preferRgb: Boolean(parsed.preferRgb ?? fallback.preferRgb),
    preferSmallFormFactor: Boolean(parsed.preferSmallFormFactor ?? fallback.preferSmallFormFactor), preferUpgradeability: Boolean(parsed.preferUpgradeability ?? fallback.preferUpgradeability), preferLowPower: Boolean(parsed.preferLowPower ?? fallback.preferLowPower), preferValue: Boolean(parsed.preferValue ?? fallback.preferValue), preferReliability: Boolean(parsed.preferReliability ?? fallback.preferReliability),
    existingPartIds: (parsed.existingPartIds || []).filter(id => existingIds.has(id)),
  };
}

export async function parseBuildIntent(query: string, ai: AiGenerationOptions): Promise<IntentParseResult> {
  const fallback = heuristic(query);
  const intentKnowledge = intentKnowledgeRules.map(rule => `- ${rule.title}: ${rule.content}`).join("\n");
  const prompt = `You are a PC recommendation pipeline. Accept the user's request in any language and parse it into JSON only; never select final hardware. Write summary, games, aiWorkloads, developerWorkloads, constraint values, and interpretations in English regardless of the input language. sourceText is the only exception and must preserve the exact original-language phrase. Produce one constraint object for every explicit requirement, preference, exclusion, or target. Brand requirements explicitly scoped to CPU or GPU are required constraints. Pure/all-white is required; ordinary color language is preferred. Negative language is excluded. Performance targets such as 4K 240Hz are goals, not guaranteed benchmarks. Set preferValue for explicit value/price-performance language and preferReliability for explicit stability/reliability/durability language. Capture Linux or Windows in operatingSystem; otherwise use none. Currency defaults to USD, uses CAD for Canadian dollars, and CNY for Chinese yuan/RMB. Country defaults to US.\n\nPC intent ontology:\n${intentKnowledge}\n\nExisting part IDs must only be used when the user names one of these known parts:\n${parts.map(p => `${p.id}: ${p.name}`).join("\n")}\n\nUser request:\n${query}`;
  const parsed = await generateModelJson<ParsedIntent>(prompt, schema, ai);
  const constraints = parsed ? validateLlmConstraints(parsed.constraints) : extractIntentConstraints(query);
  const semanticPatch = semanticRequestPatch(constraints);
  const mode = parsed ? (ai.model.startsWith("deepseek-") ? "deepseek" : "gemini") : "heuristic";
  const request = { ...normalize(parsed || fallback, fallback), ...semanticPatch, constraints };
  return { request: splitOwnedFromPinned(query, withExplicitVramFloor(query, request)), mode, summary: parsed?.summary || fallback.summary || "Intent parsed." };
}

// An explicitly stated minimum VRAM ("at least 32 GB VRAM", "至少 32GB 显存") is a
// hard capacity requirement, not a soft preference. The schema captures the
// number in `vramPreference`, but the GPU pool only enforces it as a hard filter
// when a matching required constraint exists — so synthesize one when the user's
// own words pin a VRAM floor and the LLM did not already emit it.
function withExplicitVramFloor(query: string, request: BuildRequest): BuildRequest {
  const match = query.match(/(\d+)\s*gb\s*(?:of\s*)?vram|vram[^\d]{0,12}(\d+)\s*gb|(\d+)\s*gb\s*显存|显存[^\d]{0,8}(\d+)\s*gb/i);
  if (!match) return request;
  const vram = Number(match[1] || match[2] || match[3] || match[4]);
  if (!Number.isFinite(vram) || vram <= 0) return request;
  const alreadyHard = (request.constraints || []).some(item => item.target === "workloadTarget" && item.strength === "required" && /vram|显存/i.test(`${item.value} ${item.sourceText}`));
  const next = { ...request, vramPreference: (request.vramPreference && request.vramPreference >= vram ? request.vramPreference : vram) as BuildRequest["vramPreference"] };
  if (alreadyHard) return next;
  const constraint: InterpretedConstraint = {
    id: `vram-min-${vram}`,
    target: "workloadTarget",
    value: `vram>=${vram}`,
    strength: "required",
    sourceText: match[0],
    interpretation: `User requires at least ${vram} GB of VRAM.`,
    origin: "fallback",
  };
  return { ...next, constraints: [...(next.constraints || []), constraint] };
}

// `existingPartIds` historically conflated "hardware the user already owns"
// (excluded from the budget) with "a specific model the user wants us to use"
// (must be selected AND counted in the budget). Only treat named parts as owned
// when the request actually expresses ownership; otherwise pin them as a
// required model so they are priced into the build.
function splitOwnedFromPinned(query: string, request: BuildRequest): BuildRequest {
  const ownsHardware = /我(?:已经|已)?有|已有|现有|手头(?:有)?|沿用|复用|existing|already\s+(?:have|own)|reuse|i\s+(?:have|own)|keep\s+my/i.test(query);
  const named = request.existingPartIds || [];
  if (ownsHardware || !named.length) return request;
  const alreadyPinned = new Set((request.constraints || []).filter(item => item.target === "workloadTarget" && item.value.startsWith("part:")).map(item => item.value.slice(5)));
  const toPin = named.filter(id => !alreadyPinned.has(id));
  if (!toPin.length) return { ...request, existingPartIds: [] };
  const pinnedConstraints: InterpretedConstraint[] = toPin.map(id => ({
    id: `pin-${id}`,
    target: "workloadTarget",
    value: `part:${id}`,
    strength: "required",
    sourceText: parts.find(part => part.id === id)?.name || id,
    interpretation: "User named this specific model to use; priced into the build.",
    origin: "fallback",
  }));
  return { ...request, existingPartIds: [], constraints: [...(request.constraints || []), ...pinnedConstraints] };
}
