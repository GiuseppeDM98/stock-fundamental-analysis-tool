/**
 * Main pages, signed in as fixture user A. Each test pairs what is visible (seeded decoy
 * words, so the right record is proven on screen) with the database rows it must reflect.
 * Read-only: nothing here mutates data, and every AI action button is left unclicked.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./support/test";
import { count, queryAll, queryOne } from "./support/db";
import { DECOY, IDS, TICKERS, USER_A, referenceDay } from "./support/fixtures";

/** The clock the seed dated the unfinished NSCA runs against (the visual's, too). */
const fixClock = (page: Page) => page.clock.setFixedTime(new Date(referenceDay().getTime() + 12 * 60 * 60 * 1000));

test("hub shows A's recent analyses, last snapshot P&L and watchlist count from the database", async ({ page }) => {
  await fixClock(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();

  // The three newest FINISHED analyses in the DB are exactly the three linked rows: the two
  // NSCA runs are newer, and neither takes a slot.
  const recent = await queryAll<{ id: string; ticker: string }>(
    "SELECT id, ticker FROM Analysis WHERE userId = ? AND runStatus = 'done' ORDER BY createdAt DESC LIMIT 3",
    [USER_A.id]
  );
  expect(recent.length).toBe(3);
  for (const a of recent) {
    await expect(page.locator(`a[href="/analyses/${a.id}"]`)).toHaveText(a.ticker);
  }
  await expect(page.locator(`a[href="/analyses/${IDS.analysisCut}"]`)).toHaveCount(0);
  await expect(page.locator(`a[href="/analyses/${IDS.analysisLive}"]`)).toHaveCount(0);

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
  await fixClock(page);
  await page.goto("/analyses");

  // Every ticker has a group (NSCA's holds only its status lines); only finished rows count
  // as analyses.
  const tickers = await count("SELECT COUNT(DISTINCT ticker) AS n FROM Analysis WHERE userId = ?", [USER_A.id]);
  const analyses = await count("SELECT COUNT(*) AS n FROM Analysis WHERE userId = ? AND runStatus = 'done'", [USER_A.id]);
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
    datasetId: string | null;
    groundingJson: string | null;
    reportMd: string;
    resultJson: string | null;
    reviewResultJson: string | null;
    reviewBlindJson: string | null;
    updateNotesMd: string | null;
  }>("SELECT datasetId, groundingJson, reportMd, resultJson, reviewResultJson, reviewBlindJson, updateNotesMd FROM Analysis WHERE id = ?", [IDS.analysisGrounded]);
  expect(row?.datasetId, "seeded grounded row reads its dataset").toBe(IDS.datasetGrounded);
  expect(row!.groundingJson).toBeNull();
  // Current format: a stored result, and a report whose JSON block is the very last thing.
  expect(JSON.parse(row!.resultJson!).sector).toBe("Regulated Utilities");
  expect(row!.reportMd.trimEnd().endsWith("```")).toBe(true);
  expect(row!.reportMd.lastIndexOf("```json\n")).toBeGreaterThan(row!.reportMd.indexOf("## 1. Overview"));
  expect(row!.reportMd).toContain('"sector": "Utilities"');
  expect(row!.updateNotesMd).toContain(DECOY.groundedWebUpdate);

  await page.goto(`/analyses/${IDS.analysisGrounded}`);
  await expect(page.getByRole("heading", { name: DECOY.groundedCompany })).toBeVisible();
  await expect(page.getByText(DECOY.groundedReport)).toBeVisible();
  // The web update's notes, in their own box above the report.
  const webUpdate = page.getByTestId("web-update-card");
  await expect(webUpdate.getByText("Web update")).toBeVisible();
  await expect(webUpdate.getByText(DECOY.groundedWebUpdate).first()).toBeVisible();
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

  // The dataset's tables, each year with its source: the income statement from its paste
  // block (FY2025 revenue 1,000), the balance sheet with no source recorded.
  const income = page.getByTestId("dataset-table-income");
  await expect(income.getByRole("row").nth(2)).toContainText("1,000");
  await expect(income.getByRole("row").nth(1).getByText("📋 paste")).toHaveCount(5);
  await expect(page.getByTestId("dataset-table-balance").getByRole("row").nth(1).getByText("—")).toHaveCount(5);
});

/** The value under a statistic of the dividend card, by its label. */
const dividendTile = (page: Page, label: string) =>
  page.getByTestId("dividend-outlook").locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");

test("the grounded detail shows the dividend outlook: history, forward yield, yield on cost and the gate's coverage", async ({ page }) => {
  // The inputs, from the database: the dataset's DPS history, the declared path, the open lots.
  const dataset = await queryOne<{ dataJson: string }>("SELECT dataJson FROM FinancialDataset WHERE id = ?", [IDS.datasetGrounded]);
  const financials = JSON.parse(dataset!.dataJson).financials as Array<{ dividendsPerShare: number | null }>;
  expect(financials.map((f) => f.dividendsPerShare)).toEqual([0.36, 0.38, 0.4, 0.4, 0.4]);
  const analysis = await queryOne<{ resultJson: string }>("SELECT resultJson FROM Analysis WHERE id = ?", [IDS.analysisGrounded]);
  const forwardBase = JSON.parse(analysis!.resultJson).dividends.path[0].base as number;
  expect(forwardBase).toBe(0.42);
  const lots = await queryAll<{ shares: number; purchasePrice: number; currency: string }>(
    "SELECT shares, purchasePrice, currency FROM Position WHERE userId = ? AND ticker = ? AND closedAt IS NULL",
    [USER_A.id, TICKERS.grounded]
  );
  expect(new Set(lots.map((l) => l.currency))).toEqual(new Set(["EUR"]));
  const wac = lots.reduce((s, l) => s + l.shares * l.purchasePrice, 0) / lots.reduce((s, l) => s + l.shares, 0);

  await page.goto(`/analyses/${IDS.analysisGrounded}`);
  const card = page.getByTestId("dividend-outlook");
  await expect(card.getByRole("heading", { name: "Dividend outlook" })).toBeVisible();
  await expect(dividendTile(page, "Last DPS")).toHaveText("0.40");
  await expect(dividendTile(page, "Years without a cut")).toHaveText("4");
  // The stubbed quote is 11.40 EUR: 0.42 / 11.40 = 3.7%, and on the lots' cost 3.9%.
  await expect(card.getByText("Forward yield", { exact: true }).locator("..")).toContainText(`Base ${((forwardBase / 11.4) * 100).toFixed(1)}%`);
  await expect(card.getByText("Forward yield", { exact: true }).locator("..")).toContainText("Base 3.7%");
  await expect(card.getByText("Forward yield on cost", { exact: true }).locator("..")).toContainText(`Base ${((forwardBase / wac) * 100).toFixed(1)}%`);
  await expect(card.getByText("Forward yield on cost", { exact: true }).locator("..")).toContainText("Base 3.9%");
  // The coverage is the dividend_coverage gate's ratio, on the checks card above it.
  await expect(dividendTile(page, "FCF coverage")).toHaveText("0.42 ✓");
  await expect(page.getByText(/^✓ Dividend covered by FCF — .*ratio 0\.42$/)).toBeVisible();
  // The chart: labelled as an image, its data table beside it, every year and no other.
  await expect(card.getByRole("img", { name: "Dividend per share, history and projected path" })).toBeAttached();
  await expect(card.locator("table.sr-only tbody tr")).toHaveCount(8);
  await expect(card.getByTestId("source-legend")).toContainText("📋 paste");
  // Between the checks card and the dataset's tables.
  const order = await page.evaluate(() => {
    const at = (el: Element | null) => (el ? Array.from(document.querySelectorAll("*")).indexOf(el) : -1);
    return [
      at(Array.from(document.querySelectorAll("h3")).find((h) => h.textContent === "Deterministic checks") ?? null),
      at(document.querySelector('[data-testid="dividend-outlook"]')),
      at(document.querySelector('[data-testid="dataset-table-income"]')),
    ];
  });
  expect(order[0]).toBeGreaterThan(-1);
  expect(order[1]).toBeGreaterThan(order[0]);
  expect(order[2]).toBeGreaterThan(order[1]);
});

test("a report saved before the dividend path gets a trailing yield; one without dividends gets no card", async ({ page }) => {
  const legacy = await queryOne<{ reportMd: string; resultJson: string | null }>("SELECT reportMd, resultJson FROM Analysis WHERE id = ?", [IDS.analysisGroundingLegacy]);
  expect(legacy!.resultJson).toBeNull();
  expect(legacy!.reportMd).not.toContain('"dividends"');

  await page.goto(`/analyses/${IDS.analysisGroundingLegacy}`);
  const card = page.getByTestId("dividend-outlook");
  await expect(card.getByRole("heading", { name: "Dividend outlook" })).toBeVisible();
  // 0.40 / 11.40, once: a trailing DPS has no scenarios.
  await expect(card.getByText("Trailing yield", { exact: true }).locator("..")).toHaveText("Trailing yield3.5%");
  await expect(card.getByText("Forward yield", { exact: true })).toHaveCount(0);
  await expect(dividendTile(page, "FCF coverage")).toHaveText("0.40 (trailing)");

  // The panel ticker: a report without a dividends field, saved without a dataset.
  const panel = await queryOne<{ datasetId: string | null; groundingJson: string | null; reportMd: string }>(
    "SELECT datasetId, groundingJson, reportMd FROM Analysis WHERE id = ?",
    [IDS.analysisPanel]
  );
  expect(panel!.datasetId).toBeNull();
  expect(panel!.groundingJson).toBeNull();
  expect(panel!.reportMd).not.toContain('"dividends"');
  await page.goto(`/analyses/${IDS.analysisPanel}`);
  await expect(page.getByRole("heading", { name: "Deterministic checks", exact: true })).toBeVisible();
  await expect(page.getByTestId("dividend-outlook")).toHaveCount(0);
  await expect(page.getByText("Dividend outlook")).toHaveCount(0);
});

test("a lens stopped at its critique offers phase 3 on the page and a pill on /analyses", async ({ page }) => {
  const row = await queryOne<{ optimistCritiqueMd: string | null; optimistResultJson: string | null; optimistFairValueBase: number | null }>(
    "SELECT optimistCritiqueMd, optimistResultJson, optimistFairValueBase FROM Analysis WHERE id = ?",
    [IDS.analysisGrounded]
  );
  expect(row!.optimistCritiqueMd).toContain(DECOY.groundedOptimistCritique);
  expect(row!.optimistResultJson).toBeNull();
  expect(row!.optimistFairValueBase).toBeNull();

  await page.goto(`/analyses/${IDS.analysisGrounded}`);
  await expect(page.getByText(DECOY.groundedOptimistCritique)).toBeVisible();
  // Only the Optimist is halfway: one resume button, enabled, next to the three Run/Re-run.
  const resume = page.getByRole("button", { name: "Retry phase 3" });
  await expect(resume).toHaveCount(1);
  await expect(resume).toBeEnabled();

  await page.goto("/analyses");
  const card = page.locator(".card").filter({ hasText: DECOY.groundedCompany });
  await expect(card.getByText("Phase 3 pending", { exact: true })).toBeVisible();
  await expect(card.getByText(/Reviewed/)).toBeVisible();
  // The panel ticker's three lenses are complete (critique and numbers): no pill there.
  await expect(page.locator(".card").filter({ hasText: DECOY.panelCompany }).getByText("Phase 3 pending")).toHaveCount(0);
});

/** A saved analysis whose extract the page read: every lens can run, with its model selector
 *  and no hint (only the disabled case was covered until 2026-11-09). */
async function expectLensesRunnable(page: Page) {
  await expect(page.getByText("Re-run the analysis with a dataset to use the lenses", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("AI model")).toHaveCount(1);
  const run = page.getByRole("button", { name: /^(Run|Re-run)$/ });
  await expect(run).toHaveCount(3);
  for (const button of await run.all()) await expect(button).toBeEnabled();
}

test("an older grounded analysis still reads its extract from groundingJson", async ({ page }) => {
  const row = await queryOne<{ datasetId: string | null; groundingJson: string | null }>(
    "SELECT datasetId, groundingJson FROM Analysis WHERE id = ?",
    [IDS.analysisGroundingLegacy]
  );
  expect(row?.datasetId).toBeNull();
  // Saved before rows carried their sources.
  expect(JSON.parse(row!.groundingJson!).extract.financials[0].sources).toBeUndefined();

  await page.goto(`/analyses/${IDS.analysisGroundingLegacy}`);
  await expect(page.getByText(DECOY.groundingLegacyReport)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deterministic checks", exact: true })).toBeVisible();
  // The card has the extract: the gates that need it are not marked unavailable.
  await expect(page.getByText("No dataset: basis, market-implied and net-debt gates unavailable", { exact: true })).toHaveCount(0);
  const income = page.getByTestId("dataset-table-income");
  await expect(income.getByRole("row").nth(2)).toContainText("1,000");
  await expect(income.getByRole("row").nth(1).getByText("—")).toHaveCount(5);
  await expectLensesRunnable(page);
});

test("an analysis on a web dataset shows each row's web source by host, and the unverified one as such", async ({ page }) => {
  const dataset = await queryOne<{ origin: string; researchJson: string | null; warningsJson: string }>(
    "SELECT origin, researchJson, warningsJson FROM FinancialDataset WHERE id = ?",
    [IDS.datasetOrnt]
  );
  expect(dataset?.origin).toBe("web");
  expect(JSON.parse(dataset!.researchJson!).unverifiedSources).toEqual(["https://data.example/ORNT/multiples"]);
  expect(JSON.parse(dataset!.warningsJson).map((w: { code: string }) => w.code)).toEqual(["source_unverified"]);
  const analysis = await queryOne<{ datasetId: string | null }>("SELECT datasetId FROM Analysis WHERE id = ?", [IDS.analysisPanelOlder]);
  expect(analysis?.datasetId).toBe(IDS.datasetOrnt);

  await page.goto(`/analyses/${IDS.analysisPanelOlder}`);
  await expect(page.getByText(`Older ${DECOY.panelReport} save.`)).toBeVisible();
  // The statements come from the annual report the research opened: verified, by host.
  const income = page.getByTestId("dataset-table-income");
  await expect(income.getByRole("row").nth(1).getByText("🌐 ir.ornitorinco.example")).toHaveCount(4);
  await expect(income.getByRole("row").nth(1).getByText(/unverified/)).toHaveCount(0);
  // The multiples come from a page it only cited: the chip says unverified.
  const multiples = page.getByTestId("dataset-table-multiples");
  await expect(multiples.getByRole("row").nth(1).getByText("🌐 data.example")).toHaveCount(4);
  await expect(multiples.getByRole("row").nth(1).getByText("· unverified")).toHaveCount(4);
  await expectLensesRunnable(page);
});

test("/analyze opens on A's recent dataset for the ticker, and Use confirms it with no AI call", async ({ page, forbiddenCalls }) => {
  const row = await queryOne<{ ticker: string; origin: string }>("SELECT ticker, origin FROM FinancialDataset WHERE id = ?", [IDS.datasetGrounded]);
  expect(row).toEqual({ ticker: TICKERS.grounded, origin: "paste" });

  await page.goto(`/analyze?ticker=${TICKERS.grounded}`);
  const section = page.getByTestId("dataset-section");
  await expect(section.getByText(/^Dataset from .+ \(paste\)$/)).toBeVisible();
  // Compact: the three most recent years.
  await expect(section.getByTestId("dataset-table-income").getByRole("columnheader")).toHaveText(["", "2023", "2024", "2025"]);
  await section.getByRole("button", { name: "Use this dataset" }).click();
  await expect(section.getByText("✓ Ready").first()).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});

test("/analyze reuses A's recent web dataset for the ticker, with each row's web source", async ({ page, forbiddenCalls }) => {
  const row = await queryOne<{ ticker: string; origin: string }>("SELECT ticker, origin FROM FinancialDataset WHERE id = ?", [IDS.datasetOrnt]);
  expect(row).toEqual({ ticker: TICKERS.panel, origin: "web" });

  await page.goto(`/analyze?ticker=${TICKERS.panel}`);
  const section = page.getByTestId("dataset-section");
  await expect(section.getByText(/^Dataset from .+ \(web\)$/)).toBeVisible();
  await expect(section.getByTestId("dataset-table-income").getByRole("row").nth(1).getByText("🌐 ir.ornitorinco.example")).toHaveCount(3);
  await expect(section.getByRole("button", { name: "Add pasted data" })).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});

test("/analyze reuses a web dataset whose research skipped the estimates, saying the section was not collected", async ({ page, forbiddenCalls }) => {
  const row = await queryOne<{ warningsJson: string; researchJson: string }>("SELECT warningsJson, researchJson FROM FinancialDataset WHERE id = ?", [IDS.datasetSkipped]);
  expect(JSON.parse(row!.warningsJson)).toEqual([{ code: "research_part_skipped", severity: "info", fiscalYear: null, detail: "estimates" }]);
  expect(JSON.parse(row!.researchJson).parts.map((p: { status: string }) => p.status)).toEqual(["done", "done", "skipped"]);

  await page.goto(`/analyze?ticker=${TICKERS.skipped}`);
  const section = page.getByTestId("dataset-section");
  await expect(section.getByText(/^Dataset from .+ \(web\)$/)).toBeVisible();
  await expect(section.getByText("⚠ Section not collected: the research step was skipped — estimates")).toBeVisible();
  await expect(section.getByRole("button", { name: "Use this dataset" })).toBeEnabled();
  expect(forbiddenCalls).toEqual([]);
});

test("/analyze without a dataset offers the web research and keeps Deep Value disabled", async ({ page, forbiddenCalls }) => {
  expect(await count("SELECT COUNT(*) AS n FROM FinancialDataset WHERE userId = ? AND ticker = ?", [USER_A.id, TICKERS.watchOnly])).toBe(0);

  await page.goto(`/analyze?ticker=${TICKERS.watchOnly}`);
  const section = page.getByTestId("dataset-section");
  // Never clicked: /api/ai/** is forbidden in the e2e.
  await expect(section.getByRole("button", { name: "Search the web for the data" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Add pasted data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep Analysis (AI)" })).toBeDisabled();
  await expect(page.getByText("Prepare or research a dataset first", { exact: true })).toBeVisible();
  expect(forbiddenCalls).toEqual([]);
});

test("an analysis saved without a dataset gets the checks card from its leading fence, and its lenses cannot run", async ({ page }) => {
  const row = await queryOne<{ datasetId: string | null; groundingJson: string | null; resultJson: string | null }>(
    "SELECT datasetId, groundingJson, resultJson FROM Analysis WHERE id = ? AND resultJson IS NULL",
    [IDS.analysisPanel]
  );
  expect(row, "the panel row has no resultJson column: the card is built from the fence").toBeTruthy();
  expect(row!.datasetId).toBeNull();
  expect(row!.groundingJson).toBeNull();

  await page.goto(`/analyses/${IDS.analysisPanel}`);
  await expect(page.getByRole("heading", { name: "Deterministic checks", exact: true })).toBeVisible();
  await expect(page.getByText("No dataset: basis, market-implied and net-debt gates unavailable", { exact: true })).toBeVisible();
  expect(await page.getByText(/— no dataset$/).count()).toBeGreaterThanOrEqual(6);
  // The gates that need only the JSON and the price still compute: bear 130 < live 150.
  await expect(page.getByText("— bear 130.00 · price 150.00", { exact: true })).toBeVisible();
  await expect(page.getByText("— bear 130.00 · base 180.00 · bull 220.00", { exact: true })).toBeVisible();
  await expect(page.getByText("— missing 2,3,4,5,6,7,9,10", { exact: true })).toBeVisible();

  // Every lens has a saved critique, still readable, and a disabled Re-run.
  await expect(page.getByText("Re-run the analysis with a dataset to use the lenses", { exact: true })).toBeVisible();
  const rerun = page.getByRole("button", { name: "Re-run" });
  await expect(rerun).toHaveCount(3);
  for (const button of await rerun.all()) await expect(button).toBeDisabled();
  // Nothing can run, so there is no model to pick (2026-11-09).
  await expect(page.getByTitle("AI model")).toHaveCount(0);
  await expect(page.getByText(DECOY.skepticCritique)).toBeVisible();
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
  await fixClock(page);
  await page.goto("/watchlist");
  const items = await queryAll<{ companyName: string }>("SELECT companyName FROM WatchlistItem WHERE userId = ?", [USER_A.id]);
  expect(items.length).toBe(4);
  for (const item of items) {
    await expect(page.getByText(item.companyName, { exact: true })).toBeVisible();
  }

  const card = page.locator(".card").filter({ hasText: DECOY.groundedCompany });
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card.getByText(DECOY.watchlistNote)).toBeVisible();

  // NSCA has only unfinished runs: listed, with no verdict.
  const nsca = page.locator(".card").filter({ hasText: DECOY.cutCompany });
  await expect(nsca).toHaveCount(1);
  await expect(nsca.getByText(/^(BUY|WATCH|OVER FV)/)).toHaveCount(0);
});

test("/analyses shows NSCA's cut run with Retry and its live run without, above no card", async ({ page }) => {
  await fixClock(page);
  await page.goto("/analyses");

  const lines = page.getByTestId("analysis-run-status");
  await expect(lines).toHaveCount(2);
  // Each line names its phase: where the cut run stopped, and what Retry will do.
  const cut = lines.filter({ hasText: "Interrupted during: Valuation" });
  await expect(cut).toContainText("The valuation stopped before the end (e2e)");
  // Not clicked: the retry would start from the click on /analyze, and /api/ai/** is forbidden.
  await expect(cut.getByRole("link", { name: "Retry from: Valuation" })).toHaveAttribute("href", `/analyze?ticker=${TICKERS.cut}&resume=${IDS.analysisCut}`);
  await expect(cut.getByRole("button", { name: "Delete" })).toBeVisible();

  const live = lines.filter({ hasText: "Running: Web update" });
  await expect(live).toHaveCount(1);
  await expect(live.getByRole("link", { name: /Retry/ })).toHaveCount(0);
  // A ticker with only unfinished rows has no card.
  await expect(page.locator(".card").filter({ hasText: DECOY.cutCompany })).toHaveCount(0);
});

test("the detail page of a cut run shows its status, not a report, and no PDF", async ({ page }) => {
  await fixClock(page);
  await page.goto(`/analyses/${IDS.analysisCut}`);
  await expect(page.getByTestId("analysis-run-status")).toContainText("Interrupted during: Valuation");
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await expect(page.getByText("Analyst Panel")).toHaveCount(0);
});

test("/analyze?resume= prepares the cut run with Retry and starts nothing", async ({ page, forbiddenCalls }) => {
  await fixClock(page);
  await page.goto(`/analyze?ticker=${TICKERS.cut}&resume=${IDS.analysisCut}`);
  await expect(page.getByText("The run was cut before the end.", { exact: true })).toBeVisible();
  // The notes its web update wrote, and a Retry that resumes from the valuation.
  await expect(page.getByText(DECOY.cutWebUpdate)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry from: Valuation" })).toBeEnabled();
  // The URL params are read once and cleared.
  await expect(page).toHaveURL(/\/analyze$/);
  expect(forbiddenCalls).toEqual([]);
});

test("advisor loads A's saved session and its messages without calling the AI", async ({ page }) => {
  const messages = await count("SELECT COUNT(*) AS n FROM AdvisorMessage WHERE sessionId = ?", [IDS.advisorSession]);
  expect(messages).toBe(2);

  await page.goto("/advisor");
  await expect(page.getByRole("button", { name: new RegExp(DECOY.advisorTitle) }).first()).toBeVisible();
  // The most recent session auto-loads: its stored assistant reply is on screen.
  await expect(page.getByText(DECOY.advisorReply)).toBeVisible();
});
