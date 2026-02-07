import { ScenarioInput, ScenarioResult } from "@/types/valuation";

/**
 * DCF Engine (10-year + Gordon Growth terminal value)
 *
 * Design notes:
 * - We use a single-stage yearly projection for 10 years to keep the model
 *   transparent and easy to audit in UI.
 * - Revenue growth is split into years 1-5 and 6-10 to reflect growth decay.
 * - We derive free cash flow from NOPAT and reinvestment assumptions instead
 *   of requiring all accounting line items, because external APIs can have
 *   missing/inconsistent fields across regions.
 */

export type DcfInput = {
  currentRevenue: number;
  netDebt: number;
  sharesOutstanding: number;
  currentPrice: number;
  mosPercent: number;
  scenario: ScenarioInput;
};

/**
 * Validate scenario constraints before running DCF.
 *
 * Throws an Error if constraints are violated.
 */
export function validateScenarioInput(scenario: ScenarioInput): void {
  if (scenario.wacc <= scenario.terminalGrowth) {
    throw new Error("WACC must be greater than terminal growth.");
  }

  const bounded: Array<[number, number, number, string]> = [
    [scenario.revenueGrowthYears1to5, -0.5, 0.6, "Revenue growth years 1-5"],
    [scenario.revenueGrowthYears6to10, -0.5, 0.4, "Revenue growth years 6-10"],
    [scenario.operatingMarginTarget, 0, 0.8, "Operating margin target"],
    [scenario.taxRate, 0, 0.6, "Tax rate"],
    [scenario.reinvestmentRate, 0, 0.9, "Reinvestment rate"],
    [scenario.wacc, 0.03, 0.3, "WACC"],
    [scenario.terminalGrowth, -0.02, 0.06, "Terminal growth"]
  ];

  for (const [value, min, max, label] of bounded) {
    if (value < min || value > max) {
      throw new Error(`${label} must be between ${min} and ${max}.`);
    }
  }
}

/**
 * Compute a scenario fair value using a simplified but explicit DCF model.
 *
 * Side effects: none.
 */
export function runDcf(input: DcfInput): ScenarioResult {
  validateScenarioInput(input.scenario);

  const {
    currentRevenue,
    netDebt,
    sharesOutstanding,
    currentPrice,
    mosPercent,
    scenario
  } = input;

  if (currentRevenue <= 0 || sharesOutstanding <= 0 || currentPrice <= 0) {
    throw new Error("Revenue, shares outstanding, and current price must be positive.");
  }

  let revenue = currentRevenue;
  let discountedFcfSum = 0;

  for (let year = 1; year <= 10; year += 1) {
    const growth = year <= 5 ? scenario.revenueGrowthYears1to5 : scenario.revenueGrowthYears6to10;
    revenue *= 1 + growth;

    const ebit = revenue * scenario.operatingMarginTarget;
    const nopat = ebit * (1 - scenario.taxRate);

    // We subtract reinvestment from NOPAT so growth is not "free" in the model.
    const fcf = nopat * (1 - scenario.reinvestmentRate);

    const discountFactor = (1 + scenario.wacc) ** year;
    discountedFcfSum += fcf / discountFactor;
  }

  const terminalYearEbit = revenue * scenario.operatingMarginTarget;
  const terminalYearNopat = terminalYearEbit * (1 - scenario.taxRate);
  const terminalYearFcf = terminalYearNopat * (1 - scenario.reinvestmentRate);
  const terminalFcf = terminalYearFcf * (1 + scenario.terminalGrowth);

  const terminalValue = terminalFcf / (scenario.wacc - scenario.terminalGrowth);
  const discountedTerminal = terminalValue / (1 + scenario.wacc) ** 10;

  const enterpriseValue = discountedFcfSum + discountedTerminal;
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = equityValue / sharesOutstanding;
  const fairValueAfterMos = fairValuePerShare * (1 - mosPercent / 100);
  const upsideVsPricePercent = ((fairValueAfterMos - currentPrice) / currentPrice) * 100;

  return {
    enterpriseValue,
    equityValue,
    fairValuePerShare,
    fairValueAfterMos,
    upsideVsPricePercent
  };
}
