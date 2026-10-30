/**
 * Types for the per-ticker financial dataset — the structured financials an analysis is
 * grounded on, stored in their own table (FinancialDataset) instead of inside the analysis,
 * with a source on every row so the UI can say where each number came from.
 *
 * Pure (no zod, no Prisma): shared by the client tables, the pure merge and the server store.
 */
import type { FiscalYearFinancials, GroundedFinancials, GroundingBlock } from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import type { BasisReconciliation } from "@/lib/grounding/basis";
import type { ImpliedExpectations, MarketImplied, MultipleStats, ValuationGrid } from "@/lib/grounding/anchors";
import type { AiEffort, AiModelId } from "@/types/ai-settings";

export type DataSourceKind = "paste" | "web";

export type DataSource = {
  kind: DataSourceKind;
  url: string | null; // web only
  title: string | null; // web only (page/document title)
  asOf: string | null; // ISO date the source states, web only
  blockId: string | null; // paste only — the GroundingBlock id
  // paste: always true; web: true only when the URL appears in the research transcript
  // (a cited URL is not an opened URL).
  verified: boolean;
};

/** One source per statement, not per field. `mixed.<statement>` is true when a second block
 *  (or, after a merge of datasets, a second source) filled fields of that statement: the chip
 *  then says "+1". */
export type RowSources = {
  income: DataSource | null;
  balance: DataSource | null;
  cashFlow: DataSource | null;
  mixed: { income: boolean; balance: boolean; cashFlow: boolean };
};

export type StatementKind = "income" | "balance" | "cashFlow";

/** Frozen, for comparisons and tests only: a row that needs sources gets its own object
 *  from emptyRowSources(), since the merge writes into it. */
export const EMPTY_ROW_SOURCES: Readonly<RowSources> = Object.freeze({
  income: null,
  balance: null,
  cashFlow: null,
  mixed: Object.freeze({ income: false, balance: false, cashFlow: false }),
});

export function emptyRowSources(): RowSources {
  return { income: null, balance: null, cashFlow: null, mixed: { income: false, balance: false, cashFlow: false } };
}

/** Which statement each FiscalYearFinancials field belongs to — the provenance granularity. */
export const STATEMENT_FIELD_KIND = {
  revenue: "income",
  ebitda: "income",
  ebit: "income",
  netIncome: "income",
  eps: "income",
  sharesDiluted: "income",
  dividendsPerShare: "income",
  totalEquity: "balance",
  minorityInterest: "balance",
  totalDebt: "balance",
  cashAndEquivalents: "balance",
  netDebt: "balance",
  cfo: "cashFlow",
  capex: "cashFlow",
  depreciationAmortization: "cashFlow",
  freeCashFlow: "cashFlow",
} as const satisfies Record<FinancialField, StatementKind>;

/** The numeric fields of a financials row (everything but the year and the sources). */
export type FinancialField = Exclude<keyof FiscalYearFinancials, "fiscalYear" | "sources">;

/** How recent a stored dataset must be for /analyze to offer it for reuse. */
export const DATASET_REUSE_MAX_AGE_DAYS = 7;

export type DatasetOrigin = "paste" | "web" | "merged";

/** pasteDatasetId/webDatasetId are set on a merged dataset only: "Refresh data" re-merges
 *  from them. */
export type DatasetMeta = {
  ticker: string;
  createdAt: string;
  origin: DatasetOrigin;
  pasteDatasetId: string | null;
  webDatasetId: string | null;
};

export type FinancialDataset = GroundedFinancials & { datasetMeta: DatasetMeta };

/** How a web dataset was researched (FinancialDataset.researchJson): the run's model and
 *  effort, the searches and fetches it made, how long it took, the cited URLs the run never
 *  opened, and the model's own notes (the EBITDA definition used, gaps). `model` is the
 *  resolved one; `servedBy` names the model that answered instead through Sonnet 5.5's
 *  refusal fallback (lib/ai/fallback.ts), null when the resolved model answered itself. */
export type ResearchMeta = {
  model: AiModelId;
  servedBy: string | null;
  effort: AiEffort;
  searches: number;
  fetches: number;
  durationMs: number;
  unverifiedSources: string[];
  notes: string | null;
};

/** A FinancialDataset row read back and validated (lib/datasets/parse.ts). `research` is null
 *  for a paste, and for a web or merged row whose researchJson is missing or malformed. */
export type StoredDataset = {
  id: string;
  dataset: FinancialDataset;
  blocks: GroundingBlock[];
  warnings: ReconciliationWarning[];
  research: ResearchMeta | null;
  createdAt: string;
};

/** POST /api/ai/research: the saved web dataset with everything the preview needs, computed
 *  on the server (the anchors against the current quote, the warnings), so the browser
 *  recomputes nothing. */
export type ResearchResponse = {
  datasetId: string;
  dataset: FinancialDataset;
  basis: BasisReconciliation;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied | null;
  impliedExpectations: ImpliedExpectations | null;
  warnings: ReconciliationWarning[];
  research: ResearchMeta;
};

/** POST /api/datasets with origin "merged": the same bundle, the research being the web
 *  dataset's (null when that row carries none), its unverifiedSources narrowed to the URLs a
 *  merged row still cites. */
export type MergedDatasetResponse = Omit<ResearchResponse, "research"> & { research: ResearchMeta | null };
