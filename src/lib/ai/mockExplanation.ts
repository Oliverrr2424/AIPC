import type { BuildRecommendation } from "@/types/build";
export function mockExplanation(b:Omit<BuildRecommendation,"explanation">){
 const {parts:p,request:r}=b; const issues=b.compatibility.filter(x=>x.status!=="PASS");
 return `## Summary\n${b.title} allocates the budget toward ${r.useCase==="ai"?"GPU memory and CUDA throughput":r.useCase==="gaming"?"graphics performance":"CPU, memory, and fast storage"}, pairing ${p.cpu.name} with ${p.gpu.name}.\n\n## Trade-offs\nThe build favors measurable workload performance over cosmetic upgrades.${issues.length?` ${issues.map(w=>w.message).join(" ")}`:" All deterministic compatibility rules passed."} Pricing is an estimate, so local availability may shift which alternative offers the best value.\n\n## Upgrade path\nThe most useful next upgrade is usually ${r.useCase==="ai"?"a GPU with more VRAM":"the GPU"}, followed by memory or storage. The selected platform keeps those changes straightforward.`;
}
