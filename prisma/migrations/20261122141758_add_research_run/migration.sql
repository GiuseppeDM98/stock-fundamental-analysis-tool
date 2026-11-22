-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "statementsJson" TEXT,
    "marketJson" TEXT,
    "estimatesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchRun_userId_createdAt_idx" ON "ResearchRun"("userId", "createdAt");
