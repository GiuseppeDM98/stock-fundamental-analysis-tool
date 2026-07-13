import { describe, it, expect } from "vitest";
import { computeMultipleStats, percentileOf, computeValuationGrid, computeMarketImplied, computeImpliedExpectations } from "@/lib/grounding/anchors";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
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

// A basis with no EV/Revenue or Enterprise Value data anywhere ⇒ kE unavailable ⇒
// adjustedEvEbitda null ⇒ grid/market-implied degrade to basisApplied: false (kE treated
// as 1) rather than failing outright — this is the pre-v2 behavior, still correct when the
// basis genuinely can't be verified.
const UNVERIFIABLE_BASIS = computeBasisReconciliation(makeExtract({ multiples: DERATING_MULTIPLES }));

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

describe("computeValuationGrid — unverified basis (kE null, degrades to kE=1)", () => {
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
  const basis = computeBasisReconciliation(extract); // no evSales/enterpriseValue ⇒ kE null

  it("builds a 3x3 grid: p25/median/p75 columns x last-FY/5y-median/forward-estimate rows, with horizon labels", () => {
    const grid = computeValuationGrid(extract, basis);
    expect(grid).not.toBeNull();
    expect(grid!.multipleKey).toBe("evEbitda");
    expect(grid!.basisApplied).toBe(false); // kE unverifiable in this fixture
    expect(grid!.columns.map((c) => c.label)).toEqual(["p25", "median", "p75"]);
    expect(grid!.rows.map((r) => r.label)).toEqual(["Last FY (2025)", "5y median", "2026e"]);
    expect(grid!.rows.map((r) => r.horizon)).toEqual(["trailing", "midcycle", "forward"]);
    expect(grid!.rows.map((r) => r.driverYear)).toEqual([2025, null, 2026]);

    expect(grid!.rows[0].driverValue).toBe(14200);
    // 5y median of [13000,15500,14000,13600,14200] sorted → [13000,13600,14000,14200,15500],
    // n=5 odd → middle element = 14000
    expect(grid!.rows[1].driverValue).toBe(14000);
    expect(grid!.rows[2].driverValue).toBe(14900);

    expect(grid!.bridge).toEqual({ netDebt: 11500, minorities: 3200, shares: 3150 });

    // kE unverifiable ⇒ columns use the RAW stats (equivalent to kE=1); kB defaults to 1
    // too (no marketCap/pe/pb data) ⇒ cells match the pre-v2 formula exactly.
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
    const grid = computeValuationGrid(noEstimate, computeBasisReconciliation(noEstimate));
    expect(grid!.rows.map((r) => r.label)).toEqual(["Last FY (2025)", "5y median"]);
  });

  it("returns null when there's no EV/EBITDA history", () => {
    const noMultiples = makeExtract({ ...extract, multiples: [] });
    expect(computeValuationGrid(noMultiples, computeBasisReconciliation(noMultiples))).toBeNull();
  });

  it("returns null when the latest fiscal year is missing a bridge input", () => {
    const missingShares = makeExtract({
      ...extract,
      financials: [
        ...extract.financials.slice(0, -1),
        makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: null }),
      ],
    });
    expect(computeValuationGrid(missingShares, computeBasisReconciliation(missingShares))).toBeNull();
  });

  it("returns null/empty on garbage input (no financials at all)", () => {
    const garbage = makeExtract({ multiples: DERATING_MULTIPLES });
    expect(computeValuationGrid(garbage, computeBasisReconciliation(garbage))).toBeNull();
  });
});

describe("computeValuationGrid — verified basis (kE/kB applied)", () => {
  it("uses adjustedEvEbitda for columns and scales the bridge deduction by kB", () => {
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [
        makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, revenue: 2000, netDebt: 500, minorityInterest: 200, sharesDiluted: 100 }),
      ],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 2.0 })], // kE: EV_P=4000, ebitdaProvider=800, kE=0.8
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.kE).toBeCloseTo(0.8, 6);

    const grid = computeValuationGrid(extract, basis);
    expect(grid!.basisApplied).toBe(true);
    // Single observation ⇒ p25=median=p75=5×0.8=4.0 (adjustedEvEbitda)
    expect(grid!.columns.map((c) => c.multiple)).toEqual([4, 4, 4]);
    // kB defaults to 1 here (no marketCap/pe/pb) ⇒ perShare = (4×1000 − 1×(500+200))/100 = 33
    expect(grid!.cells[0][0]!.perShare).toBeCloseTo(33, 6);
  });
});

describe("computeMarketImplied — same-basis (spec §2.3)", () => {
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 })],
    multiples: DERATING_MULTIPLES,
  });

  it("computes the statement-basis read unconditionally, and the provider-basis read only when kE is verifiable", () => {
    const result = computeMarketImplied(14.18, "EUR", extract, UNVERIFIABLE_BASIS);
    expect(result).not.toBeNull();
    // impliedOnStatement = (price × shares + netDebt + minorities) / ebitda
    // = (14.18 × 3150 + 11500 + 3200) / 14200 ≈ 4.1808
    expect(result!.impliedOnStatement).toBeCloseTo(4.180774648, 6);
    expect(result!.driverLabel).toBe("EBITDA");
    expect(result!.driverYear).toBe(2025);
    // kE null (UNVERIFIABLE_BASIS) ⇒ impliedOnProvider/percentile null, basisApplied false
    expect(result!.impliedOnProvider).toBeNull();
    expect(result!.percentile).toBeNull();
    expect(result!.basisApplied).toBe(false);
  });

  it("re-expresses impliedOnStatement in provider space (÷kE) and ranks THAT — never the raw statement figure", () => {
    const basis = computeBasisReconciliation(
      makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, revenue: 2000 })],
        multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 2.0 })], // kE ≈ 0.8
      })
    );
    const extractWithHistory = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 })],
      multiples: DERATING_MULTIPLES,
    });
    const result = computeMarketImplied(14.18, "EUR", extractWithHistory, basis);
    expect(result!.impliedOnProvider).toBeCloseTo(result!.impliedOnStatement / 0.8, 6);
    expect(result!.basisApplied).toBe(true);
    expect(result!.percentile).not.toBeNull();
  });

  it("returns null on a currency mismatch instead of a silently wrong number (spec §5.1)", () => {
    // Reporting currency is EUR, quote currency is USD — must never divide across units.
    expect(computeMarketImplied(15, "USD", extract, UNVERIFIABLE_BASIS)).toBeNull();
  });

  it("returns null when the reporting currency was never determined", () => {
    const noCurrency = makeExtract({ ...extract, meta: makeMeta() });
    expect(computeMarketImplied(15, "EUR", noCurrency, computeBasisReconciliation(noCurrency))).toBeNull();
  });

  it("returns null on garbage/empty input (no financials, no multiples)", () => {
    const garbage = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }) });
    expect(computeMarketImplied(15, "EUR", garbage, computeBasisReconciliation(garbage))).toBeNull();
  });
});

describe("computeImpliedExpectations — the reverse-engineering read (spec §2.4)", () => {
  // Iren-shaped: same-basis median ≈5.9x (kE≈0.83 × raw median 7.1x — see
  // grounding-basis.test.ts), latest FY EBITDA_S=1353, 2026e EBITDA_S=1610 (chosen so
  // requiredEbitdaAtMedian lands ~16% below it, mirroring the spec's own Iren narrative:
  // "l'EBITDA dovrebbe essere 1.140 mln — il 16% sotto la stima 2026e di 1.353 mln").
  const STATEMENT_EBITDA = 1353;
  const IREN_YEARS = [
    { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
    { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
    { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
    { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
  ];
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [
      ...IREN_YEARS.slice(0, -1).map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: STATEMENT_EBITDA })),
      makeFinancialsRow({
        fiscalYear: 2025,
        ebitda: STATEMENT_EBITDA,
        netDebt: 4411.6,
        minorityInterest: 0,
        sharesDiluted: 908.8,
      }),
    ],
    multiples: IREN_YEARS.map((y) => {
      const ebitdaProvider = y.kE * STATEMENT_EBITDA;
      return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
    }),
    estimates: [makeEstimateRow({ fiscalYear: 2026, ebitda: 1353 * 1.19 })], // ≈1610, "2026e"
  });
  const basis = computeBasisReconciliation(extract); // kE ≈ 0.83, raw median 7.1x

  it("solves for the EBITDA the current price implies at the same-basis historical median", () => {
    const result = computeImpliedExpectations(2.95, "EUR", extract, basis);
    expect(result).not.toBeNull();
    // requiredEbitdaAtMedian = (price×shares + kB×(netDebt+minorities)) / (median_P × kE)
    // = (2.95×908.8 + 1×4411.6) / (7.1 × 0.83) = 7092.56 / 5.893 ≈ 1203.557
    expect(result!.requiredEbitdaAtMedian).toBeCloseTo(1203.557, 1);
    // vsLatestFyPct = (1203.557 - 1353) / 1353 ≈ -11.0%
    expect(result!.vsLatestFyPct).toBeLessThan(0);
  });

  it("compares the required EBITDA against the first forward estimate, negative ⇒ market doesn't believe the estimate path", () => {
    const result = computeImpliedExpectations(2.95, "EUR", extract, basis);
    expect(result!.nextEstimateYear).toBe(2026);
    expect(result!.vsNextEstimatePct).not.toBeNull();
    expect(result!.vsNextEstimatePct!).toBeLessThan(0);
  });

  it("computes the symmetric multipleAtNextEstimate in provider space, rankable against history", () => {
    const result = computeImpliedExpectations(2.95, "EUR", extract, basis);
    expect(result!.multipleAtNextEstimate).not.toBeNull();
    expect(result!.multipleAtNextEstimatePercentile).not.toBeNull();
  });

  it("degrades requiredEbitdaAtMedian to null when kE is unverifiable, without throwing", () => {
    const noBasisExtract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: extract.financials,
      multiples: extract.multiples.map((m) => ({ ...m, enterpriseValue: null })), // strip the direct EV column
      estimates: extract.estimates,
    });
    const noBasis = computeBasisReconciliation(noBasisExtract); // no evSales either ⇒ kE null
    const result = computeImpliedExpectations(2.95, "EUR", noBasisExtract, noBasis);
    expect(result).not.toBeNull();
    expect(result!.requiredEbitdaAtMedian).toBeNull();
    expect(result!.vsLatestFyPct).toBeNull();
  });

  it("returns null on a currency mismatch", () => {
    expect(computeImpliedExpectations(2.95, "USD", extract, basis)).toBeNull();
  });

  it("returns null when there's no EV/EBITDA history to solve against", () => {
    const noHistory = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }), financials: extract.financials });
    expect(computeImpliedExpectations(2.95, "EUR", noHistory, computeBasisReconciliation(noHistory))).toBeNull();
  });
});
