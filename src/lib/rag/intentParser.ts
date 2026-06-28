import { parts } from "@/data/parts";
import { generateModelJson } from "@/lib/ai/modelGateway";
import type { AiGenerationOptions } from "@/types/ai";
import type { BuildRequest, UseCase } from "@/types/build";
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
    targetFps: { type: "number", enum: [60, 120, 144, 240] }, games: { type: "string" },
    aiWorkloads: { type: "array", items: { type: "string" } }, vramPreference: { type: "number", enum: [12, 16, 24, 32] },
    ramCapacityGb: { type: "number" }, storageCapacityTb: { type: "number" },
    developerWorkloads: { type: "array", items: { type: "string" } },
    preferredCpuBrand: { type: "string", enum: ["intel", "amd", "none"] },
    preferredGpuBrand: { type: "string", enum: ["nvidia", "amd", "intel", "none"] },
    preferredColor: { type: "string", enum: ["white", "black", "none"] },
    preferredCooling: { type: "string", enum: ["air", "aio", "none"] },
    preferredCaseStyle: { type: "string", enum: ["panoramic", "traditional", "none"] },
    preferQuiet: { type: "boolean" }, preferRgb: { type: "boolean" }, preferSmallFormFactor: { type: "boolean" },
    preferUpgradeability: { type: "boolean" }, preferLowPower: { type: "boolean" },
    constraints: { type: "array", items: { type: "object", properties: {
      target: { type: "string", enum: ["cpuBrand", "gpuBrand", "color", "lighting", "cooling", "caseStyle", "noise", "formFactor", "upgradeability", "workloadTarget"] },
      value: { type: "string" }, strength: { type: "string", enum: ["required", "preferred", "excluded"] },
      sourceText: { type: "string" }, interpretation: { type: "string" },
    }, required: ["target", "value", "strength", "sourceText", "interpretation"] } },
    existingPartIds: { type: "array", items: { type: "string" } }, summary: { type: "string" },
  },
  required: ["budget", "currency", "country", "useCase", "preferredCpuBrand", "preferredGpuBrand", "preferredColor", "preferredCooling", "preferredCaseStyle", "preferQuiet", "preferRgb", "preferSmallFormFactor", "preferUpgradeability", "preferLowPower", "constraints", "existingPartIds", "summary"],
};

function explicitCpuBrand(q: string): BuildRequest["preferredCpuBrand"] {
  if (/(?:intel|英特尔)\s*(?:cpu|processor|处理器)|(?:cpu|processor|处理器).{0,8}(?:intel|英特尔)/i.test(q)) return "intel";
  if (/(?:amd|ryzen|锐龙)\s*(?:cpu|processor|处理器)|(?:cpu|processor|处理器).{0,8}(?:amd|ryzen|锐龙)/i.test(q)) return "amd";
  return "none";
}

function explicitGpuBrand(q: string): BuildRequest["preferredGpuBrand"] {
  if (/(?:nvidia|geforce|rtx|英伟达)\s*(?:gpu|graphics|显卡)?|(?:gpu|graphics|显卡).{0,8}(?:nvidia|geforce|rtx|英伟达)/i.test(q)) return "nvidia";
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
  return {
    budget: Number.isFinite(budget) && budget >= 700 ? budget : 2000,
    currency, country,
    useCase, resolution: /4k/.test(q) ? "4k" : /1440p|2k/.test(q) ? "1440p" : /1080p/.test(q) ? "1080p" : undefined,
    targetFps: /240\s*fps/.test(q) ? 240 : /144\s*fps/.test(q) ? 144 : /120\s*fps/.test(q) ? 120 : /60\s*fps/.test(q) ? 60 : undefined,
    vramPreference: /32\s*gb/.test(q) ? 32 : /24\s*gb/.test(q) ? 24 : /16\s*gb/.test(q) ? 16 : /12\s*gb/.test(q) ? 12 : undefined,
    preferredCpuBrand: explicitCpuBrand(q), preferredGpuBrand: explicitGpuBrand(q),
    preferredColor: /纯白|全白|白色|white/.test(q) ? "white" : /纯黑|全黑|黑色|black/.test(q) ? "black" : "none",
    preferQuiet: /静音|安静|quiet/.test(q), preferRgb: /rgb|灯效/.test(q) && !/不要rgb|无rgb|no rgb/.test(q),
    preferSmallFormFactor: /小机箱|小钢炮|sff|mini.?itx|itx/.test(q), preferUpgradeability: /升级|upgrade/.test(q), preferLowPower: /低功耗|省电|low power|efficient/.test(q), existingPartIds,
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
    resolution: parsed.resolution, targetFps: parsed.targetFps, games: parsed.games,
    aiWorkloads: parsed.aiWorkloads, vramPreference: parsed.vramPreference,
    ramCapacityGb: Number(parsed.ramCapacityGb) > 0 ? Number(parsed.ramCapacityGb) : Number(fallback.ramCapacityGb) > 0 ? Number(fallback.ramCapacityGb) : undefined,
    storageCapacityTb: Number(parsed.storageCapacityTb) > 0 ? Number(parsed.storageCapacityTb) : Number(fallback.storageCapacityTb) > 0 ? Number(fallback.storageCapacityTb) : undefined,
    developerWorkloads: parsed.developerWorkloads,
    preferredCpuBrand: parsed.preferredCpuBrand ?? fallback.preferredCpuBrand ?? "none",
    preferredGpuBrand: parsed.preferredGpuBrand ?? fallback.preferredGpuBrand ?? "none",
    preferredColor: parsed.preferredColor ?? fallback.preferredColor ?? "none",
    preferredCooling: parsed.preferredCooling ?? fallback.preferredCooling ?? "none", preferredCaseStyle: parsed.preferredCaseStyle ?? fallback.preferredCaseStyle ?? "none",
    preferQuiet: Boolean(parsed.preferQuiet ?? fallback.preferQuiet), preferRgb: Boolean(parsed.preferRgb ?? fallback.preferRgb),
    preferSmallFormFactor: Boolean(parsed.preferSmallFormFactor ?? fallback.preferSmallFormFactor), preferUpgradeability: Boolean(parsed.preferUpgradeability ?? fallback.preferUpgradeability), preferLowPower: Boolean(parsed.preferLowPower ?? fallback.preferLowPower),
    existingPartIds: (parsed.existingPartIds || []).filter(id => existingIds.has(id)),
  };
}

export async function parseBuildIntent(query: string, ai: AiGenerationOptions): Promise<IntentParseResult> {
  const fallback = heuristic(query);
  const intentKnowledge = intentKnowledgeRules.map(rule => `- ${rule.title}: ${rule.content}`).join("\n");
  const prompt = `You are a PC recommendation pipeline. Parse the user's natural language into JSON only; never select final hardware. Produce one constraint object for every explicit requirement, preference, exclusion, or target. sourceText must be the exact phrase that supports the constraint. Brand requirements explicitly scoped to CPU or GPU are required constraints. Pure/all-white is required; ordinary color language is preferred. Negative language is excluded. Performance targets such as 4K 240Hz are goals, not guaranteed benchmarks. Currency defaults to USD, uses CAD for Canadian dollars, and CNY for Chinese yuan/RMB. Country defaults to US.\n\nPC intent ontology:\n${intentKnowledge}\n\nExisting part IDs must only be used when the user names one of these known parts:\n${parts.map(p => `${p.id}: ${p.name}`).join("\n")}\n\nUser request:\n${query}`;
  const parsed = await generateModelJson<ParsedIntent>(prompt, schema, ai);
  const constraints = parsed ? validateLlmConstraints(parsed.constraints) : extractIntentConstraints(query);
  const semanticPatch = semanticRequestPatch(constraints);
  const mode = parsed ? (ai.model.startsWith("deepseek-") ? "deepseek" : "gemini") : "heuristic";
  return { request: { ...normalize(parsed || fallback, fallback), ...semanticPatch, constraints }, mode, summary: parsed?.summary || fallback.summary || "Intent parsed." };
}
