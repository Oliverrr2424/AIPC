export const AI_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek", description: "Fast default for intent parsing and explanations" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", description: "Higher-quality reasoning for complex briefs" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", description: "Google Gemini option" },
] as const;

export type AiModelId = typeof AI_MODELS[number]["id"];
export type ThinkingMode = "enabled" | "disabled";

export interface AiGenerationOptions {
  model: AiModelId;
  thinking: ThinkingMode;
}

export const DEFAULT_AI_OPTIONS: AiGenerationOptions = { model: "deepseek-v4-flash", thinking: "disabled" };

export function isAiModelId(value: unknown): value is AiModelId {
  return typeof value === "string" && AI_MODELS.some(model => model.id === value);
}
