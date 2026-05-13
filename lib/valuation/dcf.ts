import { ScenarioInput, ScenarioResult } from "@/types/valuation";

/**
 * Input for the reverse DCF solver.
 *
 * Given the current market price, computeImpliedGrowthRate finds the annual
 * FCF growth rate the market is implicitly pricing over 10 years.
 * baseFcf is used only as a feasibility guard (must be positive); the DCF
 * projection itself starts from baseRevenue, consistent with how the forward
 * DCF engine works (revenue → margin → NOPAT → FCF).
 */
export interface ReverseDcfInput {
  currentPrice: number;
  sharesOutstanding: number;
  wacc: number;
  terminalGrowthRate: number;
  operatingMarginTarget: number;
  taxRate: number;
  reinvestmentRate: number;
  baseFcf: number;       // most recent annual FCF — must be > 0
  baseRevenue: number;   // most recent annual revenue — starting point for projection
}

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

// DcfInput stays unchanged below — ReverseDcfInput is the new public interface above.
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
 * Algorithm:
 * 1. Project 10 years of free cash flows with two-phase revenue growth
 * 2. Calculate terminal value using Gordon Growth model
 * 3. Discount all cash flows to present value at WACC
 * 4. Convert enterprise value to equity value by subtracting net debt
 * 5. Divide by shares outstanding for per-share fair value
 * 6. Apply margin of safety adjustment
 *
 * @param input - Current financials, scenario assumptions, and margin of safety
 * @returns Valuation results including fair value and upside percentage
 * @throws Error if inputs are invalid or scenario constraints violated
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

  // Step 1: Project 10 years of explicit free cash flows
  let revenue = currentRevenue;
  let discountedFcfSum = 0;

  for (let year = 1; year <= 10; year += 1) {
    const growth = year <= 5 ? scenario.revenueGrowthYears1to5 : scenario.revenueGrowthYears6to10;
    revenue *= 1 + growth;

    const ebit = revenue * scenario.operatingMarginTarget;
    const nopat = ebit * (1 - scenario.taxRate);

    // Subtract reinvestment from NOPAT so growth is not "free" in the model
    const fcf = nopat * (1 - scenario.reinvestmentRate);

    const discountFactor = (1 + scenario.wacc) ** year;
    discountedFcfSum += fcf / discountFactor;
  }

  // Step 2: Calculate terminal value using Gordon Growth formula
  // Terminal value = FCF(year 11) / (WACC - g)
  const terminalYearEbit = revenue * scenario.operatingMarginTarget;
  const terminalYearNopat = terminalYearEbit * (1 - scenario.taxRate);
  const terminalYearFcf = terminalYearNopat * (1 - scenario.reinvestmentRate);
  const terminalFcf = terminalYearFcf * (1 + scenario.terminalGrowth);

  const terminalValue = terminalFcf / (scenario.wacc - scenario.terminalGrowth);
  const discountedTerminal = terminalValue / (1 + scenario.wacc) ** 10;

  // Step 3: Sum present values to get enterprise value
  const enterpriseValue = discountedFcfSum + discountedTerminal;

  // Step 4: Convert to equity value and per-share fair value
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = equityValue / sharesOutstanding;

  // Step 5: Apply margin of safety adjustment
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

/**
 * Build a DcfInput from ReverseDcfInput with a given trial growth rate.
 *
 * Both Y1-5 and Y6-10 receive the same rate, capped at 0.40 for Y6-10 to
 * respect the DCF validation bound. The binary search remains monotonic
 * because Y1-5 growth still increases with each iteration.
 * netDebt is omitted from ReverseDcfInput (solving for equity value directly);
 * mosPercent is 0 so we compare raw fairValuePerShare to the market price.
 */
function buildDcfInputForRate(input: ReverseDcfInput, growthRate: number): DcfInput {
  return {
    currentRevenue: input.baseRevenue,
    netDebt: 0,
    sharesOutstanding: input.sharesOutstanding,
    currentPrice: input.currentPrice,
    mosPercent: 0,
    scenario: {
      revenueGrowthYears1to5: growthRate,
      revenueGrowthYears6to10: Math.min(growthRate, 0.40),
      operatingMarginTarget: input.operatingMarginTarget,
      taxRate: input.taxRate,
      reinvestmentRate: input.reinvestmentRate,
      wacc: input.wacc,
      terminalGrowth: input.terminalGrowthRate,
    },
  };
}

/**
 * Solve for the implied annual FCF growth rate the market is pricing in.
 *
 * Uses binary search on [-5%, 60%]. Returns null when:
 * - currentPrice ≤ 0 or baseFcf ≤ 0 (loss-making or free)
 * - currentPrice is outside the range the model can produce at [-5%, 60%]
 *
 * @param input - Market price, shares outstanding, and DCF parameters
 * @returns Decimal implied growth rate (e.g. 0.142 = 14.2%), or null
 */
export function computeImpliedGrowthRate(input: ReverseDcfInput): number | null {
  if (input.currentPrice <= 0 || input.baseFcf <= 0) return null;

  const MAX_ITERATIONS = 60;
  const TOLERANCE = 0.01;

  let lo = -0.05;
  let hi = 0.60;

  // Check whether the market price falls within the model's solvable range
  const loValue = runDcf(buildDcfInputForRate(input, lo)).fairValuePerShare;
  const hiValue = runDcf(buildDcfInputForRate(input, hi)).fairValuePerShare;

  if (input.currentPrice < loValue || input.currentPrice > hiValue) return null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const value = runDcf(buildDcfInputForRate(input, mid)).fairValuePerShare;

    if (Math.abs(value - input.currentPrice) < TOLERANCE) {
      return mid;
    }

    // Higher growth → higher value; narrow the bracket toward currentPrice
    if (value > input.currentPrice) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Compute the annualised FCF growth rate (CAGR) over a historical period.
 *
 * Expects annualFcf sorted newest-first (matching how fundamentalsTimeSeries
 * data is ordered by yahoo-client). Returns null if there is insufficient
 * data or if either endpoint is negative (CAGR undefined for sign changes).
 *
 * Default lookback is 4 years (requires 5 data points) rather than 5 because
 * Yahoo fundamentalsTimeSeries typically returns 4-5 annual entries — not
 * enough for a 5yr CAGR (which needs 6 points).
 *
 * @param annualFcf - FCF values sorted newest-first
 * @param years - Lookback period (default 4)
 */
export function computeFcfCagr(annualFcf: number[], years = 4): number | null {
  if (annualFcf.length < years + 1) return null;
  const latest = annualFcf[0];
  const base = annualFcf[years];
  if (base <= 0 || latest <= 0) return null;
  return Math.pow(latest / base, 1 / years) - 1;
}
