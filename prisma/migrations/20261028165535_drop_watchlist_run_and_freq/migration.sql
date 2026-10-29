/*
  Warnings:

  - You are about to drop the `WatchlistRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `watchlistFreq` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "WatchlistRun_userId_ticker_idx";

-- DropIndex
DROP INDEX "WatchlistRun_userId_runAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WatchlistRun";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchlistEmail" TEXT,
    "watchlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastManualWatchlistRun" DATETIME,
    "aiModel" TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    "aiEffort" TEXT NOT NULL DEFAULT 'high',
    "aiThinkingEnabled" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_User" ("aiEffort", "aiModel", "aiThinkingEnabled", "createdAt", "email", "id", "lastManualWatchlistRun", "passwordHash", "watchlistEmail", "watchlistEnabled") SELECT "aiEffort", "aiModel", "aiThinkingEnabled", "createdAt", "email", "id", "lastManualWatchlistRun", "passwordHash", "watchlistEmail", "watchlistEnabled" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
