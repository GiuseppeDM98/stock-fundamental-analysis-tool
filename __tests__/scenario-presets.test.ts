import { describe, expect, it } from "vitest";

import { getCompanyScenarios, getDefaultScenarios } from "../lib/valuation/scenario-presets";
import { FundamentalsResponse } from "../types/fundamentals";
import { AnalystEstimates } from "../types/valuation";

// Apple-like fundamentals: high margins, steady growth
const appleFundamentals: FundamentalsResponse = {
  ticker: "AAPL",
  currency: "USD",
  annual: [
    { year: 2025, revenue: 391035e6, ebit: 123215e6, netIncome: 93736e6, fcf: 108807e6, operatingMargin: 0.315, netMargin: 0.24 },
    { year: 2024, revenue: 383285e6, ebit: 114301e6, netIncome: 96995e6, fcf: 99584e6, operatingMargin: 0.298, netMargin: 0.253 },
    { year: 2023, revenue: 394328e6, ebit: 114301e6, netIncome: 96995e6, fcf: 99584e6, operatingMargin: 0.290, netMargin: 0.246 },
    { year: 2022, revenue: 365817e6, ebit: 119437e6, netIncome: 99803e6, fcf: 111443e6, operatingMargin: 0.327, netMargin: 0.273 },
  ],
  ratios: { pe: 28.5, pb: 45.2, ps: 7.8, evEbitda: 24.1 },
};

const appleAnalystEstimates: AnalystEstimates = {
  revenueGrowthNextYear: 0.08,
  revenueGrowth5Year: 0.10,
  earningsGrowthNextYear: 0.12,
  targetMeanPrice: 250,
  numberOfAnalysts: 35,
  operatingMargins: 0.315,
  revenueGrowthTTM: 0.02,
  freeCashflow: 108807e6,   // Apple's actual FCF
  totalRevenue: 391035e6,   // Apple's actual revenue
};

// No analyst coverage (small cap / non-US)
const noAnalystEstimates: AnalystEstimates = {
  revenueGrowthNextYear: null,
  revenueGrowth5Year: null,
  earningsGrowthNextYear: null,
  targetMeanPrice: null,
  numberOfAnalysts: null,
  operatingMargins: null,
  revenueGrowthTTM: null,
  freeCashflow: null,
  totalRevenue: null,
};

// Minimal fundamentals (only 1 year of data)
const minimalFundamentals: FundamentalsResponse = {
  ticker: "XYZ",
  currency: "USD",
  annual: [
    { year: 2025, revenue: 100e6, ebit: 15e6, netIncome: 10e6, fcf: 8e6, operatingMargin: 0.15, netMargin: 0.10 },
  ],
  ratios: { pe: null, pb: null, ps: null },
};

describe("getCompanyScenarios", () => {
  it("generates Apple-like scenarios with analyst data", () => {
    const scenarios = getCompanyScenarios(appleFundamentals, appleAnalystEstimates);

    // Base scenario should use analyst 5-year growth estimate (10%)
    expect(scenarios.base.revenueGrowthYears1to5).toBeCloseTo(0.10, 2);

    // Operating margin should reflect Apple's actual ~31.5%, not generic 18%
    expect(scenarios.base.operatingMarginTarget).toBeGreaterThan(0.28);

    // Bull should be higher than base
    expect(scenarios.bull.revenueGrowthYears1to5).toBeGreaterThan(scenarios.base.revenueGrowthYears1to5);
    expect(scenarios.bull.operatingMarginTarget).toBeGreaterThan(scenarios.base.operatingMarginTarget);

    // Bear should be lower than base
    expect(scenarios.bear.revenueGrowthYears1to5).toBeLessThan(scenarios.base.revenueGrowthYears1to5);
    expect(scenarios.bear.operatingMarginTarget).toBeLessThan(scenarios.base.operatingMarginTarget);
  });

  it("falls back to historical CAGR when no analyst estimates", () => {
    const scenarios = getCompanyScenarios(appleFundamentals, noAnalystEstimates);

    // Should compute CAGR from historical revenue data
    // 4 data points spanning 3 years: CAGR = (391035/365817)^(1/3) - 1 ≈ 2.3%
    expect(scenarios.base.revenueGrowthYears1to5).toBeGreaterThan(0);

    // Operating margin should still come from latest fundamentals
    expect(scenarios.base.operatingMarginTarget).toBeCloseTo(0.315, 2);
  });

  it("handles minimal data with graceful fallbacks", () => {
    const scenarios = getCompanyScenarios(minimalFundamentals, noAnalystEstimates);

    // With only 1 year of data and no analyst estimates, should fall back to 5% growth
    expect(scenarios.base.revenueGrowthYears1to5).toBeCloseTo(0.05, 2);

    // Operating margin from the single data point
    expect(scenarios.base.operatingMarginTarget).toBeCloseTo(0.15, 2);
  });

  it("derives low reinvestment rate for capital-light companies like Apple", () => {
    const scenarios = getCompanyScenarios(appleFundamentals, appleAnalystEstimates);

    // Apple's FCF (~108B) exceeds NOPAT (~94B), so reinvestment should be near minimum (5%)
    // The old code was falling back to 30% which destroyed the valuation
    expect(scenarios.base.reinvestmentRate).toBeLessThan(0.15);
  });

  it("ensures WACC > terminal growth for all scenarios", () => {
    const scenarios = getCompanyScenarios(appleFundamentals, appleAnalystEstimates);

    expect(scenarios.bull.wacc).toBeGreaterThan(scenarios.bull.terminalGrowth);
    expect(scenarios.base.wacc).toBeGreaterThan(scenarios.base.terminalGrowth);
    expect(scenarios.bear.wacc).toBeGreaterThan(scenarios.bear.terminalGrowth);
  });

  it("clamps all values within DCF validation bounds", () => {
    const scenarios = getCompanyScenarios(appleFundamentals, appleAnalystEstimates);

    for (const name of ["bull", "base", "bear"] as const) {
      const s = scenarios[name];
      expect(s.revenueGrowthYears1to5).toBeGreaterThanOrEqual(-0.5);
      expect(s.revenueGrowthYears1to5).toBeLessThanOrEqual(0.6);
      expect(s.revenueGrowthYears6to10).toBeGreaterThanOrEqual(-0.5);
      expect(s.revenueGrowthYears6to10).toBeLessThanOrEqual(0.4);
      expect(s.operatingMarginTarget).toBeGreaterThanOrEqual(0);
      expect(s.operatingMarginTarget).toBeLessThanOrEqual(0.8);
      expect(s.taxRate).toBeGreaterThanOrEqual(0);
      expect(s.taxRate).toBeLessThanOrEqual(0.6);
      expect(s.reinvestmentRate).toBeGreaterThanOrEqual(0);
      expect(s.reinvestmentRate).toBeLessThanOrEqual(0.9);
      expect(s.wacc).toBeGreaterThanOrEqual(0.03);
      expect(s.wacc).toBeLessThanOrEqual(0.3);
      expect(s.terminalGrowth).toBeGreaterThanOrEqual(-0.02);
      expect(s.terminalGrowth).toBeLessThanOrEqual(0.06);
    }
  });
});

describe("getDefaultScenarios", () => {
  it("returns generic conservative presets", () => {
    const scenarios = getDefaultScenarios();

    expect(scenarios.base.revenueGrowthYears1to5).toBe(0.08);
    expect(scenarios.base.operatingMarginTarget).toBe(0.18);
    expect(scenarios.bull.wacc).toBeLessThan(scenarios.base.wacc);
    expect(scenarios.bear.wacc).toBeGreaterThan(scenarios.base.wacc);
  });
});
