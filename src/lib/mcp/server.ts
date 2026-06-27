// MCP server scaffold exposing AIPC capabilities as tools:
//   - get_price_history  : historical price series for a part
//   - get_current_price  : latest price + staleness for a part
//   - check_compatibility: run the deterministic compatibility checker on a build
//   - estimate_performance: real benchmark-based FPS / token-s / render time
//   - sync_prices        : trigger a live price refresh
//
// Run standalone:  npx tsx src/lib/mcp/server.ts
// Or wire into Cursor via .cursor/mcp.json pointing at this command.
//
// Phase 3 will promote this to a full multi-agent orchestration; this file
// establishes the tool surface that agents (and external MCP clients) can call.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { checkCompatibility, estimateWattage } from "@/lib/compatibility/compatibilityChecker";
import { estimatePerformance } from "@/lib/performance/performanceEstimator";
import { getCurrentPrice, getPriceHistory, getPriceStats } from "@/lib/pricing/priceHistory";
import { getBenchmarksForPart } from "@/lib/benchmarks/benchmarkDb";
import { syncPrices } from "@/lib/pricing/syncPrices";
import { partById, parts as allParts } from "@/data/parts";
import type { BuildParts, Part } from "@/types/parts";
import type { BuildRequest } from "@/types/build";

const tools = [
  {
    name: "get_current_price",
    description: "Get the latest price + staleness flag for a single AIPC part id (e.g. 'gpu-4090').",
    inputSchema: {
      type: "object" as const,
      properties: { partId: { type: "string", description: "Part id from the AIPC catalog." } },
      required: ["partId"],
    },
  },
  {
    name: "get_price_history",
    description: "Get a 30-day price history series for a part (for charting / trend analysis).",
    inputSchema: {
      type: "object" as const,
      properties: {
        partId: { type: "string" },
        days: { type: "number", default: 30, description: "Lookback window in days (1-180)." },
      },
      required: ["partId"],
    },
  },
  {
    name: "get_benchmarks",
    description: "Get public benchmark rows (FPS / token-s / render seconds) for a part.",
    inputSchema: {
      type: "object" as const,
      properties: { partId: { type: "string" } },
      required: ["partId"],
    },
  },
  {
    name: "check_compatibility",
    description: "Run the deterministic compatibility checker on a set of part ids forming a full build. Returns PASS/WARNING/FAIL per rule.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cpu: { type: "string" }, gpu: { type: "string" }, motherboard: { type: "string" },
        ram: { type: "string" }, storage: { type: "string" }, cooler: { type: "string" },
        psu: { type: "string" }, case: { type: "string" },
      },
      required: ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"],
    },
  },
  {
    name: "estimate_performance",
    description: "Estimate performance (FPS, token/s, Blender render seconds, Cinebench) for a build given part ids + a use case. Uses public benchmark data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cpu: { type: "string" }, gpu: { type: "string" }, motherboard: { type: "string" },
        ram: { type: "string" }, storage: { type: "string" }, cooler: { type: "string" },
        psu: { type: "string" }, case: { type: "string" },
        useCase: { type: "string", enum: ["gaming", "ai", "development", "video", "balanced"], default: "balanced" },
        resolution: { type: "string", enum: ["1080p", "1440p", "4k"], default: "1440p" },
        budget: { type: "number", default: 2000 }, currency: { type: "string", default: "USD" },
        country: { type: "string", default: "US" },
      },
      required: ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"],
    },
  },
  {
    name: "sync_prices",
    description: "Trigger a live price refresh from configured North American providers. Returns per-provider status. Requires SYNC_API_TOKEN env or dev mode.",
    inputSchema: {
      type: "object" as const,
      properties: { provider: { type: "string", description: "Restrict to one provider (bestbuy | pcpartpicker | list)." } },
    },
  },
  {
    name: "list_parts",
    description: "List all parts in the AIPC catalog, optionally filtered by category.",
    inputSchema: {
      type: "object" as const,
      properties: { category: { type: "string", enum: ["cpu", "gpu", "motherboard", "ram", "storage", "cooler", "psu", "case"] } },
    },
  },
];

function resolvePart(id: string): Part | null {
  return partById(id) ?? null;
}

function buildFromIds(ids: { cpu: string; gpu: string; motherboard: string; ram: string; storage: string; cooler: string; psu: string; case: string }): BuildParts | { error: string } {
  const lookup = <K extends keyof BuildParts>(k: K): BuildParts[K] | { error: string } => {
    const p = resolvePart(ids[k]);
    if (!p) return { error: `part not found: ${ids[k]}` };
    return p as BuildParts[K];
  };
  const cpu = lookup("cpu"); if ("error" in cpu) return cpu;
  const gpu = lookup("gpu"); if ("error" in gpu) return gpu;
  const motherboard = lookup("motherboard"); if ("error" in motherboard) return motherboard;
  const ram = lookup("ram"); if ("error" in ram) return ram;
  const storage = lookup("storage"); if ("error" in storage) return storage;
  const cooler = lookup("cooler"); if ("error" in cooler) return cooler;
  const psu = lookup("psu"); if ("error" in psu) return psu;
  const pcCase = lookup("case"); if ("error" in pcCase) return pcCase;
  return { cpu, gpu, motherboard, ram, storage, cooler, psu, case: pcCase } as BuildParts;
}

const server = new Server(
  { name: "aipc", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      case "get_current_price": {
        const partId = String(args.partId ?? "");
        const price = await getCurrentPrice(partId);
        return { content: [{ type: "text", text: JSON.stringify(price ?? { error: "no price data" }) }] };
      }
      case "get_price_history": {
        const partId = String(args.partId ?? "");
        const days = Math.min(180, Math.max(1, Number(args.days ?? 30)));
        const stats = await getPriceStats(partId, days);
        return { content: [{ type: "text", text: JSON.stringify(stats) }] };
      }
      case "get_benchmarks": {
        const partId = String(args.partId ?? "");
        const rows = await getBenchmarksForPart(partId);
        return { content: [{ type: "text", text: JSON.stringify(rows) }] };
      }
      case "check_compatibility": {
        const ids = args as Parameters<typeof buildFromIds>[0];
        const build = buildFromIds(ids);
        if ("error" in build) return { content: [{ type: "text", text: JSON.stringify({ error: build.error }) }] };
        const results = checkCompatibility(build);
        const watts = estimateWattage(build);
        return { content: [{ type: "text", text: JSON.stringify({ results, estimatedWattage: watts }) }] };
      }
      case "estimate_performance": {
        const ids = args as Parameters<typeof buildFromIds>[0] & { useCase?: string; resolution?: string; budget?: number; currency?: string; country?: string };
        const build = buildFromIds(ids);
        if ("error" in build) return { content: [{ type: "text", text: JSON.stringify({ error: build.error }) }] };
        const request: BuildRequest = {
          budget: Number(ids.budget ?? 2000),
          currency: (ids.currency as "USD") ?? "USD",
          country: (ids.country === "Canada" ? "Canada" : ids.country === "China" ? "China" : "US"),
          useCase: (ids.useCase as BuildRequest["useCase"]) ?? "balanced",
          resolution: (ids.resolution as "1080p" | "1440p" | "4k") ?? "1440p",
        };
        const perf = await estimatePerformance(build, request);
        return { content: [{ type: "text", text: JSON.stringify(perf) }] };
      }
      case "sync_prices": {
        const provider = args.provider ? String(args.provider) : undefined;
        const results = await syncPrices({ provider });
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      }
      case "list_parts": {
        const cat = args.category as Part["category"] | undefined;
        const list = cat ? allParts.filter(p => p.category === cat) : allParts;
        const summary = list.map(p => ({ id: p.id, name: p.name, brand: p.brand, price: p.price, category: p.category }));
        return { content: [{ type: "text", text: JSON.stringify(summary) }] };
      }
      default:
        return { content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "tool failed" }) }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error("[aipc-mcp] fatal:", err); process.exit(1); });
