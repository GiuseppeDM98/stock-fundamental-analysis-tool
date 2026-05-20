import { describe, expect, test } from "vitest";

import { computeQualityScorecard } from "../lib/valuation/quality-metrics";
import type { FundamentalsResponse } from "../types/fundamentals";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const balanceSheet = {
  year: 2024,
  totalAssets: 300e9,
  totalCurrentAssets: 135e9,
  totalCurrentLiabilities: 125e9,
  longTermDebt: 90e9,
  totalEquity: 50e9,
  retainedEarnings: 30e9,
  cash: 20e9,
};

const balanceSheetPrior = {
  year: 2023,
  totalAssets: 280e9,
  totalCurrentAssets: 120e9,
  totalCurrentLiabilities: 118e9,
  longTermDebt: 100e9,   // higher debt ratio than current year → F5 passes
  totalEquity: 45e9,
  retainedEarnings: 25e9,
  cash: 18e9,
};

// Excellent company: positive earnings, strong FCF, improving fundamentals
const excellentFundamentals: FundamentalsResponse = {
  ticker: "EXCEL",
  currency: "USD",
  annual: [
    // Most recent year first; shares decreased (no dilution → F7 passes), gross margin improved → F8 passes
    { year: 2024, revenue: 400e9, ebit: 80e9, netIncome: 60e9, fcf: 70e9, operatingMargin: 0.20, netMargin: 0.15, grossProfit: 160e9, sharesOutstanding: 1_000e6 },
    { year: 2023, revenue: 370e9, ebit: 72e9, netIncome: 52e9, fcf: 60e9, operatingMargin: 0.195, netMargin: 0.14, grossProfit: 140e9, sharesOutstanding: 1_050e6 },
  ],
  annualBalanceSheet: [balanceSheet, balanceSheetPrior],
  ratios: { pe: 20, pb: 5, ps: 3, evEbitda: 12 },
  sector: "Technology",
  industry: "Software",
  dividendRate: null,
  ebitda: null,
};

// Minimal fundamentals: no balance sheet data, no gross profit, no shares
const minimalFundamentals: FundamentalsResponse = {
  ticker: "MIN",
  currency: "USD",
  annual: [
    { year: 2024, revenue: 100e6, ebit: 15e6, netIncome: 10e6, fcf: 8e6, operatingMargin: 0.15, netMargin: 0.10, grossProfit: null, sharesOutstanding: null },
  ],
  annualBalanceSheet: [],
  ratios: { pe: null, pb: null, ps: null },
  sector: null,
  industry: null,
  dividendRate: null,
  ebitda: null,
};

// Financial-sector company (Altman Z must be skipped)
const bankFundamentals: FundamentalsResponse = {
  ticker: "BANK",
  currency: "USD",
  annual: [
    { year: 2024, revenue: 50e9, ebit: 10e9, netIncome: 7e9, fcf: 5e9, operatingMargin: 0.20, netMargin: 0.14, grossProfit: null, sharesOutstanding: null },
  ],
  annualBalanceSheet: [balanceSheet],
  ratios: { pe: 12, pb: 1.2, ps: 1, evEbitda: null },
  sector: "Financial Services",
  industry: "Banks",
  dividendRate: 2.5,
  ebitda: null,
};

// Loss-making company
const lossFundamentals: FundamentalsResponse = {
  ticker: "LOSS",
  currency: "USD",
  annual: [
    { year: 2024, revenue: 200e9, ebit: -5e9, netIncome: -8e9, fcf: 2e9, operatingMargin: -0.025, netMargin: -0.04, grossProfit: null, sharesOutstanding: null },
  ],
  annualBalanceSheet: [balanceSheet],
  ratios: { pe: null, pb: 2, ps: 1, evEbitda: null },
  sector: "Technology",
  industry: "Semiconductors",
  dividendRate: null,
  ebitda: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeQualityScorecard", () => {
  test("returns Strong interpretation for an excellent company", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    expect(result.piotroski.interpretation).toBe("Strong");
    expect(result.piotroski.score).toBeGreaterThanOrEqual(5);
  });

  test("all nine signal keys are present in the result", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    const keys = result.piotroski.signals.map((s) => s.key);
    expect(keys).toContain("piotroskiRoa");
    expect(keys).toContain("piotroskiCfo");
    expect(keys).toContain("piotroskiRoaTrend");
    expect(keys).toContain("piotroskiAccrual");
    expect(keys).toContain("piotroskiLeverage");
    expect(keys).toContain("piotroskiCurrentRatio");
    expect(keys).toContain("piotroskiDilution");
    expect(keys).toContain("piotroskiGrossMargin");
    expect(keys).toContain("piotroskiAssetTurnover");
    expect(keys).toHaveLength(9);
  });

  test("F7 (dilution) passes when shares decreased year-over-year", () => {
    // excellentFundamentals: shares went from 1050M to 1000M → no dilution → pass
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    const dilution = result.piotroski.signals.find((s) => s.key === "piotroskiDilution");
    expect(dilution?.pass).toBe(true);
  });

  test("F8 (gross margin) passes when gross margin improved year-over-year", () => {
    // 2024: 160/400 = 40%; 2023: 140/370 ≈ 37.8% → margin improved → pass
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    const gm = result.piotroski.signals.find((s) => s.key === "piotroskiGrossMargin");
    expect(gm?.pass).toBe(true);
  });

  test("F7 and F8 are null when gross profit / shares data is unavailable", () => {
    const result = computeQualityScorecard(minimalFundamentals, 0.09, 100, 1e9);
    const dilution = result.piotroski.signals.find((s) => s.key === "piotroskiDilution");
    const grossMargin = result.piotroski.signals.find((s) => s.key === "piotroskiGrossMargin");
    expect(dilution?.pass).toBeNull();
    expect(grossMargin?.pass).toBeNull();
  });

  test("maxScore counts all available signals and score is within bounds", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    // All 9 signals are computable (2 years of data with grossProfit and sharesOutstanding)
    expect(result.piotroski.maxScore).toBe(9);
    expect(result.piotroski.score).toBeLessThanOrEqual(result.piotroski.maxScore);
    expect(result.piotroski.score).toBeGreaterThanOrEqual(0);
  });

  test("returns null roicSpread when balance sheet data is unavailable", () => {
    const result = computeQualityScorecard(minimalFundamentals, 0.09, 100, 1e9);
    expect(result.roicWacc.spread).toBeNull();
    expect(result.roicWacc.roic).toBeNull();
    expect(result.roicWacc.wacc).toBe(0.09);
  });

  test("returns null altmanZ and altmanZSkipped=true for Financial Services sector", () => {
    const result = computeQualityScorecard(bankFundamentals, 0.07, 50, 1e9);
    expect(result.altmanZ).toBeNull();
    expect(result.altmanZSkipped).toBe(true);
  });

  test("returns null altmanZ and altmanZSkipped=true for Real Estate sector", () => {
    const reFundamentals: FundamentalsResponse = {
      ...minimalFundamentals,
      sector: "Real Estate",
      annualBalanceSheet: [balanceSheet],
    };
    const result = computeQualityScorecard(reFundamentals, 0.07, 50, 1e9);
    expect(result.altmanZ).toBeNull();
    expect(result.altmanZSkipped).toBe(true);
  });

  test("altmanZSkipped=false when null due to missing data (not sector exclusion)", () => {
    const result = computeQualityScorecard(minimalFundamentals, 0.09, 100, null);
    expect(result.altmanZ).toBeNull();
    expect(result.altmanZSkipped).toBe(false);
  });

  test("returns null altmanZ when sharesOutstanding is null", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, null);
    expect(result.altmanZ).toBeNull();
  });

  test("computes a positive altmanZ for a financially healthy company", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    expect(result.altmanZ).not.toBeNull();
    expect(result.altmanZ!).toBeGreaterThan(0);
  });

  test("FCF conversion is null when netIncome is negative (loss company)", () => {
    const result = computeQualityScorecard(lossFundamentals, 0.10, 30, 5e9);
    expect(result.fcfConversion).toBeNull();
  });

  test("FCF conversion is null when netIncome is zero", () => {
    const zeroNiFundamentals: FundamentalsResponse = {
      ...minimalFundamentals,
      annual: [
        { year: 2024, revenue: 100e6, ebit: 5e6, netIncome: 0, fcf: 8e6, operatingMargin: 0.05, netMargin: 0, grossProfit: null, sharesOutstanding: null },
      ],
    };
    const result = computeQualityScorecard(zeroNiFundamentals, 0.09, 50, 1e9);
    expect(result.fcfConversion).toBeNull();
  });

  test("FCF conversion correctly computes ratio for positive earnings", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    // FCF = 70B, netIncome = 60B → conversion = 70/60 ≈ 1.167
    expect(result.fcfConversion).toBeCloseTo(70e9 / 60e9, 4);
  });

  test("ROIC vs WACC spread is positive for a value-creating company", () => {
    // EBIT = 80B, netIncome = 60B, tax rate ≈ 1 - 60/80 = 0.25
    // NOPAT = 80B × 0.75 = 60B
    // Invested Capital = totalEquity(50B) + longTermDebt(90B) = 140B
    // ROIC = 60B / 140B ≈ 42.9%
    // WACC = 9% → spread ≈ 33.9% > 0
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    expect(result.roicWacc.spread).not.toBeNull();
    expect(result.roicWacc.spread!).toBeGreaterThan(0);
  });

  test("Piotroski ROA signal passes for profitable company", () => {
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    const roa = result.piotroski.signals.find((s) => s.key === "piotroskiRoa");
    // netIncome(60B) / totalAssets(300B) = 0.2 > 0
    expect(roa?.pass).toBe(true);
  });

  test("Piotroski leverage signal passes when debt-to-assets ratio improved", () => {
    // Prior: 100/280 ≈ 0.357; Current: 90/300 = 0.3 → leverage decreased → F5 passes
    const result = computeQualityScorecard(excellentFundamentals, 0.09, 150, 15e9);
    const leverage = result.piotroski.signals.find((s) => s.key === "piotroskiLeverage");
    expect(leverage?.pass).toBe(true);
  });

  test("Piotroski signals are all null when balance sheet is empty", () => {
    const result = computeQualityScorecard(minimalFundamentals, 0.09, 100, 1e9);
    // Signals that require balance sheet (F1, F3, F4, F5, F6, F9) must be null
    const bsSignals = ["piotroskiRoa", "piotroskiRoaTrend", "piotroskiAccrual",
      "piotroskiLeverage", "piotroskiCurrentRatio", "piotroskiAssetTurnover"];
    for (const key of bsSignals) {
      const sig = result.piotroski.signals.find((s) => s.key === key);
      expect(sig?.pass).toBeNull();
    }
  });
});
