// Deterministic, price-independent anchors for the Grounded Deep Value mode: historical
// multiple statistics, the 3×3 valuation grid, the market-implied read (a CONTROL, never
// an input — see ANALYTICAL_RIGOR_BLOCK item 10 in lib/ai/deep-value-prompts.ts) and the
// reverse-engineered "what must be true" read. Pure, no server-only. See
// docs/deep-value-grounding-spec.md §5.1 and docs/deep-value-rigor-v2-spec.md §2.3/§2.4 —
// the grid and market-implied reads are now SAME-BASIS: every consumer that multiplies a
// historical multiple by a statement-basis EBITDA, or ranks a statement-basis multiple
// against the raw historical distribution, goes through the BasisReconciliation computed
// in lib/grounding/basis.ts. Doing this ungrounded (kE=kB=1 implicitly) is exactly the bug
// that produced the Iren misvaluation — see docs/deep-value-rigor-v2-spec.md §0.
import type { FiscalYearFinancials, FiscalYearMultiples, GroundedFinancials } from "@/types/grounding";
import { toProviderBasis, type BasisReconciliation } from "@/lib/grounding/basis";

/**
 * The p-th quantile of `sorted` (ascending), via linear interpolation between the two
 * bracketing order statistics — R/Excel's "type 7" / PERCENTILE.INC convention. Documented
 * explicitly so a future reader can verify the arithmetic without reverse-engineering it.
 * Exported so lib/grounding/basis.ts can reuse the exact same convention for the kE/kB
 * basis-ratio median — one interpolation rule for every "median" in lib/grounding/*.
 *
 * @param sorted Ascending values, length ≥ 1.
 * @param p Quantile in [0, 1] (0.25 = p25, 0.5 = median, 0.75 = p75).
 */
export function quantile(sorted: number[], p: number): number {
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
 *
 * CALLER CONTRACT (docs/deep-value-rigor-v2-spec.md Regola 2): `series` is always the RAW
 * historical multiple series, which lives in PROVIDER basis. `value` must therefore also be
 * in provider basis — run it through `toProviderBasis()` first if it was derived from a
 * statement-basis figure. Passing a statement-basis value directly reproduces the exact
 * cross-basis bug that misranked the Iren report.
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
 * Per-multiple historical stats, in PROVIDER basis — this is the raw pasted series,
 * unadjusted. `multiples` is expected ordered ascending by fiscalYear (as
 * `GroundedFinancials.multiples` is documented) — early/late means split the window IN
 * TIME, not by value, so a structural de-rating (e.g. energy) is visible rather than
 * smoothed away by a decade-long median.
 *
 * A key is omitted entirely from the result when the series has zero non-null values.
 * NEVER multiply this function's evEbitda stats by a statement-basis EBITDA — use
 * `computeBasisReconciliation(extract).adjustedEvEbitda` for that (same-basis, rescaled by
 * kE). This function stays raw on purpose: it also feeds `percentileOf` ranking, which
 * needs the untouched provider-basis distribution.
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
export type ValuationGridRow = {
  label: string;
  driverValue: number;
  // "trailing" = last reported fiscal year (comparable to the historical distribution
  // as-is); "midcycle" = multi-year median (smooths, not tied to one year); "forward" = a
  // future estimate (NOT comparable to a TRAILING historical distribution — spec §1
  // Regola 3, "the trailing/forward gate"). driverYear is null for "midcycle" (it spans
  // several years, not one).
  horizon: "trailing" | "midcycle" | "forward";
  driverYear: number | null;
};
export type ValuationGrid = {
  multipleKey: "evEbitda";
  columns: { label: "p25" | "median" | "p75"; multiple: number }[];
  rows: ValuationGridRow[];
  cells: (ValuationGridCell | null)[][];
  bridge: { netDebt: number; minorities: number; shares: number };
  // false when the basis wasn't verifiable (kE null) — the grid was still computed (with
  // kE treated as 1, i.e. the raw column multiples used as-is) but is UNVERIFIED, and the
  // prompt/UI must say so rather than presenting it with the same confidence as a verified
  // same-basis grid.
  basisApplied: boolean;
};

// "Mediana 5a" row — median EBITDA over up to the last 5 fiscal years.
const GRID_LOOKBACK_YEARS = 5;

/**
 * The 3×3 grid the Grounded prompt injects as FACTS: 3 historical EV/EBITDA multiples
 * (p25/median/p75, SAME-BASIS — rescaled by kE when `basis.adjustedEvEbitda` is available)
 * × 3 EBITDA bases (last FY, 5y median, next forward estimate). The bridge deduction in
 * every cell is scaled by kB (`basis.kB ?? 1`) — docs/deep-value-rigor-v2-spec.md §2.3.
 * Row labels are plain English placeholders — not yet wired to i18n `t()`, since no UI
 * consumes this grid until a later session; whichever session renders it can adapt the
 * shape then.
 *
 * Returns null when there's no EV/EBITDA history to anchor to, or when the latest fiscal
 * year is missing a bridge input (net debt / minorities / shares).
 */
export function computeValuationGrid(extract: GroundedFinancials, basis: BasisReconciliation): ValuationGrid | null {
  const rawEvEbitdaStats = computeMultipleStats(extract.multiples).find((s) => s.key === "evEbitda");
  if (!rawEvEbitdaStats) return null;

  const financials = extract.financials; // ascending by fiscalYear
  const latestFy = financials[financials.length - 1];
  if (!latestFy || latestFy.netDebt == null || latestFy.minorityInterest == null || latestFy.sharesDiluted == null) {
    return null;
  }
  const bridge = { netDebt: latestFy.netDebt, minorities: latestFy.minorityInterest, shares: latestFy.sharesDiluted };
  const kB = basis.kB ?? 1;

  // basis.adjustedEvEbitda is null exactly when kE is null (basis.ts) — degrade to the raw
  // stats (equivalent to kE=1) rather than failing the whole grid, but say so via basisApplied.
  const columnStats = basis.adjustedEvEbitda ?? rawEvEbitdaStats;
  const basisApplied = basis.adjustedEvEbitda != null;

  const columns: ValuationGrid["columns"] = [
    { label: "p25", multiple: columnStats.p25 },
    { label: "median", multiple: columnStats.median },
    { label: "p75", multiple: columnStats.p75 },
  ];

  const rows: ValuationGrid["rows"] = [];
  if (latestFy.ebitda != null) {
    rows.push({ label: `Last FY (${latestFy.fiscalYear})`, driverValue: latestFy.ebitda, horizon: "trailing", driverYear: latestFy.fiscalYear });
  }
  const recentEbitdas = financials
    .slice(-GRID_LOOKBACK_YEARS)
    .map((f) => f.ebitda)
    .filter((v): v is number => v != null);
  if (recentEbitdas.length > 0) {
    rows.push({
      label: "5y median",
      driverValue: quantile([...recentEbitdas].sort((a, b) => a - b), 0.5),
      horizon: "midcycle",
      driverYear: null,
    });
  }
  const nextEstimate = extract.estimates
    .filter((e): e is typeof e & { ebitda: number } => e.fiscalYear > latestFy.fiscalYear && e.ebitda != null)
    .sort((a, b) => a.fiscalYear - b.fiscalYear)[0];
  if (nextEstimate) {
    rows.push({ label: `${nextEstimate.fiscalYear}e`, driverValue: nextEstimate.ebitda, horizon: "forward", driverYear: nextEstimate.fiscalYear });
  }

  const cells: (ValuationGridCell | null)[][] = rows.map((row) =>
    columns.map((col) => ({
      multiple: col.multiple,
      driverValue: row.driverValue,
      perShare: (col.multiple * row.driverValue - kB * (bridge.netDebt + bridge.minorities)) / bridge.shares,
    })),
  );

  return { multipleKey: "evEbitda", columns, rows, cells, bridge, basisApplied };
}

export type MarketImplied = {
  price: number;
  driverLabel: string;
  // The statement fiscal year the driver (EBITDA_S) is drawn from — always the latest
  // reported year, so this read is trailing by construction.
  driverYear: number;
  // (price×shares + netDebt + minorities) / EBITDA_S — OUR OWN bridge, unscaled. Space S.
  impliedOnStatement: number;
  // impliedOnStatement re-expressed in provider space via toProviderBasis (kE-only) — the
  // ONLY figure from this type that may be passed to percentileOf. null when kE is null.
  impliedOnProvider: number | null;
  // percentileOf(impliedOnProvider, raw historical series) — null when impliedOnProvider
  // is null (kE unverifiable) or there's no historical series to rank against.
  percentile: number | null;
  // false ⇒ percentile (if present at all) rests on an unverified basis — see basisApplied
  // on ValuationGrid for the same convention.
  basisApplied: boolean;
} | null;

/**
 * Backs out the EV/EBITDA multiple the current price already implies, from the latest
 * fiscal year's bridge inputs — a CONTROL that reports the gap vs. the history-anchored
 * base multiple, never an input to it (rigor block item 10). Returns BOTH the statement-
 * basis read (our own bridge) and the provider-basis read (comparable to the raw
 * historical distribution) — see docs/deep-value-rigor-v2-spec.md §2.3: showing only one
 * of these, or ranking the statement-basis figure against the provider-basis distribution
 * directly, is the exact bug this rewrite fixes.
 *
 * CURRENCY GUARD (mandatory, spec §5.1): returns null whenever the extract's reporting
 * currency doesn't match the quote's currency, rather than silently mixing units — a price
 * in one currency divided against an EBITDA in another is a silently wrong number, the
 * worst bug class in this app.
 */
export function computeMarketImplied(
  price: number,
  quoteCurrency: string,
  extract: GroundedFinancials,
  basis: BasisReconciliation
): MarketImplied {
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

  const impliedOnStatement = (price * latestFy.sharesDiluted + latestFy.netDebt + latestFy.minorityInterest) / latestFy.ebitda;
  const impliedOnProvider = toProviderBasis(impliedOnStatement, basis);
  const percentile = impliedOnProvider != null ? percentileOf(impliedOnProvider, series) : null;

  return {
    price,
    driverLabel: "EBITDA",
    driverYear: latestFy.fiscalYear,
    impliedOnStatement,
    impliedOnProvider,
    percentile,
    basisApplied: basis.adjustedEvEbitda != null,
  };
}

export type ImpliedExpectations = {
  /** The EBITDA_S the price implies IF the stock traded at the historical median
   *  (same-basis). null when the basis or bridge inputs aren't verifiable. */
  requiredEbitdaAtMedian: number | null;
  /** Gap vs. the last reported EBITDA. Negative ⇒ the market is pricing in a DECLINE. */
  vsLatestFyPct: number | null;
  /** Gap vs. the first available forward estimate. Negative ⇒ the market doesn't believe
   *  the consensus/estimate path. */
  vsNextEstimatePct: number | null;
  nextEstimateYear: number | null;
  /** Symmetric read: at the level of the next forward estimate, what multiple (provider
   *  space) is the market paying TODAY? Comparable to the historical distribution on the
   *  MULTIPLE (like-for-like), but cross-horizon on the DRIVER (forward vs. trailing) —
   *  callers must label it as such. */
  multipleAtNextEstimate: number | null;
  multipleAtNextEstimatePercentile: number | null;
};

/**
 * The reverse-engineering read (docs/deep-value-rigor-v2-spec.md §2.4): not "the market is
 * at 5.5x and I anchor at 7.1x, therefore upside" but "what would have to be true for
 * today's price to be correct at the historical median multiple?" — turns the
 * market-implied check from rhetoric into arithmetic. Same currency guard as
 * computeMarketImplied; returns null under the same degradation conditions plus when
 * there's no EV/EBITDA history to solve against.
 */
export function computeImpliedExpectations(
  price: number,
  quoteCurrency: string,
  extract: GroundedFinancials,
  basis: BasisReconciliation
): ImpliedExpectations | null {
  if (!extract.meta.reportingCurrency || extract.meta.reportingCurrency !== quoteCurrency) return null;

  const latestFy = extract.financials[extract.financials.length - 1];
  if (!latestFy || latestFy.netDebt == null || latestFy.minorityInterest == null || latestFy.sharesDiluted == null) return null;

  const evEbitdaStats = computeMultipleStats(extract.multiples).find((s) => s.key === "evEbitda");
  if (!evEbitdaStats) return null;

  const kE = basis.kE;
  const kB = basis.kB ?? 1;
  const bridgeAtPrice = price * latestFy.sharesDiluted + kB * (latestFy.netDebt + latestFy.minorityInterest);

  let requiredEbitdaAtMedian: number | null = null;
  let vsLatestFyPct: number | null = null;
  if (kE != null && kE !== 0 && evEbitdaStats.median !== 0) {
    requiredEbitdaAtMedian = bridgeAtPrice / (evEbitdaStats.median * kE);
    if (latestFy.ebitda != null && latestFy.ebitda !== 0) {
      vsLatestFyPct = (requiredEbitdaAtMedian - latestFy.ebitda) / latestFy.ebitda;
    }
  }

  const nextEstimate = extract.estimates
    .filter((e): e is typeof e & { ebitda: number } => e.fiscalYear > latestFy.fiscalYear && e.ebitda != null)
    .sort((a, b) => a.fiscalYear - b.fiscalYear)[0];

  let vsNextEstimatePct: number | null = null;
  let multipleAtNextEstimate: number | null = null;
  let multipleAtNextEstimatePercentile: number | null = null;
  if (nextEstimate) {
    if (requiredEbitdaAtMedian != null && nextEstimate.ebitda !== 0) {
      vsNextEstimatePct = (requiredEbitdaAtMedian - nextEstimate.ebitda) / nextEstimate.ebitda;
    }
    // Same pattern as computeMarketImplied: our own (unscaled) bridge in statement space,
    // then translated to provider space via toProviderBasis — so it's rankable against
    // the raw historical series alongside impliedOnProvider above.
    const sMultipleAtNextEstimate = (price * latestFy.sharesDiluted + latestFy.netDebt + latestFy.minorityInterest) / nextEstimate.ebitda;
    const provider = toProviderBasis(sMultipleAtNextEstimate, basis);
    if (provider != null) {
      multipleAtNextEstimate = provider;
      const series = extract.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null);
      if (series.length > 0) multipleAtNextEstimatePercentile = percentileOf(provider, series);
    }
  }

  return {
    requiredEbitdaAtMedian,
    vsLatestFyPct,
    vsNextEstimatePct,
    nextEstimateYear: nextEstimate?.fiscalYear ?? null,
    multipleAtNextEstimate,
    multipleAtNextEstimatePercentile,
  };
}
