#!/usr/bin/env node
// Normalize raw CA retailer crawl output into the AIPC catalog shape.
//
// Reads:  <rawDir>/{retailer}/{category}.json   (produced by crawl.mjs)
//         src/data/parts.ts                      (curated catalog, for dedup)
//         src/data/crawledParts.json             (existing HF-derived parts)
// Writes: <outDir>/parts.json      — NEW parts (Part shape, USD price)
//         <outDir>/snapshots.json  — PriceSnapshots (region=CA, currency=CAD)
//         <outDir>/_normalize_report.json
//
// Currency policy: retailer CAD price is converted to USD via Frankfurter for
// Part.price and PriceSnapshot.priceUsd (keeps the existing catalog + price
// estimator, which assume USD, consistent). The native CAD amount is preserved
// as `priceCad` on each snapshot row for archival. PriceSnapshot.currency is
// tagged "CAD" and region "CA".

import fs from "node:fs/promises";
import path from "node:path";
import { RETAILERS, CATEGORY_DEFS } from "./targets.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((v, i, a) =>
    v.startsWith("--") ? [[v.slice(2), a[i + 1]?.startsWith("--") ? true : a[i + 1]]] : []
  ).filter(([, val]) => val !== undefined)
);
const dataDir = path.resolve(String(args.data || "data/crawl"));
const rawDir = path.join(dataDir, "raw");
const outDir = path.resolve(String(args.out || path.join(dataDir, "normalized")));
const capturedAt = new Date().toISOString();
const runDate = capturedAt.slice(0, 10);

// --- small helpers (mirror scripts/crawl-parts.mjs) -------------------------
const text = v => (v == null ? "" : String(v).trim());
const number = v => { const m = text(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : undefined; };
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const slug = v => text(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const normalizedName = v => text(v).toLowerCase().replace(/\b(amd|intel|nvidia|asus|msi|gigabyte|zotac|sapphire|powercolor|xfx|corsair|samsung|wd|western digital|crucial|teamgroup|noctua|thermalright|arctic|lian li|nzxt|fractal|be quiet!|seasonic|thermaltake)\b/g, "").replace(/[^a-z0-9]+/g, "");
const includesAny = (v, terms) => terms.some(t => v.toLowerCase().includes(t));
const spec = (row, ...keys) => {
  const specs = row.specs && typeof row.specs === "object" ? row.specs : {};
  for (const key of keys) {
    const entry = Object.entries(specs).find(([k]) => k.toLowerCase() === key.toLowerCase());
    if (entry && text(entry[1])) return text(entry[1]);
  }
  return "";
};

// Parse a free-form description into a {key: value} specs map.
function parseSpecs(desc) {
  const clean = text(desc).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");
  const specs = {};
  for (const seg of clean.split(/\n|•|\||·|;|(?<=\.)\s{2,}/)) {
    const s = seg.trim();
    if (!s) continue;
    const m = s.match(/^([A-Za-z][\w\s\/().-]{1,32}?)\s*[:=]\s*(.{1,80})$/);
    if (m) specs[m[1].trim()] = m[2].trim();
  }
  return specs;
}

const fullText = row => `${text(row.name)} ${text(row.description)} ${Object.values(row.specs || {}).join(" ")}`;
const catalogTags = value => {
  const s = text(value).toLowerCase();
  return [
    /\bwhite\b|\bsnow\b|chalk white/.test(s) && "white",
    /\bblack\b|charcoal/.test(s) && "black",
    /\bargb\b|\brgb\b/.test(s) && "rgb",
    /mini[- ]?itx|\bsff\b|small form factor/.test(s) && "sff",
    /airflow|mesh/.test(s) && "airflow",
    /quiet|low[- ]noise|silent/.test(s) && "quiet",
    /panoramic|dual[- ]chamber|fish tank|\bo11\b/.test(s) && "panoramic",
  ].filter(Boolean);
};

function listingSkipReason(category, listing) {
  const name = text(listing.name);
  const s = `${name} ${text(listing.description)}`;
  if (/\b(combo|comb|bundle)\b/i.test(name) || /\bCPU\b.{0,25}(?:motherboard|\+|&)/i.test(name) || /motherboard.{0,25}\bCPU\b/i.test(name)) return "combo-or-bundle";
  if (/\b(open box|refurbished|renewed|used)\b/i.test(name)) return "non-new-condition";
  const system = /gaming desktop|gaming pc|desktop computer|workstation desktop|\bprebuilt\b|windows 11|\bwin11|\blaptop\b|\bnotebook\b|\bmini pc\b|all-in-one/i;
  if ((category === "cpu" || category === "gpu") && system.test(s)) return "complete-system";
  if (category === "cpu") {
    if (!/(?:Ryzen\s+[3579]\s+\d{4}[A-Z0-9]*|Core\s+i[3579]-?\d{4,5}[A-Z]*|Core\s+Ultra\s+[3579]\s+\d{3}[A-Z]*)/i.test(name)) return "not-desktop-cpu";
    if (!/processor|desktop cpu|\bcpu\b/i.test(name)) return "not-processor-listing";
  }
  if (category === "gpu") {
    if (/laptop gpu|mobile graphics/i.test(s)) return "mobile-gpu";
    if (!/(RTX\s*\d{4}|RX\s*\d{4}|Arc\s+B\d{3})/i.test(name)) return "not-target-gpu";
    if (!/graphics|video card|\bgpu\b/i.test(name)) return "not-graphics-card";
  }
  if (category === "motherboard" && /\bE-?ATX\b/i.test(name)) return "unsupported-eatx";
  if (category === "ram" && /SO-?DIMM|laptop|notebook|\bECC\b|\bRDIMM\b|server memory/i.test(s)) return "non-desktop-memory";
  if (category === "storage" && (!/SSD|NVMe|solid state/i.test(s) || /enclosure|adapter|duplicator/i.test(name))) return "not-internal-ssd";
  if (category === "cooler" && (/thermal (paste|compound)|mounting (kit|bracket)|replacement fan/i.test(name) || /LGA\s*4710|LGA\s*4677|\bSP6\b|sTR5/i.test(name) || !/(CPU.{0,18}cooler|air cooler|liquid cooler|\bAIO\b|liquid freezer|peerless assassin|phantom spirit|NH-D15|galahad|nautilus)/i.test(name))) return "not-desktop-cooler";
  if (category === "psu" && (!/(power supply|\bPSU\b)/i.test(name) || !/\b\d{3,4}\s*W\b/i.test(name) || /extension cable|replacement cable|tester|adapter only/i.test(name))) return "not-power-supply";
  if (category === "case" && (!/\b(case|chassis)\b/i.test(name) || /replacement panel|carry bag|case accessory/i.test(name))) return "not-pc-case";
  return undefined;
}

// --- category mappers (ported from scripts/crawl-parts.mjs) -----------------
function socketFrom(row) {
  const explicit = spec(row, "Socket / CPU", "Socket", "CPU Socket", "Processor Socket").toUpperCase().replace(/SOCKET\s*/g, "");
  if (explicit) return explicit.replace(/\s+/g, "");
  const name = row.name.toUpperCase();
  const chipset = spec(row, "Chipset").toUpperCase();
  if (/RYZEN\s+[3579]\s+[789]\d{3}|RYZEN\s+[3579]\s+8\d{3}/.test(name) || /A620|B650|B850|X670|X870|B840/.test(chipset)) return "AM5";
  if (/RYZEN|ATHLON/.test(name) || /A320|B350|B450|B550|X370|X470|X570/.test(chipset)) return "AM4";
  if (/CORE ULTRA\s+[3579]\s+2\d{2}|Z890|B860|H810|H870/.test(`${name} ${chipset}`)) return "LGA1851";
  if (/CORE I[3579]-1[234]\d{3}|Z690|Z790|B660|B760|H610|H670|H770/.test(`${name} ${chipset}`)) return "LGA1700";
  if (/CORE I[3579]-1[01]\d{3}|Z490|Z590|B460|B560|H410|H510/.test(`${name} ${chipset}`)) return "LGA1200";
  return "LGA1851";
}
function formFactor(v) {
  const s = v.toLowerCase();
  if (s.includes("mini itx") || s.includes("mini-itx") || s.includes("itx") || /\b[abhqwxz]\d{3}[a-z]?(?:-i|i)\b/i.test(s)) return "Mini-ITX";
  if (s.includes("micro atx") || s.includes("micro-atx") || s.includes("matx") || s.includes("m-atx") || /\b[abhqwxz]\d{3}[a-z]?(?:-m|m)\b/i.test(s)) return "Micro-ATX";
  return "ATX";
}

function sourceMeta(listing, priceUsd) {
  return {
    id: "", // filled per-part below
    name: text(listing.name),
    brand: text(listing.brand) || text(listing.name).split(/\s+/)[0] || "Unknown",
    price: round(priceUsd),
    currency: "USD",
    imageUrl: listing.image || undefined,
    productUrl: listing.url || undefined,
    specSourceUrl: listing.url || undefined,
    priceSourceUrl: listing.url || undefined,
    priceKind: "retail",
    priceAsOf: runDate,
  };
}

function mapCpu(row, base) {
  const allText = fullText(row);
  const cpuFacts = /\b270K\s+Plus\b/i.test(row.name) ? { cores: 24, threads: 24, base: 3.7, boost: 5.5, power: 250 } : /\b250K(?:F)?\s+Plus\b/i.test(row.name) ? { cores: 18, threads: 18, base: 4.2, boost: 5.3, power: 159 } : /\b285K\b/i.test(row.name) ? { cores: 24, threads: 24, base: 3.7, boost: 5.7, power: 250 } : /\b265K\b/i.test(row.name) ? { cores: 20, threads: 20, base: 3.9, boost: 5.5, power: 250 } : /\b245K\b/i.test(row.name) ? { cores: 14, threads: 14, base: 4.2, boost: 5.2, power: 159 } : undefined;
  const hybrid = allText.match(/\b(\d{1,2})P\s*\+\s*(\d{1,2})E\b/i);
  const coreCandidates = [...allText.matchAll(/\b(\d{1,3})\s*-?\s*Core(?:s)?\b/gi)].map(m => Number(m[1])).filter(v => v >= 2 && v <= 32);
  const coresFromName = coreCandidates.length ? Math.min(...coreCandidates) : undefined;
  const ghzs = [...(row.name.matchAll(/(\d+\.?\d*)\s*ghz/gi) || [])].map(m => Number(m[1])).filter(v => v >= 1 && v <= 7);
  const tdpCandidates = [...allText.matchAll(/\b(\d{2,3})\s*W\b/gi)].map(m => Number(m[1])).filter(v => v >= 35 && v <= 350);
  const tdpFromName = tdpCandidates.length ? Math.min(...tdpCandidates) : undefined;
  const cores = cpuFacts?.cores || number(spec(row, "Core Count", "Cores", "# of Cores")) || coresFromName || (hybrid ? Number(hybrid[1]) + Number(hybrid[2]) : 4);
  const baseClockGHz = cpuFacts?.base || number(spec(row, "Performance Core Clock", "Core Clock", "Base Clock", "Base Frequency")) || (ghzs.length ? ghzs[0] : undefined);
  const boostClockGHz = cpuFacts?.boost || number(spec(row, "Performance Core Boost Clock", "Boost Clock", "Max Turbo", "Boost Frequency")) || (ghzs.length > 1 ? Math.max(...ghzs) : undefined);
  const tdpWatts = cpuFacts?.power || number(spec(row, "TDP", "Thermal Design Power", "Default TDP")) || tdpFromName || (base.price > 350 ? 250 : base.price > 200 ? 125 : base.price > 120 ? 95 : 65);
  const explicitThreads = number(spec(row, "Thread Count", "Threads")) || number((allText.match(/\b(\d{1,3})\s*Threads?\b/i) || [])[1]);
  const threads = cpuFacts?.threads || explicitThreads || (/Core\s+Ultra/i.test(row.name) ? cores : hybrid ? Number(hybrid[1]) * 2 + Number(hybrid[2]) : /Ryzen/i.test(row.name) ? cores * 2 : cores * 2);
  const tier = cores >= 16 || base.price >= 500 ? "enthusiast" : cores >= 10 || base.price >= 300 ? "high" : cores >= 6 ? "mid" : "entry";
  const gamingScore = Math.round(clamp(35 + (boostClockGHz || baseClockGHz || 3.5) * 9 + Math.log2(Math.max(2, cores)) * 5));
  const productivityScore = Math.round(clamp(28 + cores * 3.4 + (boostClockGHz || 4) * 3));
  return { ...base, category: "cpu", socket: socketFrom(row), cores, threads, baseClockGHz, boostClockGHz, tdpWatts, gamingScore, productivityScore, tier, tags: [socketFrom(row), tier, "ca-retail", ...catalogTags(allText)], summary: `${cores}-core ${socketFrom(row)} desktop processor from CA retailer; spec fields derived from listing when source omits them.` };
}
function mapGpu(row, base) {
  const allText = fullText(row);
  const modelMatch = base.name.match(/(RTX\s*5090|RTX\s*5080|RTX\s*5070\s*Ti|RTX\s*5070|RTX\s*5060\s*Ti|RTX\s*5060|RTX\s*5050|RTX\s*4090|RTX\s*4080\s*Super|RTX\s*4070\s*Super|RX\s*9070\s*XT|RX\s*9070|RX\s*9060\s*XT|RX\s*9060|RX\s*7900\s*XTX|RX\s*7800\s*XT|Arc\s*B580)/i);
  const chipset = spec(row, "Chipset", "GPU", "Graphics Coprocessor") || (modelMatch ? modelMatch[1].replace(/\s+/g, " ") : base.name.replace(/^(ASUS|MSI|Gigabyte|Zotac|Sapphire|PowerColor|XFX|PNY|ASRock)\s+/i, ""));
  const modelKey = chipset.toUpperCase().replace(/\s+/g, "");
  const facts = modelKey.includes("RTX5090") ? { vram: 32, tdp: 575, length: 360 } : modelKey.includes("RTX5080") ? { vram: 16, tdp: 360, length: 340 } : modelKey.includes("RTX5070TI") ? { vram: 16, tdp: 300, length: 330 } : modelKey.includes("RTX5070") ? { vram: 12, tdp: 250, length: 320 } : modelKey.includes("RTX5060TI") ? { vram: /16\s*GB/i.test(base.name) ? 16 : 8, tdp: 180, length: 310 } : modelKey.includes("RTX5060") ? { vram: 8, tdp: 145, length: 300 } : modelKey.includes("RTX5050") ? { vram: 8, tdp: 130, length: 280 } : modelKey.includes("RTX4090") ? { vram: 24, tdp: 450, length: 350 } : modelKey.includes("RTX4080SUPER") ? { vram: 16, tdp: 320, length: 340 } : modelKey.includes("RTX4070SUPER") ? { vram: 12, tdp: 220, length: 320 } : modelKey.includes("RX9070XT") ? { vram: 16, tdp: 304, length: 330 } : modelKey.includes("RX9070") ? { vram: 16, tdp: 220, length: 320 } : modelKey.includes("RX9060XT") ? { vram: /8\s*GB/i.test(base.name) ? 8 : 16, tdp: 160, length: 310 } : modelKey.includes("RX9060") ? { vram: 8, tdp: 150, length: 300 } : modelKey.includes("RX7900XTX") ? { vram: 24, tdp: 355, length: 340 } : modelKey.includes("RX7800XT") ? { vram: 16, tdp: 263, length: 330 } : modelKey.includes("ARCB580") ? { vram: 12, tdp: 190, length: 300 } : undefined;
  const namedVram = number((base.name.match(/(?:RTX|RX|Arc)[\s\S]{0,80}?\b(\d+)\s*GB\s*(?:GDDR|VRAM)/i) || [])[1]);
  const vramGb = namedVram || facts?.vram || number(spec(row, "Memory", "Memory Size", "Video Memory")) || 8;
  const tdpWatts = number(spec(row, "TDP", "Thermal Design Power", "Total Board Power")) || facts?.tdp || Math.round(clamp(base.price * 0.2, 75, 600));
  const sourceLength = number((allText.match(/(?:card length|length|dimensions?)[^\d]{0,20}(\d{3})\s*mm/i) || [])[1]);
  const lengthMm = sourceLength || facts?.length || 300;
  const priceScore = clamp(28 + Math.sqrt(Math.max(1, base.price)) * 2.15);
  const cuda = /NVIDIA|GEFORCE|RTX|GTX/i.test(`${base.brand} ${chipset}`);
  return { ...base, category: "gpu", chipset, vramGb, tdpWatts, lengthMm, gamingScore1080p: Math.round(clamp(priceScore + 8)), gamingScore1440p: Math.round(priceScore), gamingScore4k: Math.round(clamp(priceScore - 12)), aiScore: Math.round(clamp(priceScore * 0.65 + vramGb * 1.8 + (cuda ? 12 : 0))), cuda, tags: [`${vramGb}GB`, cuda ? "CUDA" : "raster", "ca-retail", ...catalogTags(allText)], summary: `${vramGb}GB graphics card from CA retailer; relative workload scores derived for ranking.` };
}
function mapMotherboard(row, base) {
  const allText = fullText(row);
  const socket = socketFrom(row);
  const chipset = spec(row, "Chipset") || base.name.match(/(?:A|B|H|Q|W|X|Z)\d{3}[A-Z]?/i)?.[0]?.toUpperCase() || "Unknown";
  const ff = formFactor(spec(row, "Form Factor") || base.name);
  const memoryType = /DDR4/i.test(spec(row, "Memory Type", "Memory") + base.name) ? "DDR4" : "DDR5";
  const maxMemoryGb = number(spec(row, "Memory Max", "Maximum Memory", "Max Memory")) || (/Z890|B860|H810|X870|B850|B840/i.test(chipset) ? 256 : 192);
  const namedM2 = number((allText.match(/\b(\d+)[x×]\s*M\.2\b/i) || [])[1]);
  const m2Slots = number(spec(row, "M.2 Slots", "M.2 Ports")) || namedM2 || 2;
  const tiers = /X\d70|Z\d90/i.test(chipset) ? ["mid", "high", "enthusiast"] : ["entry", "mid", "high"];
  return { ...base, category: "motherboard", socket, chipset, formFactor: ff, memoryType, maxMemoryGb, m2Slots, storageInterfaces: ["NVMe", "SATA"], cpuTiers: tiers, tags: [socket, chipset, ff, memoryType, "ca-retail", ...catalogTags(allText)], summary: `${ff} ${chipset} motherboard for ${socket} from CA retailer; M.2 slot count derived when source omits it.` };
}
function mapRam(row, base) {
  const modules = spec(row, "Modules", "Kit Configuration");
  const moduleMatch = modules.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*GB/i);
  const sticks = moduleMatch ? Number(moduleMatch[1]) : 2;
  const capacityGb = moduleMatch ? Number(moduleMatch[1]) * Number(moduleMatch[2]) : number(spec(row, "Capacity", "Total Memory")) || number(base.name.match(/(\d+)\s*GB/i)?.[1]) || 16;
  const speedRaw = spec(row, "Speed", "Memory Speed") || base.name;
  const speedMt = number(speedRaw.match(/(?:DDR[45][ -]?)?(\d{4,5})/i)?.[1]) || 3200;
  const memoryType = /DDR5/i.test(speedRaw + base.name) || speedMt >= 4800 ? "DDR5" : "DDR4";
  return { ...base, category: "ram", memoryType, capacityGb, speedMt, sticks, tags: [memoryType, `${capacityGb}GB`, `${speedMt}MT/s`, "ca-retail", ...catalogTags(fullText(row))], summary: `${capacityGb}GB ${memoryType}-${speedMt} memory kit from CA retailer.` };
}
function mapStorage(row, base) {
  const capacityText = `${spec(row, "Capacity", "Storage Capacity")} ${base.name}`;
  const tbMatch = capacityText.match(/(\d+(?:\.\d+)?)\s*TB\b/i);
  const gbMatch = capacityText.match(/(\d{2,5})\s*GB\b/i);
  const capacityTb = tbMatch ? Number(tbMatch[1]) : gbMatch ? round(Number(gbMatch[1]) / 1000, 3) : 1;
  const interfaceText = `${spec(row, "Interface", "Form Factor")} ${base.name}`;
  if (/rpm|hard drive|hdd/i.test(`${spec(row, "Type")} ${base.name}`) && !/ssd/i.test(base.name)) return undefined;
  const storageInterface = /nvme|m\.2|pcie/i.test(interfaceText) ? "NVMe" : "SATA";
  const generation = number(interfaceText.match(/PCIe\s*(\d)/i)?.[1]) || 3;
  const allText = fullText(row);
  const speedToken = "(\\d{1,3}(?:,\\d{3})|\\d{3,5})";
  const slashSpeeds = allText.match(new RegExp(`(?:R\\/?W|read\\/?write|read speeds? up to)[^\\d]{0,30}${speedToken}\\s*\\/\\s*${speedToken}`, "i"));
  const namedRead = number((allText.match(/(?:read(?: speeds?)?|seq\.? read)[^\d]{0,35}(\d{1,3}(?:,\d{3})|\d{3,5})/i) || [])[1]);
  const readSpeedMb = slashSpeeds ? number(slashSpeeds[1]) : namedRead || (storageInterface === "NVMe" ? (generation >= 5 ? 12000 : generation >= 4 ? 7000 : 3500) : 550);
  const writeSpeedMb = slashSpeeds ? number(slashSpeeds[2]) : Math.round(readSpeedMb * 0.85);
  return { ...base, category: "storage", capacityTb, interface: storageInterface, readSpeedMb, writeSpeedMb, tags: [storageInterface, `${capacityTb}TB`, "SSD", "ca-retail", ...catalogTags(allText)], summary: `${capacityTb}TB ${storageInterface} SSD from CA retailer; throughput is an interface-class estimate when omitted.` };
}
function mapCooler(row, base) {
  const allText = fullText(row);
  const radiator = number(spec(row, "Radiator Size")) || number(allText.match(/(?:120|140|240|280|360|420)\s*mm/i)?.[0]);
  const liquid = Boolean(radiator) || /liquid|aio|water/i.test(base.name);
  const heightMm = liquid ? undefined : number(spec(row, "Height", "Cooler Height")) || 155;
  const tdpRatingWatts = liquid ? Math.round(clamp((radiator || 240) * 0.9, 180, 380)) : Math.round(clamp(base.price * 1.5 + 130, 150, 280));
  const sockets = [...new Set(allText.match(/(?:AM[45]|LGA\s*(?:1851|1700|1200|115[0-9]))/gi) || [])].map(s => s.toUpperCase().replace(/\s+/g, ""));
  for (const value of ["1851", "1700", "1200"]) if (new RegExp(`Intel[^\\n]{0,45}\\b${value}\\b`, "i").test(allText) && !sockets.includes(`LGA${value}`)) sockets.push(`LGA${value}`);
  const supportedSockets = sockets.length ? sockets : ["AM4", "AM5", "LGA1700", "LGA1851"];
  const type = liquid ? "aio" : "air";
  return { ...base, category: "cooler", supportedSockets, tdpRatingWatts, heightMm, type, tags: [type, `${tdpRatingWatts}W`, "ca-retail", ...catalogTags(allText)], summary: `${liquid ? "Liquid" : "Air"} CPU cooler from CA retailer; cooling capacity conservatively derived.` };
}
function mapPsu(row, base) {
  const wattage = number(spec(row, "Wattage", "Power", "Maximum Power")) || number(base.name.match(/\d{3,4}\s*W/i)?.[0]) || 650;
  const rating = spec(row, "Efficiency Rating", "80 PLUS") || base.name;
  const efficiency = includesAny(rating, ["titanium"]) ? "Titanium" : includesAny(rating, ["platinum"]) ? "Platinum" : includesAny(rating, ["gold"]) ? "Gold" : "Bronze";
  const typeText = spec(row, "Type", "Form Factor") + base.name;
  const psuForm = /SFX/i.test(typeText) ? "SFX" : "ATX";
  const modularText = spec(row, "Modular", "Modularity");
  const modular = !/no|false|non/i.test(modularText || base.name);
  return { ...base, category: "psu", wattage, efficiency, formFactor: psuForm, modular, tags: [`${wattage}W`, efficiency, psuForm, modular ? "modular" : "non-modular", "ca-retail", ...catalogTags(fullText(row))], summary: `${wattage}W ${efficiency} ${psuForm} power supply from CA retailer.` };
}
function mapCase(row, base) {
  const allText = fullText(row);
  const typeText = `${spec(row, "Type", "Form Factor")} ${base.name}`;
  const hasFullAtx = /\bATX\b/i.test(typeText) && !/^\s*(?:m|micro)[- ]?ATX\b/i.test(typeText);
  const small = !hasFullAtx && /mini[- ]?itx|\bsff\b|small form factor/i.test(typeText);
  const micro = !hasFullAtx && /micro[- ]?atx|\bmatx\b|\bm-atx\b/i.test(typeText);
  const forms = small ? ["Mini-ITX"] : micro ? ["Micro-ATX", "Mini-ITX"] : ["ATX", "Micro-ATX", "Mini-ITX"];
  const namedGpuLengths = [...allText.matchAll(/GPU(?:s)?\s+up to\s+(\d{3})\s*mm/gi)].map(m => Number(m[1]));
  const maxGpuLengthMm = number(spec(row, "Maximum Video Card Length", "Max Video Card Length", "VGA Max Length")) || (namedGpuLengths.length ? Math.max(...namedGpuLengths) : small ? 320 : micro ? 350 : 380);
  const namedCoolerHeight = number((allText.match(/(?:CPU )?cooler(?: max(?:imum)? height| height)?[^\d]{0,20}(\d{2,3})\s*mm/i) || [])[1]);
  const maxCoolerHeightMm = number(spec(row, "Maximum CPU Cooler Height", "Max CPU Cooler Height", "CPU Cooler Max Height")) || namedCoolerHeight || (small ? 75 : micro ? 160 : 170);
  const psuFormFactors = small ? ["SFX"] : ["ATX", "SFX"];
  return { ...base, category: "case", supportedMotherboardFormFactors: forms, maxGpuLengthMm, maxCoolerHeightMm, psuFormFactors, tags: [...forms, "ca-retail", ...catalogTags(allText)], summary: `${small ? "SFF" : micro ? "Micro-ATX" : "ATX"} enclosure from CA retailer; clearance values are conservative when source omits them.` };
}
const mappers = { cpu: mapCpu, gpu: mapGpu, motherboard: mapMotherboard, ram: mapRam, storage: mapStorage, cooler: mapCooler, psu: mapPsu, case: mapCase };

// --- curated catalog dedup map (name -> id, per category) -------------------
async function buildCuratedMap() {
  const map = Object.fromEntries(CATEGORY_DEFS.map(d => [d.app, new Map()]));
  // 1) regex-parse src/data/parts.ts for {ctor}("id","name",...)
  try {
    const src = await fs.readFile(path.resolve("src/data/parts.ts"), "utf8");
    for (const def of CATEGORY_DEFS) {
      const re = new RegExp(`\\b${def.ctor}\\(\\s*"([^"]+)"\\s*,\\s*"([^"]+)"`, "g");
      let m;
      while ((m = re.exec(src)) !== null) {
        const [, id, name] = m;
        map[def.app].set(normalizedName(name), id);
      }
    }
  } catch (e) {
    console.warn(`[normalize] could not read parts.ts: ${e.message}`);
  }
  // 2) also include the existing HF-derived crawledParts.json
  try {
    const raw = await fs.readFile(path.resolve("src/data/crawledParts.json"), "utf8");
    const arr = JSON.parse(raw);
    for (const p of arr) {
      if (p && p.category && p.name && map[p.category]) {
        map[p.category].set(normalizedName(p.name), p.id);
      }
    }
  } catch { /* file may be absent on fresh hosts */ }
  return map;
}

// --- CAD -> USD rate (Frankfurter, same source as the EUR->USD crawl) -------
async function cadUsdRate() {
  const res = await fetch("https://api.frankfurter.app/latest?from=CAD&to=USD", {
    headers: { Accept: "application/json", "User-Agent": "AIPC-catalog-ca/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Frankfurter CAD->USD HTTP ${res.status}`);
  const payload = await res.json();
  const rate = Number(payload?.rates?.USD);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("CAD->USD rate unavailable; refusing to invent converted prices");
  return { rate, date: payload.date, source: "https://api.frankfurter.app (ECB reference data)" };
}

async function readRawListings() {
  const all = [];
  for (const retailer of RETAILERS) {
    const dir = path.join(rawDir, retailer);
    let entries = [];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const file of entries) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      const category = file.replace(/\.json$/, "");
      const items = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
      for (const it of items) { it.category = category; all.push(it); }
    }
  }
  return all;
}

async function main() {
  console.log(`normalize -> ${outDir}`);
  await fs.mkdir(outDir, { recursive: true });

  const curated = await buildCuratedMap();
  const curatedCounts = Object.fromEntries(Object.entries(curated).map(([k, m]) => [k, m.size]));
  console.log(`curated dedup map: ${JSON.stringify(curatedCounts)}`);

  const fx = await cadUsdRate();
  console.log(`CAD->USD rate: ${fx.rate} (as of ${fx.date})`);

  const listings = await readRawListings();
  console.log(`read ${listings.length} raw listings`);

  const parts = [];
  const snapshots = [];
  const seenPartIds = new Set();
  const partIdByName = new Map();
  const partIndexById = new Map();
  const seenSnapshotKeys = new Set();
  const report = { generatedAt: capturedAt, fx, perCategory: {}, dedup: { curatedMatched: 0, newParts: 0, snapshots: 0, skippedUnpriced: 0, duplicateMerged: 0, skippedByReason: {} } };
  const cadPriceBounds = { cpu: [50, 2000], gpu: [150, 12000], motherboard: [75, 2500], ram: [20, 3000], storage: [30, 6000], cooler: [20, 1500], psu: [50, 1500], case: [40, 1200] };

  for (const listing of listings) {
    const category = listing.category;
    if (!category || !mappers[category]) continue;
    const name = text(listing.name);
    if (!name) continue;
    const norm = normalizedName(name);
    if (!norm) continue;
    const skipReason = listingSkipReason(category, listing);
    if (skipReason) {
      report.dedup.skippedByReason[skipReason] = (report.dedup.skippedByReason[skipReason] || 0) + 1;
      continue;
    }

    const priceCad = Number.isFinite(listing.priceCad) ? Number(listing.priceCad) : null;
    if (priceCad == null || priceCad <= 0) { report.dedup.skippedUnpriced++; continue; }
    const [minCad, maxCad] = cadPriceBounds[category];
    if (priceCad < minCad || priceCad > maxCad) {
      report.dedup.skippedByReason["price-outlier"] = (report.dedup.skippedByReason["price-outlier"] || 0) + 1;
      continue;
    }
    const priceUsd = Math.round(priceCad * fx.rate * 100) / 100;

    // Determine target partId: curated match wins, else mint a new CA part id.
    const curatedId = curated[category]?.get(norm);
    let partId;
    let isNewPart = false;
    if (curatedId) {
      partId = curatedId;
      report.dedup.curatedMatched++;
    } else if (partIdByName.has(`${category}|${norm}`)) {
      partId = partIdByName.get(`${category}|${norm}`);
      report.dedup.duplicateMerged++;
      const existingIndex = partIndexById.get(partId);
      if (existingIndex != null && priceUsd < parts[existingIndex].price) {
        parts[existingIndex].price = round(priceUsd);
        parts[existingIndex].productUrl = listing.url || parts[existingIndex].productUrl;
        parts[existingIndex].priceSourceUrl = listing.url || parts[existingIndex].priceSourceUrl;
        parts[existingIndex].priceAsOf = runDate;
      }
    } else {
      const base = sourceMeta(listing, priceUsd);
      let candidate = `ca-${listing.retailer}-${category}-${slug(name)}`;
      let n = 1;
      while (seenPartIds.has(candidate)) { candidate = `ca-${listing.retailer}-${category}-${slug(name)}-${n++}`; }
      partId = candidate;
      base.id = partId;
      const row = { name, brand: listing.brand, description: listing.description, specs: parseSpecs(listing.description), category, url: listing.url, image_url: listing.image };
      const part = mappers[category](row, base);
      if (!part) continue;
      if (!seenPartIds.has(partId)) {
        parts.push(part);
        seenPartIds.add(partId);
        partIdByName.set(`${category}|${norm}`, partId);
        partIndexById.set(partId, parts.length - 1);
        report.dedup.newParts++;
        isNewPart = true;
      }
    }

    // PriceSnapshot (append-only). Dedup within this run by (partId,retailer,url).
    const snapKey = `${partId}|${listing.retailer}|${listing.url}`;
    if (seenSnapshotKeys.has(snapKey)) continue;
    seenSnapshotKeys.add(snapKey);
    snapshots.push({
      partId,
      retailer: listing.retailer,
      region: "CA",
      priceUsd,
      priceCad,
      currency: "CAD",
      inStock: listing.inStock !== false,
      url: listing.url || null,
      capturedAt,
    });
    report.dedup.snapshots++;
    const pc = report.perCategory[category] || { newParts: 0, snapshots: 0, curatedMatched: 0 };
    pc.snapshots++;
    if (isNewPart) pc.newParts++;
    if (curatedId) pc.curatedMatched++;
    report.perCategory[category] = pc;
  }

  await fs.writeFile(path.join(outDir, "parts.json"), JSON.stringify(parts, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, "snapshots.json"), JSON.stringify(snapshots, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(outDir, "_normalize_report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`\nwrote ${parts.length} new parts, ${snapshots.length} price snapshots`);
  console.log(`dedup: ${JSON.stringify(report.dedup)}`);
  console.log(`per category: ${JSON.stringify(report.perCategory, null, 2)}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
