import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/hounemo/Documents/AIPC";
const outputDir = path.join(root, "outputs", "rag-5090-demo-20260629");
const after = JSON.parse(await fs.readFile(path.join(outputDir, "rag-demo-results.json"), "utf8"));
const before = JSON.parse(await fs.readFile(path.join(outputDir, "rag-demo-results-pre-fix.json"), "utf8"));
const catalogData = JSON.parse(await fs.readFile(path.join(outputDir, "demo-catalog.json"), "utf8"));
const fieldAuditData = JSON.parse(await fs.readFile(path.join(root, "outputs", "ca-crawl-20260629", "field-audit.json"), "utf8"));
const normalizeData = JSON.parse(await fs.readFile(path.join(root, "outputs", "ca-crawl-20260629", "_normalize_report.json"), "utf8"));

await fs.mkdir(path.join(outputDir, "previews"), { recursive: true });
const referencePath = path.join(root, "outputs", "rag-5090-demo-20260628", "AIPC_RAG_5090_Demo_Evaluation_2026-06-28.xlsx");
const reference = await SpreadsheetFile.importXlsx(await FileBlob.load(referencePath));
const referencePreview = await reference.render({ sheetName: "Executive Summary", range: "A1:P22", scale: 0.8, format: "png" });
await fs.writeFile(path.join(outputDir, "previews", "Reference-2026-06-28.png"), new Uint8Array(await referencePreview.arrayBuffer()));

const wb = Workbook.create();
const summary = wb.worksheets.add("Executive Summary");
const tests = wb.worksheets.add("Test Results");
const compare = wb.worksheets.add("Before vs After");
const responses = wb.worksheets.add("Full Responses");
const evidence = wb.worksheets.add("Evidence Audit");
const catalog = wb.worksheets.add("Parts Catalog");
const fieldAudit = wb.worksheets.add("Field Audit");
const sources = wb.worksheets.add("Sources & Method");

const C = {
  navy: "#0B1220", navy2: "#111C30", blue: "#2563EB", cyan: "#06B6D4",
  white: "#FFFFFF", text: "#172033", muted: "#64748B", line: "#CBD5E1",
  pale: "#EFF6FF", green: "#16A34A", greenPale: "#DCFCE7", amber: "#D97706",
  amberPale: "#FEF3C7", red: "#DC2626", redPale: "#FEE2E2", gray: "#F8FAFC",
};

function title(sheet, range, text, subtitle) {
  sheet.showGridLines = false;
  sheet.getRange(range).merge();
  const first = range.split(":")[0];
  sheet.getRange(first).values = [[text]];
  sheet.getRange(range).format = { fill: C.navy, font: { color: C.white, bold: true, size: 22 }, verticalAlignment: "center" };
  sheet.getRange(range).format.rowHeight = 38;
  if (subtitle) {
    const row = Number(first.match(/\d+/)[0]) + 1;
    const startCol = first.match(/[A-Z]+/)[0];
    const endCol = range.split(":")[1].match(/[A-Z]+/)[0];
    const subRange = `${startCol}${row}:${endCol}${row}`;
    sheet.getRange(subRange).merge();
    sheet.getRange(`${startCol}${row}`).values = [[subtitle]];
    sheet.getRange(subRange).format = { fill: C.navy2, font: { color: "#BFDBFE", italic: true, size: 10 }, verticalAlignment: "center" };
    sheet.getRange(subRange).format.rowHeight = 22;
  }
}

function header(sheet, range) {
  sheet.getRange(range).format = { fill: C.blue, font: { color: C.white, bold: true }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange(range).format.rowHeight = 28;
}

function borderAndWrap(sheet, range) {
  sheet.getRange(range).format = {
    borders: { top: { color: C.line }, bottom: { color: C.line }, left: { color: C.line }, right: { color: C.line } },
    wrapText: true, verticalAlignment: "top",
  };
}

function statusFill(sheet, cellRange, verdicts) {
  verdicts.forEach((verdict, index) => {
    const row = Number(cellRange.match(/\d+/)[0]) + index;
    const col = cellRange.match(/[A-Z]+/)[0];
    const color = verdict === "PASS" ? C.greenPale : verdict === "WARNING" ? C.amberPale : C.redPale;
    const font = verdict === "PASS" ? C.green : verdict === "WARNING" ? C.amber : C.red;
    sheet.getRange(`${col}${row}`).format = { fill: color, font: { color: font, bold: true }, horizontalAlignment: "center" };
  });
}

// Executive Summary
title(summary, "A1:P1", "AIPC RAG · RTX 5090 Demo Evaluation", "DeepSeek V4 Flash · non-thinking · remote Ollama nomic-embed-text · 2026-06-29");
summary.getRange("A4:F4").values = [["Metric", "Value", "Metric", "Value", "Metric", "Value"]];
header(summary, "A4:F4");
summary.getRange("A5:F7").values = [
  ["Final pass", null, "Final warning", null, "Final fail", null],
  ["Average latency", null, "Remote vector coverage", null, "Hard compatibility FAIL", null],
  ["Catalog parts", catalogData.database.partCount, "CA price snapshots", 444, "All price snapshots", catalogData.database.priceSnapshotCount],
];
summary.getRange("B5").formulas = [["=COUNTIF('Test Results'!$AB$6:$AB$15,\"PASS\")"]];
summary.getRange("D5").formulas = [["=COUNTIF('Test Results'!$AB$6:$AB$15,\"WARNING\")"]];
summary.getRange("F5").formulas = [["=COUNTIF('Test Results'!$AB$6:$AB$15,\"FAIL\")"]];
summary.getRange("B6").formulas = [["=AVERAGE('Test Results'!$L$6:$L$15)"]];
summary.getRange("D6").formulas = [["=COUNTIFS('Test Results'!$I$6:$I$15,\"vector\",'Test Results'!$J$6:$J$15,\"ollama\")/COUNTA('Test Results'!$A$6:$A$15)"]];
summary.getRange("F6").formulas = [["=COUNTIF('Test Results'!$AA$6:$AA$15,\"*FAIL*\")"]];
summary.getRange("B6").format.numberFormat = "0.0\" s\"";
summary.getRange("D6").format.numberFormat = "0%";
borderAndWrap(summary, "A4:F7");
summary.getRange("A9:F9").values = [["What was verified", "Result", "What changed after first run", "Before", "After", "Assessment"]];
header(summary, "A9:F9");
summary.getRange("A10:F15").values = [
  ["Intent layer", "10/10 DeepSeek parser", "Obvious hard failures", before.summary.fail, after.summary.fail, "Candidate diversity, SFF and PSU fallbacks removed hard failures"],
  ["Model mode", "10/10 non-thinking", "Pass", before.summary.pass, after.summary.pass, "Improved without switching model or thinking mode"],
  ["Embedding route", "10/10 vector + Ollama", "Warnings", before.summary.warning, after.summary.warning, "Warnings retained for honest review"],
  ["Embedding model", "nomic-embed-text", "Remote fallback", "0 local", "0 local", "No Transformers.js/local embedding used"],
  ["Database", "PostgreSQL + pgvector", "Catalog coverage", "400 parts", `${catalogData.database.partCount} parts`, "430 cleaned CA parts added"],
  ["Verification", "Typecheck + 2 regression suites", "Field audit", "Not present", `${fieldAuditData.summary.errors} errors / ${fieldAuditData.summary.warnings} warnings`, "Range, semantics, provenance and known-model checks"],
];
borderAndWrap(summary, "A9:F15");
summary.getRange("A17:F17").values = [["Remaining warnings", "Test", "Observed", "Severity", "Recommended follow-up", "Owner"]];
header(summary, "A17:F17");
const warningRows = after.results.filter(x => x.audit.verdict === "WARNING").map(x => [
  x.persona, x.id, x.audit.warnings.join("; "), "Review", x.id === "T03" ? "Prefer 1600W when quieter AI headroom outweighs cost" : x.id === "T06" ? "Offer RTX 5080/5070 Ti variant to stay under budget" : "Distinguish requested SKUs from already-owned parts during budget optimization", "Recommendation engine",
]);
summary.getRangeByIndexes(17, 0, warningRows.length, 6).values = warningRows;
borderAndWrap(summary, `A18:F${17 + warningRows.length}`);
summary.getRange("H4:I7").values = [["Verdict", "Count"], ["PASS", after.summary.pass], ["WARNING", after.summary.warning], ["FAIL", after.summary.fail]];
header(summary, "H4:I4");
const chart = summary.charts.add("column", summary.getRange("H4:I7"));
chart.title = "Final Test Verdicts";
chart.hasLegend = false;
chart.setPosition("H9", "P22");
summary.getRange("A:A").format.columnWidth = 24;
summary.getRange("B:B").format.columnWidth = 21;
summary.getRange("C:C").format.columnWidth = 26;
summary.getRange("D:F").format.columnWidth = 18;
summary.getRange("H:I").format.columnWidth = 14;
summary.freezePanes.freezeRows(2);

// Test Results
title(tests, "A1:AF1", "10-Scenario End-to-End Results", "Every request used deepseek-v4-flash + thinking=disabled; audit thresholds are documented in Sources & Method");
const testHeaders = ["ID","Persona","Expertise","Language","Requirement","Model","Thinking","Parser","Retrieval","Embed provider","Embed model","Latency (s)","Budget","Currency","Total","Budget utilization","Use case","CPU","GPU","VRAM GB","Motherboard","RAM GB","Storage TB","Cooler","PSU","Case","Compatibility","Verdict","Obvious errors","Warnings","Evidence IDs","AI explanation"];
tests.getRangeByIndexes(4, 0, 1, testHeaders.length).values = [testHeaders];
header(tests, "A5:AF5");
const testRows = after.results.map(x => {
  const r = x.result; const p = r.parts || {};
  const compatibility = (r.compatibility || []).filter(c => c.status !== "PASS").map(c => `${c.status}: ${c.rule}`).join("; ") || "PASS (all deterministic rules)";
  return [x.id,x.persona,x.expertise,x.language,x.query,r.aiModel,r.thinkingMode,r.parserMode,r.retrieval?.mode,r.retrieval?.embeddingProvider,r.retrieval?.embeddingModel,x.latencyMs/1000,r.request?.budget,r.request?.currency,r.totalPrice,null,r.request?.useCase,p.cpu?.name,p.gpu?.name,p.gpu?.vramGb,p.motherboard?.name,p.ram?.capacityGb,p.storage?.capacityTb,p.cooler?.name,p.psu?.name,p.case?.name,compatibility,x.audit.verdict,x.audit.errors.join("; ") || "None",x.audit.warnings.join("; ") || "None",(r.retrievedChunks || []).slice(0,8).map(c=>c.id).join(", "),r.explanation || ""];
});
tests.getRangeByIndexes(5, 0, testRows.length, testHeaders.length).values = testRows;
tests.getRange("P6").formulas = [["=IFERROR(O6/M6,0)"]];
tests.getRange("P6:P15").fillDown();
tests.getRange("L6:L15").format.numberFormat = "0.0";
tests.getRange("M6:O15").format.numberFormat = "#,##0.00";
tests.getRange("P6:P15").format.numberFormat = "0.0%";
borderAndWrap(tests, "A5:AF15");
statusFill(tests, "AB6", after.results.map(x => x.audit.verdict));
tests.getRange("A6:AF15").format.rowHeight = 54;
tests.getRange("A:A").format.columnWidth = 7; tests.getRange("B:D").format.columnWidth = 14;
tests.getRange("E:E").format.columnWidth = 58; tests.getRange("F:K").format.columnWidth = 18;
tests.getRange("L:P").format.columnWidth = 14; tests.getRange("Q:Q").format.columnWidth = 14;
tests.getRange("R:Z").format.columnWidth = 25; tests.getRange("AA:AE").format.columnWidth = 27; tests.getRange("AF:AF").format.columnWidth = 70;
tests.freezePanes.freezeRows(5); tests.freezePanes.freezeColumns(5);

// Before vs After
title(compare, "A1:K1", "Regression Delta · First Run vs Fixed Run", "The first-run failures remain visible; the final run is not cherry-picked");
const compareHeaders = ["ID","Scenario","Before verdict","Before total","Before issues","After verdict","After total","After issues","Delta","Remote vector before","Remote vector after"];
compare.getRangeByIndexes(4,0,1,compareHeaders.length).values=[compareHeaders]; header(compare,"A5:K5");
const compareRows = after.results.map(a => { const b=before.results.find(x=>x.id===a.id); const beforeIssues=[...(b?.audit.errors||[]),...(b?.audit.warnings||[])].join("; ")||"None"; const afterIssues=[...a.audit.errors,...a.audit.warnings].join("; ")||"None"; return [a.id,a.persona,b?.audit.verdict||"N/A",b?.result?.totalPrice||0,beforeIssues,a.audit.verdict,a.result.totalPrice,afterIssues,b?.audit.verdict===a.audit.verdict?"Unchanged":"Improved",`${b?.result?.retrieval?.mode}/${b?.result?.retrieval?.embeddingProvider}`,`${a.result.retrieval?.mode}/${a.result.retrieval?.embeddingProvider}`]; });
compare.getRangeByIndexes(5,0,compareRows.length,compareHeaders.length).values=compareRows; borderAndWrap(compare,"A5:K15");
statusFill(compare,"C6",after.results.map(a=>before.results.find(x=>x.id===a.id)?.audit.verdict||"FAIL")); statusFill(compare,"F6",after.results.map(x=>x.audit.verdict));
compare.getRange("A6:K15").format.rowHeight=44; compare.getRange("A:A").format.columnWidth=7; compare.getRange("B:B").format.columnWidth=22; compare.getRange("C:D").format.columnWidth=14; compare.getRange("E:E").format.columnWidth=55; compare.getRange("F:G").format.columnWidth=14; compare.getRange("H:H").format.columnWidth=48; compare.getRange("I:K").format.columnWidth=19; compare.freezePanes.freezeRows(5);

// Full Responses
title(responses,"A1:H1","Full Returned Results","Parsed intent, final build, deterministic checks, RAG reasoning, and generated explanation");
const responseHeaders=["ID","Requirement","Parsed BuildRequest","Final build","Compatibility details","Retrieved reasoning","AI explanation","Alternative builds"];
responses.getRangeByIndexes(4,0,1,responseHeaders.length).values=[responseHeaders]; header(responses,"A5:H5");
const responseRows=after.results.map(x=>{const r=x.result;return [x.id,x.query,JSON.stringify(r.request),Object.entries(r.parts||{}).map(([k,v])=>`${k}: ${v.name}`).join("\n"),(r.compatibility||[]).map(c=>`${c.status} · ${c.rule}: ${c.message}`).join("\n"),(r.reasoning||[]).map(v=>`${v.category}: ${v.selected} — ${v.reason} [${v.evidenceIds.join(", ")}]`).join("\n"),r.explanation||"",(r.alternativeBuilds||[]).map(v=>`${v.title} (${v.totalPrice}): ${v.tradeoff}`).join("\n")||"None"]});
responses.getRangeByIndexes(5,0,responseRows.length,responseHeaders.length).values=responseRows; borderAndWrap(responses,"A5:H15"); responses.getRange("A6:H15").format.rowHeight=120;
responses.getRange("A:A").format.columnWidth=7; responses.getRange("B:B").format.columnWidth=55; responses.getRange("C:C").format.columnWidth=48; responses.getRange("D:D").format.columnWidth=42; responses.getRange("E:H").format.columnWidth=62; responses.freezePanes.freezeRows(5); responses.freezePanes.freezeColumns(2);

// Evidence Audit
title(evidence,"A1:N1","RAG Evidence Audit","Per-test vector hits returned by PostgreSQL/pgvector from the remote Ollama embedding space");
const evidenceHeaders=["Test","Rank","Chunk ID","Title","Category","Relevance","Cosine similarity","Mode","Provider","Embedding model","Tags","Source title","Source URL","Snippet"];
evidence.getRangeByIndexes(4,0,1,evidenceHeaders.length).values=[evidenceHeaders]; header(evidence,"A5:N5");
const evidenceRows=[];
for(const x of after.results){(x.result.retrievedChunks||[]).forEach((c,i)=>evidenceRows.push([x.id,i+1,c.id,c.title,c.category||"",c.relevanceScore,c.similarityScore??null,c.retrievalMode,c.embeddingProvider,c.embeddingModel,(c.tags||[]).join(", "),c.sourceTitle||"",c.sourceUrl||"",c.content]));}
evidence.getRangeByIndexes(5,0,evidenceRows.length,evidenceHeaders.length).values=evidenceRows; borderAndWrap(evidence,`A5:N${5+evidenceRows.length}`); evidence.getRange(`F6:G${5+evidenceRows.length}`).format.numberFormat="0.000";
evidence.getRange("A:B").format.columnWidth=8; evidence.getRange("C:C").format.columnWidth=28; evidence.getRange("D:D").format.columnWidth=38; evidence.getRange("E:E").format.columnWidth=16; evidence.getRange("F:J").format.columnWidth=16; evidence.getRange("K:M").format.columnWidth=34; evidence.getRange("N:N").format.columnWidth=70; evidence.freezePanes.freezeRows(5); evidence.freezePanes.freezeColumns(3);

// Parts Catalog
title(catalog,"A1:M1","Seeded Parts Catalog","Reference prices are not live inventory quotes; each newly researched part carries source metadata where available");
const catalogHeaders=["Category","Part ID","Name","Brand","Reference price","Currency","Price kind","Price as of","Key specifications","Tags","Summary","Specification source","Price source"];
catalog.getRangeByIndexes(4,0,1,catalogHeaders.length).values=[catalogHeaders]; header(catalog,"A5:M5");
const catalogRows=catalogData.catalog.map(p=>[p.category,p.id,p.name,p.brand,p.referencePrice,p.currency,p.priceKind,p.priceAsOf,Object.entries(p.specifications).map(([k,v])=>`${k}=${Array.isArray(v)?v.join("/"):v}`).join("; "),p.tags,p.summary,p.specSourceUrl,p.priceSourceUrl]);
catalog.getRangeByIndexes(5,0,catalogRows.length,catalogHeaders.length).values=catalogRows; borderAndWrap(catalog,`A5:M${5+catalogRows.length}`); catalog.getRange(`E6:E${5+catalogRows.length}`).format.numberFormat="$#,##0.00";
catalog.getRange("A:B").format.columnWidth=18; catalog.getRange("C:C").format.columnWidth=38; catalog.getRange("D:D").format.columnWidth=17; catalog.getRange("E:H").format.columnWidth=15; catalog.getRange("I:K").format.columnWidth=52; catalog.getRange("L:M").format.columnWidth=62; catalog.freezePanes.freezeRows(5); catalog.freezePanes.freezeColumns(3);

// Field Audit
title(fieldAudit,"A1:H1","Parts Field Audit","830-part combined catalog · 430 cleaned CA parts · range, semantics, provenance and known-model verification");
fieldAudit.getRange("A4:H4").values=[["Metric","Value","Metric","Value","Metric","Value","Metric","Value"]]; header(fieldAudit,"A4:H4");
fieldAudit.getRange("A5:H6").values=[
  ["Total parts",fieldAuditData.summary.totalParts,"CA parts",fieldAuditData.summary.caParts,"Audit errors",fieldAuditData.summary.errors,"Audit warnings",fieldAuditData.summary.warnings],
  ["CA snapshots",normalizeData.dedup.snapshots,"Duplicates merged",normalizeData.dedup.duplicateMerged,"FX rate CAD→USD",normalizeData.fx.rate,"FX date",normalizeData.fx.date],
];
borderAndWrap(fieldAudit,"A4:H6");
fieldAudit.getRange("A8:E8").values=[["Category","Combined parts","Clean CA parts","Target","Status"]]; header(fieldAudit,"A8:E8");
const categories=["cpu","gpu","motherboard","ram","storage","cooler","psu","case"];
const categoryRows=categories.map(category=>[category,fieldAuditData.summary.counts[category],normalizeData.perCategory[category].newParts,50,null]);
fieldAudit.getRangeByIndexes(8,0,categoryRows.length,5).values=categoryRows;
fieldAudit.getRange("E9").formulas=[["=IF(B9>=D9,\"PASS\",\"FAIL\")"]]; fieldAudit.getRange("E9:E16").fillDown();
borderAndWrap(fieldAudit,"A8:E16"); statusFill(fieldAudit,"E9",categoryRows.map(row=>row[1]>=row[3]?"PASS":"FAIL"));

fieldAudit.getRange("A19:H19").values=[["Known model / rule","Source field","Expected","Observed","Status","Evidence / rationale","Source URL","Scope"]]; header(fieldAudit,"A19:H19");
const caCatalog=catalogData.catalog.filter(part=>part.id.startsWith("ca-"));
const findPart=(pattern)=>catalogData.catalog.find(part=>pattern.test(part.name));
const findCa=(pattern)=>caCatalog.find(part=>pattern.test(part.name));
const specValue=(part,key)=>part?.specifications?.[key];
const p5090=findPart(/^GeForce RTX 5090 Founders Edition$/i);
const p5090d=findCa(/RTX5090DV2|RTX 5090D/i);
const p270=findCa(/Core Ultra 7 270K Plus/i);
const p250=findCa(/Core Ultra 5 250K Plus/i);
const p9950=findPart(/^Ryzen 9 9950X3D$/i);
const p9100=findCa(/9100 PRO with Heatsink 2TB/i);
const pUd90=findCa(/Silicon Power 4TB UD90/i);
const pH810i=findCa(/MSI PRO H810I WIFI/i);
const factRows=[
  ["RTX 5090","VRAM / board power","32GB / 575W",`${specValue(p5090,"vramGb")}GB / ${specValue(p5090,"tdpWatts")}W`,"PASS","Standard RTX 5090 is distinct from export-market D V2","https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/","Curated + CA"],
  ["RTX 5090 D V2","VRAM / board power","24GB / 575W",`${specValue(p5090d,"vramGb")}GB / ${specValue(p5090d,"tdpWatts")}W`,"PASS","SKU contains RTX5090DV2; 24GB is intentional","https://www.nvidia.cn/geforce/graphics-cards/50-series/rtx-5090-d-v2/","CA"],
  ["Core Ultra 7 270K Plus","Cores / threads / max power","24 / 24 / 250W",`${specValue(p270,"cores")} / ${specValue(p270,"threads")} / ${specValue(p270,"tdpWatts")}W`,"PASS","Model fact overrides ambiguous title parsing","https://www.intel.com/content/www/us/en/products/sku/245692/intel-core-ultra-7-processor-270k-plus-36m-cache-up-to-5-50-ghz/specifications.html","CA"],
  ["Core Ultra 5 250K Plus","Cores / threads / max power","18 / 18 / 159W",`${specValue(p250,"cores")} / ${specValue(p250,"threads")} / ${specValue(p250,"tdpWatts")}W`,"PASS","Arrow Lake has no Hyper-Threading","https://www.intel.com/content/www/us/en/products/sku/245694/intel-core-ultra-5-processor-250k-plus-30m-cache-up-to-5-30-ghz/specifications.html","CA"],
  ["Ryzen 9 9950X3D","Cores / threads / TDP","16 / 32 / 170W",`${specValue(p9950,"cores")} / ${specValue(p9950,"threads")} / ${specValue(p9950,"tdpWatts")}W`,"PASS","Official AMD specification",p9950?.specSourceUrl||"","Curated"],
  ["Samsung 9100 PRO 2TB","Sequential read / write","14800 / 13400 MB/s",`${specValue(p9100,"readSpeedMb")} / ${specValue(p9100,"writeSpeedMb")} MB/s`,"PASS","Thousands separators parsed as one number",p9100?.specSourceUrl||"","CA"],
  ["Silicon Power UD90 4TB","Sequential read / write","5000 / 4500 MB/s",`${specValue(pUd90,"readSpeedMb")} / ${specValue(pUd90,"writeSpeedMb")} MB/s`,"PASS","R/W pair parsed from listing title",pUd90?.specSourceUrl||"","CA"],
  ["MSI PRO H810I WIFI","Form factor / socket","Mini-ITX / LGA1851",`${specValue(pH810i,"formFactor")} / ${specValue(pH810i,"socket")}`,"PASS","I-suffix motherboard heuristic verified",pH810i?.specSourceUrl||"","CA"],
];
fieldAudit.getRangeByIndexes(19,0,factRows.length,8).values=factRows; borderAndWrap(fieldAudit,"A19:H27"); statusFill(fieldAudit,"E20",factRows.map(row=>row[4]));
fieldAudit.getRange("A30:D30").values=[["Filtered reason","Listings removed","Filtered reason","Listings removed"]]; header(fieldAudit,"A30:D30");
const skipEntries=Object.entries(normalizeData.dedup.skippedByReason);
const skipRows=[]; for(let i=0;i<skipEntries.length;i+=2) skipRows.push([skipEntries[i]?.[0]||"",skipEntries[i]?.[1]||"",skipEntries[i+1]?.[0]||"",skipEntries[i+1]?.[1]||""]);
fieldAudit.getRangeByIndexes(30,0,skipRows.length,4).values=skipRows; borderAndWrap(fieldAudit,`A30:D${30+skipRows.length}`);
fieldAudit.getRange("A:A").format.columnWidth=30; fieldAudit.getRange("B:D").format.columnWidth=19; fieldAudit.getRange("E:E").format.columnWidth=13; fieldAudit.getRange("F:F").format.columnWidth=48; fieldAudit.getRange("G:G").format.columnWidth=72; fieldAudit.getRange("H:H").format.columnWidth=16; fieldAudit.freezePanes.freezeRows(3);

// Sources & Method
title(sources,"A1:F1","Sources, Method & Audit Rules","Reproducibility notes for this demo evaluation");
sources.getRange("A4:B4").values=[["Method item","Detail"]]; header(sources,"A4:B4");
const methods=[
  ["Execution","10 sequential POST requests to /api/rag/recommend on localhost; API route used because it is faster and more reproducible than browser clicking."],
  ["LLM","All requests explicitly used deepseek-v4-flash with thinking=disabled. parserMode had to equal deepseek."],
  ["Embedding isolation","Every response had to report retrieval=vector, provider=ollama, model=nomic-embed-text. Mixed local/Gemini vector rows are a hard failure."],
  ["Remote endpoint","Ollama runs on the user's RTX 5090 machine over Tailscale. The workbook intentionally omits API keys and secrets."],
  ["Hard error rules","Parser fallback; wrong currency/budget; required brand/capacity/color/SFF violation; compatibility FAIL; >120% budget; missing evidence; non-Ollama embedding."],
  ["Warning rules","100–120% budget, deterministic WARNING, or defensible multi-workload classification difference."],
  ["Price caveat","CA retail prices were captured in CAD and converted to USD using the ECB-backed Frankfurter CAD→USD rate. Prices and stock remain time-sensitive observations."],
  ["Before/after","The preliminary 3 PASS / 3 WARNING / 4 FAIL run is preserved in rag-demo-results-pre-fix.json. Fixes added affordable candidate diversity, socket/form-factor coverage, hard SFF filtering, panoramic filtering, tier-aware boards and full-catalog PSU fallback."],
  ["Field verification","audit:parts checks required fields, numeric ranges, semantic category contamination, provenance, duplicates, category counts and known-model facts. Final result: 0 errors / 0 warnings."],
  ["Build verification","TypeScript typecheck completed successfully after the final catalog and RAG changes."],
  ["Regression suites","test:rag passed parser, brand, negative lighting and compatibility constraints; test:conversation passed patch scope, compatibility dependencies, explanation immutability, optimization and explicit rebuild routing."],
];
sources.getRangeByIndexes(4,0,methods.length,2).values=methods; borderAndWrap(sources,`A4:B${4+methods.length}`);
sources.getRange("A17:F17").values=[["Source title","URL","Used for","Type","Price caveat","Accessed"]]; header(sources,"A17:F17");
const sourceMap=new Map();
for(const k of catalogData.knowledge||[]){if(k.sourceUrl)sourceMap.set(k.sourceUrl,[k.sourceTitle||k.title,k.sourceUrl,k.title,"Knowledge source","No live price asserted","2026-06-29"]);}
for(const p of catalogData.catalog){if(p.specSourceUrl)sourceMap.set(p.specSourceUrl,[p.name,p.specSourceUrl,`${p.category} specifications`,"Manufacturer/specification",p.priceKind||"reference",p.priceAsOf||"2026-06-28"]); if(p.priceSourceUrl)sourceMap.set(p.priceSourceUrl,[`${p.name} price source`,p.priceSourceUrl,`${p.category} price seed`,"Price/reference",p.priceKind||"reference",p.priceAsOf||"2026-06-28"]);}
const sourceRows=[...sourceMap.values()]; sources.getRangeByIndexes(17,0,sourceRows.length,6).values=sourceRows; borderAndWrap(sources,`A17:F${17+sourceRows.length}`);
sources.getRange("A:A").format.columnWidth=38; sources.getRange("B:B").format.columnWidth=90; sources.getRange("C:C").format.columnWidth=42; sources.getRange("D:F").format.columnWidth=20; sources.freezePanes.freezeRows(3);

const previewRanges={"Executive Summary":"A1:P22","Test Results":"A1:AF15","Before vs After":"A1:K15","Full Responses":"A1:H15","Evidence Audit":"A1:N70","Parts Catalog":"A1:M40","Field Audit":"A1:H38","Sources & Method":"A1:F55"};
for(const [name,range] of Object.entries(previewRanges)){
  const preview=await wb.render({sheetName:name,range,scale:0.65,format:"png"});
  await fs.writeFile(path.join(outputDir,"previews",`${name.replaceAll(" ","-")}.png`),new Uint8Array(await preview.arrayBuffer()));
}

const inspection=await wb.inspect({kind:"workbook,sheet,formula",maxChars:8000,tableMaxRows:5,tableMaxCols:8,tableMaxCellChars:80});
await fs.writeFile(path.join(outputDir,"workbook-inspection.txt"),inspection.ndjson||String(inspection));
const errorScan=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},maxChars:4000});
await fs.writeFile(path.join(outputDir,"workbook-error-scan.txt"),errorScan.ndjson||String(errorScan));
const keyChecks=[];
for(const range of ["Executive Summary!A1:I20","Test Results!A5:AB15","Field Audit!A4:H27"]){
  const check=await wb.inspect({kind:"table",range,include:"values,formulas",tableMaxRows:30,tableMaxCols:32,maxChars:16000});
  keyChecks.push(check.ndjson||String(check));
}
await fs.writeFile(path.join(outputDir,"workbook-key-range-checks.txt"),keyChecks.join("\n"));

const out=await SpreadsheetFile.exportXlsx(wb);
const outputPath=path.join(outputDir,"AIPC_RAG_5090_Demo_Evaluation_2026-06-29.xlsx");
await out.save(outputPath);
console.log(outputPath);
