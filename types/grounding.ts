/**
 * Types for the Grounded Deep Value mode — user-pasted financial statements/multiples/
 * estimates/peers, transcribed to structured JSON, used to compute deterministic
 * historical-multiple anchors and to verify the model's own valuation bridge.
 *
 * Deliberately NOT modeled: analyst target price, target multiple, rating. Those are
 * already anchored to the current price/consensus — modeling them here would offer the
 * model the exact price-anchoring shortcut this feature exists to remove. Forward
 * operating estimates (revenue/EBITDA/EPS) are fine — they are fundamentals.
 *
 * Every row carries where it came from (`sources` / `source`, types/dataset.ts), written by
 * the merge only (lib/grounding/merge.ts): the extraction model never declares a source.
 */
import type { DataSource, RowSources } from "@/types/dataset";

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

// Paste-size caps, shared by every boundary that accepts pasted blocks (the input UI, the
// extraction route, the deep-value route's payload schema) so they can never drift apart.
// Kept here rather than in lib/grounding/schema.ts because the client component needs
// them too and must not pull zod into its bundle just to read three numbers.
/** Per-block character cap — one statement table, with generous headroom. */
export const GROUNDING_MAX_BLOCK_CHARS = 40000;
/** Total character cap across all blocks — bounds the prompt cost of the raw paste. */
export const GROUNDING_MAX_TOTAL_CHARS = 200000;
/** Block-count cap: the six specific kinds plus "other" leave room for several peer and
 *  multi-period blocks; beyond this the payload is abuse, not a genuine paste. */
export const GROUNDING_MAX_BLOCKS = 40;

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
  // Depreciation and amortization, a positive amount (cash-flow statement add-back). Lets the
  // research stage compute EBITDA = EBIT + D&A when a company publishes no EBITDA
  // (lib/ai/research-to-dataset.ts); null on pastes and on datasets saved before 2026-10-30.
  depreciationAmortization: number | null;
  freeCashFlow: number | null;
  dividendsPerShare: number | null;
  // One source per statement (income/balance/cash flow); the field → statement map is
  // STATEMENT_FIELD_KIND in types/dataset.ts.
  sources: RowSources;
};

export type FiscalYearMultiples = {
  fiscalYear: number;
  evEbitda: number | null;
  evSales: number | null;
  pe: number | null;
  pb: number | null;
  fcfYield: number | null; // percentage
  dividendYield: number | null; // percentage
  // Basis-reconciliation inputs — when the paste has explicit Market Cap / Enterprise
  // Value columns, these make kE/kB OBSERVED instead of inferred from evSales/pe/pb. Same
  // unit as meta.units, like every other monetary value in this type. Nullable +
  // defaulted for backward compatibility with extracts saved before this field existed —
  // lib/grounding/basis.ts degrades to the inferred path (or "unavailable") when both are
  // absent.
  marketCap: number | null;
  enterpriseValue: number | null;
  // The source of the row's first non-null value.
  source: DataSource | null;
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
  source: DataSource | null;
};

export type PeerMultiples = {
  ticker: string;
  companyName: string | null;
  // May hold a single "current" row. No source of its own: each row carries one.
  multiples: FiscalYearMultiples[];
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

/** A confirmed paste: the blocks and the extract made from them, sent to POST /api/datasets.
 *  Analyses saved before the dataset table existed carry one in Analysis.groundingJson. */
export type GroundingPayload = {
  blocks: GroundingBlock[];
  extract: GroundedFinancials;
};
