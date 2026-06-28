import type { BuildParts, Currency, Part, PartCategory } from "./parts";
import type { CompatibilityResult } from "./compatibility";
import type { PerformanceEstimate } from "./performance";
export type UseCase = "gaming"|"ai"|"development"|"video"|"balanced";
export type ConstraintStrength = "required"|"preferred"|"excluded";
export type ConstraintTarget = "cpuBrand"|"gpuBrand"|"color"|"lighting"|"cooling"|"caseStyle"|"noise"|"formFactor"|"upgradeability"|"workloadTarget";
export interface InterpretedConstraint { id:string; target:ConstraintTarget; value:string; strength:ConstraintStrength; sourceText:string; interpretation:string; origin?:"llm"|"fallback" }
export interface BuildRequest { budget:number; currency:Currency; country:"Canada"|"US"|"China"; useCase:UseCase; resolution?:"1080p"|"1440p"|"4k"; targetFps?:60|120|144|240; games?:string; aiWorkloads?:string[]; vramPreference?:12|16|24|32; ramCapacityGb?:number; storageCapacityTb?:number; developerWorkloads?:string[]; preferredCpuBrand?:"intel"|"amd"|"none"; preferredGpuBrand?:"nvidia"|"amd"|"intel"|"none"; preferredColor?:"white"|"black"|"none"; preferredCooling?:"air"|"aio"|"none"; preferredCaseStyle?:"panoramic"|"traditional"|"none"; preferQuiet?:boolean; preferRgb?:boolean; preferSmallFormFactor?:boolean; preferUpgradeability?:boolean; preferLowPower?:boolean; existingPartIds?:string[]; constraints?:InterpretedConstraint[] }
export interface AlternativePart { category:PartCategory; current:Part; alternative:Part; priceDifference:number; label:string; reason:string }
export interface BuildRecommendation { id:string; title:string; request:BuildRequest; parts:BuildParts; totalPrice:number; estimatedWattage:number; compatibility:CompatibilityResult[]; performance:PerformanceEstimate; explanation:string; alternatives:AlternativePart[]; generatedAt:string }
