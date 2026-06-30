import type { BuildParts, Part } from "@/types/parts";
import type { CompatibilityResult, CompatibilityStatus } from "@/types/compatibility";

const result = (id: string, status: CompatibilityStatus, rule: string, message: string, relatedParts: string[]): CompatibilityResult => ({ id, status, rule, message, relatedParts });

export function estimateWattage(p: BuildParts) {
  return Math.round(p.cpu.tdpWatts + p.gpu.tdpWatts + 85 + (p.ram.capacityGb / 8) * 3 + p.storage.capacityTb * 5);
}

export function requiredPsuWattage(p: BuildParts) {
  return Math.ceil(estimateWattage(p) * 1.35 / 50) * 50;
}

function unknown(id: string, rule: string, message: string, relatedParts: Part[]) {
  return result(id, "UNKNOWN", rule, message, relatedParts.map(part => part.id));
}

function gpuPowerConnectorResult(p: BuildParts): CompatibilityResult {
  const connector = p.gpu.powerConnector;
  const related = [p.gpu.id, p.psu.id];
  if (!connector) return unknown("gpu-power-connector", "GPU power connector", "The GPU power-connector specification is missing. Verify the exact card and PSU cable set before purchase.", [p.gpu, p.psu]);

  if (connector === "12V-2x6" || connector === "12VHPWR") {
    if ((p.psu.twelveV2x6Connectors ?? 0) > 0) return result("gpu-power-connector", "PASS", "GPU power connector", `${p.psu.name} provides a native 16-pin high-power GPU connector for ${p.gpu.name}.`, related);
    if (p.psu.twelveV2x6Connectors == null && p.psu.pcie8PinConnectors == null) return unknown("gpu-power-connector", "GPU power connector", "The PSU cable inventory is missing, so native 12V-2x6/12VHPWR support cannot be verified.", [p.gpu, p.psu]);
    if ((p.psu.pcie8PinConnectors ?? 0) >= 3) return result("gpu-power-connector", "WARNING", "GPU power connector", `${p.gpu.name} requires a 16-pin high-power connection. ${p.psu.name} may require the GPU vendor's multi-8-pin adapter; verify the exact cable count and routing.`, related);
    return result("gpu-power-connector", "FAIL", "GPU power connector", `${p.psu.name} has no verified native 16-pin connector or sufficient PCIe 8-pin cable inventory for ${p.gpu.name}.`, related);
  }

  if (connector === "8-pin") {
    const needed = p.gpu.powerConnectorCount ?? 1;
    if (p.psu.pcie8PinConnectors == null) return unknown("gpu-power-connector", "GPU power connector", `The GPU needs ${needed} PCIe 8-pin connector(s), but the PSU cable inventory is missing.`, [p.gpu, p.psu]);
    return result("gpu-power-connector", p.psu.pcie8PinConnectors >= needed ? "PASS" : "FAIL", "GPU power connector", p.psu.pcie8PinConnectors >= needed ? `${p.psu.name} provides enough PCIe 8-pin connectors.` : `${p.gpu.name} needs ${needed} PCIe 8-pin connector(s), but ${p.psu.name} lists ${p.psu.pcie8PinConnectors}.`, related);
  }

  if (p.psu.pcie8PinConnectors == null) return unknown("gpu-power-connector", "GPU power connector", "The PSU cable inventory is missing, so the GPU auxiliary-power connection cannot be verified.", [p.gpu, p.psu]);
  return result("gpu-power-connector", p.psu.pcie8PinConnectors > 0 ? "PASS" : "FAIL", "GPU power connector", p.psu.pcie8PinConnectors > 0 ? `${p.psu.name} provides the required 6-pin-compatible PCIe cable.` : `${p.psu.name} has no listed PCIe auxiliary-power cable.`, related);
}

export function checkCompatibility(p: BuildParts): CompatibilityResult[] {
  const watts = estimateWattage(p);
  const required = requiredPsuWattage(p);
  const headroom = p.psu.wattage / watts;
  const cpuFamilyKnown = Boolean(p.cpu.family && p.motherboard.supportedCpuFamilies);
  const cpuFamilySupported = cpuFamilyKnown && p.motherboard.supportedCpuFamilies!.includes(p.cpu.family!);
  const qvlKnown = Array.isArray(p.ram.qvlMotherboardIds);

  const results: CompatibilityResult[] = [
    result("socket", p.cpu.socket === p.motherboard.socket ? "PASS" : "FAIL", "CPU socket", p.cpu.socket === p.motherboard.socket ? `${p.cpu.name} uses ${p.cpu.socket}, matching ${p.motherboard.name}.` : `${p.cpu.name} uses ${p.cpu.socket}, but ${p.motherboard.name} uses ${p.motherboard.socket}.`, [p.cpu.id, p.motherboard.id]),
    cpuFamilyKnown
      ? result("cpu-support", cpuFamilySupported ? "PASS" : "FAIL", "CPU generation / BIOS support", cpuFamilySupported ? `${p.motherboard.name} lists the ${p.cpu.family} CPU family as supported${p.motherboard.minimumBiosByCpuFamily?.[p.cpu.family!] ? ` from BIOS ${p.motherboard.minimumBiosByCpuFamily[p.cpu.family!]}` : ""}.` : `${p.motherboard.name} does not list the ${p.cpu.family} CPU family as supported.`, [p.cpu.id, p.motherboard.id])
      : unknown("cpu-support", "CPU generation / BIOS support", "Socket compatibility is known, but the board CPU-support list/minimum BIOS is not in the catalog. Verify the motherboard vendor's CPU QVL.", [p.cpu, p.motherboard]),
    result("memory", p.ram.memoryType === p.motherboard.memoryType ? "PASS" : "FAIL", "Memory type", p.ram.memoryType === p.motherboard.memoryType ? `${p.ram.memoryType} memory matches the motherboard.` : `${p.ram.memoryType} RAM cannot be used with a ${p.motherboard.memoryType} motherboard.`, [p.ram.id, p.motherboard.id]),
    p.cpu.memoryTypes?.length
      ? result("cpu-memory", p.cpu.memoryTypes.includes(p.ram.memoryType) ? "PASS" : "FAIL", "CPU memory controller", p.cpu.memoryTypes.includes(p.ram.memoryType) ? `${p.cpu.name} supports ${p.ram.memoryType} memory.` : `${p.cpu.name} does not support ${p.ram.memoryType} memory.`, [p.cpu.id, p.ram.id])
      : unknown("cpu-memory", "CPU memory controller", "The CPU's supported memory types are missing from the catalog.", [p.cpu, p.ram]),
    p.motherboard.ramSlots == null
      ? unknown("memory-slots", "Memory slot count", "The motherboard DIMM-slot count is missing, so this kit's stick count cannot be verified.", [p.ram, p.motherboard])
      : result("memory-slots", p.ram.sticks <= p.motherboard.ramSlots ? "PASS" : "FAIL", "Memory slot count", p.ram.sticks <= p.motherboard.ramSlots ? `${p.ram.sticks} DIMMs fit the board's ${p.motherboard.ramSlots} slots.` : `${p.ram.sticks} DIMMs exceed the board's ${p.motherboard.ramSlots} slots.`, [p.ram.id, p.motherboard.id]),
    result("memory-capacity", p.ram.capacityGb <= p.motherboard.maxMemoryGb ? "PASS" : "FAIL", "Memory capacity", p.ram.capacityGb <= p.motherboard.maxMemoryGb ? `${p.ram.capacityGb}GB is within the board's ${p.motherboard.maxMemoryGb}GB limit.` : `${p.ram.capacityGb}GB exceeds the board's ${p.motherboard.maxMemoryGb}GB limit.`, [p.ram.id, p.motherboard.id]),
    qvlKnown
      ? result("memory-qvl", p.ram.qvlMotherboardIds!.includes(p.motherboard.id) ? "PASS" : "WARNING", "Memory QVL", p.ram.qvlMotherboardIds!.includes(p.motherboard.id) ? `This exact memory kit is recorded on the motherboard QVL.` : `This exact memory kit is not recorded on the motherboard QVL; it may still work, but the rated profile is not verified.`, [p.ram.id, p.motherboard.id])
      : unknown("memory-qvl", "Memory QVL", "No exact kit-to-motherboard QVL record is stored. Verify the part number and rated XMP/EXPO profile on the board vendor's QVL.", [p.ram, p.motherboard]),
    result("form", p.case.supportedMotherboardFormFactors.includes(p.motherboard.formFactor) ? "PASS" : "FAIL", "Motherboard fit", p.case.supportedMotherboardFormFactors.includes(p.motherboard.formFactor) ? `${p.motherboard.formFactor} motherboard fits inside ${p.case.name}.` : `${p.case.name} does not support ${p.motherboard.formFactor} motherboards.`, [p.case.id, p.motherboard.id]),
    result("gpu-length", p.gpu.lengthMm <= p.case.maxGpuLengthMm ? "PASS" : "FAIL", "GPU length", p.gpu.lengthMm <= p.case.maxGpuLengthMm ? `${p.gpu.name} is ${p.gpu.lengthMm}mm and fits the ${p.case.maxGpuLengthMm}mm length limit.` : `GPU length ${p.gpu.lengthMm}mm exceeds the case maximum of ${p.case.maxGpuLengthMm}mm.`, [p.gpu.id, p.case.id]),
    p.gpu.thicknessSlots == null || p.case.maxGpuThicknessSlots == null
      ? unknown("gpu-thickness", "GPU thickness", "GPU slot thickness or the case thickness limit is missing. Verify side-panel, riser, and adjacent-slot clearance.", [p.gpu, p.case])
      : result("gpu-thickness", p.gpu.thicknessSlots <= p.case.maxGpuThicknessSlots ? "PASS" : "FAIL", "GPU thickness", p.gpu.thicknessSlots <= p.case.maxGpuThicknessSlots ? `${p.gpu.thicknessSlots}-slot GPU fits the case's ${p.case.maxGpuThicknessSlots}-slot limit.` : `${p.gpu.thicknessSlots}-slot GPU exceeds the case's ${p.case.maxGpuThicknessSlots}-slot limit.`, [p.gpu.id, p.case.id]),
    p.cooler.type === "aio"
      ? p.cooler.radiatorSizeMm == null || p.case.supportedRadiatorSizesMm == null
        ? unknown("cooler-clearance", "AIO radiator fit", "AIO radiator size or the case radiator-support list is missing. Do not assume that an AIO fits from air-cooler clearance alone.", [p.cooler, p.case])
        : result("cooler-clearance", p.case.supportedRadiatorSizesMm.includes(p.cooler.radiatorSizeMm) ? "PASS" : "FAIL", "AIO radiator fit", p.case.supportedRadiatorSizesMm.includes(p.cooler.radiatorSizeMm) ? `${p.case.name} lists support for the ${p.cooler.radiatorSizeMm}mm radiator size.` : `${p.case.name} does not list support for a ${p.cooler.radiatorSizeMm}mm radiator.`, [p.cooler.id, p.case.id])
      : p.cooler.heightMm == null
        ? unknown("cooler-clearance", "Air-cooler height", "The air-cooler height is missing, so side-panel clearance cannot be verified.", [p.cooler, p.case])
        : result("cooler-clearance", p.cooler.heightMm <= p.case.maxCoolerHeightMm ? "PASS" : "FAIL", "Air-cooler height", p.cooler.heightMm <= p.case.maxCoolerHeightMm ? `${p.cooler.name} fits with ${p.case.maxCoolerHeightMm - p.cooler.heightMm}mm clearance.` : `${p.cooler.name} exceeds the case's ${p.case.maxCoolerHeightMm}mm limit.`, [p.cooler.id, p.case.id]),
    p.cooler.supportedSockets.length
      ? result("cooler-socket", p.cooler.supportedSockets.includes(p.cpu.socket) ? "PASS" : "FAIL", "Cooler mounting socket", p.cooler.supportedSockets.includes(p.cpu.socket) ? `${p.cooler.name} lists mounting support for ${p.cpu.socket}.` : `${p.cooler.name} does not list a ${p.cpu.socket} mounting kit.`, [p.cooler.id, p.cpu.id])
      : unknown("cooler-socket", "Cooler mounting socket", "The cooler mounting-socket list is missing.", [p.cooler, p.cpu]),
    result("power", p.psu.wattage >= required ? (headroom < 1.5 ? "WARNING" : "PASS") : "FAIL", "Power headroom", p.psu.wattage >= required ? (headroom < 1.5 ? `Estimated draw is ${watts}W. ${p.psu.wattage}W meets the 1.35x floor, but upgrade margin is modest.` : `Estimated draw is ${watts}W. ${p.psu.wattage}W provides healthy headroom.`) : `Estimated draw is ${watts}W. At least ${required}W is required by the 1.35x rule.`, [p.psu.id, p.cpu.id, p.gpu.id]),
    result("psu-form", p.case.psuFormFactors.includes(p.psu.formFactor) ? "PASS" : "FAIL", "PSU form factor", p.case.psuFormFactors.includes(p.psu.formFactor) ? `${p.psu.formFactor} PSU is supported by ${p.case.name}.` : `${p.case.name} does not support ${p.psu.formFactor} power supplies.`, [p.psu.id, p.case.id]),
    p.psu.lengthMm == null || p.case.maxPsuLengthMm == null
      ? unknown("psu-length", "PSU length", "PSU length or the case PSU-length limit is missing. Verify cable and drive-cage clearance.", [p.psu, p.case])
      : result("psu-length", p.psu.lengthMm <= p.case.maxPsuLengthMm ? "PASS" : "FAIL", "PSU length", p.psu.lengthMm <= p.case.maxPsuLengthMm ? `${p.psu.lengthMm}mm PSU fits the ${p.case.maxPsuLengthMm}mm limit.` : `${p.psu.lengthMm}mm PSU exceeds the case's ${p.case.maxPsuLengthMm}mm limit.`, [p.psu.id, p.case.id]),
    result("cooling", p.cooler.tdpRatingWatts >= p.cpu.tdpWatts ? "PASS" : "FAIL", "Cooling capacity", p.cooler.tdpRatingWatts >= p.cpu.tdpWatts ? `${p.cooler.tdpRatingWatts}W catalog rating covers the CPU's ${p.cpu.tdpWatts}W rating; vendor ratings are not standardized.` : `Cooler rating is below the CPU's ${p.cpu.tdpWatts}W requirement.`, [p.cooler.id, p.cpu.id]),
    result("chipset", p.motherboard.cpuTiers.includes(p.cpu.tier) ? "PASS" : "WARNING", "Chipset pairing", p.motherboard.cpuTiers.includes(p.cpu.tier) ? `${p.motherboard.chipset} is a sensible match for this ${p.cpu.tier}-tier CPU.` : `${p.motherboard.chipset} may constrain a ${p.cpu.tier}-tier CPU. Consider a higher-tier board.`, [p.motherboard.id, p.cpu.id]),
    result("storage", p.motherboard.storageInterfaces.includes(p.storage.interface) ? "PASS" : "FAIL", "Storage interface", p.motherboard.storageInterfaces.includes(p.storage.interface) ? `${p.storage.interface} storage is supported by the motherboard.` : `Motherboard does not support ${p.storage.interface} storage.`, [p.storage.id, p.motherboard.id]),
  ];

  results.splice(results.findIndex(item => item.id === "power") + 1, 0, gpuPowerConnectorResult(p));
  return results;
}

/** Shared, fail-only feasibility check for partial optimizer states. Unknown data
 * is deliberately allowed and is scored later as a confidence penalty. */
export function hasKnownCompatibilityFailure(b: Partial<BuildParts>): boolean {
  const { cpu, gpu, motherboard, ram, storage, cooler, psu } = b;
  const pc = b.case;
  if (cpu && motherboard && cpu.socket !== motherboard.socket) return true;
  if (cpu?.family && motherboard?.supportedCpuFamilies && !motherboard.supportedCpuFamilies.includes(cpu.family)) return true;
  if (ram && motherboard && ram.memoryType !== motherboard.memoryType) return true;
  if (ram && cpu?.memoryTypes?.length && !cpu.memoryTypes.includes(ram.memoryType)) return true;
  if (ram && motherboard && ram.capacityGb > motherboard.maxMemoryGb) return true;
  if (ram && motherboard?.ramSlots != null && ram.sticks > motherboard.ramSlots) return true;
  if (pc && motherboard && !pc.supportedMotherboardFormFactors.includes(motherboard.formFactor)) return true;
  if (gpu && pc && gpu.lengthMm > pc.maxGpuLengthMm) return true;
  if (gpu?.thicknessSlots != null && pc?.maxGpuThicknessSlots != null && gpu.thicknessSlots > pc.maxGpuThicknessSlots) return true;
  if (cooler && pc && cooler.type === "air" && cooler.heightMm != null && cooler.heightMm > pc.maxCoolerHeightMm) return true;
  if (cooler?.type === "aio" && cooler.radiatorSizeMm != null && pc?.supportedRadiatorSizesMm && !pc.supportedRadiatorSizesMm.includes(cooler.radiatorSizeMm)) return true;
  if (cooler && cpu && (cooler.supportedSockets.length > 0 && !cooler.supportedSockets.includes(cpu.socket))) return true;
  if (cooler && cpu && cooler.tdpRatingWatts < cpu.tdpWatts) return true;
  if (storage && motherboard && !motherboard.storageInterfaces.includes(storage.interface)) return true;
  if (pc && psu && !pc.psuFormFactors.includes(psu.formFactor)) return true;
  if (pc?.maxPsuLengthMm != null && psu?.lengthMm != null && psu.lengthMm > pc.maxPsuLengthMm) return true;
  if (psu && cpu && gpu && ram && storage && pc && psu.wattage < requiredPsuWattage(b as BuildParts)) return true;
  return false;
}
