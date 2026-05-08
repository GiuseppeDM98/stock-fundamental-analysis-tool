-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN "fairValueBase" REAL;
ALTER TABLE "Analysis" ADD COLUMN "fairValueBear" REAL;
ALTER TABLE "Analysis" ADD COLUMN "fairValueBull" REAL;
ALTER TABLE "Analysis" ADD COLUMN "priceAtAnalysis" REAL;
ALTER TABLE "Analysis" ADD COLUMN "valuationMethod" TEXT;

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "purchasePrice" REAL NOT NULL,
    "shares" REAL NOT NULL,
    "purchasedAt" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_userId_ticker_idx" ON "Position"("userId", "ticker");
