-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "runStatus" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "Analysis" ADD COLUMN "runStartedAt" DATETIME;
ALTER TABLE "Analysis" ADD COLUMN "runError" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "priceCurrency" TEXT;
