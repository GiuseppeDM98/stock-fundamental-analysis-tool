import { describe, expect, it } from "vitest";

import { runDcf, validateScenarioInput } from "../lib/valuation/dcf";

describe("dcf", () => {
  const scenario = {
    revenueGrowthYears1to5: 0.08,
    revenueGrowthYears6to10: 0.05,
    operatingMarginTarget: 0.2,
    taxRate: 0.22,
    reinvestmentRate: 0.35,
    wacc: 0.1,
    terminalGrowth: 0.025
  };

  it("returns deterministic scenario output", () => {
    const result = runDcf({
      currentRevenue: 100_000_000_000,
      netDebt: 20_000_000_000,
      sharesOutstanding: 15_000_000_000,
      currentPrice: 190,
      mosPercent: 25,
      scenario
    });

    expect(result.fairValuePerShare).toBeGreaterThan(0);
    expect(result.fairValueAfterMos).toBeCloseTo(result.fairValuePerShare * 0.75, 6);
  });

  it("enforces wacc > terminal growth", () => {
    expect(() =>
      validateScenarioInput({
        ...scenario,
        wacc: 0.03,
        terminalGrowth: 0.04
      })
    ).toThrow("WACC must be greater than terminal growth.");
  });

  it("applies margin of safety to all outputs", () => {
    const noMos = runDcf({
      currentRevenue: 50_000_000_000,
      netDebt: 0,
      sharesOutstanding: 5_000_000_000,
      currentPrice: 100,
      mosPercent: 0,
      scenario
    });

    const withMos = runDcf({
      currentRevenue: 50_000_000_000,
      netDebt: 0,
      sharesOutstanding: 5_000_000_000,
      currentPrice: 100,
      mosPercent: 20,
      scenario
    });

    expect(withMos.fairValueAfterMos).toBeCloseTo(noMos.fairValuePerShare * 0.8, 6);
  });
});
