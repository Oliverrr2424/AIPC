export type PartCategory = "cpu"|"gpu"|"motherboard"|"ram"|"storage"|"cooler"|"psu"|"case";
export type Currency = "CAD"|"CNY"|"USD";
export interface BasePart { id:string; category:PartCategory; name:string; brand:string; price:number; currency:Currency; imageUrl?:string; productUrl?:string; tags:string[]; summary:string }
export interface CpuPart extends BasePart { category:"cpu"; socket:string; cores:number; threads:number; baseClockGHz?:number; boostClockGHz?:number; tdpWatts:number; gamingScore:number; productivityScore:number; tier:"entry"|"mid"|"high"|"enthusiast" }
export interface GpuPart extends BasePart { category:"gpu"; chipset:string; vramGb:number; tdpWatts:number; lengthMm:number; gamingScore1080p:number; gamingScore1440p:number; gamingScore4k:number; aiScore:number; cuda:boolean }
export interface MotherboardPart extends BasePart { category:"motherboard"; socket:string; chipset:string; formFactor:"ATX"|"Micro-ATX"|"Mini-ITX"; memoryType:"DDR4"|"DDR5"; maxMemoryGb:number; m2Slots:number; storageInterfaces:("NVMe"|"SATA")[]; cpuTiers:("entry"|"mid"|"high"|"enthusiast")[] }
export interface RamPart extends BasePart { category:"ram"; memoryType:"DDR4"|"DDR5"; capacityGb:number; speedMt:number; sticks:number }
export interface StoragePart extends BasePart { category:"storage"; capacityTb:number; interface:"NVMe"|"SATA"; readSpeedMb?:number; writeSpeedMb?:number }
export interface CoolerPart extends BasePart { category:"cooler"; supportedSockets:string[]; tdpRatingWatts:number; heightMm?:number; type:"air"|"aio" }
export interface PsuPart extends BasePart { category:"psu"; wattage:number; efficiency:"Bronze"|"Gold"|"Platinum"|"Titanium"; formFactor:"ATX"|"SFX"; modular:boolean }
export interface CasePart extends BasePart { category:"case"; supportedMotherboardFormFactors:("ATX"|"Micro-ATX"|"Mini-ITX")[]; maxGpuLengthMm:number; maxCoolerHeightMm:number; psuFormFactors:("ATX"|"SFX")[] }
export type Part = CpuPart|GpuPart|MotherboardPart|RamPart|StoragePart|CoolerPart|PsuPart|CasePart;
export type BuildParts = { cpu:CpuPart; gpu:GpuPart; motherboard:MotherboardPart; ram:RamPart; storage:StoragePart; cooler:CoolerPart; psu:PsuPart; case:CasePart };
