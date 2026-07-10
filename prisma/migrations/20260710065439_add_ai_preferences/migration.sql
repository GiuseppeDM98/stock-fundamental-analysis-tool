-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchlistEmail" TEXT,
    "watchlistFreq" TEXT NOT NULL DEFAULT 'biweekly',
    "watchlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastManualWatchlistRun" DATETIME,
    "aiModel" TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    "aiEffort" TEXT NOT NULL DEFAULT 'high',
    "aiThinkingEnabled" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_User" ("createdAt", "email", "id", "lastManualWatchlistRun", "passwordHash", "watchlistEmail", "watchlistEnabled", "watchlistFreq") SELECT "createdAt", "email", "id", "lastManualWatchlistRun", "passwordHash", "watchlistEmail", "watchlistEnabled", "watchlistFreq" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
