-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "optimistCritiqueMd" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "optimistFairValueBase" REAL;
ALTER TABLE "Analysis" ADD COLUMN "optimistFairValueBear" REAL;
ALTER TABLE "Analysis" ADD COLUMN "optimistFairValueBull" REAL;
ALTER TABLE "Analysis" ADD COLUMN "optimistValuationMethod" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "qualityCritiqueMd" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "qualityFairValueBase" REAL;
ALTER TABLE "Analysis" ADD COLUMN "qualityFairValueBear" REAL;
ALTER TABLE "Analysis" ADD COLUMN "qualityFairValueBull" REAL;
ALTER TABLE "Analysis" ADD COLUMN "qualityValuationMethod" TEXT;
