import { describe, it, expect } from "vitest";
import { computeMultipleStats, percentileOf, computeValuationGrid, computeMarketImplied } from "@/lib/grounding/anchors";
import { makeFinancialsRow, makeMultiplesRow, makeEstimateRow, makeExtract, makeMeta } from "./grounding-test-helpers";

// A 10y EV/EBITDA series with a structural de-rating (early half ~4.4x, late half ~3.4x),
// matching the Eni-shaped scenario described in CLAUDE.md.
const DERATING_MULTIPLES = [
  makeMultiplesRow({ fiscalYear: 2016, evEbitda: 4.6 }),
  makeMultiplesRow({ fiscalYear: 2017, evEbitda: 4.5 }),
  makeMultiplesRow({ fiscalYear: 2018, evEbitda: 4.3 }),
  makeMultiplesRow({ fiscalYear: 2019, evEbitda: 4.2 }),
  makeMultiplesRow({ fiscalYear: 2020, evEbitda: 4.4 }),
  makeMultiplesRow({ fiscalYear: 2021, evEbitda: 3.6 }),
  makeMultiplesRow({ fiscalYear: 2022, evEbitda: 3.3 }),
  makeMultiplesRow({ fiscalYear: 2023, evEbitda: 3.2 }),
  makeMultiplesRow({ fiscalYear: 2024, evEbitda: 3.5 }),
  makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.4 }),
];

describe("computeMultipleStats", () => {
  it("computes quantiles (type-7 interpolation) and omits keys with no data", () => {
    const stats = computeMultipleStats(DERATING_MULTIPLES);

    // Only evEbitda has data — evSales/pe/pb must be omitted entirely, not present as
    // zero-filled stats.
    expect(stats.map((s) => s.key)).toEqual(["evEbitda"]);

    const evEbitda = stats[0];
    // sorted: [3.2,3.3,3.4,3.5,3.6,4.2,4.3,4.4,4.5,4.6], n=10
    expect(evEbitda.n).toBe(10);
    expect(evEbitda.min).toBe(3.2);
    expect(evEbitda.max).toBe(4.6);
    // median: h=(10-1)*0.5=4.5 → sorted[4]=3.6 + 0.5*(sorted[5]-sorted[4])=3.6+0.5*0.6=3.9
    expect(evEbitda.median).toBeCloseTo(3.9, 6);
    // p25: h=9*0.25=2.25 → sorted[2]=3.4 + 0.25*(sorted[3]-sorted[2])=3.4+0.25*0.1=3.425
    expect(evEbitda.p25).toBeCloseTo(3.425, 6);
    // p75: h=9*0.75=6.75 → sorted[6]=4.3 + 0.75*(sorted[7]-sorted[6])=4.3+0.75*0.1=4.375
    expect(evEbitda.p75).toBeCloseTo(4.375, 6);
  });

  it("splits early/late means chronologically (not by value) to reveal a de-rating", () => {
    const evEbitda = computeMultipleStats(DERATING_MULTIPLES)[0];
    // early = mean(2016..2020) = (4.6+4.5+4.3+4.2+4.4)/5 = 22.0/5 = 4.4
    expect(evEbitda.earlyMean).toBeCloseTo(4.4, 6);
    // late = mean(2021..2025) = (3.6+3.3+3.2+3.5+3.4)/5 = 17.0/5 = 3.4
    expect(evEbitda.lateMean).toBeCloseTo(3.4, 6);
  });

  it("returns null early/lateMean when fewer than 2 data points exist", () => {
    const single = computeMultipleStats([makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4.0 })]);
    expect(single[0].earlyMean).toBeNull();
    expect(single[0].lateMean).toBeNull();
  });

  it("returns an empty array on garbage/empty input", () => {
    expect(computeMultipleStats([])).toEqual([]);
  });
});

describe("percentileOf", () => {
  const series = DERATING_MULTIPLES.map((m) => m.evEbitda as number);

  it("ranks a mid-series value via the type-7 inverse (PERCENTRANK.INC)", () => {
    // Bracket [3.6, 4.2] (index 4→5): frac=(4.18-3.6)/(4.2-3.6)=0.58/0.6=0.9667,
    // h=4+0.9667=4.9667, percentile=4.9667/9*100≈55.19
    expect(percentileOf(4.18, series)).toBeCloseTo(55.185, 2);
  });

  it("clamps to 0 at or below the minimum, 100 at or above the maximum", () => {
    expect(percentileOf(3.2, series)).toBe(0);
    expect(percentileOf(4.6, series)).toBe(100);
    expect(percentileOf(2.0, series)).toBe(0); // below min
    expect(percentileOf(9.0, series)).toBe(100); // above max
  });

  it("handles a degenerate single-point series without crashing", () => {
    expect(percentileOf(5, [4])).toBe(100); // above the only point
    expect(percentileOf(3, [4])).toBe(0); // at/below the only point
  });
});

describe("computeValuationGrid", () => {
  // Last FY (2025) EBITDA=14200 (bridge inputs live here); a 5y EBITDA history whose
  // median (14000) differs from both the last-FY figure and the forward estimate, so the
  // three grid rows are all distinguishable.
  const extract = makeExtract({
    financials: [
      makeFinancialsRow({ fiscalYear: 2021, ebitda: 13000 }),
      makeFinancialsRow({ fiscalYear: 2022, ebitda: 15500 }),
      makeFinancialsRow({ fiscalYear: 2023, ebitda: 14000 }),
      makeFinancialsRow({ fiscalYear: 2024, ebitda: 13600 }),
      makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 }),
    ],
    multiples: DERATING_MULTIPLES,
    estimates: [makeEstimateRow({ fiscalYear: 2026, ebitda: 14900 })],
  });

  it("builds a 3x3 grid: p25/median/p75 columns x last-FY/5y-median/forward-estimate rows", () => {
    const grid = computeValuationGrid(extract);
    expect(grid).not.toBeNull();
    expect(grid!.multipleKey).toBe("evEbitda");
    expect(grid!.columns.map((c) => c.label)).toEqual(["p25", "median", "p75"]);
    expect(grid!.rows.map((r) => r.label)).toEqual(["Last FY (2025)", "5y median", "2026e"]);

    expect(grid!.rows[0].driverValue).toBe(14200);
    // 5y median of [13000,15500,14000,13600,14200] sorted → [13000,13600,14000,14200,15500],
    // n=5 odd → middle element = 14000
    expect(grid!.rows[1].driverValue).toBe(14000);
    expect(grid!.rows[2].driverValue).toBe(14900);

    expect(grid!.bridge).toEqual({ netDebt: 11500, minorities: 3200, shares: 3150 });

    // Last-FY row, median column: perShare = (median × 14200 − 11500 − 3200) / 3150
    // = (3.9 × 14200 − 14700) / 3150 = (55380 − 14700) / 3150 ≈ 12.9143
    expect(grid!.cells[0][1]!.perShare).toBeCloseTo(12.914285714, 6);
    // 5y-median row, p25 column: (3.425 × 14000 − 14700) / 3150 ≈ 10.5556
    expect(grid!.cells[1][0]!.perShare).toBeCloseTo(10.555555556, 6);
    // Forward-estimate row, p75 column: (4.375 × 14900 − 14700) / 3150 ≈ 16.0278
    expect(grid!.cells[2][2]!.perShare).toBeCloseTo(16.027777778, 6);
  });

  it("omits the forward-estimate row when no future estimate exists", () => {
    const noEstimate = makeExtract({ ...extract, estimates: [] });
    const grid = computeValuationGrid(noEstimate);
    expect(grid!.rows.map((r) => r.label)).toEqual(["Last FY (2025)", "5y median"]);
  });

  it("returns null when there's no EV/EBITDA history", () => {
    const noMultiples = makeExtract({ ...extract, multiples: [] });
    expect(computeValuationGrid(noMultiples)).toBeNull();
  });

  it("returns null when the latest fiscal year is missing a bridge input", () => {
    const missingShares = makeExtract({
      ...extract,
      financials: [
        ...extract.financials.slice(0, -1),
        makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: null }),
      ],
    });
    expect(computeValuationGrid(missingShares)).toBeNull();
  });

  it("returns null/empty on garbage input (no financials at all)", () => {
    expect(computeValuationGrid(makeExtract({ multiples: DERATING_MULTIPLES }))).toBeNull();
  });
});

describe("computeMarketImplied", () => {
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 })],
    multiples: DERATING_MULTIPLES,
  });

  it("computes the price-implied EV/EBITDA and its historical percentile", () => {
    const result = computeMarketImplied(14.18, "EUR", extract);
    expect(result).not.toBeNull();
    // impliedMultiple = (price × shares + netDebt + minorities) / ebitda
    // = (14.18 × 3150 + 11500 + 3200) / 14200 ≈ 4.1808
    expect(result!.impliedMultiple).toBeCloseTo(4.180774648, 6);
    expect(result!.driverLabel).toBe("EBITDA");
    expect(result!.percentile).toBeGreaterThan(0);
  });

  it("returns null on a currency mismatch instead of a silently wrong number (spec §5.1)", () => {
    // Reporting currency is EUR, quote currency is USD — must never divide across units.
    expect(computeMarketImplied(15, "USD", extract)).toBeNull();
  });

  it("returns null when the reporting currency was never determined", () => {
    const noCurrency = makeExtract({ ...extract, meta: makeMeta() });
    expect(computeMarketImplied(15, "EUR", noCurrency)).toBeNull();
  });

  it("returns null on garbage/empty input (no financials, no multiples)", () => {
    expect(computeMarketImplied(15, "EUR", makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }) }))).toBeNull();
  });
});
