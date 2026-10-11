/**
 * Recreates the isolated e2e database: safety guard → delete the old file → `prisma migrate
 * deploy` → seed.
 *
 * WHY THIS RUNS FROM THE webServer COMMAND, NOT FROM globalSetup: Playwright starts the
 * webServer BEFORE globalSetup, and the dev server opens the SQLite file on its first
 * request. Deleting and recreating the file in globalSetup would leave the server holding
 * the unlinked old file. Running here (`tsx e2e/prepare-db.ts && next dev …`) guarantees the
 * database is ready before the server process exists, and the `&&` means a failed guard,
 * migration or seed never starts the server at all.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { E2E_DB_URL, REPO_ROOT, assertIsolatedDatabaseUrl, buildIsolatedEnv, e2eDbPath } from "./support/env";
import { seedE2eDatabase } from "../scripts/seed-e2e";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

function prismaClientIsStale(): boolean {
  // `prisma generate` normally runs inside `npm run build`; a standalone `npm run e2e` must
  // not seed through a client generated from an older schema.
  const client = path.join(REPO_ROOT, "generated", "prisma", "client.ts");
  const schema = path.join(REPO_ROOT, "prisma", "schema.prisma");
  return !fs.existsSync(client) || fs.statSync(client).mtimeMs < fs.statSync(schema).mtimeMs;
}

async function main(): Promise<void> {
  // 1. Guard — before any filesystem or database operation.
  assertIsolatedDatabaseUrl(E2E_DB_URL, "prepare-db");
  const env = { ...process.env, ...buildIsolatedEnv() };
  assertIsolatedDatabaseUrl(env.DATABASE_URL, "prepare-db (Prisma CLI env)");

  // 2. Fresh file every run: throwaway users registered by auth.spec.ts don't pile up.
  const dbPath = e2eDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });

  // 3. Schema from prisma/migrations — the same SQL that is applied to Turso by hand.
  if (prismaClientIsStale()) execFileSync(NPX, ["prisma", "generate"], { cwd: REPO_ROOT, env, stdio: "inherit" });
  execFileSync(NPX, ["prisma", "migrate", "deploy"], { cwd: REPO_ROOT, env, stdio: "inherit" });

  // 4. Fixtures.
  const today = await seedE2eDatabase(E2E_DB_URL);
  console.log(`[e2e] database ready at ${dbPath} (reference day ${today.toISOString().slice(0, 10)})`);
}

main().catch((err) => {
  console.error("[e2e] prepare-db failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
