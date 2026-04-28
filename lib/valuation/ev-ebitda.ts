import { EvEbitdaScenarioInput, ScenarioResult } from "@/types/valuation";

/**
 * EV/EBITDA Valuation Engine
 *
 * Appropriate for commodity-driven sectors (Energy, Materials) where FCF is
 * distorted by capex cycles and D&A is large relative to net income. The model
 * applies a target EV/EBITDA multiple to TTM EBITDA to estimate enterprise value,
 * then derives equity value per share by subtracting net debt.
 *
 * Formula:
 *   Enterprise Value = EBITDA × targetMultiple
 *   Equity Value     = Enterprise Value − Net Debt
 *   Fair Value/share = Equity Value / Shares Outstanding
 */

export type EvEbitdaInput = {
  ebitda: number;              // TTM EBITDA
  netDebt: number;             // Total debt − total cash
  sharesOutstanding: number;
  currentPrice: number;
  mosPercent: number;
  scenario: EvEbitdaScenarioInput;
};

/**
 * Validate EV/EBITDA scenario constraints before running the model.
 */
export function validateEvEbitdaInput(scenario: EvEbitdaScenarioInput): void {
  if (scenario.targetMultiple < 1 || scenario.targetMultiple > 30) {
    throw new Error("Target EV/EBITDA multiple must be between 1x and 30x.");
  }
}

/**
 * Compute fair value using an EV/EBITDA multiple approach.
 *
 * @param input - EBITDA, capital structure, and scenario multiple
 * @returns Valuation results including fair value and upside percentage
 * @throws Error if inputs are invalid
 */
export function runEvEbitda(input: EvEbitdaInput): ScenarioResult {
  validateEvEbitdaInput(input.scenario);

  const { ebitda, netDebt, sharesOutstanding, currentPrice, mosPercent, scenario } = input;

  if (ebitda <= 0 || sharesOutstanding <= 0 || currentPrice <= 0) {
    throw new Error("EBITDA, shares outstanding, and current price must be positive.");
  }

  const enterpriseValue = ebitda * scenario.targetMultiple;
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = equityValue / sharesOutstanding;

  const fairValueAfterMos = fairValuePerShare * (1 - mosPercent / 100);
  const upsideVsPricePercent = ((fairValueAfterMos - currentPrice) / currentPrice) * 100;

  return {
    enterpriseValue,
    equityValue,
    fairValuePerShare,
    fairValueAfterMos,
    upsideVsPricePercent,
  };
}
