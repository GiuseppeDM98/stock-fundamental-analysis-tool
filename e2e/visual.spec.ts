/**
 * Full-page screenshots of the main pages, in the desktop and phone projects
 * (`npm run e2e:visual`; regenerate with `npm run e2e:visual:update`).
 *
 * Determinism:
 *   - quote prices and FX come from the stubs in support/test.ts; Google Fonts is blocked,
 *     so every run renders with the same fallback font;
 *   - the browser clock is frozen to midday of referenceDay(), the same anchor the seed used
 *     for snapshot and earnings dates, so "in N days"/"as of" texts and holding periods do
 *     not move during the day;
 *   - animations and the caret are disabled (playwright.config.ts) and the Next.js dev
 *     indicator is hidden (visual.css).
 *
 * Print: the analysis detail pages are also captured under `print` media emulation, which is
 * what "Download PDF" (window.print()) renders: app/print.css inverts `.print-report` to a
 * light palette and the `print:` variants hide the app chrome. The regular screenshots never
 * apply either, so without these a regression in the PDF export would go unnoticed.
 *
 * LIMIT: snapshot and earnings dates are relative to today (the snapshots API only returns
 * the last 90 days), so a baseline is valid for the UTC day it was generated on. Generate
 * the baselines at the start of a session, compare after the change, never commit them.
 */
import path from "node:path";
import { test, expect } from "./support/test";
import { DECOY, IDS, referenceDay } from "./support/fixtures";

const STYLE_PATH = path.join(__dirname, "visual.css");

const PAGES: Array<{ name: string; url: string; ready: string; loggedOut?: boolean }> = [
  { name: "login", url: "/login", ready: "Sign in", loggedOut: true },
  { name: "hub", url: "/", ready: "Pick up where you left off" },
  { name: "analyses", url: "/analyses", ready: DECOY.panelCompany },
  { name: "analysis-grounded", url: `/analyses/${IDS.analysisGrounded}`, ready: "Deterministic checks" },
  { name: "analysis-panel", url: `/analyses/${IDS.analysisPanel}`, ready: DECOY.qualityCritique },
  { name: "analysis-legacy", url: `/analyses/${IDS.analysisLegacy}`, ready: DECOY.legacyReport },
  { name: "portfolio", url: "/portfolio", ready: "Portfolio value over time" },
  { name: "watchlist", url: "/watchlist", ready: DECOY.watchlistOnlyCompany },
  { name: "advisor", url: "/advisor", ready: DECOY.advisorReply },
];

for (const p of PAGES) {
  test.describe(p.name, () => {
    if (p.loggedOut) test.use({ storageState: { cookies: [], origins: [] } });

    test(`${p.name} matches its baseline`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(referenceDay().getTime() + 12 * 60 * 60 * 1000));
      await page.goto(p.url);
      await expect(page.getByText(p.ready).first()).toBeVisible();
      // Client components fetch after hydration (quotes, snapshots, earnings): wait for the
      // network to settle so the screenshot never catches a half-loaded state.
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true, stylePath: STYLE_PATH });
    });
  });
}

const PRINT_PAGES: Array<{ name: string; url: string; ready: string }> = [
  { name: "analysis-grounded-print", url: `/analyses/${IDS.analysisGrounded}`, ready: "Deterministic checks" },
  { name: "analysis-panel-print", url: `/analyses/${IDS.analysisPanel}`, ready: DECOY.qualityCritique },
];

for (const p of PRINT_PAGES) {
  test.describe(p.name, () => {
    test(`${p.name} matches its baseline`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(referenceDay().getTime() + 12 * 60 * 60 * 1000));
      await page.goto(p.url);
      // The ready text is checked on screen media: some of it may be hidden in print.
      await expect(page.getByText(p.ready).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.emulateMedia({ media: "print" });
      await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true, stylePath: STYLE_PATH });
    });
  });
}
