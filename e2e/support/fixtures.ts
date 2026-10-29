/**
 * Fixture identities, ids and decoy words shared by the seed (scripts/seed-e2e.ts) and the
 * specs. Kept free of any database/Prisma import so a spec can read it without loading the
 * generated client.
 *
 * DECOY WORDS: invented terms ("fenicottero", "ornitorinco", …) that appear nowhere else in
 * the app. An assertion that finds one on screen proves the page rendered THAT seeded
 * record, not a coincidentally similar string from a translation or another row.
 */

// ─── Throwaway identities ──────────────────────────────────────────────────────
// Both live only in the isolated `.e2e/e2e.db`. The password is public on purpose: the
// accounts exist nowhere else and are recreated on every run.
export const E2E_PASSWORD = "e2e-password-123";
export const USER_A = { id: "e2e_user_a", email: "e2e-a@example.test" } as const;
export const USER_B = { id: "e2e_user_b", email: "e2e-b@example.test" } as const;

/** Email prefix used by auth.spec.ts for users it registers through the UI. */
export const REGISTERED_EMAIL_PREFIX = "e2e-reg-";

// ─── Decoys ────────────────────────────────────────────────────────────────────
export const DECOY = {
  groundedCompany: "Fenicottero Holding S.p.A.",
  groundedReport: "fenicottero-rosa-report",
  panelCompany: "Ornitorinco Industries Inc.",
  panelReport: "ornitorinco-dcf-report",
  skepticCritique: "scettico-pangolino-critica",
  optimistCritique: "rialzista-armadillo-critica",
  qualityCritique: "qualita-capibara-critica",
  legacyCompany: "Pangolino Legacy SpA",
  legacyReport: "pangolino-vecchio-formato",
  authzCompany: "Lemure Autorizzazione Srl",
  positionNote: "nota-fenicottero-lotto-uno",
  closedPositionCompany: "Pangolino Legacy SpA",
  watchlistNote: "nota-watchlist-okapi",
  watchlistOnlyCompany: "Okapi Watch Corp",
  advisorTitle: "Sessione ornitorinco: idee value",
  advisorReply: "consulente-tapiro-risposta",
  userBCompany: "Beta Quokka Corp",
} as const;

// ─── Record ids (fixed, so specs can address rows directly) ────────────────────
export const IDS = {
  analysisGrounded: "e2e_an_grounded",
  analysisPanel: "e2e_an_panel",
  analysisPanelOlder: "e2e_an_panel_older",
  analysisLegacy: "e2e_an_legacy",
  /** Sacrificial: authorization.spec.ts PATCHes and finally DELETEs it. */
  analysisAuthz: "e2e_an_authz",
  analysisUserB: "e2e_an_user_b",
  positionGroundedLot1: "e2e_pos_fnct_1",
  positionGroundedLot2: "e2e_pos_fnct_2",
  positionPanelOpen: "e2e_pos_ornt_open",
  positionPanelClosed: "e2e_pos_ornt_closed",
  positionLegacyClosed: "e2e_pos_pngl_closed",
  /** Sacrificial: authorization.spec.ts closes and finally DELETEs it. */
  positionAuthz: "e2e_pos_authz",
  positionUserB: "e2e_pos_user_b",
  advisorSession: "e2e_adv_session",
} as const;

export const TICKERS = {
  grounded: "FNCT.MI",
  panel: "ORNT",
  legacy: "PNGL.MI",
  authz: "LMRA",
  watchOnly: "OKPI",
  userB: "BQKA",
} as const;

// ─── Stubbed market data ───────────────────────────────────────────────────────
// What the stubbed /api/quote/[ticker] answers (Yahoo is never called). Fixed values so
// verdicts, P&L and screenshots are deterministic.
export const QUOTE_STUBS: Record<string, { price: number; currency: string; changePercent: number }> = {
  [TICKERS.grounded]: { price: 11.4, currency: "EUR", changePercent: 0.85 },
  [TICKERS.panel]: { price: 150, currency: "USD", changePercent: -1.2 },
  [TICKERS.legacy]: { price: 4.7, currency: "EUR", changePercent: 0.1 },
  [TICKERS.authz]: { price: 1.5, currency: "EUR", changePercent: 0 },
  [TICKERS.watchOnly]: { price: 42, currency: "USD", changePercent: 2.5 },
  [TICKERS.userB]: { price: 20, currency: "USD", changePercent: 0 },
};

/** EUR-based FX rates the stubbed Frankfurter endpoint answers. */
export const FX_STUB: Record<string, number> = { USD: 1.1, GBP: 0.85, CHF: 0.95 };

// ─── Dates ─────────────────────────────────────────────────────────────────────

/**
 * Midnight UTC of the current day — the anchor for every date that must stay "recent".
 * Snapshots are five inside the 90-day window plus one outside it (the dividends route reads
 * all of them), and the next-earnings date must stay in
 * the future, so those are offsets from this anchor rather than fixed calendar dates. Every
 * other date (analysis/purchase/sale) is fixed. The visual spec freezes the browser clock to
 * `referenceDay() + 12h`, so screenshots are stable within a day (see visual.spec.ts).
 */
export function referenceDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function daysFrom(anchor: Date, days: number, hourUtc = 12): Date {
  const d = new Date(anchor.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

/** Offsets (days from referenceDay) of the seeded portfolio snapshots, oldest first. */
export const SNAPSHOT_OFFSETS = [-120, -12, -9, -6, -3, -1] as const;
/** Days from referenceDay to the seeded next-earnings date of the grounded ticker. */
export const EARNINGS_OFFSET_DAYS = 45;
