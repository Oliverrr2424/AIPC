import type { BuildRequest } from "@/types/build";
import type { BuildParts } from "@/types/parts";
import type { PerformanceEstimate } from "@/types/performance";
const tier=(v:number):"Entry"|"Good"|"High"|"Ultra"=>v>=92?"Ultra":v>=78?"High":v>=60?"Good":"Entry";
export function estimatePerformance(parts:BuildParts,request:BuildRequest):PerformanceEstimate{
 const r=request.resolution||"1440p", gpuScore=r==="4k"?parts.gpu.gamingScore4k:r==="1440p"?parts.gpu.gamingScore1440p:parts.gpu.gamingScore1080p;
 const combined=gpuScore*.78+parts.cpu.gamingScore*.22, v=parts.gpu.vramGb, mem=parts.ram.capacityGb;
 return {
  gaming:{resolution:r,estimatedFpsTier:tier(combined),explanation:`${parts.gpu.name} drives the ${r} tier while ${parts.cpu.name} keeps frame delivery balanced. This is a relative tier, not a benchmark claim.`},
  ai:{vramGb:v,localLlmTier:v>=24?"Large models":v>=16?"Medium models":"Small models",diffusionTier:v>=24?"Excellent":v>=12?"Good":"Basic",explanation:`${v}GB VRAM supports ${v>=24?"large local experiments":v>=16?"strong hobbyist workloads":"smaller models and image generation"}${parts.gpu.cuda?" with CUDA support":" without CUDA-specific acceleration"}.`},
  development:{multitaskingTier:mem>=64&&parts.cpu.cores>=8?"Excellent":mem>=32?"Good":"Basic",dockerTier:mem>=64?"Excellent":mem>=32?"Good":"Basic",explanation:`${parts.cpu.cores} CPU cores and ${mem}GB RAM define the available headroom for containers, builds, and local services.`},
  video:{editingTier:parts.cpu.productivityScore>=90&&mem>=64?"Excellent":parts.cpu.productivityScore>=75&&mem>=32?"Good":"Basic",explanation:"The tier combines CPU productivity, GPU capability, memory capacity, and NVMe storage speed."}
 };
}
