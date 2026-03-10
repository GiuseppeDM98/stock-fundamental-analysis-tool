import { FundamentalsResponse } from "@/types/fundamentals";
import { AnalystEstimates, ScenarioInput, ScenariosInput } from "@/types/valuation";

/**
 * Return default bull/base/bear assumptions meant for retail users.
 *
 * The defaults are intentionally conservative enough to avoid extreme output
 * while still differentiating scenario behavior. All rates are expressed
 * as decimals (0.12 = 12%).
 *
 * @returns Three preset scenarios with DCF input parameters
 */
export function getDefaultScenarios(): ScenariosInput {
  return {
    // Optimistic scenario: high growth, strong margins, lower discount rate
    bull: {
      revenueGrowthYears1to5: 0.12,   // 12% annual growth in early years
      revenueGrowthYears6to10: 0.08,  // Growth moderates to 8%
      operatingMarginTarget: 0.22,    // Strong 22% operating margin
      taxRate: 0.2,                   // 20% effective tax rate
      reinvestmentRate: 0.3,          // 30% reinvestment for growth
      wacc: 0.085,                    // 8.5% discount rate (lower risk premium)
      terminalGrowth: 0.03            // 3% perpetual growth
    },
    // Moderate scenario: balanced assumptions for typical company
    base: {
      revenueGrowthYears1to5: 0.08,   // 8% growth early
      revenueGrowthYears6to10: 0.05,  // Slows to 5%
      operatingMarginTarget: 0.18,    // 18% operating margin
      taxRate: 0.22,                  // 22% effective tax rate
      reinvestmentRate: 0.35,         // 35% reinvestment
      wacc: 0.095,                    // 9.5% discount rate
      terminalGrowth: 0.025           // 2.5% perpetual growth
    },
    // Conservative scenario: slow growth, compressed margins, higher discount rate
    bear: {
      revenueGrowthYears1to5: 0.04,   // 4% growth early
      revenueGrowthYears6to10: 0.02,  // Slows to 2%
      operatingMarginTarget: 0.14,    // 14% operating margin
      taxRate: 0.25,                  // 25% effective tax rate
      reinvestmentRate: 0.4,          // 40% reinvestment (less efficient capital use)
      wacc: 0.11,                     // 11% discount rate (higher risk)
      terminalGrowth: 0.02            // 2% perpetual growth
    }
  };
}

/**
 * Clamp a value between min and max bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estimate WACC using CAPM for the cost of equity.
 *
 * Formula: Ke = Rf + β × ERP
 * where ERP (Equity Risk Premium) defaults to 5.5% — Damodaran's 2024
 * implied ERP estimate for the US market, widely used as a benchmark.
 *
 * Limitations:
 * - This is equity cost only (no debt weighting), which is an approximation.
 * - A full WACC requires debt cost and D/E ratio from the balance sheet.
 * - For most equity investors using enterprise DCF, Ke ≈ WACC is a
 *   reasonable simplification when leverage is moderate.
 *
 * Beta fallback: uses 1.0 (market beta) if no beta data is available.
 * Result clamped to [6%, 18%] to keep DCF stable.
 */
function computeWacc(beta: number | null, riskFreeRate: number, erp = 0.055): number {
  const b = beta ?? 1.0;
  const ke = riskFreeRate + b * erp;
  return clamp(ke, 0.06, 0.18);
}

/**
 * Compute the Compound Annual Growth Rate from an array of annual revenue figures.
 *
 * CAGR = (endValue / startValue)^(1/years) - 1
 * Requires at least 2 data points. Returns null if data is insufficient or invalid.
 */
function computeRevenueCAGR(annual: FundamentalsResponse["annual"]): number | null {
  if (annual.length < 2) return null;

  // annual[0] is the most recent year, annual[last] is the oldest
  const endRevenue = annual[0].revenue;
  const startRevenue = annual[annual.length - 1].revenue;

  if (startRevenue <= 0 || endRevenue <= 0) return null;

  const years = annual.length - 1;
  return Math.pow(endRevenue / startRevenue, 1 / years) - 1;
}

/**
 * Derive effective tax rate from historical fundamentals.
 *
 * Uses the most recent year where both EBIT and net income are positive.
 * Effective tax rate ≈ 1 - (netIncome / ebit), which approximates
 * the combined effect of corporate tax and interest expense.
 */
function deriveEffectiveTaxRate(annual: FundamentalsResponse["annual"]): number | null {
  for (const point of annual) {
    if (point.ebit > 0 && point.netIncome > 0) {
      return clamp(1 - point.netIncome / point.ebit, 0.1, 0.4);
    }
  }
  return null;
}

/**
 * Derive reinvestment rate from FCF and NOPAT data.
 *
 * reinvestmentRate = 1 - (FCF / NOPAT)
 * For capital-light companies (Apple, Google), FCF can exceed NOPAT because
 * working capital changes add cash beyond operating profit. In these cases
 * the reinvestment rate is near-zero — we clamp to [0.05, 0.70].
 *
 * Prefers financialData FCF (current TTM, always available) over
 * cashflowStatementHistory (deprecated by Yahoo, often returns incomplete data).
 */
function deriveReinvestmentRate(
  annual: FundamentalsResponse["annual"],
  estimates: AnalystEstimates
): number | null {
  // Prefer current FCF from financialData — this is the most reliable source
  // because Yahoo's cashflowStatementHistory module was deprecated Nov 2024
  if (estimates.freeCashflow !== null && estimates.totalRevenue !== null && estimates.operatingMargins !== null) {
    const currentEbit = estimates.totalRevenue * estimates.operatingMargins;
    const effectiveTax = deriveEffectiveTaxRate(annual) ?? 0.22;
    const currentNopat = currentEbit * (1 - effectiveTax);
    if (currentNopat > 0) {
      return clamp(1 - estimates.freeCashflow / currentNopat, 0.05, 0.70);
    }
  }

  // Fallback to historical data (may be incomplete for some tickers)
  for (const point of annual) {
    const nopat = point.ebit * (1 - (point.ebit > 0 && point.netIncome > 0 ? 1 - point.netIncome / point.ebit : 0.22));
    if (nopat > 0 && point.fcf !== 0) {
      return clamp(1 - point.fcf / nopat, 0.05, 0.70);
    }
  }
  return null;
}

/**
 * Generate company-specific bull/base/bear scenarios using real financial data.
 *
 * Design:
 * - Base scenario uses analyst estimates (preferred) with historical data as fallback
 * - Bull applies optimistic adjustments to base (+25% growth, +3pp margin, etc.)
 * - Bear applies conservative adjustments (50% of base growth, -4pp margin, etc.)
 * - All values are clamped to DCF validation bounds to ensure model stability
 *
 * Fallback chain for revenue growth: analyst 5yr → historical CAGR → TTM growth → 5%
 * Fallback chain for margins: latest actual → 3yr average → generic 18%
 *
 * @param fundamentals - Historical financial statements
 * @param estimates - Analyst consensus estimates (nullable fields)
 * @param riskFreeRate - Current risk-free rate (e.g. US 10Y Treasury yield). Defaults to 4.5% if not provided.
 * @returns Company-specific scenarios; falls back to generic defaults if data is insufficient
 */
export function getCompanyScenarios(
  fundamentals: FundamentalsResponse,
  estimates: AnalystEstimates,
  riskFreeRate?: number
): ScenariosInput {
  const { annual } = fundamentals;

  // Revenue growth: prefer analyst 5-year estimate, then CAGR, then TTM, then 5%
  const baseGrowthY1to5 =
    estimates.revenueGrowth5Year ??
    estimates.revenueGrowthNextYear ??
    computeRevenueCAGR(annual) ??
    estimates.revenueGrowthTTM ??
    0.05;

  // Years 6-10 growth fades towards terminal rate (60% of early growth)
  const baseGrowthY6to10 = baseGrowthY1to5 * 0.6;

  // Operating margin: prefer multi-year historical average over TTM.
  // TTM can be distorted by one-time charges or commodity price cycles
  // (e.g. oil majors in a low-price year). A 5-year average is more
  // representative of normalized profitability.
  const latestMargin = annual[0]?.operatingMargin ?? null;
  const avgMargin3yr = annual.length >= 3
    ? annual.slice(0, 3).reduce((sum, p) => sum + p.operatingMargin, 0) / 3
    : null;
  const avgMargin5yr = annual.length >= 5
    ? annual.slice(0, 5).reduce((sum, p) => sum + p.operatingMargin, 0) / 5
    : null;
  const baseMargin = avgMargin5yr ?? avgMargin3yr ?? estimates.operatingMargins ?? latestMargin ?? 0.18;

  const baseTaxRate = deriveEffectiveTaxRate(annual) ?? 0.22;
  const baseReinvestmentRate = deriveReinvestmentRate(annual, estimates) ?? 0.30;

  // Compute WACC using CAPM: Ke = Rf + β × ERP.
  // This is far more accurate than a hardcoded 9.5% because it accounts
  // for company-specific risk (beta) and the current interest rate environment (Rf).
  const rf = riskFreeRate ?? 0.045; // default to 4.5% if risk-free rate not provided
  const baseWacc = computeWacc(estimates.beta, rf);
  const baseTerminalGrowth = 0.025;

  // Build base scenario with validation bounds applied
  const base: ScenarioInput = {
    revenueGrowthYears1to5: clamp(baseGrowthY1to5, -0.5, 0.6),
    revenueGrowthYears6to10: clamp(baseGrowthY6to10, -0.5, 0.4),
    operatingMarginTarget: clamp(baseMargin, 0, 0.8),
    taxRate: clamp(baseTaxRate, 0, 0.6),
    reinvestmentRate: clamp(baseReinvestmentRate, 0, 0.9),
    wacc: baseWacc,
    terminalGrowth: baseTerminalGrowth,
  };

  // Bull: optimistic adjustments — higher growth, better margins, lower discount
  const bull: ScenarioInput = {
    revenueGrowthYears1to5: clamp(base.revenueGrowthYears1to5 * 1.25, -0.5, 0.6),
    revenueGrowthYears6to10: clamp(base.revenueGrowthYears6to10 * 1.25, -0.5, 0.4),
    operatingMarginTarget: clamp(base.operatingMarginTarget + 0.03, 0, 0.8),
    taxRate: clamp(base.taxRate - 0.02, 0, 0.6),
    reinvestmentRate: clamp(base.reinvestmentRate - 0.05, 0, 0.9),
    wacc: clamp(base.wacc - 0.01, 0.03, 0.3),
    terminalGrowth: clamp(base.terminalGrowth + 0.005, -0.02, 0.06),
  };

  // Bear: conservative adjustments — slower growth, compressed margins, higher discount
  const bear: ScenarioInput = {
    revenueGrowthYears1to5: clamp(base.revenueGrowthYears1to5 * 0.5, -0.5, 0.6),
    revenueGrowthYears6to10: clamp(base.revenueGrowthYears6to10 * 0.4, -0.5, 0.4),
    operatingMarginTarget: clamp(base.operatingMarginTarget - 0.04, 0, 0.8),
    taxRate: clamp(base.taxRate + 0.03, 0, 0.6),
    reinvestmentRate: clamp(base.reinvestmentRate + 0.10, 0, 0.9),
    wacc: clamp(base.wacc + 0.015, 0.03, 0.3),
    terminalGrowth: clamp(base.terminalGrowth - 0.005, -0.02, 0.06),
  };

  // Safety: ensure WACC > terminalGrowth for all scenarios (Gordon Growth constraint)
  if (bull.wacc <= bull.terminalGrowth) {
    bull.terminalGrowth = bull.wacc - 0.01;
  }
  if (bear.wacc <= bear.terminalGrowth) {
    bear.terminalGrowth = bear.wacc - 0.01;
  }

  return { bull, base, bear };
}
