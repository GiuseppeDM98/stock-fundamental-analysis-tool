-- CreateTable
CREATE TABLE "FinancialDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "currency" TEXT,
    "units" TEXT,
    "coverageLabel" TEXT,
    "dataJson" TEXT NOT NULL,
    "blocksJson" TEXT,
    "warningsJson" TEXT,
    "researchJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialDataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "reportMd" TEXT NOT NULL,
    "mosPercent" REAL NOT NULL,
    "priceAtAnalysis" REAL,
    "fairValueBull" REAL,
    "fairValueBase" REAL,
    "fairValueBear" REAL,
    "valuationMethod" TEXT,
    "reviewMd" TEXT,
    "reviewFairValueBull" REAL,
    "reviewFairValueBase" REAL,
    "reviewFairValueBear" REAL,
    "reviewValuationMethod" TEXT,
    "optimistFairValueBull" REAL,
    "optimistFairValueBase" REAL,
    "optimistFairValueBear" REAL,
    "optimistValuationMethod" TEXT,
    "optimistCritiqueMd" TEXT,
    "qualityFairValueBull" REAL,
    "qualityFairValueBase" REAL,
    "qualityFairValueBear" REAL,
    "qualityValuationMethod" TEXT,
    "qualityCritiqueMd" TEXT,
    "reviewBlindJson" TEXT,
    "optimistBlindJson" TEXT,
    "qualityBlindJson" TEXT,
    "datasetId" TEXT,
    "groundingJson" TEXT,
    "resultJson" TEXT,
    "currency" TEXT,
    "sector" TEXT,
    "reportLanguage" TEXT,
    "aiModel" TEXT,
    "aiEffort" TEXT,
    "aiThinking" BOOLEAN,
    "reviewResultJson" TEXT,
    "optimistResultJson" TEXT,
    "qualityResultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Analysis_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "FinancialDataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Analysis" ("aiEffort", "aiModel", "aiThinking", "companyName", "createdAt", "currency", "fairValueBase", "fairValueBear", "fairValueBull", "groundingJson", "id", "mosPercent", "optimistBlindJson", "optimistCritiqueMd", "optimistFairValueBase", "optimistFairValueBear", "optimistFairValueBull", "optimistResultJson", "optimistValuationMethod", "priceAtAnalysis", "qualityBlindJson", "qualityCritiqueMd", "qualityFairValueBase", "qualityFairValueBear", "qualityFairValueBull", "qualityResultJson", "qualityValuationMethod", "reportLanguage", "reportMd", "resultJson", "reviewBlindJson", "reviewFairValueBase", "reviewFairValueBear", "reviewFairValueBull", "reviewMd", "reviewResultJson", "reviewValuationMethod", "sector", "ticker", "userId", "valuationMethod") SELECT "aiEffort", "aiModel", "aiThinking", "companyName", "createdAt", "currency", "fairValueBase", "fairValueBear", "fairValueBull", "groundingJson", "id", "mosPercent", "optimistBlindJson", "optimistCritiqueMd", "optimistFairValueBase", "optimistFairValueBear", "optimistFairValueBull", "optimistResultJson", "optimistValuationMethod", "priceAtAnalysis", "qualityBlindJson", "qualityCritiqueMd", "qualityFairValueBase", "qualityFairValueBear", "qualityFairValueBull", "qualityResultJson", "qualityValuationMethod", "reportLanguage", "reportMd", "resultJson", "reviewBlindJson", "reviewFairValueBase", "reviewFairValueBear", "reviewFairValueBull", "reviewMd", "reviewResultJson", "reviewValuationMethod", "sector", "ticker", "userId", "valuationMethod" FROM "Analysis";
DROP TABLE "Analysis";
ALTER TABLE "new_Analysis" RENAME TO "Analysis";
CREATE INDEX "Analysis_userId_createdAt_idx" ON "Analysis"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FinancialDataset_userId_ticker_createdAt_idx" ON "FinancialDataset"("userId", "ticker", "createdAt");
