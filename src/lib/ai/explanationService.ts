import type { BuildRecommendation } from "@/types/build";
import { mockExplanation } from "./mockExplanation";
export async function generateExplanation(build:Omit<BuildRecommendation,"explanation">){
 const key=process.env.OPENAI_API_KEY||process.env.DEEPSEEK_API_KEY; if(!key) return mockExplanation(build);
 const base=process.env.AI_BASE_URL||"https://api.openai.com/v1"; const model=process.env.AI_MODEL||"gpt-4o-mini";
 try{const response=await fetch(`${base}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model,temperature:.25,messages:[{role:"system",content:"You are a PC hardware expert. Explain only the structured build provided. Do not invent parts, prices, or benchmark figures. Use headings: Build summary, Why it fits, Major trade-offs, Compatibility notes, Upgrade path."},{role:"user",content:JSON.stringify(build)}]})}); if(!response.ok) throw new Error("AI provider error"); const data=await response.json(); return data.choices?.[0]?.message?.content||mockExplanation(build)}catch{return mockExplanation(build)}
}
