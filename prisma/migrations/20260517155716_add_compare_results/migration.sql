-- CreateTable
CREATE TABLE "CompareResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "fairValueBull" REAL NOT NULL,
    "fairValueBase" REAL NOT NULL,
    "fairValueBear" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompareResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CompareResult_userId_idx" ON "CompareResult"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompareResult_userId_ticker_key" ON "CompareResult"("userId", "ticker");
