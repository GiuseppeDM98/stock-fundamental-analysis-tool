/**
 * Playwright configuration for the end-to-end suite (WORKFLOW.md §3).
 *
 * The app runs as `next dev` (or `next start`, see SERVER_COMMAND) on port 3200 against the isolated SQLite file `.e2e/e2e.db`,
 * NEVER the Turso database `.env` points at. The database is rebuilt (migrations + seed) by
 * e2e/prepare-db.ts as the first half of the webServer command.
 *
 * The dev server uses the regular `.next` cache directory, so do not run the suite while
 * another `next dev` / `next build` is running from the same checkout: two Next processes
 * writing one cache corrupt each other's chunks. (A separate distDir would avoid that, but
 * `next dev` then rewrites tracked files — tsconfig.json's include and next-env.d.ts — on
 * every start.)
 *
 * Projects:
 *   setup           signs users A and B in through /login and saves their storageState
 *   e2e             functional specs (auth, authorization, pages) — `npm run e2e`
 *   visual-desktop  screenshot spec at 1280×800 — `npm run e2e:visual`
 *   visual-phone    screenshot spec at 390×844
 */
import { defineConfig } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_DB_URL,
  E2E_PORT,
  REPO_ROOT,
  STORAGE_STATE,
  assertIsolatedDatabaseUrl,
  buildIsolatedEnv,
} from "./e2e/support/env";

// Evaluated before Playwright starts the webServer: a non-`file:` URL stops the run here,
// before any process, migration or request exists.
assertIsolatedDatabaseUrl(E2E_DB_URL, "playwright.config.ts");

// `next dev` by default, so `npm run e2e` needs no build. scripts/ci-local.sh sets
// E2E_SERVER=start to run the suite against the production build it just made instead:
// closer to what Vercel serves, and immune to hot reloads triggered by files being edited
// while the suite runs.
const SERVER_COMMAND = process.env.E2E_SERVER === "start" ? `npx next start -p ${E2E_PORT}` : `npx next dev -p ${E2E_PORT}`;

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One worker, in file order: authorization.spec.ts mutates (and finally deletes) its
  // sacrificial rows, and a single `next dev` compiles routes on demand — parallel workers
  // would mostly wait on the same compile while racing on shared rows.
  fullyParallel: false,
  workers: 1,
  // One retry so a failure leaves a trace; a test that only passes on retry is reported
  // as "flaky", not hidden.
  retries: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: E2E_BASE_URL,
    browserName: "chromium",
    viewport: DESKTOP,
    locale: "en-US",
    timezoneId: "Europe/Rome",
    trace: "on-first-retry",
    // The PWA service worker would sit between the page and context.route(), letting
    // requests bypass the quote/AI stubs.
    serviceWorkers: "block",
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "e2e",
      testMatch: /(auth|authorization|pages)\.spec\.ts$/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE.userA },
    },
    {
      name: "visual-desktop",
      testMatch: /visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE.userA, viewport: DESKTOP },
    },
    {
      name: "visual-phone",
      testMatch: /visual\.spec\.ts$/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE.userA, viewport: PHONE, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx tsx e2e/prepare-db.ts && ${SERVER_COMMAND}`,
    cwd: REPO_ROOT,
    url: `${E2E_BASE_URL}/login`,
    // Never attach to a server someone else started: its environment (and database) is
    // unknown. A busy port fails the run instead.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: buildIsolatedEnv(),
  },
});
