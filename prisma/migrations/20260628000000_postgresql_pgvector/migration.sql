CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "Part" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "chipset" TEXT,
  "imageUrl" TEXT,
  "productUrl" TEXT,
  "tags" TEXT[] NOT NULL,
  "summary" TEXT NOT NULL,
  "specsJson" JSONB NOT NULL,
  "listPriceUsd" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceSnapshot" (
  "id" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "retailer" TEXT NOT NULL,
  "region" TEXT NOT NULL DEFAULT 'US',
  "priceUsd" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "inStock" BOOLEAN NOT NULL DEFAULT true,
  "url" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BenchmarkResult" (
  "id" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "benchmarkKey" TEXT NOT NULL,
  "benchmarkKind" TEXT NOT NULL,
  "workload" TEXT NOT NULL,
  "resolution" TEXT,
  "quality" TEXT,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "publishedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenchmarkResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "partsTouched" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL,
  "category" TEXT,
  "partId" TEXT,
  "sourceUrl" TEXT,
  "sourceTitle" TEXT,
  "contentHash" TEXT NOT NULL,
  "embeddingModel" TEXT,
  "embedding" vector(384),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Part_category_idx" ON "Part"("category");
CREATE INDEX "Part_brand_idx" ON "Part"("brand");
CREATE INDEX "PriceSnapshot_partId_capturedAt_idx" ON "PriceSnapshot"("partId", "capturedAt");
CREATE INDEX "PriceSnapshot_retailer_capturedAt_idx" ON "PriceSnapshot"("retailer", "capturedAt");
CREATE INDEX "PriceSnapshot_partId_retailer_capturedAt_idx" ON "PriceSnapshot"("partId", "retailer", "capturedAt");
CREATE INDEX "BenchmarkResult_partId_benchmarkKey_idx" ON "BenchmarkResult"("partId", "benchmarkKey");
CREATE INDEX "BenchmarkResult_benchmarkKind_workload_idx" ON "BenchmarkResult"("benchmarkKind", "workload");
CREATE INDEX "BenchmarkResult_benchmarkKey_resolution_quality_idx" ON "BenchmarkResult"("benchmarkKey", "resolution", "quality");
CREATE INDEX "KnowledgeChunk_category_idx" ON "KnowledgeChunk"("category");
CREATE INDEX "KnowledgeChunk_partId_idx" ON "KnowledgeChunk"("partId");
CREATE INDEX "KnowledgeChunk_contentHash_idx" ON "KnowledgeChunk"("contentHash");
CREATE INDEX "KnowledgeChunk_tags_gin_idx" ON "KnowledgeChunk" USING GIN ("tags");
CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkResult" ADD CONSTRAINT "BenchmarkResult_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
