// Deterministic, price-independent anchors for the Grounded Deep Value mode: historical
// multiple statistics, the 3×3 valuation grid, and the market-implied read (a CONTROL, never
// an input — see ANALYTICAL_RIGOR_BLOCK item 10 in lib/ai/deep-value-prompts.ts). Pure, no
// server-only. See docs/deep-value-grounding-spec.md §5.1.
import type { FiscalYearFinancials, FiscalYearMultiples, GroundedFinancials } from "@/types/grounding";

/**
 * The p-th quantile of `sorted` (ascending), via linear interpolation between the two
 * bracketing order statistics — R/Excel's "type 7" / PERCENTILE.INC convention. Documented
 * explicitly so a future reader can verify the arithmetic without reverse-engineering it.
 *
 * @param sorted Ascending values, length ≥ 1.
 * @param p Quantile in [0, 1] (0.25 = p25, 0.5 = median, 0.75 = p75).
 */
function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lower = Math.floor(h);
  const upper = Math.ceil(h);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (h - lower) * (sorted[upper] - sorted[lower]);
}

function average(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * The percentile rank of `value` within `series` — the fraction (as 0-100) of observations
 * at or below `value`. The exact inverse of `quantile()` above (PERCENTRANK.INC): given
 * `v = s[i] + frac*(s[i+1]-s[i])`, solves for the rank position `h = i + frac`, then
 * `p = h / (n-1)`. Caller must ensure `series` is non-empty.
 */
export function percentileOf(value: number, series: number[]): number {
  const sorted = [...series].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return value <= sorted[0] ? 0 : 100; // no meaningful rank with 1 point
  if (value <= sorted[0]) return 0;
  if (value >= sorted[n - 1]) return 100;

  let i = 0;
  while (i < n - 1 && sorted[i + 1] < value) i++;
  const span = sorted[i + 1] - sorted[i];
  const frac = span === 0 ? 0 : (value - sorted[i]) / span;
  const h = i + frac;
  return (h / (n - 1)) * 100;
}

export type MultipleKey = "evEbitda" | "evSales" | "pe" | "pb";
const MULTIPLE_KEYS: MultipleKey[] = ["evEbitda", "evSales", "pe", "pb"];

export type MultipleStats = {
  key: MultipleKey;
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  earlyMean: number | null; // mean of the first half of the window, chronologically
  lateMean: number | null; // mean of the second half — reveals a de-rating trend
};

/**
 * Per-multiple historical stats. `multiples` is expected ordered ascending by fiscalYear
 * (as `GroundedFinancials.multiples` is documented) — early/late means split the window IN
 * TIME, not by value, so a structural de-rating (e.g. energy) is visible rather than
 * smoothed away by a decade-long median.
 *
 * A key is omitted entirely from the result when the series has zero non-null values.
 */
export function computeMultipleStats(multiples: FiscalYearMultiples[]): MultipleStats[] {
  const stats: MultipleStats[] = [];
  for (const key of MULTIPLE_KEYS) {
    const chronological = multiples.map((m) => m[key]).filter((v): v is number => v != null);
    const n = chronological.length;
    if (n === 0) continue;

    const sorted = [...chronological].sort((a, b) => a - b);
    const mid = Math.floor(n / 2);

    stats.push({
      key,
      n,
      min: sorted[0],
      p25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      max: sorted[n - 1],
      earlyMean: n >= 2 ? average(chronological.slice(0, mid)) : null,
      lateMean: n >= 2 ? average(chronological.slice(mid)) : null,
    });
  }
  return stats;
}

export type ValuationGridCell = { multiple: number; driverValue: number; perShare: number };
export type ValuationGrid = {
  multipleKey: "evEbitda";
  columns: { label: "p25" | "median" | "p75"; multiple: number }[];
  rows: { label: string; driverValue: number }[];
  cells: (ValuationGridCell | null)[][];
  bridge: { netDebt: number; minorities: number; shares: number };
};

// "Mediana 5a" row — median EBITDA over up to the last 5 fiscal years.
const GRID_LOOKBACK_YEARS = 5;

/**
 * The 3×3 grid the Grounded prompt injects as FACTS: 3 historical EV/EBITDA multiples
 * (p25/median/p75) × 3 EBITDA bases (last FY, 5y median, next forward estimate). Row labels
 * are plain English placeholders — not yet wired to i18n `t()`, since no UI consumes this
 * grid until a later session; whichever session renders it can adapt the shape then.
 *
 * Returns null when there's no EV/EBITDA history to anchor to, or when the latest fiscal
 * year is missing a bridge input (net debt / minorities / shares).
 */
export function computeValuationGrid(extract: GroundedFinancials): ValuationGrid | null {
  const evEbitdaStats = computeMultipleStats(extract.multiples).find((s) => s.key === "evEbitda");
  if (!evEbitdaStats) return null;

  const financials = extract.financials; // ascending by fiscalYear
  const latestFy = financials[financials.length - 1];
  if (!latestFy || latestFy.netDebt == null || latestFy.minorityInterest == null || latestFy.sharesDiluted == null) {
    return null;
  }
  const bridge = { netDebt: latestFy.netDebt, minorities: latestFy.minorityInterest, shares: latestFy.sharesDiluted };

  const columns: ValuationGrid["columns"] = [
    { label: "p25", multiple: evEbitdaStats.p25 },
    { label: "median", multiple: evEbitdaStats.median },
    { label: "p75", multiple: evEbitdaStats.p75 },
  ];

  const rows: ValuationGrid["rows"] = [];
  if (latestFy.ebitda != null) {
    rows.push({ label: `Last FY (${latestFy.fiscalYear})`, driverValue: latestFy.ebitda });
  }
  const recentEbitdas = financials
    .slice(-GRID_LOOKBACK_YEARS)
    .map((f) => f.ebitda)
    .filter((v): v is number => v != null);
  if (recentEbitdas.length > 0) {
    rows.push({ label: "5y median", driverValue: quantile([...recentEbitdas].sort((a, b) => a - b), 0.5) });
  }
  const nextEstimate = extract.estimates
    .filter((e): e is typeof e & { ebitda: number } => e.fiscalYear > latestFy.fiscalYear && e.ebitda != null)
    .sort((a, b) => a.fiscalYear - b.fiscalYear)[0];
  if (nextEstimate) {
    rows.push({ label: `${nextEstimate.fiscalYear}e`, driverValue: nextEstimate.ebitda });
  }

  const cells: (ValuationGridCell | null)[][] = rows.map((row) =>
    columns.map((col) => ({
      multiple: col.multiple,
      driverValue: row.driverValue,
      perShare: (col.multiple * row.driverValue - bridge.netDebt - bridge.minorities) / bridge.shares,
    })),
  );

  return { multipleKey: "evEbitda", columns, rows, cells, bridge };
}

export type MarketImplied = {
  price: number;
  driverLabel: string;
  impliedMultiple: number;
  percentile: number;
} | null;

/**
 * Backs out the EV/EBITDA multiple the current price already implies, from the latest
 * fiscal year's bridge inputs — a CONTROL that reports the gap vs. the history-anchored
 * base multiple, never an input to it (rigor block item 10).
 *
 * CURRENCY GUARD (mandatory, spec §5.1): returns null whenever the extract's reporting
 * currency doesn't match the quote's currency, rather than silently mixing units — a price
 * in one currency divided against an EBITDA in another is a silently wrong number, the
 * worst bug class in this app.
 */
export function computeMarketImplied(price: number, quoteCurrency: string, extract: GroundedFinancials): MarketImplied {
  if (!extract.meta.reportingCurrency || extract.meta.reportingCurrency !== quoteCurrency) {
    return null;
  }

  const latestFy: FiscalYearFinancials | undefined = extract.financials[extract.financials.length - 1];
  if (
    !latestFy ||
    latestFy.ebitda == null ||
    latestFy.netDebt == null ||
    latestFy.minorityInterest == null ||
    latestFy.sharesDiluted == null
  ) {
    return null;
  }

  const series = extract.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null);
  if (series.length === 0) return null;

  const impliedMultiple = (price * latestFy.sharesDiluted + latestFy.netDebt + latestFy.minorityInterest) / latestFy.ebitda;

  return {
    price,
    driverLabel: "EBITDA",
    impliedMultiple,
    percentile: percentileOf(impliedMultiple, series),
  };
}
