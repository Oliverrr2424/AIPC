import fs from "node:fs/promises";
import path from "node:path";
import { parts } from "../src/data/parts";
import type { Part, PartCategory } from "../src/types/parts";
import { catalogIdentityIssue } from "../src/lib/catalog/catalogQuality";

type Finding = { severity: "error" | "warning"; rule: string; partId?: string; category?: PartCategory; message: string };
const findings: Finding[] = [];
const add = (severity: Finding["severity"], rule: string, part: Part | undefined, message: string) => findings.push({ severity, rule, partId: part?.id, category: part?.category, message });
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const inRange = (value: unknown, min: number, max: number) => finite(value) && Number(value) >= min && Number(value) <= max;
const normalizedName = (name: string) => name.toLowerCase().replace(/\b(open box|refurbished|renewed)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const seenIds = new Map<string, Part>();
const seenNames = new Map<string, Part>();

for (const part of parts) {
  if (seenIds.has(part.id)) add("error", "duplicate-id", part, `Duplicate ID also used by ${seenIds.get(part.id)?.name}`);
  else seenIds.set(part.id, part);
  const nameKey = `${part.category}:${normalizedName(part.name)}`;
  if (seenNames.has(nameKey)) add("warning", "duplicate-name", part, `Normalized name duplicates ${seenNames.get(nameKey)?.id}`);
  else seenNames.set(nameKey, part);

  if (!part.id || !part.name || !part.brand || !part.summary) add("error", "required-base-field", part, "Missing ID, name, brand, or summary");
  if (!inRange(part.price, 1, 20_000)) add("error", "price-range", part, `Implausible USD reference price ${part.price}`);
  if (!Array.isArray(part.tags)) add("error", "tags-array", part, "tags must be an array");
  if (part.id.startsWith("ca-") && (!part.productUrl || !part.specSourceUrl || !part.priceSourceUrl || !part.priceAsOf)) add("error", "ca-provenance", part, "CA item is missing URL or as-of provenance");

  const name = part.name.toLowerCase();
  if (["gaming desktop", "desktop computer", "gaming pc", "laptop", "notebook"].some(term => name.includes(term)) && ["cpu", "gpu"].includes(part.category)) add("error", "complete-system", part, "CPU/GPU catalog contains a complete computer");
  if (part.category === "ram" && /sodimm|so-dimm|rdimm|ecc/.test(name)) add("error", "non-desktop-memory", part, "Laptop/server memory entered desktop RAM catalog");
  if (part.category === "cooler" && /thermal paste|thermal compound|watch|mouse|ups|figure/.test(name)) add("error", "unrelated-cooler", part, "Non-cooler item entered cooler catalog");

  switch (part.category) {
    case "cpu":
      if (!inRange(part.cores, 2, 128) || !inRange(part.threads, part.cores, 256)) add("error", "cpu-core-thread-range", part, `${part.cores} cores / ${part.threads} threads`);
      if (!inRange(part.tdpWatts, 20, 500)) add("error", "cpu-power-range", part, `${part.tdpWatts}W`);
      if (part.baseClockGHz !== undefined && !inRange(part.baseClockGHz, 0.8, 6.5)) add("error", "cpu-base-clock", part, `${part.baseClockGHz}GHz`);
      if (part.boostClockGHz !== undefined && !inRange(part.boostClockGHz, 1.5, 7)) add("error", "cpu-boost-clock", part, `${part.boostClockGHz}GHz`);
      break;
    case "gpu":
      if (!inRange(part.vramGb, 2, 64)) add("error", "gpu-vram-range", part, `${part.vramGb}GB`);
      if (!inRange(part.tdpWatts, 30, 700)) add("error", "gpu-power-range", part, `${part.tdpWatts}W`);
      if (!inRange(part.lengthMm, 120, 500)) add("error", "gpu-length-range", part, `${part.lengthMm}mm`);
      break;
    case "motherboard":
      if (!inRange(part.maxMemoryGb, 32, 512)) add("error", "motherboard-memory-range", part, `${part.maxMemoryGb}GB`);
      if (!inRange(part.m2Slots, 1, 8)) add("error", "motherboard-m2-range", part, `${part.m2Slots} slots`);
      break;
    case "ram":
      if (!inRange(part.capacityGb, 8, 512)) add("error", "ram-capacity-range", part, `${part.capacityGb}GB`);
      if (!inRange(part.speedMt, 800, 10_000)) add("error", "ram-speed-range", part, `${part.speedMt}MT/s`);
      if (!inRange(part.sticks, 1, 8)) add("error", "ram-stick-range", part, `${part.sticks} sticks`);
      break;
    case "storage":
      if (!inRange(part.capacityTb, 0.1, 16)) add("error", "storage-capacity-range", part, `${part.capacityTb}TB`);
      if (part.readSpeedMb !== undefined && !inRange(part.readSpeedMb, 400, 20_000)) add("error", "storage-read-range", part, `${part.readSpeedMb}MB/s`);
      if (part.writeSpeedMb !== undefined && !inRange(part.writeSpeedMb, 300, 20_000)) add("error", "storage-write-range", part, `${part.writeSpeedMb}MB/s`);
      break;
    case "cooler":
      if (!part.supportedSockets.length) add("error", "cooler-sockets", part, "No supported socket recorded");
      if (!inRange(part.tdpRatingWatts, 60, 500)) add("error", "cooler-rating-range", part, `${part.tdpRatingWatts}W`);
      if (part.type === "air" && !inRange(part.heightMm, 30, 190)) add("error", "air-cooler-height", part, `${part.heightMm}mm`);
      break;
    case "psu":
      if (!inRange(part.wattage, 300, 2_000)) add("error", "psu-wattage-range", part, `${part.wattage}W`);
      break;
    case "case":
      if (!part.supportedMotherboardFormFactors.length) add("error", "case-form-factor", part, "No motherboard form factor recorded");
      if (!inRange(part.maxGpuLengthMm, 180, 600)) add("error", "case-gpu-clearance", part, `${part.maxGpuLengthMm}mm`);
      if (!inRange(part.maxCoolerHeightMm, 35, 250)) add("error", "case-cooler-clearance", part, `${part.maxCoolerHeightMm}mm`);
      break;
  }
}

const knownFacts: Array<{ pattern: RegExp; category: PartCategory; fields: Record<string, number> }> = [
  { pattern: /core ultra 7 (processor )?270k plus/i, category: "cpu", fields: { cores: 24, threads: 24, tdpWatts: 250 } },
  { pattern: /core ultra 5 (processor )?250k plus/i, category: "cpu", fields: { cores: 18, threads: 18, tdpWatts: 159 } },
  { pattern: /core ultra 9 (processor )?285k/i, category: "cpu", fields: { cores: 24, threads: 24, tdpWatts: 250 } },
  { pattern: /core ultra 7 (processor )?265k/i, category: "cpu", fields: { cores: 20, threads: 20, tdpWatts: 250 } },
  { pattern: /core ultra 5 (processor )?245k/i, category: "cpu", fields: { cores: 14, threads: 14, tdpWatts: 159 } },
  { pattern: /ryzen 9 9950x3d(?!2)/i, category: "cpu", fields: { cores: 16, threads: 32, tdpWatts: 170 } },
  { pattern: /rtx\s*5090(?:d|.*?dv2)/i, category: "gpu", fields: { vramGb: 24, tdpWatts: 575 } },
  { pattern: /rtx 5090/i, category: "gpu", fields: { vramGb: 32, tdpWatts: 575 } },
  { pattern: /rtx 5080/i, category: "gpu", fields: { vramGb: 16, tdpWatts: 360 } },
];
for (const fact of knownFacts) {
  for (const part of parts.filter(candidate => candidate.category === fact.category && fact.pattern.test(candidate.name))) {
    if (fact.fields.vramGb === 32 && /rtx\s*5090(?:d|.*?dv2)/i.test(part.name)) continue;
    for (const [field, expected] of Object.entries(fact.fields)) {
      const actual = (part as unknown as Record<string, unknown>)[field];
      if (actual !== expected) add("error", "known-model-fact", part, `${field}=${actual}; expected ${expected}`);
    }
  }
}

const categories: PartCategory[] = ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"];
const counts = Object.fromEntries(categories.map(category => [category, parts.filter(part => part.category === category).length]));
for (const [category, count] of Object.entries(counts)) if (count < 50) findings.push({ severity: "error", rule: "category-count", category: category as PartCategory, message: `${count} parts; target is at least 50` });
const compatibilityFields: Record<PartCategory, string[]> = {
  cpu: ["memoryTypes", "family"], gpu: ["thicknessSlots", "powerConnector"], motherboard: ["ramSlots", "supportedCpuFamilies"], ram: ["qvlMotherboardIds"],
  storage: ["nandType", "tbw", "warrantyYears"], cooler: ["supportedSockets", "radiatorSizeMm"], psu: ["lengthMm", "pcie8PinConnectors", "twelveV2x6Connectors"], case: ["maxGpuThicknessSlots", "supportedRadiatorSizesMm", "maxPsuLengthMm"],
};
const compatibilityFieldCoverage = Object.fromEntries(categories.map(category => {
  const categoryParts = parts.filter(part => part.category === category);
  const fields = Object.fromEntries(compatibilityFields[category].map(field => [field, categoryParts.filter(part => (part as unknown as Record<string, unknown>)[field] != null).length]));
  return [category, { total: categoryParts.length, fields }];
}));
const excludedFromRecommendation = parts.flatMap(part => {
  const issue = catalogIdentityIssue(part);
  return issue ? [{ partId: part.id, issue }] : [];
});

async function main() {
  const outputArg = process.argv.find(arg => arg.startsWith("--out="));
  const outputPath = path.resolve(outputArg?.slice(6) || "outputs/ca-crawl-20260629/field-audit.json");
  const errors = findings.filter(finding => finding.severity === "error");
  const warnings = findings.filter(finding => finding.severity === "warning");
  const report = { generatedAt: new Date().toISOString(), summary: { totalParts: parts.length, caParts: parts.filter(part => part.id.startsWith("ca-")).length, counts, excludedFromRecommendation: excludedFromRecommendation.length, compatibilityFieldCoverage, errors: errors.length, warnings: warnings.length }, excludedFromRecommendation, findings };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Saved ${outputPath}`);
  if (errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
