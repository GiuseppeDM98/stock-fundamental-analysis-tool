/**
 * Seed for the isolated end-to-end database (`.e2e/e2e.db`).
 *
 * Run: `npm run seed:e2e` (tsx). The Playwright run seeds automatically through
 * e2e/prepare-db.ts; this entry point exists to re-seed a database by hand during a
 * collaudo without restarting anything.
 *
 * Plants two throwaway users and their data:
 *   - A (e2e-a@example.test) owns everything the page specs look at: a Grounded analysis
 *     (groundingJson + a leading ```json block with bridges, so the deterministic post-check
 *     card renders), an analysis with all three analyst lenses filled plus an older save of
 *     the same ticker (grouping, evolution diff), an old-format analysis with no JSON block
 *     and no grounding (must still open), a sacrificial analysis and position for the
 *     authorization spec, open and closed positions (some with a capital-gains tax rate),
 *     watchlist items, five portfolio snapshots, one earnings estimate, one advisor session.
 *   - B (e2e-b@example.test) owns one analysis and one position — just enough for the
 *     own-vs-someone-else's pair.
 * Password for both: E2E_PASSWORD in e2e/support/fixtures.ts.
 *
 * Idempotent: it first deletes every row owned by the two fixture users (and by any user
 * auth.spec.ts registered), then recreates them with fixed ids.
 *
 * It never reads TURSO_DATABASE_URL: the URL comes from e2e/support/env.ts and must be a
 * `file:` URL, or the script throws before connecting.
 */
import bcrypt from "bcryptjs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client";
import { E2E_DB_URL, assertIsolatedDatabaseUrl } from "../e2e/support/env";
import {
  DECOY,
  E2E_PASSWORD,
  EARNINGS_OFFSET_DAYS,
  IDS,
  REGISTERED_EMAIL_PREFIX,
  SNAPSHOT_OFFSETS,
  TICKERS,
  USER_A,
  USER_B,
  daysFrom,
  referenceDay,
} from "../e2e/support/fixtures";
import type { DeepValueResult } from "../components/report/types";
import type { GroundingPayload } from "../types/grounding";
import type { SnapshotData } from "../types/portfolio";

export * from "../e2e/support/fixtures";

// ─── Report builders ───────────────────────────────────────────────────────────

/** A saved Deep Value report: the leading ```json block the detail page parses, then the body. */
function deepValueReport(result: DeepValueResult, body: string): string {
  return "```json\n" + JSON.stringify(result, null, 2) + "\n```\n\n" + body;
}

// Grounded analysis (FNCT.MI, EUR millions, MoS 20%). Bridge arithmetic is exact:
// intrinsic = (EBITDA 200 × multiple − net debt 300 − minorities 10) / 100 shares, and the
// stored fair values are the MoS-adjusted buy targets (intrinsic × 0.8).
const GROUNDED_RESULT: DeepValueResult = {
  method: "EV/EBITDA",
  sector: "Utilities",
  currency: "EUR",
  bull: {
    fairValue: 12.72,
    probability: 0.25,
    bridge: { driver: "EBITDA", driverValue: 200, driverYear: 2025, multiple: 9.5, netDebt: 300, minorities: 10, shares: 100, intrinsicPerShare: 15.9 },
  },
  base: {
    fairValue: 10.32,
    probability: 0.5,
    bridge: { driver: "EBITDA", driverValue: 200, driverYear: 2025, multiple: 8, netDebt: 300, minorities: 10, shares: 100, intrinsicPerShare: 12.9 },
  },
  bear: {
    fairValue: 7.12,
    probability: 0.25,
    bridge: { driver: "EBITDA", driverValue: 200, driverYear: 2025, multiple: 6, netDebt: 300, minorities: 10, shares: 100, intrinsicPerShare: 8.9 },
  },
  assumptions: { wacc: 8, roic: 11.5, terminalGrowth: 1.5 },
  crossCheck: { method: "DDM", intrinsicPerShare: 12.2, reconciliation: "The DDM sits slightly below the multiple because the payout ratio is conservative." },
};

const GROUNDED_YEARS = [2021, 2022, 2023, 2024, 2025];
const GROUNDED_EV_EBITDA = [7.5, 8.0, 7.0, 7.8, 8.2];

function groundedPayload(): GroundingPayload {
  const financials = GROUNDED_YEARS.map((fiscalYear, i) => {
    const revenue = 800 + 50 * i;
    const ebitda = 160 + 10 * i;
    const netIncome = 70 + 5 * i;
    return {
      fiscalYear,
      revenue,
      ebitda,
      ebit: ebitda - 40,
      netIncome,
      eps: netIncome / 100,
      totalEquity: 600 + 20 * i,
      minorityInterest: 10,
      totalDebt: 400,
      cashAndEquivalents: 100,
      netDebt: 300,
      sharesDiluted: 100,
      cfo: ebitda - 30,
      capex: -60,
      freeCashFlow: ebitda - 90,
      dividendsPerShare: 0.4,
    };
  });
  const multiples = GROUNDED_YEARS.map((fiscalYear, i) => {
    const ebitda = financials[i].ebitda;
    const enterpriseValue = GROUNDED_EV_EBITDA[i] * ebitda;
    const marketCap = enterpriseValue - 300 - 10;
    return {
      fiscalYear,
      evEbitda: GROUNDED_EV_EBITDA[i],
      evSales: enterpriseValue / financials[i].revenue,
      pe: marketCap / financials[i].netIncome,
      pb: marketCap / financials[i].totalEquity,
      fcfYield: (financials[i].freeCashFlow / marketCap) * 100,
      dividendYield: 4,
      marketCap,
      enterpriseValue,
    };
  });
  return {
    blocks: [
      { id: "e2e-block-is", kind: "income_statement", text: `Fenicottero income statement (${DECOY.groundedReport})\nFY2021 FY2022 FY2023 FY2024 FY2025` },
      { id: "e2e-block-mult", kind: "valuation_multiples", text: "EV/EBITDA 7.5 8.0 7.0 7.8 8.2" },
    ],
    extract: {
      meta: { reportingCurrency: "EUR", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" },
      financials,
      multiples,
      estimates: [{ fiscalYear: 2026, revenue: 1050, ebitda: 210, ebit: 165, netIncome: 95, eps: 0.95 }],
      peers: [],
    },
  };
}

// Analyst-panel analysis (ORNT, USD, DCF, MoS 25%): intrinsic 220/180/130 → buy targets.
const PANEL_RESULT: DeepValueResult = {
  method: "DCF",
  sector: "Industrials",
  currency: "USD",
  bull: { fairValue: 165 },
  base: { fairValue: 135 },
  bear: { fairValue: 97.5 },
};

// Older save of the same ticker — gives /analyses a history row and an evolution step.
const PANEL_OLDER_RESULT: DeepValueResult = {
  method: "DCF",
  sector: "Industrials",
  currency: "USD",
  bull: { fairValue: 150 },
  base: { fairValue: 120 },
  bear: { fairValue: 90 },
};

const AUTHZ_RESULT: DeepValueResult = {
  method: "P/B",
  sector: "Financials",
  currency: "EUR",
  bull: { fairValue: 2.4 },
  base: { fairValue: 2 },
  bear: { fairValue: 1.6 },
};

const USER_B_RESULT: DeepValueResult = {
  method: "EV/EBITDA",
  sector: "Consumer",
  currency: "USD",
  bull: { fairValue: 30 },
  base: { fairValue: 25 },
  bear: { fairValue: 18 },
};

// ─── Seed ──────────────────────────────────────────────────────────────────────

/**
 * Wipes and recreates every fixture row in the database at `url` (must be `file:`).
 * Returns the reference day the relative dates (snapshots, earnings) were computed from.
 */
export async function seedE2eDatabase(url: string = E2E_DB_URL): Promise<Date> {
  assertIsolatedDatabaseUrl(url, "seedE2eDatabase");
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try {
    await wipeFixtureUsers(db);
    // Cost 4, not the app's 12: the hash is only ever compared by bcrypt.compare, which reads
    // the cost from the hash itself, and the suite seeds on every run.
    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 4);
    const today = referenceDay();

    await db.user.create({ data: { id: USER_A.id, email: USER_A.email, passwordHash } });
    await db.user.create({ data: { id: USER_B.id, email: USER_B.email, passwordHash } });

    await seedAnalyses(db);
    await seedPositions(db);
    await seedWatchlist(db);
    await seedSnapshots(db, today);
    await db.earningsEstimate.create({
      data: {
        userId: USER_A.id,
        ticker: TICKERS.grounded,
        nextEarningsDate: daysFrom(today, EARNINGS_OFFSET_DAYS, 0),
        confidence: "confirmed",
        sourceUrl: "https://example.test/fenicottero-investor-relations",
        fetchedAt: daysFrom(today, -2),
      },
    });
    await db.advisorSession.create({
      data: {
        id: IDS.advisorSession,
        userId: USER_A.id,
        title: DECOY.advisorTitle,
        messages: {
          create: [
            { role: "user", content: `What do you think of [[${TICKERS.panel}]]? (ornitorinco)` },
            { role: "assistant", content: `The ${DECOY.advisorReply}: the analysis is still valid, watch the buy target.` },
          ],
        },
      },
    });
    return today;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Deletes every row owned by the fixture users and by users auth.spec.ts registered, child
 * tables first — explicit deletes rather than relying on ON DELETE CASCADE, which SQLite only
 * enforces when the foreign_keys pragma is on for the connection.
 */
async function wipeFixtureUsers(db: PrismaClient): Promise<void> {
  const users = await db.user.findMany({
    where: { OR: [{ email: { in: [USER_A.email, USER_B.email] } }, { email: { startsWith: REGISTERED_EMAIL_PREFIX } }, { id: { in: [USER_A.id, USER_B.id] } }] },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;
  const byUser = { where: { userId: { in: userIds } } };
  await db.advisorMessage.deleteMany({ where: { session: { userId: { in: userIds } } } });
  await db.advisorSession.deleteMany(byUser);
  await db.analysis.deleteMany(byUser);
  await db.position.deleteMany(byUser);
  await db.portfolioSnapshot.deleteMany(byUser);
  await db.watchlistItem.deleteMany(byUser);
  await db.watchlistRun.deleteMany(byUser);
  await db.earningsEstimate.deleteMany(byUser);
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedAnalyses(db: PrismaClient): Promise<void> {
  await db.analysis.create({
    data: {
      id: IDS.analysisGrounded,
      userId: USER_A.id,
      ticker: TICKERS.grounded,
      companyName: DECOY.groundedCompany,
      mosPercent: 20,
      priceAtAnalysis: 10.9,
      fairValueBull: GROUNDED_RESULT.bull.fairValue,
      fairValueBase: GROUNDED_RESULT.base.fairValue,
      fairValueBear: GROUNDED_RESULT.bear.fairValue,
      valuationMethod: GROUNDED_RESULT.method,
      groundingJson: JSON.stringify(groundedPayload()),
      reportMd: deepValueReport(
        GROUNDED_RESULT,
        `## 1. Overview\n\nGrounded report ${DECOY.groundedReport}: regulated networks with a stable EBITDA path.\n\n## 2. Moat\n\nConcession-based moat.\n\n## 8. Summary\n\nBase case EV/EBITDA 8.0x on FY2025 EBITDA.`
      ),
      createdAt: new Date("2026-09-15T09:30:00Z"),
    },
  });

  await db.analysis.create({
    data: {
      id: IDS.analysisPanelOlder,
      userId: USER_A.id,
      ticker: TICKERS.panel,
      companyName: DECOY.panelCompany,
      mosPercent: 25,
      priceAtAnalysis: 128,
      fairValueBull: PANEL_OLDER_RESULT.bull.fairValue,
      fairValueBase: PANEL_OLDER_RESULT.base.fairValue,
      fairValueBear: PANEL_OLDER_RESULT.bear.fairValue,
      valuationMethod: PANEL_OLDER_RESULT.method,
      reportMd: deepValueReport(PANEL_OLDER_RESULT, `## 1. Overview\n\nOlder ${DECOY.panelReport} save.`),
      createdAt: new Date("2026-06-10T08:00:00Z"),
    },
  });

  await db.analysis.create({
    data: {
      id: IDS.analysisPanel,
      userId: USER_A.id,
      ticker: TICKERS.panel,
      companyName: DECOY.panelCompany,
      mosPercent: 25,
      priceAtAnalysis: 142,
      fairValueBull: PANEL_RESULT.bull.fairValue,
      fairValueBase: PANEL_RESULT.base.fairValue,
      fairValueBear: PANEL_RESULT.bear.fairValue,
      valuationMethod: PANEL_RESULT.method,
      reportMd: deepValueReport(PANEL_RESULT, `## 1. Overview\n\nQuick-mode report ${DECOY.panelReport}.\n\n## 8. Summary\n\nDCF with a 9% WACC.`),
      // All three analyst lenses filled — the same MoS-adjusted unit as fairValue*.
      reviewMd: `## Skeptic\n\n${DECOY.skepticCritique}: margins are peak-cycle.`,
      reviewFairValueBull: 112.5,
      reviewFairValueBase: 90,
      reviewFairValueBear: 60,
      reviewValuationMethod: "DCF",
      optimistCritiqueMd: `## Bull\n\n${DECOY.optimistCritique}: backlog supports growth.`,
      optimistFairValueBull: 142.5,
      optimistFairValueBase: 120,
      optimistFairValueBear: 90,
      optimistValuationMethod: "DCF",
      qualityCritiqueMd: `## Quality\n\n${DECOY.qualityCritique}: ROIC above WACC for a decade.`,
      qualityFairValueBull: 127.5,
      qualityFairValueBase: 105,
      qualityFairValueBear: 75,
      qualityValuationMethod: "DCF",
      createdAt: new Date("2026-09-20T14:00:00Z"),
    },
  });

  // Old format: no JSON block, no fair values, no grounding — the detail page must fall back
  // to the plain report body instead of crashing.
  await db.analysis.create({
    data: {
      id: IDS.analysisLegacy,
      userId: USER_A.id,
      ticker: TICKERS.legacy,
      companyName: DECOY.legacyCompany,
      mosPercent: 0,
      reportMd: `# Legacy analysis\n\nThis is the ${DECOY.legacyReport} body, saved before the Deep Value JSON block existed.\n\n- Revenue grew 4%\n- Debt is stable`,
      createdAt: new Date("2025-11-02T10:00:00Z"),
    },
  });

  await db.analysis.create({
    data: {
      id: IDS.analysisAuthz,
      userId: USER_A.id,
      ticker: TICKERS.authz,
      companyName: DECOY.authzCompany,
      mosPercent: 20,
      fairValueBull: AUTHZ_RESULT.bull.fairValue,
      fairValueBase: AUTHZ_RESULT.base.fairValue,
      fairValueBear: AUTHZ_RESULT.bear.fairValue,
      valuationMethod: AUTHZ_RESULT.method,
      reportMd: deepValueReport(AUTHZ_RESULT, "## 1. Overview\n\nSacrificial record for the authorization spec."),
      createdAt: new Date("2026-08-01T10:00:00Z"),
    },
  });

  await db.analysis.create({
    data: {
      id: IDS.analysisUserB,
      userId: USER_B.id,
      ticker: TICKERS.userB,
      companyName: DECOY.userBCompany,
      mosPercent: 20,
      fairValueBull: USER_B_RESULT.bull.fairValue,
      fairValueBase: USER_B_RESULT.base.fairValue,
      fairValueBear: USER_B_RESULT.bear.fairValue,
      valuationMethod: USER_B_RESULT.method,
      reportMd: deepValueReport(USER_B_RESULT, "## 1. Overview\n\nUser B's only analysis (quokka)."),
      createdAt: new Date("2026-09-01T10:00:00Z"),
    },
  });
}

async function seedPositions(db: PrismaClient): Promise<void> {
  await db.position.createMany({
    data: [
      // Two open lots of the grounded ticker (aggregated row, WAC), taxed at 26%.
      { id: IDS.positionGroundedLot1, userId: USER_A.id, ticker: TICKERS.grounded, companyName: DECOY.groundedCompany, purchasePrice: 10.5, shares: 100, currency: "EUR", purchasedAt: new Date("2025-03-10T00:00:00Z"), notes: DECOY.positionNote, capitalGainsTaxRate: 26, createdAt: new Date("2025-03-10T10:00:00Z") },
      { id: IDS.positionGroundedLot2, userId: USER_A.id, ticker: TICKERS.grounded, companyName: DECOY.groundedCompany, purchasePrice: 11.2, shares: 50, currency: "EUR", purchasedAt: new Date("2025-09-01T00:00:00Z"), capitalGainsTaxRate: 26, createdAt: new Date("2025-09-01T10:00:00Z") },
      // Open USD lot without a tax rate (exercises the stubbed FX conversion).
      { id: IDS.positionPanelOpen, userId: USER_A.id, ticker: TICKERS.panel, companyName: DECOY.panelCompany, purchasePrice: 140, shares: 20, currency: "USD", purchasedAt: new Date("2025-06-15T00:00:00Z"), createdAt: new Date("2025-06-15T10:00:00Z") },
      // Closed lots: one realized loss (USD), one realized gain (EUR, taxed).
      { id: IDS.positionPanelClosed, userId: USER_A.id, ticker: TICKERS.panel, companyName: DECOY.panelCompany, purchasePrice: 150, shares: 5, currency: "USD", purchasedAt: new Date("2025-01-20T00:00:00Z"), closedAt: new Date("2026-07-01T00:00:00Z"), sellPrice: 130, realizedRecorded: true, createdAt: new Date("2025-01-20T10:00:00Z") },
      { id: IDS.positionLegacyClosed, userId: USER_A.id, ticker: TICKERS.legacy, companyName: DECOY.closedPositionCompany, purchasePrice: 4, shares: 200, currency: "EUR", purchasedAt: new Date("2024-05-02T00:00:00Z"), closedAt: new Date("2026-08-20T00:00:00Z"), sellPrice: 4.8, capitalGainsTaxRate: 26, realizedRecorded: true, createdAt: new Date("2024-05-02T10:00:00Z") },
      // Sacrificial lot for the authorization spec.
      { id: IDS.positionAuthz, userId: USER_A.id, ticker: TICKERS.authz, companyName: DECOY.authzCompany, purchasePrice: 1, shares: 10, currency: "EUR", purchasedAt: new Date("2026-01-05T00:00:00Z"), createdAt: new Date("2026-01-05T10:00:00Z") },
      { id: IDS.positionUserB, userId: USER_B.id, ticker: TICKERS.userB, companyName: DECOY.userBCompany, purchasePrice: 18, shares: 10, currency: "USD", purchasedAt: new Date("2026-02-01T00:00:00Z"), createdAt: new Date("2026-02-01T10:00:00Z") },
    ],
  });
}

async function seedWatchlist(db: PrismaClient): Promise<void> {
  // mosPercent here is a FRACTION (0.2 = 20%), unlike Analysis.mosPercent — see the
  // WatchlistItem model default.
  await db.watchlistItem.createMany({
    data: [
      { userId: USER_A.id, ticker: TICKERS.grounded, companyName: DECOY.groundedCompany, mosPercent: 0.2, notes: DECOY.watchlistNote, addedAt: new Date("2026-09-16T08:00:00Z") },
      { userId: USER_A.id, ticker: TICKERS.panel, companyName: DECOY.panelCompany, mosPercent: 0.25, addedAt: new Date("2026-09-21T08:00:00Z") },
      { userId: USER_A.id, ticker: TICKERS.watchOnly, companyName: DECOY.watchlistOnlyCompany, mosPercent: 0.3, addedAt: new Date("2026-09-25T08:00:00Z") },
    ],
  });
}

/** Five snapshots inside the API's 90-day window: one dividend day, one sale day. */
async function seedSnapshots(db: PrismaClient, today: Date): Promise<void> {
  const points = [
    { totalEur: 3610, costEur: 3530, dividendsEur: 0, realizedEur: 0 },
    { totalEur: 3655, costEur: 3530, dividendsEur: 40, realizedEur: 0 },
    { totalEur: 3590, costEur: 3530, dividendsEur: 0, realizedEur: 0 },
    { totalEur: 3720, costEur: 3530, dividendsEur: 0, realizedEur: 160 },
    { totalEur: 3770, costEur: 3530, dividendsEur: 0, realizedEur: 0 },
  ];
  await db.portfolioSnapshot.createMany({
    data: SNAPSHOT_OFFSETS.map((offset, i) => {
      const p = points[i];
      const data: SnapshotData = { dividendsEur: p.dividendsEur, entries: [], realizedEur: p.realizedEur, realizedEntries: [] };
      return { userId: USER_A.id, takenAt: daysFrom(today, offset, 20), totalEur: p.totalEur, costEur: p.costEur, data: JSON.stringify(data) };
    }),
  });
}

// CLI entry point (`npm run seed:e2e`). tsx runs this file as CommonJS (no "type": "module"
// in package.json), so `require.main === module` tells a direct run from an import.
if (require.main === module) {
  seedE2eDatabase()
    .then((today) => {
      console.log(`[seed-e2e] seeded ${E2E_DB_URL} (reference day ${today.toISOString().slice(0, 10)})`);
    })
    .catch((err) => {
      console.error("[seed-e2e] failed:", err);
      process.exit(1);
    });
}
