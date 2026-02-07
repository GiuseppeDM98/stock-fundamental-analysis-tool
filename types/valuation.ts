/**
 * DCF scenario identifier.
 *
 * Three presets representing optimistic, moderate, and conservative assumptions.
 */
export type ScenarioName = "bull" | "base" | "bear";

/**
 * Input parameters for a single DCF scenario.
 *
 * All rates are expressed as decimals (0.12 = 12%). These assumptions
 * drive the 10-year cash flow projection and terminal value calculation.
 */
export type ScenarioInput = {
  revenueGrowthYears1to5: number;    // Annual revenue growth rate for years 1-5
  revenueGrowthYears6to10: number;   // Annual revenue growth rate for years 6-10
  operatingMarginTarget: number;     // Target EBIT / revenue ratio
  taxRate: number;                   // Effective tax rate for NOPAT calculation
  reinvestmentRate: number;          // % of NOPAT reinvested (subtracted from FCF)
  wacc: number;                      // Weighted Average Cost of Capital (discount rate)
  terminalGrowth: number;            // Perpetual growth rate for terminal value (must be < WACC)
};

/**
 * Complete set of scenario inputs for bull, base, and bear cases.
 */
export type ScenariosInput = Record<ScenarioName, ScenarioInput>;

/**
 * Request payload for DCF valuation API endpoint.
 */
export type ValuationRequest = {
  mosPercent: number;                      // Margin of safety (0-80%) applied to fair value
  sharesOutstandingOverride?: number;      // Optional override if Yahoo data is missing
  scenarios: ScenariosInput;
};

/**
 * DCF valuation output for a single scenario.
 *
 * Contains intermediate values (enterprise/equity value) and final per-share
 * metrics with margin of safety adjustment applied.
 */
export type ScenarioResult = {
  enterpriseValue: number;        // Present value of all future cash flows + terminal value
  equityValue: number;            // Enterprise value - net debt
  fairValuePerShare: number;      // Equity value / shares outstanding
  fairValueAfterMos: number;      // Fair value with margin of safety discount applied
  upsideVsPricePercent: number;   // % difference between MoS-adjusted fair value and current price
};

/**
 * Analyst consensus estimates and current financial metrics from Yahoo Finance.
 *
 * Used to compute company-specific scenario defaults instead of generic presets.
 * All growth rates and margins are decimals (0.12 = 12%).
 * Fields are nullable because analyst coverage varies by ticker and region.
 */
export type AnalystEstimates = {
  revenueGrowthNextYear: number | null;  // Analyst consensus revenue growth for next fiscal year
  revenueGrowth5Year: number | null;     // Analyst consensus annualized revenue growth over 5 years
  earningsGrowthNextYear: number | null; // Analyst consensus earnings growth for next fiscal year
  targetMeanPrice: number | null;        // Mean analyst price target
  numberOfAnalysts: number | null;       // Number of analysts providing estimates
  operatingMargins: number | null;       // Current operating margin from financialData
  revenueGrowthTTM: number | null;       // Trailing 12-month revenue growth
  freeCashflow: number | null;           // Current free cash flow from financialData (more reliable than historical)
  totalRevenue: number | null;           // Current total revenue from financialData
};

/**
 * Response from the analyst-estimates API endpoint.
 *
 * Bundles raw analyst data with pre-computed company-specific scenarios
 * so the dashboard can auto-populate scenario inputs on ticker search.
 */
export type AnalystEstimatesResponse = {
  ticker: string;
  analystEstimates: AnalystEstimates;
  smartScenarios: ScenariosInput;
};

/**
 * Complete valuation response with results for all three scenarios.
 *
 * Includes summary assessment based on base scenario upside percentage.
 */
export type ValuationResponse = {
  ticker: string;
  currentPrice: number;
  mosPercent: number;                                  // Margin of safety % used in calculation
  scenarios: Record<ScenarioName, ScenarioResult>;
  summary: {
    status: "undervalued" | "fair" | "overvalued";    // Based on base scenario upside
    baseScenarioUpsideAfterMos: number;                // Quick reference for base case upside
  };
};
