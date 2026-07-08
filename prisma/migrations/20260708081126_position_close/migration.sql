-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "isin" TEXT,
    "companyName" TEXT NOT NULL,
    "purchasePrice" REAL NOT NULL,
    "shares" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "purchasedAt" DATETIME NOT NULL,
    "notes" TEXT,
    "capitalGainsTaxRate" REAL,
    "closedAt" DATETIME,
    "sellPrice" REAL,
    "realizedRecorded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Position" ("capitalGainsTaxRate", "companyName", "createdAt", "currency", "id", "isin", "notes", "purchasePrice", "purchasedAt", "shares", "ticker", "userId") SELECT "capitalGainsTaxRate", "companyName", "createdAt", "currency", "id", "isin", "notes", "purchasePrice", "purchasedAt", "shares", "ticker", "userId" FROM "Position";
DROP TABLE "Position";
ALTER TABLE "new_Position" RENAME TO "Position";
CREATE INDEX "Position_userId_idx" ON "Position"("userId");
CREATE INDEX "Position_userId_ticker_idx" ON "Position"("userId", "ticker");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
