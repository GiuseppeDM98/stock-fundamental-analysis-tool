/**
 * Types for the Grounded Deep Value mode — user-pasted financial statements/multiples/
 * estimates/peers, transcribed to structured JSON, used to compute deterministic
 * historical-multiple anchors and to verify the model's own valuation bridge. See
 * docs/deep-value-grounding-spec.md for the full design.
 *
 * Deliberately NOT modeled: analyst target price, target multiple, rating. Those are
 * already anchored to the current price/consensus — modeling them here would offer the
 * model the exact shortcut this feature exists to remove (spec §2, "Trappola delle
 * Estimates").
 */

export const GROUNDING_BLOCK_KINDS = [
  "income_statement",
  "balance_sheet",
  "cash_flow",
  "valuation_multiples",
  "estimates",
  "peer_valuation",
  "other",
] as const;
export type GroundingBlockKind = (typeof GROUNDING_BLOCK_KINDS)[number];

/** One raw pasted table, as entered by the user, labeled by kind before extraction. */
export type GroundingBlock = {
  id: string; // crypto.randomUUID() client-side — React key + edit/remove target
  kind: GroundingBlockKind;
  peerTicker?: string; // only for "peer_valuation"
  text: string; // the raw paste
};

/**
 * One fiscal year of financial-statement data, at the group/consolidated level.
 *
 * UNIT NOTE (critical): every monetary value is expressed in the unit declared by
 * `GroundingMeta.units`, and `sharesDiluted` is on the SAME scale (if `units` is
 * "millions", shares are also in millions). This keeps all arithmetic in lib/grounding/*
 * unit-less — price × shares lands in the same unit as EBITDA/net debt with no
 * conversion factor anywhere. `checkReconciliation`'s `eps ≈ netIncome / sharesDiluted`
 * check is the canary for a scale mistake: it blows up by ~3 orders of magnitude.
 */
export type FiscalYearFinancials = {
  fiscalYear: number;
  revenue: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null; // attributable to the parent
  eps: number | null; // diluted, per share
  totalEquity: number | null; // attributable to the parent
  minorityInterest: number | null; // NCI — the key Eni miss
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  netDebt: number | null;
  sharesDiluted: number | null; // see UNIT NOTE above
  cfo: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  dividendsPerShare: number | null;
};

export type FiscalYearMultiples = {
  fiscalYear: number;
  evEbitda: number | null;
  evSales: number | null;
  pe: number | null;
  pb: number | null;
  fcfYield: number | null; // percentage
  dividendYield: number | null; // percentage
};

export type ForwardEstimate = {
  fiscalYear: number;
  revenue: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  eps: number | null;
  // Deliberately NOT modeled: target price, target multiple, analyst rating — see the
  // module doc comment above.
};

export type PeerMultiples = {
  ticker: string;
  companyName: string | null;
  multiples: FiscalYearMultiples[]; // may hold a single "current" row
};

export type GroundingMeta = {
  reportingCurrency: string | null; // e.g. "EUR" — inferred from the paste
  units: "billions" | "millions" | "thousands" | "units" | null;
  latestPeriodLabel: string | null; // e.g. "FY2025" | "Q1 2026" — the "as of" coverage
  fiscalYearEnd: string | null; // e.g. "December"
};

export type GroundedFinancials = {
  meta: GroundingMeta;
  financials: FiscalYearFinancials[]; // ordered by ascending fiscal year
  multiples: FiscalYearMultiples[];
  estimates: ForwardEstimate[];
  peers: PeerMultiples[];
};

/** Persisted on Analysis.groundingJson and round-tripped through the AI routes. */
export type GroundingPayload = {
  blocks: GroundingBlock[];
  extract: GroundedFinancials;
};
