ALTER TABLE "Part"
  ADD COLUMN "specSourceUrl" TEXT,
  ADD COLUMN "priceSourceUrl" TEXT,
  ADD COLUMN "priceKind" TEXT,
  ADD COLUMN "priceAsOf" TIMESTAMP(3);
