import { describe, it, expect } from "vitest";
import { computeBasisReconciliation, effectiveKb, toProviderBasis } from "@/lib/grounding/basis";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";

// THE IREN CASE — the fixture the spec's §9 commit 3 gate hinges on: kE ≈ 0.83, sameBasis
// false, adjustedEvEbitda.median ≈ 5.9 (docs/deep-value-rigor-v2-spec.md §8). Six fiscal
// years, EV_P reported directly (enterpriseValue column), a constant statement EBITDA of
// 1353 (isolates the kE arithmetic from noise in the statement series itself) and a
// per-year kE walking 0.81→0.85 (median 0.83, spread 0.04 — matches the spec's own
// numbers verbatim).
const STATEMENT_EBITDA = 1353;
const IREN_YEARS = [
  { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
  { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
  { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
  { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
  { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
  { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
];

const IREN_EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: IREN_YEARS.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: STATEMENT_EBITDA })),
  multiples: IREN_YEARS.map((y) => {
    const ebitdaProvider = y.kE * STATEMENT_EBITDA;
    return makeMultiplesRow({
      fiscalYear: y.fiscalYear,
      evEbitda: y.evEbitda,
      enterpriseValue: y.evEbitda * ebitdaProvider, // reported EV — recovers ebitdaProvider = kE × 1353 exactly
    });
  }),
});

describe("computeBasisReconciliation — THE IREN CASE", () => {
  it("kE ≈ 0.83 (median, n=6, spread 0.04), sameBasis false, high confidence", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT);
    expect(basis.kEn).toBe(6);
    expect(basis.kE).toBeCloseTo(0.83, 6);
    expect(basis.kESpread).toBeCloseTo(0.04, 6);
    expect(basis.confidence).toBe("high");
    expect(basis.sameBasis).toBe(false);
  });

  it("adjustedEvEbitda.median ≈ 5.9 — the haircut that cures the Iren error", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT);
    expect(basis.adjustedEvEbitda).not.toBeNull();
    expect(basis.adjustedEvEbitda!.median).toBeCloseTo(5.893, 2);
    expect(basis.adjustedEvEbitda!.n).toBe(6);
  });

  it("every year resolves EV_P via the reported column, not the evSales fallback", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT);
    expect(basis.years).toHaveLength(6);
    expect(basis.years.every((y) => y.evProviderSource === "reported")).toBe(true);
  });

  it("kB defaults to assumed (1) when neither marketCap nor pe/pb/netDebt data is pasted", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT);
    expect(basis.kB).toBeNull();
    expect(basis.evBridgeConfidence).toBe("assumed");
    expect(basis.evBridgeSameBasis).toBeNull();
    expect(effectiveKb(basis)).toBe(1);
  });
});

describe("computeBasisReconciliation — EV_P resolution paths", () => {
  it("direct path: enterpriseValue reported wins even when evSales is also present", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, revenue: 5000 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 0.9, enterpriseValue: 4500 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.years[0].evProviderSource).toBe("reported");
    expect(basis.years[0].evProvider).toBe(4500);
    // ebitdaProvider = 4500/5 = 900; kE = 900/1000 = 0.9
    expect(basis.kE).toBeCloseTo(0.9, 6);
  });

  it("inferred path: falls back to evSales × revenue when enterpriseValue is absent", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, revenue: 2000 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 2.0 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.years[0].evProviderSource).toBe("ev_sales");
    // EV_P = evSales × revenue = 2.0 × 2000 = 4000; ebitdaProvider = 4000/5 = 800; kE = 0.8
    expect(basis.years[0].evProvider).toBe(4000);
    expect(basis.kE).toBeCloseTo(0.8, 6);
  });

  it("evSales AND enterpriseValue both absent ⇒ kE unavailable, NEVER silently 1", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.years[0].evProvider).toBeNull();
    expect(basis.kE).toBeNull();
    expect(basis.confidence).toBe("unavailable");
    expect(basis.sameBasis).toBeNull();
    expect(basis.adjustedEvEbitda).toBeNull();
  });
});

describe("computeBasisReconciliation — kB / EV-bridge resolution paths", () => {
  it("observed: enterpriseValue AND marketCap both reported directly", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, minorityInterest: 200 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 4500, marketCap: 3800 })],
    });
    const basis = computeBasisReconciliation(extract);
    // evBridgeProvider = 4500-3800=700; evBridgeStatement = 500+200=700 ⇒ kB=1
    expect(basis.kB).toBeCloseTo(1, 6);
    expect(basis.evBridgeConfidence).toBe("observed");
    expect(basis.evBridgeSameBasis).toBe(true);
  });

  it("inferred: EV_P reported, MarketCap_P backed out from P/E alone (no reported column)", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netIncome: 380, netDebt: 500, minorityInterest: 200 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 4500, pe: 10 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.years[0].marketCapSource).toBe("pe");
    // peEstimate = 10×380=3800; evBridgeProvider=4500-3800=700; evBridgeStatement=700 ⇒ kB=1
    expect(basis.kB).toBeCloseTo(1, 6);
    expect(basis.evBridgeConfidence).toBe("inferred");
  });

  it("P/E- and P/B-implied MarketCap diverge >10% ⇒ kB null + assumed, kE stays valid", () => {
    const extract = makeExtract({
      financials: [
        makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netIncome: 300, totalEquity: 2000, netDebt: 500, minorityInterest: 100 }),
      ],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 4500, pe: 10, pb: 2.0 })],
    });
    const basis = computeBasisReconciliation(extract);
    // peEstimate=10×300=3000; pbEstimate=2.0×2000=4000; diff=|3000-4000|/3000≈33.3%>10%
    expect(basis.years[0].marketCapProvider).toBeNull();
    expect(basis.kB).toBeNull();
    expect(basis.evBridgeConfidence).toBe("assumed");
    // kE is independent of pe/pb — ebitdaProvider=4500/5=900, kE=900/1000=0.9
    expect(basis.kE).toBeCloseTo(0.9, 6);
  });

  it("pe/pb/marketCap all absent ⇒ kB null + assumed (the Iren-case default, restated narrowly)", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, minorityInterest: 200 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 4500 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.kB).toBeNull();
    expect(basis.evBridgeConfidence).toBe("assumed");
    expect(effectiveKb(basis)).toBe(1);
  });
});

describe("computeBasisReconciliation — confidence degradation", () => {
  it("n < BASIS_MIN_YEARS (3) ⇒ low confidence even with a tight spread", () => {
    const extract = makeExtract({
      financials: [
        makeFinancialsRow({ fiscalYear: 2024, ebitda: 1000 }),
        makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000 }),
      ],
      multiples: [
        makeMultiplesRow({ fiscalYear: 2024, evEbitda: 5, enterpriseValue: 830 * 5 }),
        makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 840 * 5 }),
      ],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.kEn).toBe(2);
    expect(basis.confidence).toBe("low");
  });

  it("n ≥ 3 but spread > BASIS_LOW_CONFIDENCE_SPREAD (0.10) ⇒ low confidence", () => {
    const kEs = [0.7, 0.83, 0.95];
    const extract = makeExtract({
      financials: kEs.map((_, i) => makeFinancialsRow({ fiscalYear: 2023 + i, ebitda: 1000 })),
      multiples: kEs.map((kE, i) =>
        makeMultiplesRow({ fiscalYear: 2023 + i, evEbitda: 5, enterpriseValue: kE * 1000 * 5 })
      ),
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.kEn).toBe(3);
    expect(basis.kESpread).toBeCloseTo(0.25, 6);
    expect(basis.confidence).toBe("low");
  });

  it("returns unavailable/null/empty on garbage input (no overlapping fiscal years)", () => {
    const basis = computeBasisReconciliation(makeExtract());
    expect(basis.years).toEqual([]);
    expect(basis.kE).toBeNull();
    expect(basis.confidence).toBe("unavailable");
    expect(basis.kB).toBeNull();
    expect(basis.evBridgeConfidence).toBe("assumed");
    expect(basis.adjustedEvEbitda).toBeNull();
  });
});

describe("effectiveKb", () => {
  it("returns 1 when kB is null", () => {
    expect(effectiveKb(computeBasisReconciliation(makeExtract()))).toBe(1);
  });

  it("returns the actual kB when estimable", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT);
    const withKb = { ...basis, kB: 1.18 };
    expect(effectiveKb(withKb)).toBe(1.18);
  });
});

describe("toProviderBasis", () => {
  it("divides by kE — the exact inverse of the same-basis adjustment (m_S = m_P × kE)", () => {
    const basis = computeBasisReconciliation(IREN_EXTRACT); // kE ≈ 0.83
    // A statement-basis multiple of 6.53x (the Iren "like-for-like LTM" figure from the
    // spec's narrative) re-expressed on provider basis: 6.53 / 0.83 ≈ 7.867
    expect(toProviderBasis(6.53, basis)).toBeCloseTo(7.867469879, 6);
  });

  it("returns null when kE is unverifiable — never a guessed conversion", () => {
    const basis = computeBasisReconciliation(makeExtract());
    expect(toProviderBasis(6.53, basis)).toBeNull();
  });
});
