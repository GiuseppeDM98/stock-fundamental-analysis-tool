// The dividend outlook of a saved analysis, computed in code from two inputs: the dataset's
// reported DPS history (FiscalYearFinancials.dividendsPerShare) and the three-year path the
// model declared in its JSON (DeepValueResult.dividends). Pure arithmetic, shared by client
// and server: no currency guard here — the caller passes `price` / `weightedAvgCost` as null
// when their currency is not the dividend's (components/report/dividend-outlook.tsx).
//
// lib/dividends.ts (no relation) is the server-only Borsa Italiana fetcher of PAID dividends,
// portfolio accounting; dividends received never enter this module.
import type { FiscalYearFinancials } from "@/types/grounding";
import type { DeepValueResult, DividendPath, DividendPathYear } from "@/components/report/types";
import { dividendCoverageRatio } from "@/lib/grounding/postcheck";

export type DividendYearStats = {
  fiscalYear: number;
  dps: number;
  payoutOnEps: number | null; // DPS / EPS; null when EPS is missing or ≤ 0
  coverageByFcf: number | null; // the gate's ratio on this year's DPS and the data up to it
};

export type DividendStats = {
  years: DividendYearStats[]; // ascending, only FYs with a non-null DPS (0 included: a real year)
  lastDps: number;
  cagr3y: number | null; // (dps[lastFy] / dps[lastFy − 3])^(1/3) − 1; null if that FY is missing or its DPS is 0
  cagr5y: number | null; // idem over lastFy − 5
  cutYears: number[]; // FYs whose DPS < the DPS of FY − 1 (a missing FY − 1 is not a cut)
  streakYears: number; // consecutive year→year steps without a cut, ending at the last FY
};

export type DividendProjection = {
  stats: DividendStats | null;
  path: DividendPathYear[] | null; // the model's three years; null for a non-payer or undeclared
  policy: string | null;
  nonPayer: boolean; // the model declared dividends: null
  yieldBasis: "forward" | "trailing" | null;
  yieldOnPrice: { bull: number; base: number; bear: number } | null; // fractions
  yieldOnCost: { bull: number; base: number; bear: number } | null; // fractions, needs weightedAvgCost
  coverage: { ratio: number; status: "pass" | "fail" | "unavailable" } | null; // the gate's rule
};

/** Compound annual growth over `periods` years; null when the start is 0 (no growth from nothing). */
function cagr(first: number, last: number, periods: number): number | null {
  if (periods <= 0 || first <= 0 || last < 0) return null;
  return Math.pow(last / first, 1 / periods) - 1;
}

/**
 * The reported DPS history: per-year payout and FCF coverage, CAGRs on exact fiscal years,
 * the cuts and the streak without one. A missing year is never invented: it breaks the
 * streak and voids a CAGR that would start on it, but it is not a cut.
 * @returns null when no fiscal year reports a DPS.
 */
export function computeDividendStats(financials: FiscalYearFinancials[]): DividendStats | null {
  const ascending = [...financials].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const rows = ascending.filter((f) => f.dividendsPerShare != null);
  if (rows.length === 0) return null;
  const dpsByFy = new Map(rows.map((f) => [f.fiscalYear, f.dividendsPerShare as number]));

  const years: DividendYearStats[] = rows.map((f) => {
    const dps = f.dividendsPerShare as number;
    // Each year is weighed as the gate would have weighed it then: on the data up to it.
    const coverage = dividendCoverageRatio(dps, ascending.filter((x) => x.fiscalYear <= f.fiscalYear));
    return {
      fiscalYear: f.fiscalYear,
      dps,
      payoutOnEps: f.eps != null && f.eps > 0 ? dps / f.eps : null,
      coverageByFcf: coverage && Number.isFinite(coverage.ratio) ? coverage.ratio : null,
    };
  });

  const previousDps = (fy: number) => dpsByFy.get(fy - 1);
  const cutYears = years.filter((y) => {
    const prev = previousDps(y.fiscalYear);
    return prev != null && y.dps < prev;
  }).map((y) => y.fiscalYear);

  const lastFy = years[years.length - 1].fiscalYear;
  let streakYears = 0;
  for (let fy = lastFy; dpsByFy.has(fy - 1) && (dpsByFy.get(fy) as number) >= (dpsByFy.get(fy - 1) as number); fy--) {
    streakYears++;
  }

  const lastDps = dpsByFy.get(lastFy) as number;
  const cagrOver = (n: number) => {
    const first = dpsByFy.get(lastFy - n);
    return first != null ? cagr(first, lastDps, n) : null;
  };
  return { years, lastDps, cagr3y: cagrOver(3), cagr5y: cagrOver(5), cutYears, streakYears };
}

/**
 * History + the model's path + yields + the coverage the dividend_coverage gate computes.
 * The yield reads the BASE DPS of the path's FIRST year (forward); with no path it falls back
 * to the last reported DPS, labelled trailing. The coverage uses dividendCoverageRatio on the
 * forward base DPS, exactly as the gate does; the gate's currency check is the caller's.
 * @param price the price in the dividend's currency, else null (no yield).
 * @param weightedAvgCost the open position's average cost in the dividend's currency, else null.
 * @returns null with neither a history nor a declaration (nothing to show).
 */
export function buildDividendProjection(
  result: Pick<DeepValueResult, "dividends"> | null,
  financials: FiscalYearFinancials[],
  price: number | null,
  weightedAvgCost: number | null = null
): DividendProjection | null {
  const stats = computeDividendStats(financials);
  // undefined = no result, or a report saved before the field existed; null = the model says
  // non-payer. Written WITHOUT `??`: `null ?? undefined` is undefined and would lose the
  // non-payer.
  const declared: DividendPath | null | undefined = result ? result.dividends : undefined;
  const nonPayer = declared === null;
  const path = declared ? declared.path : null;
  if (!stats && !path && !nonPayer) return null;

  const forward = path?.[0] ?? null;
  const triple = nonPayer
    ? null
    : forward
      ? { bull: forward.bull, base: forward.base, bear: forward.bear }
      : stats && stats.lastDps > 0
        ? { bull: stats.lastDps, base: stats.lastDps, bear: stats.lastDps }
        : null;
  const yieldBasis = nonPayer ? null : forward ? "forward" : triple ? "trailing" : null;
  const over = (divisor: number) =>
    triple ? { bull: triple.bull / divisor, base: triple.base / divisor, bear: triple.bear / divisor } : null;

  return {
    stats,
    path,
    policy: declared?.policy ?? null,
    nonPayer,
    yieldBasis,
    yieldOnPrice: price != null && price > 0 ? over(price) : null,
    yieldOnCost: weightedAvgCost != null && weightedAvgCost > 0 ? over(weightedAvgCost) : null,
    coverage: forwardCoverage(nonPayer, forward, financials),
  };
}

/** The gate's verdict on the forward base DPS: a non-payer passes, a path without the data
 *  to weigh it is unavailable, no path at all has no forward coverage (null). */
function forwardCoverage(
  nonPayer: boolean,
  forward: DividendPathYear | null,
  financials: FiscalYearFinancials[]
): DividendProjection["coverage"] {
  if (nonPayer) return { ratio: 0, status: "pass" };
  if (!forward) return null;
  const coverage = dividendCoverageRatio(forward.base, financials);
  if (!coverage) return { ratio: NaN, status: "unavailable" };
  return { ratio: coverage.ratio, status: Number.isFinite(coverage.ratio) && coverage.ratio <= 1 ? "pass" : "fail" };
}
