# PCBuilder V2

An explainable RAG-augmented PC recommendation system built with Next.js, React, TypeScript, Tailwind CSS, Recharts, DeepSeek V4, and Gemini.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/build/chat` for the natural-language RAG builder, or `/build` for the form-based builder.

## How it works

1. The selected DeepSeek V4 or Gemini model parses natural language into a structured `BuildRequest`, with a deterministic local fallback.
2. A replaceable retrieval layer searches local `KnowledgeChunk` seed data by keyword, category, and tags. Its interface can later be backed by pgvector.
3. The candidate retriever builds a scored part pool for each category using performance, value, RAG relevance, preferences, and upgradeability.
4. The recommendation engine selects only from those pools. Gemini never invents the final hardware list.
5. Deterministic rules validate socket, memory type, PSU headroom, clearances, cooler height, and motherboard form factor.
6. The selected model explains the final build using retrieved evidence citations. It is explicitly prohibited from inventing prices, benchmarks, or inventory.

Copy `.env.example` to `.env.local` and set `DEEPSEEK_API_KEY` and/or `GEMINI_API_KEY`. The UI supports DeepSeek V4 Flash, DeepSeek V4 Pro, DeepSeek thinking/non-thinking modes, and Gemini 2.5 Flash. The app remains functional without a provider by using local intent parsing and evidence-based explanations.

## Commands

```bash
npm run typecheck
npm run build
```

Prices are estimated market prices and are not live listings.
