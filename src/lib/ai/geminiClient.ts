import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function generateGeminiJson<T>(prompt: string, schema: Record<string, unknown>, model = process.env.GEMINI_MODEL || "gemini-2.5-flash"): Promise<T | undefined> {
  const ai = getGeminiClient();
  if (!ai) return undefined;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        temperature: 0.1,
      },
    });
    if (!response.text) return undefined;
    return JSON.parse(response.text) as T;
  } catch {
    return undefined;
  }
}

export async function generateGeminiText(prompt: string, model = process.env.GEMINI_MODEL || "gemini-2.5-flash"): Promise<string | undefined> {
  const ai = getGeminiClient();
  if (!ai) return undefined;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { temperature: 0.25, maxOutputTokens: 1800 },
    });
    return response.text || undefined;
  } catch {
    return undefined;
  }
}
