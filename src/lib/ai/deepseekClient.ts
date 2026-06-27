import type { AiGenerationOptions } from "@/types/ai";

interface DeepSeekMessage { content?: string; reasoning_content?: string }
interface DeepSeekResponse { choices?: Array<{ message?: DeepSeekMessage }>; error?: { message?: string } }

async function requestDeepSeek(prompt: string, options: AiGenerationOptions, json = false) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !options.model.startsWith("deepseek-")) return undefined;
  const thinking = options.thinking === "enabled";
  try {
    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: json ? "Return only valid JSON. Do not wrap it in Markdown." : "Return the final answer only. Follow every factual constraint in the user prompt." },
          { role: "user", content: prompt },
        ],
        thinking: { type: thinking ? "enabled" : "disabled" },
        ...(thinking ? { reasoning_effort: "high" } : { temperature: 0.2 }),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        max_tokens: json ? 2200 : 1800,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return undefined;
    const data = await response.json() as DeepSeekResponse;
    return data.choices?.[0]?.message?.content?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function generateDeepSeekJson<T>(prompt: string, schema: Record<string, unknown>, options: AiGenerationOptions): Promise<T | undefined> {
  const content = await requestDeepSeek(`${prompt}\n\nOutput JSON matching this JSON Schema:\n${JSON.stringify(schema)}`, options, true);
  if (!content) return undefined;
  try { return JSON.parse(content) as T; } catch { return undefined; }
}

export function generateDeepSeekText(prompt: string, options: AiGenerationOptions) {
  return requestDeepSeek(prompt, options, false);
}
