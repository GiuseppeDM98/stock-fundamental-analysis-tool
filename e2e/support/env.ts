/**
 * Isolated environment for the end-to-end suite.
 *
 * WHY THIS FILE EXISTS: `.env` points TURSO_DATABASE_URL at the PRODUCTION Turso database.
 * A plain `next dev` (or a Prisma CLI call) started from this repo would therefore read and
 * write production data. Every process the e2e tooling spawns — the dev server, the
 * migration, the seed, the build inside `ci:local` — gets its environment from
 * `buildIsolatedEnv()`, which forces every database variable onto a local SQLite file and
 * blanks every paid/remote credential. Variables already present in a process environment
 * win over `.env` both for Next.js (@next/env skips keys that are already defined, even as
 * an empty string) and for Prisma's `dotenv/config`, which is what makes the override work.
 *
 * `assertIsolatedDatabaseUrl()` is the hard stop: it is called at config load, before the
 * migration, inside the seed and in the global setup, so a non-`file:` URL aborts the run
 * before anything is touched.
 */
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const E2E_DIR = path.join(REPO_ROOT, ".e2e");

// 3200, not 3000: the owner's own `npm run dev` (and other sessions' servers) use 3000/3100.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

const DEFAULT_DB_PATH = path.join(E2E_DIR, "e2e.db");

/** Signed-in browser states written by e2e/auth.setup.ts (cookies only, no secrets beyond the
 *  throwaway session). */
export const STORAGE_STATE = {
  userA: path.join(E2E_DIR, "state", "user-a.json"),
  userB: path.join(E2E_DIR, "state", "user-b.json"),
} as const;

/**
 * The database URL every e2e process uses. `E2E_DB_URL` exists only so the safety guard can
 * be exercised (point it at a `libsql://` URL and the run must abort); in normal use it is
 * unset and the URL is the absolute `file:` path of `.e2e/e2e.db`.
 */
export const E2E_DB_URL = process.env.E2E_DB_URL ?? `file:${DEFAULT_DB_PATH}`;

/** Throws unless `url` is a local SQLite `file:` URL. Never reached with production data. */
export function assertIsolatedDatabaseUrl(url: string | undefined, where: string): asserts url is string {
  if (!url || !url.startsWith("file:")) {
    throw new Error(
      `[e2e safety guard] ${where}: refusing to run against database URL ` +
        `"${url ?? "<unset>"}" — the e2e tooling only ever runs on a local "file:" SQLite database.`
    );
  }
}

/** Absolute filesystem path of the isolated database (the URL minus its `file:` scheme). */
export function e2eDbPath(): string {
  assertIsolatedDatabaseUrl(E2E_DB_URL, "e2eDbPath");
  return E2E_DB_URL.slice("file:".length);
}

/**
 * Environment overrides for every child process of the e2e tooling. Spread it on top of
 * `process.env` — never the other way round, or a shell variable could re-point a run at
 * production.
 */
export function buildIsolatedEnv(): Record<string, string> {
  assertIsolatedDatabaseUrl(E2E_DB_URL, "buildIsolatedEnv");
  return {
    // Database: the app reads TURSO_*, the Prisma CLI reads DATABASE_URL.
    TURSO_DATABASE_URL: E2E_DB_URL,
    TURSO_AUTH_TOKEN: "",
    DATABASE_URL: E2E_DB_URL,
    // Auth.js: cookies are minted for this port, with a throwaway secret so a session
    // cookie from the suite is worthless anywhere else.
    NEXTAUTH_URL: E2E_BASE_URL,
    AUTH_TRUST_HOST: "true",
    NEXTAUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-000000",
    AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-000000",
    DISABLE_REGISTRATION: "false",
    // Paid / outbound services: blanked so a test that accidentally reaches an AI route or
    // the email digest fails loudly instead of spending money or sending mail.
    ANTHROPIC_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
    CRON_SECRET: "e2e-cron-secret",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

