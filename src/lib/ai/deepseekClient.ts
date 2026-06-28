import type { AiGenerationOptions } from "@/types/ai";

interface DeepSeekMessage { content?: string; reasoning_content?: string }
interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}
interface DeepSeekResponse { choices?: Array<{ message?: DeepSeekMessage }>; usage?: DeepSeekUsage; error?: { message?: string } }

export interface DeepSeekChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekJsonResult<T> {
  data: T;
  raw: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
  };
}

async function requestDeepSeekMessages(messages: DeepSeekChatMessage[], options: AiGenerationOptions, json: boolean, maxTokens: number) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !options.model.startsWith("deepseek-")) return undefined;
  const thinking = options.thinking === "enabled";
  try {
    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model,
        messages,
        thinking: { type: thinking ? "enabled" : "disabled" },
        ...(thinking ? { reasoning_effort: "high" } : { temperature: 0.2 }),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return undefined;
    const result = await response.json() as DeepSeekResponse;
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) return undefined;
    const usage = result.usage ? {
      promptTokens: result.usage.prompt_tokens || 0,
      completionTokens: result.usage.completion_tokens || 0,
      cacheHitTokens: result.usage.prompt_cache_hit_tokens || 0,
      cacheMissTokens: result.usage.prompt_cache_miss_tokens || 0,
    } : undefined;
    return { content, usage };
  } catch {
    return undefined;
  }
}

async function requestDeepSeek(prompt: string, options: AiGenerationOptions, json = false) {
  const response = await requestDeepSeekMessages([
    { role: "system", content: json ? "Return only valid JSON. Do not wrap it in Markdown." : "Return the final answer only. Follow every factual constraint in the user prompt." },
    { role: "user", content: prompt },
  ], options, json, json ? 2200 : 1800);
  return response?.content;
}

export async function generateDeepSeekJsonFromMessages<T>(messages: DeepSeekChatMessage[], options: AiGenerationOptions): Promise<DeepSeekJsonResult<T> | undefined> {
  const response = await requestDeepSeekMessages(messages, options, true, 700);
  if (!response) return undefined;
  try {
    return { data: JSON.parse(response.content) as T, raw: response.content, usage: response.usage };
  } catch {
    return undefined;
  }
}

export async function generateDeepSeekTextFromMessages(messages: DeepSeekChatMessage[], options: AiGenerationOptions) {
  const response = await requestDeepSeekMessages(messages, options, false, 700);
  if (!response) return undefined;
  return { text: response.content, raw: response.content, usage: response.usage };
}

export async function generateDeepSeekJson<T>(prompt: string, schema: Record<string, unknown>, options: AiGenerationOptions): Promise<T | undefined> {
  const content = await requestDeepSeek(`${prompt}\n\nOutput JSON matching this JSON Schema:\n${JSON.stringify(schema)}`, options, true);
  if (!content) return undefined;
  try { return JSON.parse(content) as T; } catch { return undefined; }
}

export function generateDeepSeekText(prompt: string, options: AiGenerationOptions) {
  return requestDeepSeek(prompt, options, false);
}
