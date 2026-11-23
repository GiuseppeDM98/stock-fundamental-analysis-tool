import { describe, it, expect } from "vitest";
import { buildDividendProjection, computeDividendStats } from "@/lib/dividends/projection";
import { checkValuationBridges } from "@/lib/grounding/postcheck";
import type { DeepValueResult, DividendPath } from "@/components/report/types";
import type { FiscalYearFinancials } from "@/types/grounding";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

// FY2021–2025: DPS 0.36, 0.38, 0.40, 0.40, 0.40; FCF 70…110; 100 shares; EPS 1.00.
const YEARS = [2021, 2022, 2023, 2024, 2025];
const DPS = [0.36, 0.38, 0.4, 0.4, 0.4];
const FCF = [70, 80, 90, 100, 110];

function history(dps: Array<number | null> = DPS, years: number[] = YEARS): FiscalYearFinancials[] {
  return years.map((fiscalYear, i) =>
    makeFinancialsRow({ fiscalYear, dividendsPerShare: dps[i], freeCashFlow: FCF[i], sharesDiluted: 100, eps: 1 })
  );
}

// Base 0.42 differs from the last reported 0.40 and from the bull/bear, so a projection that
// reads the wrong number gives a different yield.
const PATH: DividendPath = {
  policy: "Pays out about 60% of net income.",
  lastDps: 0.4,
  path: [
    { year: 2026, bull: 0.44, base: 0.42, bear: 0.38 },
    { year: 2027, bull: 0.47, base: 0.44, bear: 0.36 },
    { year: 2028, bull: 0.5, base: 0.46, bear: 0.34 },
  ],
};

describe("computeDividendStats", () => {
  it("reads payout, FCF coverage, CAGRs on exact years, cuts and the streak from the reported history", () => {
    const stats = computeDividendStats(history())!;
    expect(stats.years.map((y) => y.fiscalYear)).toEqual(YEARS);
    expect(stats.lastDps).toBe(0.4);
    expect(stats.cagr3y).toBeCloseTo(Math.pow(0.4 / 0.38, 1 / 3) - 1, 12);
    // FY2020 is not in the data: no five-year CAGR, never one on four years.
    expect(stats.cagr5y).toBeNull();
    expect(stats.cutYears).toEqual([]);
    // Five years of non-decreasing DPS are four steps without a cut.
    expect(stats.streakYears).toBe(4);
    expect(stats.years[4].payoutOnEps).toBeCloseTo(0.4, 12);
    // Each year on the data up to it: 2025 over the mean of 90, 100, 110; 2021 over 70 alone.
    expect(stats.years[4].coverageByFcf).toBeCloseTo(0.4, 12);
    expect(stats.years[0].coverageByFcf).toBeCloseTo(36 / 70, 12);
  });

  it("a lower DPS than the year before is a cut, and the streak ends there", () => {
    const stats = computeDividendStats(history([0.36, 0.38, 0.4, 0.4, 0.3]))!;
    expect(stats.cutYears).toEqual([2025]);
    expect(stats.streakYears).toBe(0);
  });

  it("a missing year is no cut, but voids the CAGR that would start on it and breaks the streak", () => {
    const stats = computeDividendStats(history([0.36, 0.4, 0.4, 0.4], [2021, 2023, 2024, 2025]))!;
    expect(stats.cagr3y).toBeNull();
    expect(stats.cutYears).toEqual([]);
    expect(stats.streakYears).toBe(2);
  });

  it("a year whose DPS is null is a missing year too", () => {
    const stats = computeDividendStats(history([0.36, null, 0.4, 0.4, 0.4]))!;
    expect(stats.years.map((y) => y.fiscalYear)).toEqual([2021, 2023, 2024, 2025]);
    expect(stats.cagr3y).toBeNull();
  });

  it("sorts the rows itself", () => {
    const stats = computeDividendStats([...history()].reverse())!;
    expect(stats.years.map((y) => y.fiscalYear)).toEqual(YEARS);
    expect(stats.lastDps).toBe(0.4);
  });

  it("is null when no year reports a DPS", () => {
    expect(computeDividendStats(history([null, null, null, null, null]))).toBeNull();
    expect(computeDividendStats([])).toBeNull();
  });

  it("a DPS of 0 is a real year: a drop to 0 is a cut, and no CAGR starts from 0", () => {
    const toZero = computeDividendStats(history([0.36, 0.38, 0.4, 0.4, 0]))!;
    expect(toZero.cutYears).toEqual([2025]);
    expect(toZero.lastDps).toBe(0);
    const fromZero = computeDividendStats(history([0, 0, 0.4, 0.4, 0.4]))!;
    expect(fromZero.cagr3y).toBeNull();
  });

  it("EPS missing or negative gives no payout", () => {
    const rows = history().map((r, i) => ({ ...r, eps: i === 4 ? -0.5 : i === 3 ? null : r.eps }));
    const stats = computeDividendStats(rows)!;
    expect(stats.years[4].payoutOnEps).toBeNull();
    expect(stats.years[3].payoutOnEps).toBeNull();
  });
});

describe("buildDividendProjection", () => {
  it("a forward yield on the BASE DPS of the path's first year, per scenario", () => {
    const p = buildDividendProjection({ dividends: PATH }, history(), 11.4)!;
    expect(p.yieldBasis).toBe("forward");
    expect(p.yieldOnPrice!.base).toBeCloseTo(0.42 / 11.4, 12);
    expect(p.yieldOnPrice!.bull).toBeCloseTo(0.44 / 11.4, 12);
    expect(p.yieldOnPrice!.bear).toBeCloseTo(0.38 / 11.4, 12);
    expect(p.path).toEqual(PATH.path);
    expect(p.policy).toBe(PATH.policy);
    expect(p.nonPayer).toBe(false);
    // No position: no yield on cost.
    expect(p.yieldOnCost).toBeNull();
  });

  it("a yield on cost over the open position's average cost", () => {
    const p = buildDividendProjection({ dividends: PATH }, history(), 11.4, 10.7333)!;
    expect(p.yieldOnCost!.base).toBeCloseTo(0.42 / 10.7333, 12);
  });

  it("without a path, a trailing yield on the last reported DPS", () => {
    const p = buildDividendProjection({ dividends: undefined }, history(), 11.4)!;
    expect(p.yieldBasis).toBe("trailing");
    expect(p.yieldOnPrice).toEqual({ bull: 0.4 / 11.4, base: 0.4 / 11.4, bear: 0.4 / 11.4 });
    expect(p.coverage).toBeNull();
    expect(p.path).toBeNull();
  });

  it("no result at all reads like an undeclared path", () => {
    expect(buildDividendProjection(null, history(), 11.4)?.yieldBasis).toBe("trailing");
    expect(buildDividendProjection(null, [], 11.4)).toBeNull();
  });

  it("a declared non-payer passes coverage and has no path and no yield, even with a history", () => {
    const p = buildDividendProjection({ dividends: null }, history(), 11.4, 10)!;
    expect(p.nonPayer).toBe(true);
    expect(p.coverage).toEqual({ ratio: 0, status: "pass" });
    expect(p.path).toBeNull();
    expect(p.yieldBasis).toBeNull();
    expect(p.yieldOnPrice).toBeNull();
    expect(p.yieldOnCost).toBeNull();
    // The history stays.
    expect(p.stats?.lastDps).toBe(0.4);
  });

  it("a declared non-payer without any history still has a projection to show", () => {
    expect(buildDividendProjection({ dividends: null }, [], null)?.nonPayer).toBe(true);
  });

  it("every DPS 0 and no path: the stats, no yield", () => {
    const p = buildDividendProjection({ dividends: undefined }, history([0, 0, 0, 0, 0]), 11.4)!;
    expect(p.stats?.lastDps).toBe(0);
    // A cut is a drop below the year before: five zeros are no cut, and a flat streak.
    expect(p.stats?.cutYears).toEqual([]);
    expect(p.stats?.streakYears).toBe(4);
    expect(p.yieldBasis).toBeNull();
    expect(p.yieldOnPrice).toBeNull();
  });

  it("no price, or a price ≤ 0, gives no yield on price", () => {
    expect(buildDividendProjection({ dividends: PATH }, history(), null)?.yieldOnPrice).toBeNull();
    expect(buildDividendProjection({ dividends: PATH }, history(), 0)?.yieldOnPrice).toBeNull();
  });

  it("a path without the data to weigh it is unavailable, never pass", () => {
    expect(buildDividendProjection({ dividends: PATH }, [], 11.4)?.coverage?.status).toBe("unavailable");
  });

  it("a mean FCF ≤ 0 fails the coverage", () => {
    const rows = history().map((r) => ({ ...r, freeCashFlow: -10 }));
    expect(buildDividendProjection({ dividends: PATH }, rows, 11.4)?.coverage).toEqual({ ratio: Infinity, status: "fail" });
  });
});

describe("the outlook's coverage is the dividend_coverage gate's", () => {
  // A minimal valuation: the gate only needs the currency, the dividends and the dataset.
  const result = (dividends: DividendPath): DeepValueResult => ({
    method: "EV/EBITDA",
    sector: "Utilities",
    currency: "EUR",
    bull: { fairValue: 14 },
    base: { fairValue: 12 },
    bear: { fairValue: 9 },
    dividends,
  });
  const extract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }), financials: history() });

  it.each([
    ["covered", PATH],
    ["not covered", { ...PATH, path: PATH.path.map((y) => ({ ...y, base: 1.3 })) as DividendPath["path"] }],
  ])("same ratio and same status when %s", (_label, dividends) => {
    const gate = checkValuationBridges(result(dividends), 20, 11.4, "EUR", extract)!.gates.find((g) => g.code === "dividend_coverage")!;
    const coverage = buildDividendProjection({ dividends }, extract.financials, 11.4)!.coverage!;
    expect(gate.detail).toContain(`ratio ${coverage.ratio.toFixed(2)}`);
    expect(coverage.status).toBe(gate.status);
  });
});
