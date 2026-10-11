/**
 * Playwright globalSetup. Runs AFTER the webServer is up (Playwright's order), so it does not
 * build the database — e2e/prepare-db.ts already did, before the server started (see the
 * comment there for why). What it adds:
 *   1. the safety guard once more, on the resolved URL the server was given;
 *   2. a post-condition: the fixture users exist in THAT file. If the server had been pointed
 *      anywhere else the seeded users would not be there and every later assertion against
 *      the database would be meaningless — better to stop here;
 *   3. a warm-up: one plain GET per route the specs visit. `next dev` compiles a route on its
 *      first request and may hot-reload pages that are already open while it does, which
 *      wipes a half-filled form mid-test. Compiling everything up front removes that race.
 */
import { E2E_BASE_URL, E2E_DB_URL, assertIsolatedDatabaseUrl, buildIsolatedEnv } from "./support/env";
import { queryAll } from "./support/db";
import { IDS, USER_A, USER_B } from "./support/fixtures";

const WARM_UP_PATHS = [
  "/login",
  "/register",
  "/",
  "/analyses",
  `/analyses/${IDS.analysisGrounded}`,
  "/portfolio",
  "/watchlist",
  "/advisor",
  "/api/auth/session",
  "/api/analyses",
  `/api/analyses/${IDS.analysisGrounded}`,
  "/api/positions",
  `/api/positions/${IDS.positionAuthz}`,
  "/api/portfolio/snapshots",
  "/api/watchlist",
  "/api/earnings",
  "/api/advisor/sessions",
  `/api/advisor/sessions/${IDS.advisorSession}`,
  "/api/settings/ai",
];

export default async function globalSetup(): Promise<void> {
  assertIsolatedDatabaseUrl(E2E_DB_URL, "globalSetup");
  assertIsolatedDatabaseUrl(buildIsolatedEnv().TURSO_DATABASE_URL, "globalSetup (server env)");

  const rows = await queryAll<{ email: string }>("SELECT email FROM User WHERE email IN (?, ?)", [USER_A.email, USER_B.email]);
  const found = new Set(rows.map((r) => r.email));
  for (const email of [USER_A.email, USER_B.email]) {
    if (!found.has(email)) throw new Error(`[e2e] fixture user ${email} missing from ${E2E_DB_URL} — prepare-db did not run against this file`);
  }

  // Unauthenticated on purpose: a redirect or a 401 still compiles the route. Sequential, so
  // the dev server compiles one entry at a time instead of thrashing.
  for (const path of WARM_UP_PATHS) {
    await fetch(`${E2E_BASE_URL}${path}`, { redirect: "manual" }).catch(() => undefined);
  }
}
