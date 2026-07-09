-- CreateTable
CREATE TABLE "EarningsEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "nextEarningsDate" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'unknown',
    "sourceUrl" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EarningsEstimate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EarningsEstimate_userId_idx" ON "EarningsEstimate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EarningsEstimate_userId_ticker_key" ON "EarningsEstimate"("userId", "ticker");
