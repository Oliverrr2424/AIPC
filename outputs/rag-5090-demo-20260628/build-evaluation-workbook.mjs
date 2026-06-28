import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "/Users/hounemo/Documents/AIPC";
const outputDir = path.join(root, "outputs", "rag-5090-demo-20260628");
const after = JSON.parse(await fs.readFile(path.join(outputDir, "rag-demo-results.json"), "utf8"));
const before = JSON.parse(await fs.readFile(path.join(outputDir, "rag-demo-results-before-fixes.json"), "utf8"));
const catalogData = JSON.parse(await fs.readFile(path.join(outputDir, "demo-catalog.json"), "utf8"));

const wb = Workbook.create();
const summary = wb.worksheets.add("Executive Summary");
const tests = wb.worksheets.add("Test Results");
const compare = wb.worksheets.add("Before vs After");
const responses = wb.worksheets.add("Full Responses");
const evidence = wb.worksheets.add("Evidence Audit");
const catalog = wb.worksheets.add("Parts Catalog");
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
title(summary, "A1:P1", "AIPC RAG · RTX 5090 Demo Evaluation", "DeepSeek V4 Flash · non-thinking · remote Ollama nomic-embed-text · 2026-06-28");
summary.getRange("A4:F4").values = [["Metric", "Value", "Metric", "Value", "Metric", "Value"]];
header(summary, "A4:F4");
summary.getRange("A5:F7").values = [
  ["Final pass", null, "Final warning", null, "Final fail", null],
  ["Average latency", null, "Remote vector coverage", null, "Hard compatibility FAIL", null],
  ["Seeded parts", catalogData.database.partCount, "Knowledge chunks", catalogData.database.knowledgeChunkCount, "Benchmarks", catalogData.database.benchmarkCount],
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
  ["Intent layer", "10/10 DeepSeek parser", "Obvious hard failures", before.summary.fail, after.summary.fail, "Capacity/PSU/budget fixes removed hard failures"],
  ["Model mode", "10/10 non-thinking", "Pass", before.summary.pass, after.summary.pass, "Improved without switching model or thinking mode"],
  ["Embedding route", "10/10 vector + Ollama", "Warnings", before.summary.warning, after.summary.warning, "Warnings retained for honest review"],
  ["Embedding model", "nomic-embed-text", "Remote fallback", "0 local", "0 local", "No Transformers.js/local embedding used"],
  ["Database", "PostgreSQL + pgvector", "Catalog coverage", "54 legacy parts", `${catalogData.database.partCount} parts`, "Real-source seed expansion"],
  ["Build + regressions", "Build passed; 3 suites passed", "Knowledge coverage", "38 chunks", `${catalogData.database.knowledgeChunkCount} chunks`, "RAG 4/4 + recommendation + conversation"],
];
borderAndWrap(summary, "A9:F15");
summary.getRange("A17:F17").values = [["Remaining warnings", "Test", "Observed", "Severity", "Recommended follow-up", "Owner"]];
header(summary, "A17:F17");
const warningRows = after.results.filter(x => x.audit.verdict === "WARNING").map(x => [
  x.persona, x.id, x.audit.warnings.join("; "), "Review", x.id === "T01" ? "Add feasibility response when budget cannot meet target" : x.id === "T06" ? "Prefer 1200W PSU or explain modest headroom" : x.id === "T09" ? "Prefer B850/X870 for enthusiast CPU when budget allows" : "Expose multi-use-case classification in UI", "Recommendation engine",
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
  ["Price caveat","Seed prices are manufacturer suggested/reference values or observed official retail values, not guaranteed live street prices or inventory."],
  ["Before/after","The first run is preserved in rag-demo-results-before-fixes.json. Fixes added hard capacity filtering, general SFF filtering, PSU pool coverage, and CPU/motherboard budget downgrades."],
  ["Build verification","TypeScript typecheck and Next.js production build completed successfully after the final run."],
  ["Regression suites","rag:eval passed 4/4 semantic retrieval cases; test:rag passed negative constraints; test:conversation passed patch scope, compatibility dependencies, explanation immutability, optimization, and rebuild routing."],
];
sources.getRangeByIndexes(4,0,methods.length,2).values=methods; borderAndWrap(sources,`A4:B${4+methods.length}`);
sources.getRange("A15:F15").values=[["Source title","URL","Used for","Type","Price caveat","Accessed"]]; header(sources,"A15:F15");
const sourceMap=new Map();
for(const k of catalogData.knowledge||[]){if(k.sourceUrl)sourceMap.set(k.sourceUrl,[k.sourceTitle||k.title,k.sourceUrl,k.title,"Knowledge source","No live price asserted","2026-06-28"]);}
for(const p of catalogData.catalog){if(p.specSourceUrl)sourceMap.set(p.specSourceUrl,[p.name,p.specSourceUrl,`${p.category} specifications`,"Manufacturer/specification",p.priceKind||"reference",p.priceAsOf||"2026-06-28"]); if(p.priceSourceUrl)sourceMap.set(p.priceSourceUrl,[`${p.name} price source`,p.priceSourceUrl,`${p.category} price seed`,"Price/reference",p.priceKind||"reference",p.priceAsOf||"2026-06-28"]);}
const sourceRows=[...sourceMap.values()]; sources.getRangeByIndexes(15,0,sourceRows.length,6).values=sourceRows; borderAndWrap(sources,`A15:F${15+sourceRows.length}`);
sources.getRange("A:A").format.columnWidth=38; sources.getRange("B:B").format.columnWidth=90; sources.getRange("C:C").format.columnWidth=42; sources.getRange("D:F").format.columnWidth=20; sources.freezePanes.freezeRows(3);

await fs.mkdir(path.join(outputDir,"previews"),{recursive:true});
const previewNames=["Executive Summary","Test Results","Before vs After","Full Responses","Evidence Audit","Parts Catalog","Sources & Method"];
for(const name of previewNames){
  const preview=await wb.render({sheetName:name,autoCrop:"all",scale:0.65,format:"png"});
  await fs.writeFile(path.join(outputDir,"previews",`${name.replaceAll(" ","-")}.png`),new Uint8Array(await preview.arrayBuffer()));
}

const inspection=await wb.inspect({kind:"workbook,sheet,formula",maxChars:8000,tableMaxRows:5,tableMaxCols:8,tableMaxCellChars:80});
await fs.writeFile(path.join(outputDir,"workbook-inspection.txt"),inspection.ndjson||String(inspection));
const errorScan=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},maxChars:4000});
await fs.writeFile(path.join(outputDir,"workbook-error-scan.txt"),errorScan.ndjson||String(errorScan));

const out=await SpreadsheetFile.exportXlsx(wb);
const outputPath=path.join(outputDir,"AIPC_RAG_5090_Demo_Evaluation_2026-06-28.xlsx");
await out.save(outputPath);
console.log(outputPath);
