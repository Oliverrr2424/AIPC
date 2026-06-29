#!/usr/bin/env node
// Build a licensed, reproducible catalog supplement from the Hugging Face
// Dataset Viewer API. The source dataset is MIT-licensed and contains real
// PCPartPicker SKUs/specifications. This script does not scrape retailer HTML.

import fs from "node:fs/promises";
import path from "node:path";

const DATASET = "Doshiba/pcpartpicker-parts-dataset";
const API = "https://datasets-server.huggingface.co";
const DEFAULT_TARGET = 50;
const DEFAULT_OUTPUT = "src/data/crawledParts.json";
const DEFAULT_REPORT = "outputs/catalog-crawl-report.json";

const definitions = [
  { source: "cpu", app: "cpu", array: "cpus", ctor: "cpu" },
  { source: "video-card", app: "gpu", array: "gpus", ctor: "gpu" },
  { source: "motherboard", app: "motherboard", array: "motherboards", ctor: "mb" },
  { source: "memory", app: "ram", array: "rams", ctor: "ram" },
  { source: "internal-hard-drive", app: "storage", array: "storages", ctor: "storage" },
  { source: "cpu-cooler", app: "cooler", array: "coolers", ctor: "cooler" },
  { source: "power-supply", app: "psu", array: "psus", ctor: "psu" },
  { source: "case", app: "case", array: "cases", ctor: "pcCase" },
];

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1]] : []).filter(Boolean));
const target = Number(args.target || DEFAULT_TARGET);
const outputPath = path.resolve(String(args.output || DEFAULT_OUTPUT));
const reportPath = path.resolve(String(args.report || DEFAULT_REPORT));

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const text = value => value == null ? "" : String(value).trim();
const number = value => {
  const match = text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};
const slug = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const normalizedName = value => text(value).toLowerCase().replace(/\b(amd|intel|nvidia|asus|msi|gigabyte)\b/g, "").replace(/[^a-z0-9]+/g, "");
const spec = (row, ...keys) => {
  const specs = row.specs && typeof row.specs === "object" ? row.specs : {};
  for (const key of keys) {
    const entry = Object.entries(specs).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (entry && text(entry[1])) return text(entry[1]);
  }
  return "";
};
const includesAny = (value, terms) => terms.some(term => value.toLowerCase().includes(term));

function socketFrom(row) {
  const explicit = spec(row, "Socket / CPU", "Socket", "CPU Socket").toUpperCase().replace(/SOCKET\s*/g, "");
  if (explicit) return explicit.replace(/\s+/g, "");
  const name = row.name.toUpperCase();
  const chipset = spec(row, "Chipset").toUpperCase();
  if (/RYZEN\s+[3579]\s+[789]\d{3}|RYZEN\s+[3579]\s+8\d{3}/.test(name) || /A620|B650|B850|X670|X870/.test(chipset)) return "AM5";
  if (/RYZEN|ATHLON/.test(name) || /A320|B350|B450|B550|X370|X470|X570/.test(chipset)) return "AM4";
  if (/CORE ULTRA\s+[3579]\s+2\d{2}|Z890|B860|H810/.test(`${name} ${chipset}`)) return "LGA1851";
  if (/CORE I[3579]-1[234]\d{3}|Z690|Z790|B660|B760|H610|H670|H770/.test(`${name} ${chipset}`)) return "LGA1700";
  if (/CORE I[3579]-1[01]\d{3}|Z490|Z590|B460|B560|H410|H510/.test(`${name} ${chipset}`)) return "LGA1200";
  return "LGA1700";
}

function formFactor(value) {
  const input = value.toLowerCase();
  if (input.includes("mini itx") || input.includes("mini-itx")) return "Mini-ITX";
  if (input.includes("micro atx") || input.includes("micro-atx") || input.includes("matx")) return "Micro-ATX";
  return "ATX";
}

function sourceMeta(row, priceUsd, runDate) {
  return {
    id: `hf-${row.category}-${row.source_id || row.product_tag || slug(row.name)}`,
    name: text(row.name),
    brand: text(row.brand) || text(row.name).split(/\s+/)[0] || "Unknown",
    price: round(priceUsd),
    currency: "USD",
    imageUrl: text(row.image_url) || undefined,
    productUrl: text(row.url) || undefined,
    specSourceUrl: text(row.url) || undefined,
    priceSourceUrl: text(row.url) || undefined,
    priceKind: "reference",
    priceAsOf: runDate,
  };
}

function mapCpu(row, base) {
  const cores = number(spec(row, "Core Count")) || 4;
  const baseClockGHz = number(spec(row, "Performance Core Clock", "Core Clock"));
  const boostClockGHz = number(spec(row, "Performance Core Boost Clock", "Boost Clock"));
  const tdpWatts = number(spec(row, "TDP")) || 65;
  const tier = cores >= 16 || base.price >= 500 ? "enthusiast" : cores >= 10 || base.price >= 300 ? "high" : cores >= 6 ? "mid" : "entry";
  const gamingScore = Math.round(clamp(35 + (boostClockGHz || baseClockGHz || 3.5) * 9 + Math.log2(Math.max(2, cores)) * 5));
  const productivityScore = Math.round(clamp(28 + cores * 3.4 + (boostClockGHz || 4) * 3));
  return { ...base, category: "cpu", socket: socketFrom(row), cores, threads: cores * 2, baseClockGHz, boostClockGHz, tdpWatts, gamingScore, productivityScore, tier, tags: [socketFrom(row), tier, "dataset"], summary: `${cores}-core desktop processor with source-linked specifications; thread count and relative scores are derived for ranking.` };
}

function mapGpu(row, base) {
  const chipset = spec(row, "Chipset") || base.name.replace(/^(ASUS|MSI|Gigabyte|Zotac|Sapphire|PowerColor|XFX)\s+/i, "");
  const vramGb = number(spec(row, "Memory", "Memory Size")) || number(base.name.match(/\d+\s*GB/i)?.[0]) || 8;
  const tdpWatts = number(spec(row, "TDP", "Thermal Design Power")) || Math.round(clamp(base.price * 0.28, 75, 500));
  const lengthMm = number(spec(row, "Length")) || 280;
  const priceScore = clamp(28 + Math.sqrt(Math.max(1, base.price)) * 2.15);
  const cuda = /NVIDIA|GEFORCE|RTX|GTX/i.test(`${base.brand} ${chipset}`);
  return { ...base, category: "gpu", chipset, vramGb, tdpWatts, lengthMm, gamingScore1080p: Math.round(clamp(priceScore + 8)), gamingScore1440p: Math.round(priceScore), gamingScore4k: Math.round(clamp(priceScore - 12)), aiScore: Math.round(clamp(priceScore * 0.65 + vramGb * 1.8 + (cuda ? 12 : 0))), cuda, tags: [`${vramGb}GB`, cuda ? "CUDA" : "raster", "dataset"], summary: `${vramGb}GB graphics card; physical specifications are source-linked and relative workload scores are derived for ranking.` };
}

function mapMotherboard(row, base) {
  const socket = socketFrom(row);
  const chipset = spec(row, "Chipset") || base.name.match(/(?:A|B|H|Q|W|X|Z)\d{3}[A-Z]?/i)?.[0]?.toUpperCase() || "Unknown";
  const ff = formFactor(spec(row, "Form Factor") || base.name);
  const memoryType = /DDR4/i.test(spec(row, "Memory Type", "Memory") + base.name) ? "DDR4" : "DDR5";
  const maxMemoryGb = number(spec(row, "Memory Max", "Maximum Memory")) || 128;
  const m2Slots = number(spec(row, "M.2 Slots", "M.2 Ports")) || 2;
  const tiers = /X\d70|Z\d90/i.test(chipset) ? ["mid", "high", "enthusiast"] : ["entry", "mid", "high"];
  return { ...base, category: "motherboard", socket, chipset, formFactor: ff, memoryType, maxMemoryGb, m2Slots, storageInterfaces: ["NVMe", "SATA"], cpuTiers: tiers, tags: [socket, chipset, ff, memoryType, "dataset"], summary: `${ff} ${chipset} motherboard for ${socket} with ${m2Slots} derived/declared M.2 slots.` };
}

function mapRam(row, base) {
  const modules = spec(row, "Modules");
  const moduleMatch = modules.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*GB/i);
  const sticks = moduleMatch ? Number(moduleMatch[1]) : 2;
  const capacityGb = moduleMatch ? Number(moduleMatch[1]) * Number(moduleMatch[2]) : number(spec(row, "Capacity")) || number(base.name.match(/\d+\s*GB/i)?.[0]) || 16;
  const speedRaw = spec(row, "Speed") || base.name;
  const speedMt = number(speedRaw.match(/(?:DDR[45][ -]?)?(\d{4,5})/i)?.[1]) || 3200;
  const memoryType = /DDR5/i.test(speedRaw + base.name) || speedMt >= 4800 ? "DDR5" : "DDR4";
  return { ...base, category: "ram", memoryType, capacityGb, speedMt, sticks, tags: [memoryType, `${capacityGb}GB`, `${speedMt}MT/s`, "dataset"], summary: `${capacityGb}GB ${memoryType}-${speedMt} memory kit (${sticks} modules).` };
}

function mapStorage(row, base) {
  const capacityRaw = spec(row, "Capacity") || base.name;
  const rawCapacity = number(capacityRaw) || 1;
  const capacityTb = /GB/i.test(capacityRaw) ? round(rawCapacity / 1000, 3) : rawCapacity;
  const interfaceText = `${spec(row, "Interface", "Form Factor")} ${base.name}`;
  const driveType = spec(row, "Type");
  if (/rpm|hard drive|hdd/i.test(`${driveType} ${base.name}`) && !/ssd/i.test(base.name)) return undefined;
  const storageInterface = /nvme|m\.2|pcie/i.test(interfaceText) ? "NVMe" : "SATA";
  const generation = number(interfaceText.match(/PCIe\s*(\d)/i)?.[1]) || 3;
  const readSpeedMb = storageInterface === "NVMe" ? generation >= 5 ? 12000 : generation >= 4 ? 7000 : 3500 : 550;
  return { ...base, category: "storage", capacityTb, interface: storageInterface, readSpeedMb, writeSpeedMb: Math.round(readSpeedMb * 0.85), tags: [storageInterface, `${capacityTb}TB`, "SSD", "dataset"], summary: `${capacityTb}TB ${storageInterface} solid-state drive; throughput is an interface-class estimate when the source omits it.` };
}

function mapCooler(row, base) {
  const radiator = number(spec(row, "Radiator Size")) || number(base.name.match(/(?:120|140|240|280|360|420)\s*mm/i)?.[0]);
  const liquid = Boolean(radiator) || /liquid|aio|water/i.test(base.name);
  const heightMm = liquid ? undefined : number(spec(row, "Height")) || 155;
  const tdpRatingWatts = liquid ? Math.round(clamp((radiator || 240) * 0.9, 180, 380)) : Math.round(clamp(base.price * 1.5 + 130, 150, 280));
  const sockets = spec(row, "CPU Socket").split(/[,/]/).map(value => value.trim()).filter(Boolean);
  const supportedSockets = sockets.length ? sockets : ["AM4", "AM5", "LGA1700", "LGA1851"];
  const type = liquid ? "aio" : "air";
  return { ...base, category: "cooler", supportedSockets, tdpRatingWatts, heightMm, type, tags: [type, `${tdpRatingWatts}W`, "dataset"], summary: `${liquid ? "Liquid" : "Air"} CPU cooler; cooling capacity is a conservative derived ranking value.` };
}

function mapPsu(row, base) {
  const wattage = number(spec(row, "Wattage")) || number(base.name.match(/\d{3,4}\s*W/i)?.[0]) || 650;
  const rating = spec(row, "Efficiency Rating") || base.name;
  const efficiency = includesAny(rating, ["titanium"]) ? "Titanium" : includesAny(rating, ["platinum"]) ? "Platinum" : includesAny(rating, ["gold"]) ? "Gold" : "Bronze";
  const typeText = spec(row, "Type", "Form Factor") + base.name;
  const psuForm = /SFX/i.test(typeText) ? "SFX" : "ATX";
  const modularText = spec(row, "Modular");
  const modular = !/no|false|non/i.test(modularText || base.name);
  return { ...base, category: "psu", wattage, efficiency, formFactor: psuForm, modular, tags: [`${wattage}W`, efficiency, psuForm, modular ? "modular" : "non-modular", "dataset"], summary: `${wattage}W ${efficiency} ${psuForm} power supply${modular ? " with modular cabling" : ""}.` };
}

function mapCase(row, base) {
  const typeText = spec(row, "Type", "Form Factor") || base.name;
  const small = /mini itx|mini-itx|sff/i.test(typeText);
  const micro = /micro atx|micro-atx|matx/i.test(typeText);
  const forms = small ? ["Mini-ITX"] : micro ? ["Micro-ATX", "Mini-ITX"] : ["ATX", "Micro-ATX", "Mini-ITX"];
  const maxGpuLengthMm = number(spec(row, "Maximum Video Card Length", "Max Video Card Length")) || (small ? 320 : micro ? 350 : 380);
  const maxCoolerHeightMm = number(spec(row, "Maximum CPU Cooler Height", "Max CPU Cooler Height")) || (small ? 75 : micro ? 160 : 170);
  const psuFormFactors = small ? ["SFX"] : ["ATX", "SFX"];
  return { ...base, category: "case", supportedMotherboardFormFactors: forms, maxGpuLengthMm, maxCoolerHeightMm, psuFormFactors, tags: [...forms, "dataset"], summary: `${small ? "Small-form-factor" : micro ? "Micro-ATX" : "ATX"} enclosure with source-linked or conservative clearance data.` };
}

const mappers = { cpu: mapCpu, gpu: mapGpu, motherboard: mapMotherboard, ram: mapRam, storage: mapStorage, cooler: mapCooler, psu: mapPsu, case: mapCase };

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "AIPC-catalog-sync/1.0" }, signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1200));
    }
  }
  throw lastError;
}

async function fetchRows(category, offset) {
  const params = new URLSearchParams({ dataset: DATASET, config: "default", split: "train", where: `"category"='${category}' AND "price_eur">0`, orderby: `"rating_count" DESC`, offset: String(offset), length: "100" });
  return fetchJson(`${API}/filter?${params}`);
}

async function eurUsdRate() {
  const payload = await fetchJson("https://api.frankfurter.app/latest?from=EUR&to=USD");
  const rate = Number(payload?.rates?.USD);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("EUR/USD rate unavailable; refusing to invent converted prices");
  return { rate, date: payload.date, source: "https://api.frankfurter.app (ECB reference data)" };
}

function readCurated(block, definition) {
  const arrayMatch = block.match(new RegExp(`export const ${definition.array}:[^=]+?=\\[([\\s\\S]*?)\\];`));
  const source = arrayMatch?.[1] || "";
  const count = (source.match(new RegExp(`\\b${definition.ctor}\\(`, "g")) || []).length;
  const names = [...source.matchAll(new RegExp(`\\b${definition.ctor}\\(\\s*"[^"]+"\\s*,\\s*"([^"]+)"`, "g"))].map(match => match[1]);
  return { count, names };
}

async function main() {
  if (!Number.isInteger(target) || target < 1 || target > 500) throw new Error("--target must be an integer from 1 to 500");
  const runAt = new Date();
  const runDate = runAt.toISOString().slice(0, 10);
  const sourceFile = await fs.readFile(path.resolve("src/data/parts.ts"), "utf8");
  const fx = await eurUsdRate();
  const selected = [];
  const reportCategories = {};
  const globalNames = new Set();

  for (const definition of definitions) {
    const curated = readCurated(sourceFile, definition);
    curated.names.forEach(name => globalNames.add(normalizedName(name)));
    const needed = Math.max(0, target - curated.count);
    const additions = [];
    let scanned = 0;
    let totalAvailable = 0;
    for (let offset = 0; additions.length < needed; offset += 100) {
      const payload = await fetchRows(definition.source, offset);
      totalAvailable = Number(payload.num_rows_total || 0);
      const rows = Array.isArray(payload.rows) ? payload.rows.map(item => item.row) : [];
      if (!rows.length) break;
      for (const row of rows) {
        scanned++;
        const key = normalizedName(row.name);
        if (!key || globalNames.has(key)) continue;
        const priceEur = Number(row.price_eur);
        if (!Number.isFinite(priceEur) || priceEur <= 0) continue;
        const base = sourceMeta(row, priceEur * fx.rate, runDate);
        const part = mappers[definition.app](row, base);
        if (!part) continue;
        additions.push(part);
        globalNames.add(key);
        if (additions.length >= needed) break;
      }
      if (offset + rows.length >= totalAvailable) break;
    }
    if (additions.length < needed) throw new Error(`${definition.app}: only found ${additions.length}/${needed} usable additions`);
    selected.push(...additions);
    reportCategories[definition.app] = { curated: curated.count, added: additions.length, final: curated.count + additions.length, scanned, sourceRows: totalAvailable };
    console.log(`${definition.app}: ${curated.count} curated + ${additions.length} collected = ${curated.count + additions.length}`);
  }

  const ids = selected.map(part => part.id);
  if (new Set(ids).size !== ids.length) throw new Error("Generated duplicate part IDs");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(selected, null, 2)}\n`, "utf8");
  const report = {
    generatedAt: runAt.toISOString(), targetPerCategory: target, output: outputPath,
    source: { dataset: DATASET, api: API, license: "MIT", datasetUrl: `https://huggingface.co/datasets/${DATASET}` },
    pricing: { originalCurrency: "EUR", outputCurrency: "USD", eurUsdRate: fx.rate, rateDate: fx.date, rateSource: fx.source },
    policy: { retailerHtmlScraped: false, selection: "priced rows ordered by rating_count descending", deduplication: "normalized brand/model name" },
    derivedFields: ["cpu.threads", "relative performance scores", "fallback sockets/clearances", "cooler TDP rating", "storage throughput when omitted"],
    categories: reportCategories,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${selected.length} additions to ${outputPath}`);
  console.log(`wrote provenance report to ${reportPath}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
