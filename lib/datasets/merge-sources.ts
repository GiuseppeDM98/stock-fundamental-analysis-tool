// Merges two financial datasets of one ticker — the user's paste (primary) and the web
// research (secondary) — into one, deterministically and on the server only
// (POST /api/datasets with origin "merged"). Pure, no server-only.
//
// Why on the server (2026-10-30): the merged dataset's anchors, warnings and `verified` flags
// are computed in one place, from two rows the server read itself, so the browser never
// sends an extract it assembled.
//
// The rule is per STATEMENT × fiscal year, never per field: when the paste has any figure of
// a statement in a year, that whole statement comes from the paste, with the paste's source,
// and the web's figures for it are dropped (each named in a `value_ignored_secondary` info
// warning, a divergence above 1% in a `value_conflict`). A statement the paste lacks comes
// whole from the web, with the web's source. One statement therefore never mixes the two
// origins, and its chip names one source.
//
// Units and currency: different known units are rescaled to the primary's (monetary values
// and shares; per-share values, ratios and percentages do not scale); a different currency,
// or an unknown unit on either side, is no merge at all — the primary comes back alone, with
// a warning, because a figure in the wrong currency or scale corrupts every ratio silently.
import type {
  FiscalYearFinancials,
  FiscalYearMultiples,
  ForwardEstimate,
  GroundingMeta,
  PeerMultiples,
} from "@/types/grounding";
import { STATEMENT_FIELD_KIND, type DatasetMeta, type FinancialDataset, type FinancialField, type StatementKind } from "@/types/dataset";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import { sameCurrency } from "@/lib/grounding/currency";
import { periodEndKey } from "@/lib/grounding/merge";
import { normalizeTicker } from "@/lib/ticker";

const VALUE_CONFLICT_TOLERANCE = 0.01;

type Units = NonNullable<GroundingMeta["units"]>;
const UNIT_SCALE: Record<Units, number> = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 };

// The fields on the units scale. Everything else is per share (eps, dividendsPerShare), a
// multiple or a percentage, and keeps its value across scales.
const MONETARY_FINANCIAL_FIELDS: readonly FinancialField[] = [
  "revenue",
  "ebitda",
  "ebit",
  "netIncome",
  "totalEquity",
  "minorityInterest",
  "totalDebt",
  "cashAndEquivalents",
  "netDebt",
  "sharesDiluted", // shares sit on the same scale as money (types/grounding.ts, UNIT NOTE)
  "cfo",
  "capex",
  "depreciationAmortization",
  "freeCashFlow",
];
const MONETARY_MULTIPLE_FIELDS = ["marketCap", "enterpriseValue"] as const;
const MONETARY_ESTIMATE_FIELDS = ["revenue", "ebitda", "ebit", "netIncome"] as const;

const FINANCIAL_FIELDS = Object.keys(STATEMENT_FIELD_KIND) as FinancialField[];
const STATEMENTS: StatementKind[] = ["income", "balance", "cashFlow"];

export type MergeDatasetIds = { pasteDatasetId: string | null; webDatasetId: string | null };

function scaled(value: number | null, factor: number): number | null {
  return value == null || factor === 1 ? value : value * factor;
}

/** Deep copies, so the merged dataset never shares a row or a source with its inputs. */
function copyFinancials(row: FiscalYearFinancials): FiscalYearFinancials {
  return {
    ...row,
    sources: {
      income: row.sources.income && { ...row.sources.income },
      balance: row.sources.balance && { ...row.sources.balance },
      cashFlow: row.sources.cashFlow && { ...row.sources.cashFlow },
      mixed: { ...row.sources.mixed },
    },
  };
}

function copySourced<Row extends { source: FiscalYearMultiples["source"] }>(row: Row): Row {
  return { ...row, source: row.source && { ...row.source } };
}

/** The secondary dataset on the primary's unit scale. */
function rescale(dataset: FinancialDataset, factor: number): FinancialDataset {
  const multiplesRow = (row: FiscalYearMultiples): FiscalYearMultiples => {
    const out = copySourced(row);
    for (const field of MONETARY_MULTIPLE_FIELDS) out[field] = scaled(row[field], factor);
    return out;
  };
  return {
    ...dataset,
    financials: dataset.financials.map((row) => {
      const out = copyFinancials(row);
      for (const field of MONETARY_FINANCIAL_FIELDS) out[field] = scaled(row[field], factor);
      return out;
    }),
    multiples: dataset.multiples.map(multiplesRow),
    estimates: dataset.estimates.map((row) => {
      const out = copySourced(row);
      for (const field of MONETARY_ESTIMATE_FIELDS) out[field] = scaled(row[field], factor);
      return out;
    }),
    peers: dataset.peers.map((peer) => ({ ...peer, multiples: peer.multiples.map(multiplesRow) })),
  };
}

/** One fiscal year's financials: per statement, from the primary when it has any figure of
 *  it, else from the secondary. */
function mergeFinancialsYear(
  primary: FiscalYearFinancials,
  secondary: FiscalYearFinancials,
  labels: { primary: string; secondary: string },
  warnings: ReconciliationWarning[]
): FiscalYearFinancials {
  const out = copyFinancials(primary);
  const year = primary.fiscalYear;
  for (const statement of STATEMENTS) {
    const fields = FINANCIAL_FIELDS.filter((field) => STATEMENT_FIELD_KIND[field] === statement);
    const primaryHasStatement = fields.some((field) => primary[field] != null);
    if (!primaryHasStatement) {
      for (const field of fields) out[field] = secondary[field];
      out.sources[statement] = secondary.sources[statement] && { ...secondary.sources[statement]! };
      out.sources.mixed[statement] = secondary.sources.mixed[statement];
      continue;
    }
    for (const field of fields) {
      const kept = primary[field];
      const other = secondary[field];
      if (other == null) continue;
      if (kept == null) {
        warnings.push({ code: "value_ignored_secondary", severity: "info", fiscalYear: year, detail: `${field} FY${year}` });
      } else if (Math.abs(kept - other) / (Math.abs(kept) || 1) > VALUE_CONFLICT_TOLERANCE) {
        warnings.push({ code: "value_conflict", severity: "warn", fiscalYear: year, detail: `${field}: ${kept} (${labels.primary}) vs ${other} (${labels.secondary})` });
      }
    }
  }
  return out;
}

/** Rows keyed by fiscal year: the primary's row when it has the year, else the secondary's. */
function unionByYear<Row extends { fiscalYear: number }>(primary: Row[], secondary: Row[], copy: (row: Row) => Row): Row[] {
  const byYear = new Map<number, Row>();
  for (const row of secondary) byYear.set(row.fiscalYear, copy(row));
  for (const row of primary) byYear.set(row.fiscalYear, copy(row));
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

function mergePeers(primary: PeerMultiples[], secondary: PeerMultiples[]): PeerMultiples[] {
  const byTicker = new Map<string, { primary?: PeerMultiples; secondary?: PeerMultiples }>();
  for (const peer of primary) byTicker.set(normalizeTicker(peer.ticker), { ...byTicker.get(normalizeTicker(peer.ticker)), primary: peer });
  for (const peer of secondary) {
    const key = normalizeTicker(peer.ticker);
    byTicker.set(key, { ...byTicker.get(key), secondary: peer });
  }
  return [...byTicker.entries()].map(([ticker, { primary: p, secondary: s }]) => ({
    ticker,
    companyName: p?.companyName ?? s?.companyName ?? null,
    multiples: unionByYear(p?.multiples ?? [], s?.multiples ?? [], copySourced),
  }));
}

/** The later of two coverage labels ("FY2025" vs "H1 2026"); the primary's on a tie or when
 *  either cannot be ordered. */
function laterPeriodLabel(primary: string | null, secondary: string | null): string | null {
  if (primary == null || secondary == null) return primary ?? secondary;
  const p = periodEndKey(primary);
  const s = periodEndKey(secondary);
  return p != null && s != null && s > p ? secondary : primary;
}

/**
 * Merges `secondary` into `primary` (the paste first, the web second). Returns the
 * merged dataset, its `datasetMeta` marked "merged" with the two ids, and the merge's own
 * warnings (`value_ignored_secondary`, `value_conflict`, `meta_currency_conflict`,
 * `meta_units_conflict`). The store writes `datasetMeta` again from the same ids on save.
 */
export function mergeDatasets(
  primary: FinancialDataset,
  secondary: FinancialDataset,
  ids: MergeDatasetIds = { pasteDatasetId: null, webDatasetId: null }
): { dataset: FinancialDataset; warnings: ReconciliationWarning[] } {
  const datasetMeta: DatasetMeta = {
    ticker: primary.datasetMeta.ticker,
    createdAt: new Date().toISOString(),
    origin: "merged",
    pasteDatasetId: ids.pasteDatasetId,
    webDatasetId: ids.webDatasetId,
  };
  const primaryAlone = (): FinancialDataset => ({
    meta: { ...primary.meta },
    financials: primary.financials.map(copyFinancials),
    multiples: primary.multiples.map(copySourced),
    estimates: primary.estimates.map(copySourced),
    peers: primary.peers.map((peer) => ({ ...peer, multiples: peer.multiples.map(copySourced) })),
    datasetMeta,
  });

  const pMeta = primary.meta;
  const sMeta = secondary.meta;
  if (!sameCurrency(pMeta.reportingCurrency, sMeta.reportingCurrency)) {
    return {
      dataset: primaryAlone(),
      warnings: [{ code: "meta_currency_conflict", severity: "warn", fiscalYear: null, detail: `${pMeta.reportingCurrency ?? "unknown"} vs ${sMeta.reportingCurrency ?? "unknown"}` }],
    };
  }
  if (pMeta.units == null || sMeta.units == null) {
    return {
      dataset: primaryAlone(),
      warnings: [{ code: "meta_units_conflict", severity: "warn", fiscalYear: null, detail: `${pMeta.units ?? "unknown"} vs ${sMeta.units ?? "unknown"}` }],
    };
  }

  const web = rescale(secondary, UNIT_SCALE[sMeta.units] / UNIT_SCALE[pMeta.units]);
  const labels = { primary: primary.datasetMeta.origin, secondary: secondary.datasetMeta.origin };
  const warnings: ReconciliationWarning[] = [];

  const secondaryByYear = new Map(web.financials.map((row) => [row.fiscalYear, row]));
  const primaryYears = new Set(primary.financials.map((row) => row.fiscalYear));
  const financials = [
    ...primary.financials.map((row) => {
      const other = secondaryByYear.get(row.fiscalYear);
      return other ? mergeFinancialsYear(row, other, labels, warnings) : copyFinancials(row);
    }),
    ...web.financials.filter((row) => !primaryYears.has(row.fiscalYear)),
  ].sort((a, b) => a.fiscalYear - b.fiscalYear);

  return {
    dataset: {
      meta: {
        reportingCurrency: pMeta.reportingCurrency,
        units: pMeta.units,
        latestPeriodLabel: laterPeriodLabel(pMeta.latestPeriodLabel, sMeta.latestPeriodLabel),
        fiscalYearEnd: pMeta.fiscalYearEnd ?? sMeta.fiscalYearEnd,
      },
      financials,
      multiples: unionByYear(primary.multiples, web.multiples, copySourced),
      estimates: unionByYear<ForwardEstimate>(primary.estimates, web.estimates, copySourced),
      peers: mergePeers(primary.peers, web.peers),
      datasetMeta,
    },
    warnings,
  };
}
