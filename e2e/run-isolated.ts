/**
 * Runs a command with the isolated e2e environment (e2e/support/env.ts) layered over the
 * current one: `npx tsx e2e/run-isolated.ts npm run build`.
 *
 * Exists for scripts/ci-local.sh: `next build` loads `.env`, which points at the production
 * Turso database, and any page that queries during the build would reach it. Running the
 * build through this wrapper forces TURSO_DATABASE_URL/DATABASE_URL onto the local file
 * first, behind the same `file:` guard as the rest of the suite.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT, assertIsolatedDatabaseUrl, buildIsolatedEnv } from "./support/env";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: tsx e2e/run-isolated.ts <command> [args...]");
  process.exit(2);
}

const env = { ...process.env, ...buildIsolatedEnv() };
assertIsolatedDatabaseUrl(env.TURSO_DATABASE_URL, "run-isolated");
assertIsolatedDatabaseUrl(env.DATABASE_URL, "run-isolated");

const result = spawnSync(command, args, { cwd: REPO_ROOT, env, stdio: "inherit" });
if (result.error) {
  console.error(`[run-isolated] could not start ${command}:`, result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
