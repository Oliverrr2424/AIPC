import type { AiGenerationOptions } from "@/types/ai";
import { generateDeepSeekJson, generateDeepSeekText } from "./deepseekClient";
import { generateGeminiJson, generateGeminiText } from "./geminiClient";

export async function generateModelJson<T>(prompt: string, schema: Record<string, unknown>, options: AiGenerationOptions) {
  return options.model.startsWith("deepseek-")
    ? generateDeepSeekJson<T>(prompt, schema, options)
    : generateGeminiJson<T>(prompt, schema, options.model);
}

export async function generateModelText(prompt: string, options: AiGenerationOptions) {
  return options.model.startsWith("deepseek-")
    ? generateDeepSeekText(prompt, options)
    : generateGeminiText(prompt, options.model);
}
