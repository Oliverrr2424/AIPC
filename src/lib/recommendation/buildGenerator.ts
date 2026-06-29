import { parts as catalog } from "@/data/parts";
import type { AlternativePart, BuildRecommendation, BuildRequest } from "@/types/build";
import type { BuildParts, Part } from "@/types/parts";
import { allocations } from "./budgetAllocation";
import { priceIn } from "@/lib/pricing/priceEstimator";
import { getMarketSignals, marketRegion, summarizeBuildMarket, withMarketPrice } from "@/lib/pricing/marketSignals";
import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { generateExplanation } from "@/lib/ai/explanationService";

const inBudget=<T extends Part>(items:T[],target:number,currency:BuildRequest["currency"],score:(x:T)=>number)=>[...items].sort((a,b)=>score(b)-score(a)).find(x=>priceIn(x,currency)<=target*1.28)||[...items].sort((a,b)=>priceIn(a,currency)-priceIn(b,currency))[0];
const existing=<T extends Part>(r:BuildRequest,category:T["category"],items:T[])=>(r.existingPartIds||[]).map(id=>items.find(part=>part.id===id)).find(p=>p?.category===category) as T|undefined;
export async function generateBuild(request:BuildRequest):Promise<BuildRecommendation>{
 const marketSignals=await getMarketSignals(catalog,request.country),marketCatalog=catalog.map(part=>withMarketPrice(part,marketSignals.get(part.id)));
 const cpus=marketCatalog.filter((part):part is BuildParts["cpu"]=>part.category==="cpu"),gpus=marketCatalog.filter((part):part is BuildParts["gpu"]=>part.category==="gpu"),motherboards=marketCatalog.filter((part):part is BuildParts["motherboard"]=>part.category==="motherboard"),rams=marketCatalog.filter((part):part is BuildParts["ram"]=>part.category==="ram"),storages=marketCatalog.filter((part):part is BuildParts["storage"]=>part.category==="storage"),coolers=marketCatalog.filter((part):part is BuildParts["cooler"]=>part.category==="cooler"),psus=marketCatalog.filter((part):part is BuildParts["psu"]=>part.category==="psu"),cases=marketCatalog.filter((part):part is BuildParts["case"]=>part.category==="case");
 const a=allocations[request.useCase], budget=request.budget, c=request.currency;
 const gpuScore=(g:(typeof gpus)[number])=>{const gaming=request.resolution==="4k"?g.gamingScore4k:request.resolution==="1080p"?g.gamingScore1080p:g.gamingScore1440p; const workload=request.useCase==="ai"?g.aiScore*1.25+(g.cuda?18:0)+(g.vramGb>=(request.vramPreference||12)?16:-18):gaming; const brand=request.preferredGpuBrand&&request.preferredGpuBrand!=="none"?(g.brand.toLowerCase()===request.preferredGpuBrand?12:-9):0; return workload+brand+(workload/(priceIn(g,c)/100));};
 const gpu=existing<typeof gpus[number]>(request,"gpu",gpus)||inBudget(gpus,budget*a.gpu,c,gpuScore);
 const cpuScore=(x:(typeof cpus)[number])=>(request.useCase==="gaming"?x.gamingScore:x.productivityScore)+(request.preferLowPower?-x.tdpWatts/12:0);
 const cpu=existing<typeof cpus[number]>(request,"cpu",cpus)||inBudget(cpus,budget*a.cpu,c,cpuScore);
 const boardPool=motherboards.filter(x=>x.socket===cpu.socket&&(request.preferSmallFormFactor?x.formFactor==="Mini-ITX":x.formFactor!=="Mini-ITX"));
 const motherboard=existing<typeof motherboards[number]>(request,"motherboard",motherboards)||inBudget(boardPool.length?boardPool:motherboards,budget*a.motherboard,c,x=>x.m2Slots*10+(x.cpuTiers.includes(cpu.tier)?30:0)+(request.preferUpgradeability?x.maxMemoryGb/8:0));
 const ramNeed=request.useCase==="ai"||request.useCase==="development"||request.useCase==="video"?64:32;
 const ram=existing<typeof rams[number]>(request,"ram",rams)||inBudget(rams,budget*a.ram,c,x=>Math.min(x.capacityGb,ramNeed)*2+x.speedMt/500-(x.capacityGb>ramNeed*2?30:0));
 const storage=existing<typeof storages[number]>(request,"storage",storages)||inBudget(storages,budget*a.storage,c,x=>x.capacityTb*25+(x.readSpeedMb||0)/500);
 const casePool=cases.filter(x=>x.supportedMotherboardFormFactors.includes(motherboard.formFactor)&&x.maxGpuLengthMm>=gpu.lengthMm&&(request.preferSmallFormFactor?x.supportedMotherboardFormFactors.length===1&&x.supportedMotherboardFormFactors[0]==="Mini-ITX":x.supportedMotherboardFormFactors.length>1));
 const pcCase=existing<typeof cases[number]>(request,"case",cases)||inBudget(casePool.length?casePool:cases,budget*a.case,c,x=>x.maxGpuLengthMm/20+x.maxCoolerHeightMm/20);
 const coolerPool=coolers.filter(x=>x.supportedSockets.includes(cpu.socket)&&x.tdpRatingWatts>=cpu.tdpWatts&&(x.type==="aio"||!x.heightMm||x.heightMm<=pcCase.maxCoolerHeightMm));
 const cooler=existing<typeof coolers[number]>(request,"cooler",coolers)||inBudget(coolerPool.length?coolerPool:coolers,budget*a.cooler,c,x=>x.tdpRatingWatts/5+(request.preferQuiet&&x.type==="air"?16:0));
 const partial={cpu,gpu,motherboard,ram,storage,cooler,case:pcCase};
 const load=Math.round(cpu.tdpWatts+gpu.tdpWatts+85+(ram.capacityGb/8)*3+storage.capacityTb*5), needed=Math.ceil(load*1.35/50)*50;
 const psuPool=psus.filter(x=>x.wattage>=needed&&pcCase.psuFormFactors.includes(x.formFactor));
 const psu=existing<typeof psus[number]>(request,"psu",psus)||[...psuPool].sort((x,y)=>x.wattage-y.wattage)[0]||psus[psus.length-1];
 const parts:BuildParts={...partial,psu};
 let totalPrice=Object.values(parts).reduce((sum,p)=>sum+priceIn(p,c),0);
 // Trim optional capacity before core performance when an estimate exceeds budget.
 if(totalPrice>budget){const cheaperStorage=[...storages].filter(x=>priceIn(x,c)<priceIn(parts.storage,c)).sort((x,y)=>priceIn(y,c)-priceIn(x,c))[0]; if(cheaperStorage){parts.storage=cheaperStorage; totalPrice=Object.values(parts).reduce((s,p)=>s+priceIn(p,c),0)}}
 if(totalPrice>budget){const cheaperRam=[...rams].filter(x=>priceIn(x,c)<priceIn(parts.ram,c)).sort((x,y)=>priceIn(y,c)-priceIn(x,c))[0]; if(cheaperRam){parts.ram=cheaperRam; totalPrice=Object.values(parts).reduce((s,p)=>s+priceIn(p,c),0)}}
 const compatibility=checkCompatibility(parts), performance=await estimatePerformance(parts,request), estimatedWattage=estimateWattage(parts);
 const alt=(category:"cpu"|"gpu"|"ram"|"storage",pool:Part[]):AlternativePart|undefined=>{const current=parts[category]; const option=[...pool].filter(x=>x.id!==current.id).sort((x,y)=>Math.abs(priceIn(x,c)-priceIn(current,c))-Math.abs(priceIn(y,c)-priceIn(current,c))).find(x=>priceIn(x,c)>priceIn(current,c)); return option?{category,current,alternative:option,priceDifference:priceIn(option,c)-priceIn(current,c),label:"Performance upgrade",reason:`More ${category==="gpu"?"graphics and compute":"workload"} headroom if the budget can stretch.`}:undefined};
 const alternatives=[alt("gpu",gpus),alt("cpu",cpus.filter(x=>x.socket===motherboard.socket)),alt("ram",rams),alt("storage",storages)].filter(Boolean) as AlternativePart[];
 const id=`build-${Date.now().toString(36)}`; const title=request.useCase==="ai"?"Local AI Workstation":request.useCase==="gaming"?`${request.resolution==="4k"?"4K":request.resolution||"1440p"} Gaming Build`:request.useCase==="development"?"Developer Workstation":request.useCase==="video"?"Creator Workstation":"Balanced Performance Build";
 const raw={id,title,request,parts,totalPrice,estimatedWattage,compatibility,performance,alternatives,generatedAt:new Date().toISOString(),market:summarizeBuildMarket(Object.values(parts),marketSignals,marketRegion(request.country))};
 return {...raw,explanation:await generateExplanation(raw)};
}
