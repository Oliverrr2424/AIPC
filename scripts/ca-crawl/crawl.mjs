#!/usr/bin/env node
// CA retailer crawler — Newegg.ca (primary) + CanadaComputers (secondary).
//
// Extraction paths confirmed via on-host smoke tests:
//   - Newegg.ca search pages embed `window.__initialState__` (a <script> JSON
//     blob, NOT JSON-LD) in the STATIC html. It contains a `Products` array
//     where each ItemCell has Description.Title, ItemManufactory.Manufactory,
//     FinalPrice (CAD), Instock, Item (SKU -> product url), NewImage, and
//     Description.BulletDescription (spec bullets). So Newegg is plain HTTP +
//     balanced-brace extraction — no browser needed.
//   - CanadaComputers search pages only surface an ItemList (name+url, no
//     price) AFTER Playwright rendering. Prices live on each product page as a
//     schema.org/Product JSON-LD block (price/priceCurrency/availability/
//     image/description/brand). So CC = Playwright search render + HTTP product
//     page fetch (Playwright fallback if the static page lacks JSON-LD).
//
// Politeness: respects robots.txt (fetched once per retailer, cached), rate
// limited with jitter, identifies itself via User-Agent, writes everything
// under <outDir>/raw (D drive when run from D:\AIPC).
//
// Output: <outDir>/raw/{retailer}/{category}.json  +  <outDir>/raw/_summary.json

import fs from "node:fs/promises";
import path from "node:path";
import { TARGETS, RETAILERS, SEARCH_URL, ROBOTS_URL } from "./targets.mjs";

const UA = "AIPC-catalog-ca/1.0 (+catalog research; respects robots.txt; contact: houruike6@gmail.com)";
const RATE_BASE_MS = 700;
const RATE_JITTER_MS = 500;
const NEWEGG_MAX_PAGES = 2;            // search result pages per Newegg query
const NEWEGG_PER_CATEGORY_CAP = 60;
const CC_PER_CATEGORY_CAP = 25;        // CC is enrichment; Newegg covers the 50 floor
const CC_PRODUCT_PAGES_PER_QUERY = 4;
const HTTP_TIMEOUT_MS = 30_000;
const CC_SEARCH_RENDER_WAIT_MS = 3500;
const CC_PRODUCT_RENDER_WAIT_MS = 2500;

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((v, i, a) =>
    v.startsWith("--") ? [[v.slice(2), a[i + 1]?.startsWith("--") ? true : a[i + 1]]] : []
  ).filter(([, val]) => val !== undefined)
);
const outDir = path.resolve(String(args.out || "data/crawl"));
const rawDir = path.join(outDir, "raw");
const onlyRetailers = args.retailers ? String(args.retailers).split(",") : RETAILERS;
const capturedAt = new Date().toISOString();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rateLimit = async () => sleep(RATE_BASE_MS + Math.floor(Math.random() * RATE_JITTER_MS));
const text = v => (v == null ? "" : String(v).trim());
const absolutize = (u, base) => { if (!u) return ""; try { return new URL(u, base).href; } catch { return u; } };

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------
async function fetchHttp(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8", "Accept-Language": "en-CA,en;q=0.9" },
      redirect: "follow", signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, body: await res.text(), finalUrl: res.url || url };
  } catch (err) {
    return { ok: false, status: 0, body: "", finalUrl: url, error: String(err?.message || err) };
  } finally { clearTimeout(timer); }
}
function isCloudflareBlock(r) {
  if ((r.status === 403 || r.status === 503 || r.status === 429) && /cf-challenge|cloudflare|just a moment|attention required|__cf_chl/i.test(r.body)) return true;
  if (r.status === 403 || r.status === 503) return true;
  return /cf-challenge|__cf_chl_opt|just a moment\.\.\./i.test(r.body || "");
}

// ---------------------------------------------------------------------------
// Balanced-brace extraction of window.__initialState__ from Newegg static HTML
// ---------------------------------------------------------------------------
function extractInitialState(html) {
  const marker = "window.__initialState__";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const eq = html.indexOf("=", start);
  if (eq < 0) return null;
  let i = eq + 1;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== "{") return null;
  let depth = 0, inStr = false, esc = false, quote = "";
  const from = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) { esc = false; continue; } if (ch === "\\") { esc = true; continue; } if (ch === quote) inStr = false; continue; }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  try { return JSON.parse(html.slice(from, i)); } catch { return null; }
}

function neweggListingFromProduct(p, target) {
  const c = p.ItemCell || {};
  const d = c.Description || {};
  const name = text(d.Title || d.WebDescription || d.LineDescription || d.ShortTitle);
  if (!name) return null;
  const item = text(c.Item);
  const image = c.NewImage && c.NewImage.ImageName ? `https://c1.neweggimages.com/ProductImage/${item}/${c.NewImage.ImageName}` : "";
  const bullets = [d.BulletDescription, d.WebDescription, d.LineDescription].filter(Boolean).join("\n");
  return {
    name,
    brand: text(c.ItemManufactory && c.ItemManufactory.Manufactory),
    model: text(c.Model),
    priceCad: Number.isFinite(Number(c.FinalPrice)) ? Number(c.FinalPrice) : (Number.isFinite(Number(c.UnitCost)) ? Number(c.UnitCost) : null),
    currency: "CAD",
    inStock: c.Instock !== false,
    url: item ? `https://www.newegg.ca/p/${item}` : "",
    image,
    description: bullets,
    sku: item,
    category: target.category,
    retailer: "newegg",
    query: target.query,
    modelFamily: target.modelFamily,
    capturedAt,
    source: "newegg-initialstate",
  };
}

// ---------------------------------------------------------------------------
// JSON-LD helpers (CanadaComputers product pages)
// ---------------------------------------------------------------------------
function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try { const p = JSON.parse(raw); blocks.push(...(Array.isArray(p) ? p : [p])); }
    catch { try { const f = raw.replace(/}\s*{/g, "},{").replace(/^\[/, "").replace(/\]$/, ""); blocks.push(...JSON.parse(`[${f}]`)); } catch {} }
  }
  return blocks;
}
function collectProducts(blocks) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = n["@type"]; const ts = Array.isArray(t) ? t : [t];
    if (ts.some(x => typeof x === "string" && /product/i.test(x))) { out.push(n); return; }
    if (ts.some(x => typeof x === "string" && /itemlist/i.test(x)) && Array.isArray(n.itemListElement)) { n.itemListElement.forEach(e => visit(e && (e.item || e))); return; }
    if (n["@graph"]) visit(n["@graph"]);
  };
  visit(blocks);
  return out;
}
function firstImage(img) { if (!img) return ""; if (typeof img === "string") return img; if (Array.isArray(img)) return img[0] || ""; if (typeof img === "object") return img.url || img["@id"] || ""; return ""; }
function offerPrice(offers) {
  if (!offers) return { price: null, currency: "CAD", availability: "" };
  const o = Array.isArray(offers) ? offers[0] : offers;
  return { price: o.price ?? o.lowPrice ?? o.highPrice ?? (o.priceSpecification && o.priceSpecification.price), currency: o.priceCurrency || "CAD", availability: o.availability || "" };
}
function productFromJsonLd(prod, pageUrl) {
  const { price, currency, availability } = offerPrice(prod.offers);
  const brand = prod.brand && (prod.brand.name || prod.brand) || prod.manufacturer && (prod.manufacturer.name || prod.manufacturer) || "";
  return {
    name: text(prod.name),
    brand: text(typeof brand === "string" ? brand : brand && brand.name || ""),
    priceCad: Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) / 100 : null,
    currency: currency || "CAD",
    inStock: /instock|preorder|limited/i.test(availability) ? true : /outofstock|discontinued|soldout/i.test(availability) ? false : true,
    url: absolutize(prod.url || (prod.offers && prod.offers.url) || "", pageUrl),
    image: absolutize(firstImage(prod.image), pageUrl),
    description: text(prod.description || ""),
    sku: text(prod.sku || prod.mpn || ""),
  };
}

// ---------------------------------------------------------------------------
// Playwright (lazy-loaded, only used for CanadaComputers)
// ---------------------------------------------------------------------------
let _pw = null, _browser = null;
async function loadPlaywright() {
  if (_pw === false) return null;
  if (_pw) return _pw;
  try { _pw = await import("playwright"); return _pw; }
  catch { try { _pw = await import("playwright-core"); return _pw; } catch { _pw = false; console.warn("  [playwright] not installed — CC search rendering disabled"); return null; } }
}
async function renderPage(url, waitMs) {
  const pw = await loadPlaywright();
  if (!pw) return { ok: false, status: 0, body: "", finalUrl: url, error: "playwright-unavailable" };
  if (!_browser) _browser = await pw.chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  const page = await _browser.newPage({ userAgent: UA, locale: "en-CA", viewport: { width: 1366, height: 1000 } });
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(waitMs);
    return { ok: (resp ? resp.status() : 200) < 400, status: resp ? resp.status() : 200, body: await page.content(), finalUrl: page.url(), page };
  } catch (err) {
    return { ok: false, status: 0, body: "", finalUrl: url, error: String(err?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// robots.txt (minimal matcher on User-agent: * Disallow rules)
// ---------------------------------------------------------------------------
const robotsCache = new Map();
async function getRobots(retailer) {
  if (robotsCache.has(retailer)) return robotsCache.get(retailer);
  const entry = { disallow: [], fetched: false, reachable: true };
  try {
    const r = await fetchHttp(ROBOTS_URL[retailer], 15_000);
    if (r.ok && r.body) {
      let inStar = false;
      for (const raw of r.body.split(/\r?\n/)) {
        const line = raw.split("#")[0].trim(); if (!line) continue;
        const [k, ...rest] = line.split(":"); const key = text(k).toLowerCase(); const val = text(rest.join(":"));
        if (key === "user-agent") { inStar = val === "*"; continue; }
        if (key === "disallow" && inStar && val) entry.disallow.push(val);
      }
      entry.fetched = true;
    } else entry.reachable = false;
  } catch { entry.reachable = false; }
  robotsCache.set(retailer, entry); return entry;
}
function robotsAllowed(retailer, urlStr) {
  const e = robotsCache.get(retailer);
  if (!e || !e.reachable || !e.fetched) return true;
  let p; try { const u = new URL(urlStr); p = u.pathname + (u.search || ""); } catch { return true; }
  for (const rule of e.disallow) { const re = new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); if (re.test(p)) return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Newegg crawl (HTTP + __initialState__)
// ---------------------------------------------------------------------------
async function crawlNewegg(targets, acc, summary) {
  const robots = await getRobots("newegg");
  console.log(`[newegg] robots fetched=${robots.fetched} reachable=${robots.reachable} disallow=${robots.disallow.length}`);
  for (const t of targets) {
    if (acc.size >= NEWEGG_PER_CATEGORY_CAP) { console.log(`  [newegg/${t.category}] cap reached`); break; }
    for (let page = 1; page <= NEWEGG_MAX_PAGES; page++) {
      if (acc.size >= NEWEGG_PER_CATEGORY_CAP) break;
      const url = SEARCH_URL.newegg(t.query, page);
      if (!robotsAllowed("newegg", url)) { console.log(`  [newegg] robots disallow ${url}`); break; }
      await rateLimit();
      const r = await fetchHttp(url);
      if (!r.ok || !r.body) { console.log(`  [newegg/${t.category}] "${t.query}" p${page} HTTP ${r.status || r.error}`); summary.newegg.errors++; break; }
      if (isCloudflareBlock(r)) { console.log(`  [newegg/${t.category}] "${t.query}" p${page} cloudflare block`); summary.newegg.blocks++; break; }
      const state = extractInitialState(r.body);
      const products = (state && Array.isArray(state.Products)) ? state.Products : [];
      let added = 0;
      for (const p of products) {
        const listing = neweggListingFromProduct(p, t);
        if (!listing || !listing.url || acc.has(listing.url)) continue;
        listing.page = page;
        acc.set(listing.url, listing); added++;
        if (acc.size >= NEWEGG_PER_CATEGORY_CAP) break;
      }
      console.log(`  [newegg/${t.category}] "${t.query}" p${page} -> ${products.length} raw, +${added} (total ${acc.size})`);
      if (products.length < 8) break; // no point paginating thin results
    }
  }
}

// ---------------------------------------------------------------------------
// CanadaComputers crawl (Playwright search render + HTTP product pages)
// ---------------------------------------------------------------------------
async function crawlCanadaComputers(targets, acc, summary) {
  const robots = await getRobots("canadacomputers");
  console.log(`[canadacomputers] robots fetched=${robots.fetched} reachable=${robots.reachable} disallow=${robots.disallow.length}`);
  const pw = await loadPlaywright();
  if (!pw) { console.log("[canadacomputers] playwright unavailable — skipping CC"); return; }
  for (const t of targets) {
    if (acc.size >= CC_PER_CATEGORY_CAP) { console.log(`  [cc/${t.category}] cap reached`); break; }
    const searchUrl = SEARCH_URL.canadacomputers(t.query, 1);
    if (!robotsAllowed("canadacomputers", searchUrl)) { console.log(`  [cc] robots disallow search ${searchUrl}`); continue; }
    await rateLimit();
    const rendered = await renderPage(searchUrl, CC_SEARCH_RENDER_WAIT_MS);
    if (rendered.page) await rendered.page.close();
    if (!rendered.ok || !rendered.body) { console.log(`  [cc/${t.category}] "${t.query}" render failed (${rendered.status || rendered.error})`); summary.canadacomputers.errors++; continue; }
    if (isCloudflareBlock(rendered)) { console.log(`  [cc/${t.category}] "${t.query}" cloudflare block`); summary.canadacomputers.blocks++; continue; }
    // Collect ItemList product URLs from the rendered DOM's JSON-LD.
    const blocks = extractJsonLdBlocks(rendered.body);
    const itemUrls = [];
    for (const b of blocks) {
      const tt = Array.isArray(b["@type"]) ? b["@type"].join(",") : b["@type"];
      if (/itemlist/i.test(tt) && Array.isArray(b.itemListElement)) {
        for (const el of b.itemListElement) { const u = el && (el.url || (el.item && el.item.url)); if (u) itemUrls.push(u); }
      }
    }
    let visited = 0;
    for (const purl of itemUrls) {
      if (acc.size >= CC_PER_CATEGORY_CAP || visited >= CC_PRODUCT_PAGES_PER_QUERY) break;
      if (acc.has(purl)) continue;
      if (!robotsAllowed("canadacomputers", purl)) continue;
      await rateLimit();
      let pres = await fetchHttp(purl);
      let prods = pres.ok && pres.body && !isCloudflareBlock(pres) ? collectProducts(extractJsonLdBlocks(pres.body)) : [];
      let method = "http";
      if (!prods.length) {
        // Playwright fallback for the product page
        const r2 = await renderPage(purl, CC_PRODUCT_RENDER_WAIT_MS);
        if (r2.page) await r2.page.close();
        if (r2.ok && r2.body) { prods = collectProducts(extractJsonLdBlocks(r2.body)); method = "playwright"; }
      }
      if (!prods.length) { summary.canadacomputers.errors++; continue; }
      for (const prod of prods) {
        const listing = productFromJsonLd(prod, purl);
        if (!listing.name || !listing.url || acc.has(listing.url)) continue;
        listing.category = t.category; listing.retailer = "canadacomputers"; listing.query = t.query;
        listing.modelFamily = t.modelFamily; listing.capturedAt = capturedAt; listing.source = `cc-product-${method}`;
        acc.set(listing.url, listing);
        if (acc.size >= CC_PER_CATEGORY_CAP) break;
      }
      visited++;
    }
    console.log(`  [cc/${t.category}] "${t.query}" -> ${itemUrls.length} urls, visited ${visited} (total ${acc.size})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`CA crawl -> ${rawDir}  retailers=[${onlyRetailers}]`);
  await fs.mkdir(rawDir, { recursive: true });

  const byCategory = new Map();
  for (const t of TARGETS) { if (!byCategory.has(t.category)) byCategory.set(t.category, []); byCategory.get(t.category).push(t); }

  const summary = { generatedAt: capturedAt, retailers: { newegg: { products: 0, blocks: 0, errors: 0 }, canadacomputers: { products: 0, blocks: 0, errors: 0 } }, categories: {} };

  for (const [category, targets] of byCategory) {
    const acc = { newegg: new Map(), canadacomputers: new Map() };
    if (onlyRetailers.includes("newegg")) await crawlNewegg(targets, acc.newegg, summary.retailers);
    if (onlyRetailers.includes("canadacomputers")) await crawlCanadaComputers(targets, acc.canadacomputers, summary.retailers);

    for (const retailer of ["newegg", "canadacomputers"]) {
      if (!onlyRetailers.includes(retailer)) continue;
      const dir = path.join(rawDir, retailer);
      await fs.mkdir(dir, { recursive: true });
      const items = [...acc[retailer].values()];
      await fs.writeFile(path.join(dir, `${category}.json`), JSON.stringify(items, null, 2) + "\n", "utf8");
      summary.retailers[retailer].products += items.length;
      console.log(`[${retailer}/${category}] wrote ${items.length} (${items.filter(i => i.priceCad != null).length} priced)`);
    }
    summary.categories[category] = {
      newegg: acc.newegg.size,
      canadacomputers: acc.canadacomputers.size,
      total: acc.newegg.size + acc.canadacomputers.size,
    };
  }

  await fs.writeFile(path.join(rawDir, "_summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log("\n=== CA crawl summary ===");
  console.log(JSON.stringify(summary, null, 2));
  if (_browser) await _browser.close();
}

main().catch(e => { console.error(e); process.exitCode = 1; });
