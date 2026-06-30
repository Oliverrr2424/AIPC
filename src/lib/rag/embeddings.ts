export const EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

export type EmbeddingPurpose = "document" | "query";
export type EmbeddingProvider = "local" | "gemini" | "ollama";

export function embeddingModel() {
  const provider = embeddingProvider();
  if (provider === "local") return process.env.LOCAL_EMBEDDING_MODEL?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
  if (provider === "ollama") return process.env.OLLAMA_EMBEDDING_MODEL?.trim() || DEFAULT_OLLAMA_EMBEDDING_MODEL;
  return process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingsConfigured() {
  const provider = embeddingProvider();
  if (provider === "local") return true;
  if (provider === "ollama") return Boolean(process.env.OLLAMA_EMBEDDING_URL?.trim());
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function embeddingProvider(): EmbeddingProvider {
  const v = process.env.EMBEDDING_PROVIDER?.toLowerCase();
  if (v === "gemini") return "gemini";
  if (v === "ollama") return "ollama";
  return "local";
}

function normalize(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error("Embedding model returned a zero-length vector.");
  return values.map(value => value / magnitude);
}

function instructedText(text: string, purpose: EmbeddingPurpose, model: string) {
  if (embeddingProvider() === "local") return `${purpose === "document" ? "passage" : "query"}: ${text}`;
  if (embeddingProvider() === "ollama" && /nomic[-/]embed/i.test(model)) return `${purpose === "document" ? "search_document" : "search_query"}: ${text}`;
  if (embeddingProvider() === "ollama") return text;
  if (model !== "gemini-embedding-2") return text;
  const instruction = purpose === "document"
    ? "Represent this PC hardware knowledge passage for retrieval. Preserve product families, workloads, constraints, aesthetics, compatibility, and upgrade trade-offs."
    : "Retrieve PC hardware knowledge that answers this build-planning query. Match meaning across Chinese and English, including implicit constraints and preferences.";
  return `${instruction}\n\n${text}`;
}

export async function embedText(text: string, purpose: EmbeddingPurpose): Promise<number[]> {
  const configuredDimensions = Number(process.env.EMBEDDING_DIMENSIONS || EMBEDDING_DIMENSIONS);
  if (configuredDimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} for the current pgvector schema.`);
  }
  const model = embeddingModel();
  if (embeddingProvider() === "local") {
    const extractor = await localExtractor();
    const output = await extractor(instructedText(text, purpose, model), { pooling: "mean", normalize: true });
    const values = Array.from(output.data as Float32Array);
    if (values.length !== EMBEDDING_DIMENSIONS) throw new Error(`Local embedding model returned ${values.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
    return normalize(values);
  }
  if (embeddingProvider() === "ollama") {
    const baseUrl = process.env.OLLAMA_EMBEDDING_URL?.trim();
    if (!baseUrl) throw new Error("OLLAMA_EMBEDDING_URL is required when EMBEDDING_PROVIDER=ollama.");
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OLLAMA_EMBEDDING_API_KEY?.trim() ? { Authorization: `Bearer ${process.env.OLLAMA_EMBEDDING_API_KEY.trim()}` } : {}),
      },
      body: JSON.stringify({ model, input: instructedText(text, purpose, model), dimensions: EMBEDDING_DIMENSIONS }),
    });
    if (!res.ok) throw new Error(`Ollama embedding request failed: ${res.status} ${await res.text()}`);
    const payload = await res.json() as { data?: { embedding?: number[] }[] };
    const values = payload.data?.[0]?.embedding;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Ollama embedding returned ${values?.length || 0} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
    }
    return normalize(values);
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini.");
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const config = model === "gemini-embedding-001"
    ? { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY" }
    : { outputDimensionality: EMBEDDING_DIMENSIONS };
  const response = await ai.models.embedContent({ model, contents: instructedText(text, purpose, model), config });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding model returned ${values?.length || 0} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
  }
  return normalize(values);
}

type LocalExtractor = ((text: string, options: { pooling: "mean"; normalize: true }) => Promise<{ data: Float32Array }>) & { dispose: () => Promise<void> };
const globalEmbedding = globalThis as unknown as { aipcLocalExtractor?: Promise<LocalExtractor>; aipcEmbeddingShutdown?: boolean };

async function localExtractor(): Promise<LocalExtractor> {
  if (!globalEmbedding.aipcLocalExtractor) {
    globalEmbedding.aipcLocalExtractor = (async () => {
      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = process.env.HF_CACHE_DIR || ".cache/huggingface";
      transformers.env.remoteHost = process.env.HF_ENDPOINT || "https://huggingface.co";
      const extractor = await transformers.pipeline("feature-extraction", embeddingModel(), { dtype: "q8" });
      return extractor as unknown as LocalExtractor;
    })();
  }
  if (!globalEmbedding.aipcEmbeddingShutdown && typeof process !== "undefined") {
    globalEmbedding.aipcEmbeddingShutdown = true;
    const dispose = () => { void globalEmbedding.aipcLocalExtractor?.then(extractor => extractor.dispose()); };
    process.once("SIGINT", dispose);
    process.once("SIGTERM", dispose);
  }
  return globalEmbedding.aipcLocalExtractor;
}

export function chunkEmbeddingText(chunk: { title: string; content: string; tags: string[]; category?: string | null }) {
  return [
    `Title: ${chunk.title}`,
    chunk.category ? `Category: ${chunk.category}` : "",
    `Tags: ${chunk.tags.join(", ")}`,
    `Content: ${chunk.content}`,
  ].filter(Boolean).join("\n");
}

export function vectorLiteral(values: number[]) {
  if (values.length !== EMBEDDING_DIMENSIONS || values.some(value => !Number.isFinite(value))) {
    throw new Error("Refusing to serialize an invalid embedding vector.");
  }
  return `[${values.join(",")}]`;
}
