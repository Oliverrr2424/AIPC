import type { BuildRecommendation } from "@/types/build";
import { mockExplanation } from "./mockExplanation";

const SYSTEM_PROMPT =
  "You are a PC hardware expert. The part-level rationale is already shown elsewhere to the user, so do NOT repeat per-part explanations. " +
  "Output ONLY three short Markdown sections with these exact headings: ## Summary, ## Trade-offs, ## Upgrade path. " +
  "Keep each section to 1-3 concise sentences. No bullet lists, no per-part breakdowns, no invented specs, prices, or benchmarks. Professional and brief.";

export async function generateExplanation(build: Omit<BuildRecommendation, "explanation">) {
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!key) return mockExplanation(build);
  const base = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const payload = {
    title: build.title,
    useCase: build.request.useCase,
    budget: build.request.budget,
    currency: build.request.currency,
    totalPrice: build.totalPrice,
    estimatedWattage: build.estimatedWattage,
    compatibility: build.compatibility.map(c => c.status),
  };
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) throw new Error("AI provider error");
    const data = await response.json();
    return data.choices?.[0]?.message?.content || mockExplanation(build);
  } catch {
    return mockExplanation(build);
  }
}
