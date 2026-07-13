import { describe, it, expect } from "vitest";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeBasis } from "./grounding-test-helpers";

describe("checkReconciliation", () => {
  it("does not fire when every figure ties out", () => {
    const extract = makeExtract({
      financials: [
        makeFinancialsRow({
          fiscalYear: 2025,
          eps: 1.2,
          netIncome: 3780,
          sharesDiluted: 3150, // 3780/3150 = 1.2 exact
          netDebt: 11500,
          totalDebt: 15000,
          cashAndEquivalents: 3500, // 15000-3500=11500 exact
          ebit: 9800,
          ebitda: 14200, // ebit < ebitda, fine
        }),
      ],
    });
    expect(checkReconciliation(extract, makeBasis())).toEqual([]);
  });

  describe("eps_mismatch", () => {
    it("fires when stated eps diverges >10% from netIncome/sharesDiluted", () => {
      // implied = 1000/500 = 2.0; stated 2.6 → |2.6-2.0|/2.6 ≈ 23.1% > 10%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 2.6, netIncome: 1000, sharesDiluted: 500 })],
      });
      const warnings = checkReconciliation(extract, makeBasis());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "eps_mismatch", fiscalYear: 2025 });
    });

    it("does not fire within the 10% tolerance", () => {
      // implied = 1000/500 = 2.0; stated 2.05 → diff ≈ 2.4% < 10%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 2.05, netIncome: 1000, sharesDiluted: 500 })],
      });
      expect(checkReconciliation(extract, makeBasis())).toEqual([]);
    });

    it("is the canary for a unit-scale mistake (shares in units instead of millions)", () => {
      // true: netIncome 3780 (€m), sharesDiluted 3150 (millions) → eps 1.2. A scale slip
      // that records sharesDiluted in raw units (3.15bn) blows up the implied eps by ~3
      // orders of magnitude: 3780/3150000000 ≈ 0.0000012, vs stated 1.2 → certain to exceed
      // the 10% tolerance.
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 1.2, netIncome: 3780, sharesDiluted: 3_150_000_000 })],
      });
      const warnings = checkReconciliation(extract, makeBasis());
      expect(warnings.some((w) => w.code === "eps_mismatch" && w.fiscalYear === 2025)).toBe(true);
    });
  });

  describe("netdebt_mismatch", () => {
    it("fires when stated netDebt diverges >2% from totalDebt - cash", () => {
      // implied = 15000-3500=11500; stated 12000 → |12000-11500|/12000 ≈ 4.17% > 2%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, netDebt: 12000, totalDebt: 15000, cashAndEquivalents: 3500 })],
      });
      const warnings = checkReconciliation(extract, makeBasis());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "netdebt_mismatch", fiscalYear: 2025 });
    });

    it("does not fire within the 2% tolerance", () => {
      // implied = 15000-3600=11400; stated 11500 → diff ≈ 0.87% < 2%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, netDebt: 11500, totalDebt: 15000, cashAndEquivalents: 3600 })],
      });
      expect(checkReconciliation(extract, makeBasis())).toEqual([]);
    });
  });

  describe("share_count_jump", () => {
    it("fires on a >10% YoY jump in sharesDiluted", () => {
      // |2900-3300|/3300 ≈ 12.1% > 10%
      const extract = makeExtract({
        financials: [
          makeFinancialsRow({ fiscalYear: 2024, sharesDiluted: 3300 }),
          makeFinancialsRow({ fiscalYear: 2025, sharesDiluted: 2900 }),
        ],
      });
      const warnings = checkReconciliation(extract, makeBasis());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "share_count_jump", fiscalYear: 2025 });
    });

    it("does not fire within the 10% tolerance", () => {
      // |3200-3300|/3300 ≈ 3.0% < 10%
      const extract = makeExtract({
        financials: [
          makeFinancialsRow({ fiscalYear: 2024, sharesDiluted: 3300 }),
          makeFinancialsRow({ fiscalYear: 2025, sharesDiluted: 3200 }),
        ],
      });
      expect(checkReconciliation(extract, makeBasis())).toEqual([]);
    });
  });

  describe("ebit_gt_ebitda", () => {
    it("fires when EBIT exceeds EBITDA beyond the rounding buffer", () => {
      // 6035 > 6000*1.005=6030
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, ebit: 6035, ebitda: 6000 })],
      });
      const warnings = checkReconciliation(extract, makeBasis());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "ebit_gt_ebitda", fiscalYear: 2025 });
    });

    it("tolerates a small rounding excess (within the 0.5% buffer)", () => {
      // 6025 < 6000*1.005=6030
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, ebit: 6025, ebitda: 6000 })],
      });
      expect(checkReconciliation(extract, makeBasis())).toEqual([]);
    });
  });

  it("roe_mismatch is never emitted — no stated ROE field exists to check against (see module doc comment)", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 3780, totalEquity: 45000 })],
    });
    const warnings = checkReconciliation(extract, makeBasis());
    expect(warnings.some((w) => w.code === "roe_mismatch")).toBe(false);
  });

  it("returns an empty array on garbage/empty input", () => {
    expect(checkReconciliation(makeExtract(), makeBasis())).toEqual([]);
  });
});

describe("basis_unverifiable / basis_mismatch", () => {
  it("fires basis_unverifiable when kE is null (never silently treated as verified)", () => {
    const extract = makeExtract({ financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1353 })] });
    const basis = computeBasisReconciliation(extract); // no multiples at all ⇒ kE null
    const warnings = checkReconciliation(extract, basis);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "basis_unverifiable", fiscalYear: null });
  });

  it("fires basis_mismatch (THE IREN CASE) when kE is verifiable but outside tolerance", () => {
    // Same fixture as grounding-basis.test.ts's Iren case: kE ≈ 0.83.
    const statementEbitda = 1353;
    const years = [
      { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
      { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
      { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
      { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
    ];
    const extract = makeExtract({
      financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda })),
      multiples: years.map((y) => {
        const ebitdaProvider = y.kE * statementEbitda;
        return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
      }),
    });
    const basis = computeBasisReconciliation(extract);
    const warnings = checkReconciliation(extract, basis);
    const basisWarning = warnings.find((w) => w.code === "basis_mismatch");
    expect(basisWarning).toBeDefined();
    expect(basisWarning!.detail).toBe("0.83 (n=6, spread 0.04)");
    expect(warnings.some((w) => w.code === "basis_unverifiable")).toBe(false);
  });

  it("fires neither when kE is within SAME_BASIS_TOLERANCE of 1", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 5000 })], // kE=1 exactly
    });
    const basis = computeBasisReconciliation(extract);
    const warnings = checkReconciliation(extract, basis);
    expect(warnings.some((w) => w.code === "basis_mismatch" || w.code === "basis_unverifiable")).toBe(false);
  });
});

describe("ev_bridge_mismatch", () => {
  it("fires when kB is verifiable but outside EV_BRIDGE_TOLERANCE", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, minorityInterest: 200 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 5000, marketCap: 4200 })],
    });
    const basis = computeBasisReconciliation(extract);
    // evBridgeProvider = 5000-4200=800; evBridgeStatement=700; kB=800/700≈1.143 > 1.05
    const warnings = checkReconciliation(extract, basis);
    const bridgeWarning = warnings.find((w) => w.code === "ev_bridge_mismatch");
    expect(bridgeWarning).toBeDefined();
    expect(bridgeWarning!.detail).toBe("1.14 (n=1)");
  });

  it("does not fire when kB is null (assumed) — silence, not a false positive", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 5000 })],
    });
    const basis = computeBasisReconciliation(extract);
    expect(basis.kB).toBeNull();
    expect(checkReconciliation(extract, basis).some((w) => w.code === "ev_bridge_mismatch")).toBe(false);
  });
});

describe("dividend_not_covered", () => {
  it("fires on the Iren numbers: dividend 178.0 vs 3y-mean FCF 152.5", () => {
    const extract = makeExtract({
      financials: [
        makeFinancialsRow({ fiscalYear: 2023, freeCashFlow: 140 }),
        makeFinancialsRow({ fiscalYear: 2024, freeCashFlow: 165 }),
        makeFinancialsRow({ fiscalYear: 2025, freeCashFlow: 152.5, dividendsPerShare: 0.196, sharesDiluted: 908.16 }),
      ],
    });
    // fcfMean = (140+165+152.5)/3 = 152.5; dividendTotal = 0.196×908.16 ≈ 178.0 > 152.5
    const warnings = checkReconciliation(extract, makeBasis());
    const warning = warnings.find((w) => w.code === "dividend_not_covered");
    expect(warning).toBeDefined();
    expect(warning!.fiscalYear).toBe(2025);
    expect(warning!.detail).toBe("178.0 vs 152.5 (3y mean)");
  });

  it("does not fire when the dividend is covered by average FCF", () => {
    const extract = makeExtract({
      financials: [
        makeFinancialsRow({ fiscalYear: 2024, freeCashFlow: 200 }),
        makeFinancialsRow({ fiscalYear: 2025, freeCashFlow: 200, dividendsPerShare: 0.1, sharesDiluted: 900 }), // dividendTotal=90 < 200
      ],
    });
    expect(checkReconciliation(extract, makeBasis()).some((w) => w.code === "dividend_not_covered")).toBe(false);
  });

  it("does not fire when either input is unavailable (degrades silently, never guesses)", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, dividendsPerShare: 0.5, sharesDiluted: 900 })], // no freeCashFlow anywhere
    });
    expect(checkReconciliation(extract, makeBasis()).some((w) => w.code === "dividend_not_covered")).toBe(false);
  });
});
