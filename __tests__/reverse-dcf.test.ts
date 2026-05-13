import { describe, expect, it } from "vitest";

import {
  computeImpliedGrowthRate,
  computeFcfCagr,
  runDcf,
  type ReverseDcfInput,
} from "../lib/valuation/dcf";

// Realistic base input: company with ~$100B revenue, 20% margin, 9% WACC
const validInput: ReverseDcfInput = {
  currentPrice: 100,
  sharesOutstanding: 1_000_000_000,
  wacc: 0.09,
  terminalGrowthRate: 0.025,
  operatingMarginTarget: 0.20,
  taxRate: 0.22,
  reinvestmentRate: 0.35,
  baseFcf: 10_000_000_000,   // positive FCF — required for solve
  baseRevenue: 100_000_000_000,
};

describe("computeImpliedGrowthRate", () => {
  it("returns a growth rate that reproduces the input price within $0.05", () => {
    const rate = computeImpliedGrowthRate(validInput);
    expect(rate).not.toBeNull();

    // Feed the solved rate back into runDcf and verify it reproduces the price
    const dcfResult = runDcf({
      currentRevenue: validInput.baseRevenue,
      netDebt: 0,
      sharesOutstanding: validInput.sharesOutstanding,
      currentPrice: validInput.currentPrice,
      mosPercent: 0,
      scenario: {
        revenueGrowthYears1to5: rate!,
        revenueGrowthYears6to10: Math.min(rate!, 0.40),
        operatingMarginTarget: validInput.operatingMarginTarget,
        taxRate: validInput.taxRate,
        reinvestmentRate: validInput.reinvestmentRate,
        wacc: validInput.wacc,
        terminalGrowth: validInput.terminalGrowthRate,
      },
    });

    expect(Math.abs(dcfResult.fairValuePerShare - validInput.currentPrice)).toBeLessThan(0.05);
  });

  it("returns null when baseFcf is negative", () => {
    expect(computeImpliedGrowthRate({ ...validInput, baseFcf: -50_000_000 })).toBeNull();
  });

  it("returns null when baseFcf is zero", () => {
    expect(computeImpliedGrowthRate({ ...validInput, baseFcf: 0 })).toBeNull();
  });

  it("returns null when currentPrice is zero", () => {
    expect(computeImpliedGrowthRate({ ...validInput, currentPrice: 0 })).toBeNull();
  });

  it("returns null when currentPrice is negative", () => {
    expect(computeImpliedGrowthRate({ ...validInput, currentPrice: -10 })).toBeNull();
  });

  it("returns null when price exceeds the solvable ceiling (60% growth)", () => {
    // A price far above the 60%-growth DCF value is unsolvable
    expect(computeImpliedGrowthRate({ ...validInput, currentPrice: 999_999 })).toBeNull();
  });

  it("returns null when price is below the -5% growth value (market more pessimistic)", () => {
    // A price of $0.01 is below anything the model can produce even at -5% growth
    expect(computeImpliedGrowthRate({ ...validInput, currentPrice: 0.01 })).toBeNull();
  });

  it("produces a higher implied growth rate for a higher market price", () => {
    const rateAt100 = computeImpliedGrowthRate({ ...validInput, currentPrice: 100 });
    const rateAt200 = computeImpliedGrowthRate({ ...validInput, currentPrice: 200 });
    if (rateAt100 !== null && rateAt200 !== null) {
      expect(rateAt200).toBeGreaterThan(rateAt100);
    }
  });
});

describe("computeFcfCagr", () => {
  it("computes 4yr CAGR correctly for a known ratio", () => {
    // latest = 200, base (4yr ago) = 100 → 4yr CAGR ≈ 18.92%
    const fcf = [200, 160, 130, 110, 100];
    const cagr = computeFcfCagr(fcf, 4);
    expect(cagr).not.toBeNull();
    expect(Math.abs(cagr! - (Math.pow(200 / 100, 1 / 4) - 1))).toBeLessThan(0.0001);
  });

  it("returns null when there is insufficient data for the lookback period", () => {
    expect(computeFcfCagr([100, 80, 60], 4)).toBeNull();
  });

  it("returns null when the base year FCF is zero", () => {
    expect(computeFcfCagr([100, 80, 60, 40, 20, 0], 5)).toBeNull();
  });

  it("returns null when the base year FCF is negative", () => {
    expect(computeFcfCagr([100, 80, 60, 40, 20, -10], 5)).toBeNull();
  });

  it("returns null when the latest FCF is negative", () => {
    expect(computeFcfCagr([-10, 80, 60, 40, 20, 100], 5)).toBeNull();
  });

  it("uses a 4-year default lookback when years is omitted", () => {
    const fcf = [150, 130, 110, 90, 70];
    const explicit = computeFcfCagr(fcf, 4);
    const defaultResult = computeFcfCagr(fcf);
    expect(defaultResult).toBe(explicit);
  });
});
