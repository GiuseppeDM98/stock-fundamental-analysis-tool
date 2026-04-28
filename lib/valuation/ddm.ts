import { DdmScenarioInput, ScenarioResult } from "@/types/valuation";

/**
 * DDM Engine (2-stage Dividend Discount Model)
 *
 * Design notes:
 * - Stage 1: 10 years of explicit dividend forecasts growing at dividendGrowthRate
 * - Stage 2: Gordon Growth terminal value at terminalGrowthRate
 * - Mirrors the DCF 2-stage structure for UI consistency
 * - Appropriate for mature dividend-paying companies where FCF-based DCF is distorted
 *   by regulated capital expenditure (utilities, infrastructure REITs)
 */

export type DdmInput = {
  dividendPerShare: number;    // D₀: current trailing annual dividend per share
  currentPrice: number;
  mosPercent: number;
  scenario: DdmScenarioInput;
};

/**
 * Validate DDM scenario constraints before running the model.
 */
export function validateDdmInput(scenario: DdmScenarioInput): void {
  if (scenario.costOfEquity <= scenario.terminalGrowthRate) {
    throw new Error("Cost of equity must be greater than terminal growth rate.");
  }

  const bounded: Array<[number, number, number, string]> = [
    [scenario.dividendGrowthRate, -0.02, 0.15, "Dividend growth rate"],
    [scenario.costOfEquity, 0.03, 0.25, "Cost of equity"],
    [scenario.terminalGrowthRate, -0.01, 0.05, "Terminal growth rate"],
  ];

  for (const [value, min, max, label] of bounded) {
    if (value < min || value > max) {
      throw new Error(`${label} must be between ${min * 100}% and ${max * 100}%.`);
    }
  }
}

/**
 * Compute fair value using a 2-stage Dividend Discount Model.
 *
 * Algorithm:
 * 1. Project 10 years of dividends growing at dividendGrowthRate
 * 2. Discount each dividend to present value at costOfEquity
 * 3. Calculate Gordon Growth terminal value from year 11 dividend
 * 4. Sum PV of dividends + discounted terminal value = intrinsic value per share
 * 5. Apply margin of safety adjustment
 *
 * @param input - Dividend data, scenario assumptions, and margin of safety
 * @returns Valuation results including fair value and upside percentage
 * @throws Error if inputs are invalid or scenario constraints violated
 */
export function runDdm(input: DdmInput): ScenarioResult {
  validateDdmInput(input.scenario);

  const { dividendPerShare, currentPrice, mosPercent, scenario } = input;

  if (dividendPerShare <= 0 || currentPrice <= 0) {
    throw new Error("Dividend per share and current price must be positive.");
  }

  // Stage 1: PV of explicit 10-year dividend forecast
  let dividend = dividendPerShare;
  let pvDividends = 0;

  for (let year = 1; year <= 10; year += 1) {
    dividend *= 1 + scenario.dividendGrowthRate;
    pvDividends += dividend / (1 + scenario.costOfEquity) ** year;
  }

  // Stage 2: Gordon Growth terminal value from year 11
  const terminalDividend = dividend * (1 + scenario.terminalGrowthRate);
  const terminalValue = terminalDividend / (scenario.costOfEquity - scenario.terminalGrowthRate);
  const pvTerminal = terminalValue / (1 + scenario.costOfEquity) ** 10;

  const intrinsicValue = pvDividends + pvTerminal;

  const fairValueAfterMos = intrinsicValue * (1 - mosPercent / 100);
  const upsideVsPricePercent = ((fairValueAfterMos - currentPrice) / currentPrice) * 100;

  return {
    // enterpriseValue and equityValue are DCF concepts; reuse fields to keep
    // ScenarioResult shape consistent across both engines
    enterpriseValue: intrinsicValue,
    equityValue: intrinsicValue,
    fairValuePerShare: intrinsicValue,
    fairValueAfterMos,
    upsideVsPricePercent,
  };
}
