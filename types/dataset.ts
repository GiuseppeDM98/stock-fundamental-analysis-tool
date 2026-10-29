/**
 * Types for the per-ticker financial dataset — the structured financials an analysis is
 * grounded on, stored in their own table (FinancialDataset) instead of inside the analysis,
 * with a source on every row so the UI can say where each number came from.
 *
 * Pure (no zod, no Prisma): shared by the client tables, the pure merge and the server store.
 */
import type { FiscalYearFinancials, GroundedFinancials, GroundingBlock } from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

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

/** A FinancialDataset row read back and validated (lib/datasets/parse.ts). */
export type StoredDataset = {
  id: string;
  dataset: FinancialDataset;
  blocks: GroundingBlock[];
  warnings: ReconciliationWarning[];
  createdAt: string;
};
