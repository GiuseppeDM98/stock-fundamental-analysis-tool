import { describe, it, expect } from "vitest";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { makeFinancialsRow, makeExtract } from "./grounding-test-helpers";

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
    expect(checkReconciliation(extract)).toEqual([]);
  });

  describe("eps_mismatch", () => {
    it("fires when stated eps diverges >10% from netIncome/sharesDiluted", () => {
      // implied = 1000/500 = 2.0; stated 2.6 → |2.6-2.0|/2.6 ≈ 23.1% > 10%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 2.6, netIncome: 1000, sharesDiluted: 500 })],
      });
      const warnings = checkReconciliation(extract);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "eps_mismatch", fiscalYear: 2025 });
    });

    it("does not fire within the 10% tolerance", () => {
      // implied = 1000/500 = 2.0; stated 2.05 → diff ≈ 2.4% < 10%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 2.05, netIncome: 1000, sharesDiluted: 500 })],
      });
      expect(checkReconciliation(extract)).toEqual([]);
    });

    it("is the canary for a unit-scale mistake (shares in units instead of millions)", () => {
      // true: netIncome 3780 (€m), sharesDiluted 3150 (millions) → eps 1.2. A scale slip
      // that records sharesDiluted in raw units (3.15bn) blows up the implied eps by ~3
      // orders of magnitude: 3780/3150000000 ≈ 0.0000012, vs stated 1.2 → certain to exceed
      // the 10% tolerance.
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, eps: 1.2, netIncome: 3780, sharesDiluted: 3_150_000_000 })],
      });
      const warnings = checkReconciliation(extract);
      expect(warnings.some((w) => w.code === "eps_mismatch" && w.fiscalYear === 2025)).toBe(true);
    });
  });

  describe("netdebt_mismatch", () => {
    it("fires when stated netDebt diverges >2% from totalDebt - cash", () => {
      // implied = 15000-3500=11500; stated 12000 → |12000-11500|/12000 ≈ 4.17% > 2%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, netDebt: 12000, totalDebt: 15000, cashAndEquivalents: 3500 })],
      });
      const warnings = checkReconciliation(extract);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "netdebt_mismatch", fiscalYear: 2025 });
    });

    it("does not fire within the 2% tolerance", () => {
      // implied = 15000-3600=11400; stated 11500 → diff ≈ 0.87% < 2%
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, netDebt: 11500, totalDebt: 15000, cashAndEquivalents: 3600 })],
      });
      expect(checkReconciliation(extract)).toEqual([]);
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
      const warnings = checkReconciliation(extract);
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
      expect(checkReconciliation(extract)).toEqual([]);
    });
  });

  describe("ebit_gt_ebitda", () => {
    it("fires when EBIT exceeds EBITDA beyond the rounding buffer", () => {
      // 6035 > 6000*1.005=6030
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, ebit: 6035, ebitda: 6000 })],
      });
      const warnings = checkReconciliation(extract);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ code: "ebit_gt_ebitda", fiscalYear: 2025 });
    });

    it("tolerates a small rounding excess (within the 0.5% buffer)", () => {
      // 6025 < 6000*1.005=6030
      const extract = makeExtract({
        financials: [makeFinancialsRow({ fiscalYear: 2025, ebit: 6025, ebitda: 6000 })],
      });
      expect(checkReconciliation(extract)).toEqual([]);
    });
  });

  it("roe_mismatch is never emitted — no stated ROE field exists to check against (see module doc comment)", () => {
    const extract = makeExtract({
      financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 3780, totalEquity: 45000 })],
    });
    const warnings = checkReconciliation(extract);
    expect(warnings.some((w) => w.code === "roe_mismatch")).toBe(false);
  });

  it("returns an empty array on garbage/empty input", () => {
    expect(checkReconciliation(makeExtract())).toEqual([]);
  });
});
