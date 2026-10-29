/**
 * Main pages, signed in as fixture user A. Each test pairs what is visible (seeded decoy
 * words, so the right record is proven on screen) with the database rows it must reflect.
 * Read-only: nothing here mutates data, and every AI action button is left unclicked.
 */
import { test, expect } from "./support/test";
import { count, queryAll, queryOne } from "./support/db";
import { DECOY, IDS, TICKERS, USER_A } from "./support/fixtures";

test("hub shows A's recent analyses, last snapshot P&L and watchlist count from the database", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();

  // The three newest analyses in the DB are exactly the three linked rows.
  const recent = await queryAll<{ id: string; ticker: string }>(
    "SELECT id, ticker FROM Analysis WHERE userId = ? ORDER BY createdAt DESC LIMIT 3",
    [USER_A.id]
  );
  expect(recent.length).toBe(3);
  for (const a of recent) {
    await expect(page.locator(`a[href="/analyses/${a.id}"]`)).toHaveText(a.ticker);
  }

  const last = await queryOne<{ totalEur: number; costEur: number }>(
    "SELECT totalEur, costEur FROM PortfolioSnapshot WHERE userId = ? ORDER BY takenAt DESC LIMIT 1",
    [USER_A.id]
  );
  const pct = ((last!.totalEur - last!.costEur) / last!.costEur) * 100;
  await expect(page.locator('a[href="/portfolio"]').filter({ hasText: "as of" })).toContainText(`(+${pct.toFixed(1)}%)`);

  const watchCount = await count("SELECT COUNT(*) AS n FROM WatchlistItem WHERE userId = ?", [USER_A.id]);
  await expect(page.locator('a[href="/watchlist"]').filter({ hasText: "tracked" })).toContainText(`${watchCount}`);
});

test("analyses list groups by ticker, counts match the DB, and a group expands", async ({ page }) => {
  await page.goto("/analyses");

  const tickers = await count("SELECT COUNT(DISTINCT ticker) AS n FROM Analysis WHERE userId = ?", [USER_A.id]);
  const analyses = await count("SELECT COUNT(*) AS n FROM Analysis WHERE userId = ?", [USER_A.id]);
  await expect(page.getByText(`${tickers} tickers · ${analyses} analyses`)).toBeVisible();

  // B's analysis must never appear in A's list.
  await expect(page.getByText(DECOY.userBCompany)).toHaveCount(0);

  // Upcoming-earnings strip comes from the seeded EarningsEstimate.
  await expect(page.getByText("Upcoming earnings")).toBeVisible();

  // The analyst-panel ticker: two saves grouped into one card, reviewed badge, then expand.
  const card = page.locator(".card").filter({ hasText: DECOY.panelCompany });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("✓ Reviewed")).toBeVisible();
  await card.getByRole("button", { name: "Expand" }).click();

  // The position badge counts only the open lot, never the sold one next to it.
  const openPanelLot = await queryOne<{ shares: number }>("SELECT shares FROM Position WHERE id = ?", [IDS.positionPanelOpen]);
  const closedPanelLot = await queryOne<{ shares: number }>("SELECT shares FROM Position WHERE id = ?", [IDS.positionPanelClosed]);
  await expect(card.getByText(`Position: ${openPanelLot!.shares} shares @`)).toBeVisible();
  await expect(card.getByText(`Position: ${openPanelLot!.shares + closedPanelLot!.shares} shares @`)).toHaveCount(0);

  for (const label of ["Skeptic", "Bull", "Quality", "Consensus"]) {
    await expect(card.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(card.getByText("Estimate evolution (history)")).toBeVisible();

  const panelSaves = await count("SELECT COUNT(*) AS n FROM Analysis WHERE userId = ? AND ticker = ?", [USER_A.id, TICKERS.panel]);
  expect(panelSaves).toBe(2);
  await card.getByRole("button", { name: "1 older analysis" }).click();
  await expect(card.getByText("Jun 10, 2026").or(card.getByText("10 Jun 2026")).first()).toBeVisible();

  // "Open report" navigates to the newest save of that ticker.
  await card.getByRole("button", { name: "Open report →" }).click();
  await expect(page).toHaveURL(new RegExp(`/analyses/${IDS.analysisPanel}$`));
  await expect(page.getByText(DECOY.panelReport)).toBeVisible();
});

test("grounded analysis detail renders the report from its stored result and the deterministic checks card", async ({ page }) => {
  const row = await queryOne<{
    groundingJson: string | null;
    reportMd: string;
    resultJson: string | null;
    reviewResultJson: string | null;
    reviewBlindJson: string | null;
  }>("SELECT groundingJson, reportMd, resultJson, reviewResultJson, reviewBlindJson FROM Analysis WHERE id = ?", [IDS.analysisGrounded]);
  expect(row?.groundingJson, "seeded grounded row carries groundingJson").toBeTruthy();
  // Current format: a stored result, and a report whose JSON block is the very last thing.
  expect(JSON.parse(row!.resultJson!).sector).toBe("Regulated Utilities");
  expect(row!.reportMd.trimEnd().endsWith("```")).toBe(true);
  expect(row!.reportMd.lastIndexOf("```json\n")).toBeGreaterThan(row!.reportMd.indexOf("## 1. Overview"));
  expect(row!.reportMd).toContain('"sector": "Utilities"');

  await page.goto(`/analyses/${IDS.analysisGrounded}`);
  await expect(page.getByRole("heading", { name: DECOY.groundedCompany })).toBeVisible();
  await expect(page.getByText(DECOY.groundedReport)).toBeVisible();
  // The summary comes from the resultJson column, not from the fence: the sector badge is
  // the column's, which the fence does not carry.
  await expect(page.getByText("Regulated Utilities", { exact: true })).toBeVisible();
  await expect(page.getByText("Utilities", { exact: true })).toHaveCount(0);
  // Neither the closing JSON block nor the start marker is printed as text.
  await expect(page.getByText('"intrinsicPerShare"')).toHaveCount(0);
  await expect(page.getByText("<!--report-->")).toHaveCount(0);

  // The card needs the stubbed live price + currency; it appears once the quote resolves.
  await expect(page.getByRole("heading", { name: "Deterministic checks", exact: true })).toBeVisible();
  await expect(page.getByText("checks against the live price · 11.40 EUR")).toBeVisible();
  // sections_present reads the Markdown: the seeded report has sections 1, 2 and 8 only.
  await expect(page.getByText("— missing 3,4,5,6,7,9,10", { exact: true })).toBeVisible();
  await expect(page.getByText("Analyst Panel")).toBeVisible();

  // The Skeptic's FINAL JSON is read back from reviewResultJson: kill price and revision
  // reason on the blind card, the final kill_price gate under it.
  const final = JSON.parse(row!.reviewResultJson!) as { killPrice: number; revisions: Array<{ reason: string }> };
  expect(final.killPrice).toBe(7.9);
  expect(final.revisions[0].reason).toContain(DECOY.groundedRevisionReason);
  await expect(page.getByText(DECOY.groundedSkepticCritique)).toBeVisible();
  await expect(page.getByText(/^✓ Final · Kill price declared — 7\.90$/)).toBeVisible();
  // The blind commitment is read back from reviewBlindJson too, its own kill price apart
  // from the final one.
  expect((JSON.parse(row!.reviewBlindJson!) as { killPrice: number }).killPrice).toBe(8.1);
  await expect(page.getByText(/^✓ Kill price declared — 8\.10$/)).toBeVisible();
  await expect(page.getByText(new RegExp(DECOY.groundedRevisionReason))).toBeVisible();
});

test("a Quick analysis (no dataset) gets the deterministic checks card, read from its leading fence", async ({ page }) => {
  const row = await queryOne<{ groundingJson: string | null; resultJson: string | null }>(
    "SELECT groundingJson, resultJson FROM Analysis WHERE id = ? AND resultJson IS NULL",
    [IDS.analysisPanel]
  );
  expect(row, "the panel row has no resultJson column: the card is built from the fence").toBeTruthy();
  expect(row!.groundingJson).toBeNull();

  await page.goto(`/analyses/${IDS.analysisPanel}`);
  await expect(page.getByRole("heading", { name: "Deterministic checks", exact: true })).toBeVisible();
  await expect(page.getByText("No dataset: basis, market-implied and net-debt gates unavailable", { exact: true })).toBeVisible();
  expect(await page.getByText(/— no dataset$/).count()).toBeGreaterThanOrEqual(6);
  // The gates that need only the JSON and the price still compute: bear 130 < live 150.
  await expect(page.getByText("— bear 130.00 · price 150.00", { exact: true })).toBeVisible();
  await expect(page.getByText("— bear 130.00 · base 180.00 · bull 220.00", { exact: true })).toBeVisible();
  await expect(page.getByText("— missing 2,3,4,5,6,7,9,10", { exact: true })).toBeVisible();
});

test("when the live quote fails, the saved page reads the price at analysis everywhere and says so", async ({ page }) => {
  const row = await queryOne<{ priceAtAnalysis: number }>("SELECT priceAtAnalysis FROM Analysis WHERE id = ?", [IDS.analysisPanel]);
  expect(row!.priceAtAnalysis).toBe(142);
  // A page route wins over the context's quote stub.
  await page.route(`**/api/quote/${TICKERS.panel}`, (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));

  await page.goto(`/analyses/${IDS.analysisPanel}`);
  await expect(page.getByText("checks against the price at analysis (live quote unavailable) · 142.00 USD")).toBeVisible();
  await expect(page.getByText("— bear 130.00 · price 142.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Price at analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Current Price", { exact: true })).toHaveCount(0);
  // The banner keeps the shares and the cost, with no P&L made up from an old price.
  const banner = page.getByText("Open position:").locator("..");
  await expect(banner).toContainText("20 shares @");
  await expect(banner).not.toContainText("%");
  await expect(banner).not.toContainText("Loading P&L");
});

test("analysis with all three lenses shows every stored critique", async ({ page }) => {
  const row = await queryOne<{ reviewMd: string; optimistCritiqueMd: string; qualityCritiqueMd: string }>(
    "SELECT reviewMd, optimistCritiqueMd, qualityCritiqueMd FROM Analysis WHERE id = ?",
    [IDS.analysisPanel]
  );
  expect(row?.reviewMd).toContain(DECOY.skepticCritique);

  await page.goto(`/analyses/${IDS.analysisPanel}`);
  for (const decoy of [DECOY.skepticCritique, DECOY.optimistCritique, DECOY.qualityCritique]) {
    await expect(page.getByText(decoy)).toBeVisible();
  }
  await expect(page.getByText(DECOY.panelReport)).toBeVisible();
  // An older save (JSON block at the top, no resultJson) still gets its summary, from the fence.
  await expect(page.getByText("Industrials", { exact: true })).toBeVisible();

  // A holds this ticker, so the open-position banner is shown.
  await expect(page.getByText("Open position:")).toBeVisible();
});

test("open-position banner counts only open lots", async ({ page }) => {
  const open = await queryAll<{ shares: number }>(
    "SELECT shares FROM Position WHERE userId = ? AND ticker = ? AND closedAt IS NULL",
    [USER_A.id, TICKERS.panel]
  );
  const openShares = open.reduce((sum, l) => sum + l.shares, 0);
  expect(openShares).toBe(20);

  await page.goto(`/analyses/${IDS.analysisPanel}`);
  await expect(page.getByText(`${openShares} shares @`)).toBeVisible({ timeout: 5_000 });
});

test("an old-format analysis (no JSON block, no grounding) still opens", async ({ page }) => {
  const row = await queryOne<{ groundingJson: string | null; fairValueBase: number | null; reportMd: string }>(
    "SELECT groundingJson, fairValueBase, reportMd FROM Analysis WHERE id = ?",
    [IDS.analysisLegacy]
  );
  expect(row?.groundingJson).toBeNull();
  expect(row?.fairValueBase).toBeNull();
  expect(row?.reportMd).not.toContain("```json");

  const response = await page.goto(`/analyses/${IDS.analysisLegacy}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: DECOY.legacyCompany })).toBeVisible();
  await expect(page.getByText(DECOY.legacyReport)).toBeVisible();
  // No valuation summary and no analyst panel without a parseable JSON block.
  await expect(page.getByText("Analyst Panel")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deterministic checks" })).toHaveCount(0);
});

test("someone else's analysis detail page is a 404 for A", async ({ page }) => {
  const response = await page.goto(`/analyses/${IDS.analysisUserB}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText(DECOY.userBCompany)).toHaveCount(0);
});

test("portfolio shows open positions, the closed-positions archive and the history chart", async ({ page }) => {
  await page.goto("/portfolio");

  const openTickers = await count("SELECT COUNT(DISTINCT ticker) AS n FROM Position WHERE userId = ? AND closedAt IS NULL", [USER_A.id]);
  const openLots = await count("SELECT COUNT(*) AS n FROM Position WHERE userId = ? AND closedAt IS NULL", [USER_A.id]);
  const closed = await count("SELECT COUNT(*) AS n FROM Position WHERE userId = ? AND closedAt IS NOT NULL", [USER_A.id]);
  expect(closed).toBe(2);

  await expect(page.getByText(`${openTickers} tickers, ${openLots} purchases`)).toBeVisible();
  await expect(page.getByText(DECOY.groundedCompany).first()).toBeVisible();

  // Per-purchase view shows each lot's notes.
  await page.getByRole("button", { name: "Per Purchase" }).click();
  await expect(page.getByText(DECOY.positionNote)).toBeVisible();

  // Closed positions archive, collapsed by default.
  const archiveToggle = page.getByRole("button", { name: `▼ Closed Positions (${closed})` });
  await archiveToggle.click();
  await expect(page.getByText(DECOY.closedPositionCompany)).toBeVisible();

  // History chart: >= 2 snapshots → the Recharts lines render, with the event legend.
  const snapshots = await count("SELECT COUNT(*) AS n FROM PortfolioSnapshot WHERE userId = ?", [USER_A.id]);
  expect(snapshots).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Portfolio value over time")).toBeVisible();
  await expect(page.locator(".recharts-line").first()).toBeVisible();
  await expect(page.getByText("Sold", { exact: true })).toBeVisible();
  await expect(page.getByText("Dividend", { exact: true })).toBeVisible();

  // Dividends received: every snapshot ever taken, not only the chart's 90 days — the seed
  // puts one dividend day outside that window. Summed here from the rows themselves.
  const rows = await queryAll<{ data: string }>("SELECT data FROM PortfolioSnapshot WHERE userId = ?", [USER_A.id]);
  const dividendsEur = rows.reduce((sum, r) => {
    const entries = (JSON.parse(r.data) as { entries?: { dividendPaidEur?: number }[] }).entries ?? [];
    return sum + entries.reduce((s, e) => s + (e.dividendPaidEur ?? 0), 0);
  }, 0);
  expect(dividendsEur).toBe(47.5);
  await expect(page.getByText("+€47.50")).toBeVisible();

  // The exit signal is measured on the same basis as the /analyses verdict: the panel
  // ticker's consensus base 112.5 at MoS 25% → intrinsic 150 = the stub price, in the
  // analysis's own currency (USD), so it fires.
  // It is the only held ticker at or above its intrinsic base, so exactly one pill shows.
  await page.getByRole("button", { name: "Aggregated" }).click();
  await expect(page.getByText("⚠ At Fair Value")).toHaveCount(1);
});

test("watchlist lists A's items and shows notes when expanded", async ({ page }) => {
  await page.goto("/watchlist");
  const items = await queryAll<{ companyName: string }>("SELECT companyName FROM WatchlistItem WHERE userId = ?", [USER_A.id]);
  expect(items.length).toBe(3);
  for (const item of items) {
    await expect(page.getByText(item.companyName, { exact: true })).toBeVisible();
  }

  const card = page.locator(".card").filter({ hasText: DECOY.groundedCompany });
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card.getByText(DECOY.watchlistNote)).toBeVisible();
});

test("advisor loads A's saved session and its messages without calling the AI", async ({ page }) => {
  const messages = await count("SELECT COUNT(*) AS n FROM AdvisorMessage WHERE sessionId = ?", [IDS.advisorSession]);
  expect(messages).toBe(2);

  await page.goto("/advisor");
  await expect(page.getByRole("button", { name: new RegExp(DECOY.advisorTitle) }).first()).toBeVisible();
  // The most recent session auto-loads: its stored assistant reply is on screen.
  await expect(page.getByText(DECOY.advisorReply)).toBeVisible();
});
