/**
 * Quality Scorecard computation library.
 *
 * Four quantitative metrics used by value investors to assess business quality:
 * 1. Piotroski F-Score (0–9): binary signals for financial health + earnings quality
 * 2. ROIC vs WACC Spread: value creation or destruction
 * 3. FCF Conversion: are reported earnings backed by real cash?
 * 4. Altman Z-Score: bankruptcy risk (non-financial companies only)
 *
 * All functions are pure: no network calls, no side effects.
 * Each Piotroski signal is isolated in its own function for testability.
 */
import type { AnnualFundamentalPoint, BalanceSheetEntry, FundamentalsResponse } from "@/types/fundamentals";

export interface PiotroskiSignal {
  key: string;
  pass: boolean | null;   // null = data unavailable for this signal
}

export interface QualityScorecard {
  piotroski: {
    score: number;        // count of signals that passed (nulls excluded)
    maxScore: number;     // count of signals where data was available
    signals: PiotroskiSignal[];
    interpretation: "Strong" | "Moderate" | "Weak";
  };
  roicWacc: {
    roic: number | null;
    wacc: number;
    spread: number | null;      // decimal, e.g. 0.042 = 4.2%
  };
  fcfConversion: number | null; // decimal, e.g. 0.78 = 78%
  altmanZ: number | null;       // null if data unavailable OR sector excluded
  altmanZSkipped: boolean;      // true only when skipped due to sector (not missing data)
}

// ─── Piotroski signal helpers ─────────────────────────────────────────────────

/** F1: ROA > 0 — profitability baseline */
function signalRoa(annual: AnnualFundamentalPoint[], bs: BalanceSheetEntry[]): boolean | null {
  const a0 = annual[0];
  const b0 = bs[0];
  if (!a0 || !b0 || b0.totalAssets == null || b0.totalAssets === 0) return null;
  return a0.netIncome / b0.totalAssets > 0;
}

/** F2: Operating cash flow > 0 — confirms earnings are cash-backed */
function signalCfo(annual: AnnualFundamentalPoint[]): boolean | null {
  const a0 = annual[0];
  if (!a0) return null;
  // freeCashFlow is the closest proxy available from fundamentalsTimeSeries.
  // It underestimates CFO by capex, but capex > 0 means FCF > 0 implies CFO > 0.
  return a0.fcf > 0;
}

/** F3: ROA improving (year 0 vs year 1) */
function signalRoaTrend(annual: AnnualFundamentalPoint[], bs: BalanceSheetEntry[]): boolean | null {
  const a0 = annual[0];
  const a1 = annual[1];
  const b0 = bs[0];
  const b1 = bs[1];
  if (!a0 || !a1 || !b0 || !b1) return null;
  if (b0.totalAssets == null || b0.totalAssets === 0) return null;
  if (b1.totalAssets == null || b1.totalAssets === 0) return null;
  const roa0 = a0.netIncome / b0.totalAssets;
  const roa1 = a1.netIncome / b1.totalAssets;
  return roa0 > roa1;
}

/**
 * F4: Accrual quality — CFO/Assets > ROA.
 *
 * A company whose cash return exceeds its accounting return is less likely to
 * be inflating earnings via accruals.
 */
function signalAccrual(annual: AnnualFundamentalPoint[], bs: BalanceSheetEntry[]): boolean | null {
  const a0 = annual[0];
  const b0 = bs[0];
  if (!a0 || !b0 || b0.totalAssets == null || b0.totalAssets === 0) return null;
  const roa = a0.netIncome / b0.totalAssets;
  const cfoOverAssets = a0.fcf / b0.totalAssets;
  return cfoOverAssets > roa;
}

/** F5: Leverage decreased (long-term debt / total assets, year 0 < year 1) */
function signalLeverage(bs: BalanceSheetEntry[]): boolean | null {
  const b0 = bs[0];
  const b1 = bs[1];
  if (!b0 || !b1) return null;
  if (b0.longTermDebt == null || b0.totalAssets == null || b0.totalAssets === 0) return null;
  if (b1.longTermDebt == null || b1.totalAssets == null || b1.totalAssets === 0) return null;
  return b0.longTermDebt / b0.totalAssets < b1.longTermDebt / b1.totalAssets;
}

/** F6: Current ratio improved (currentAssets / currentLiabilities, year 0 > year 1) */
function signalCurrentRatio(bs: BalanceSheetEntry[]): boolean | null {
  const b0 = bs[0];
  const b1 = bs[1];
  if (!b0 || !b1) return null;
  if (b0.totalCurrentAssets == null || b0.totalCurrentLiabilities == null || b0.totalCurrentLiabilities === 0) return null;
  if (b1.totalCurrentAssets == null || b1.totalCurrentLiabilities == null || b1.totalCurrentLiabilities === 0) return null;
  return b0.totalCurrentAssets / b0.totalCurrentLiabilities > b1.totalCurrentAssets / b1.totalCurrentLiabilities;
}

/**
 * F7: No share dilution — shares outstanding did not increase year-over-year.
 *
 * Uses ordinarySharesNumber from fundamentalsTimeSeries. Returns null when
 * the series has fewer than 2 years of share data.
 */
function signalDilution(annual: AnnualFundamentalPoint[]): boolean | null {
  const s0 = annual[0]?.sharesOutstanding;
  const s1 = annual[1]?.sharesOutstanding;
  if (s0 == null || s1 == null || s1 === 0) return null;
  return s0 <= s1;
}

/**
 * F8: Gross margin improved (grossProfit / revenue, year 0 vs year 1).
 *
 * Uses grossProfit from fundamentalsTimeSeries. Returns null when fewer than
 * 2 years of gross profit data are available.
 */
function signalGrossMargin(annual: AnnualFundamentalPoint[]): boolean | null {
  const a0 = annual[0];
  const a1 = annual[1];
  if (!a0 || !a1 || a0.grossProfit == null || a1.grossProfit == null) return null;
  if (a0.revenue <= 0 || a1.revenue <= 0) return null;
  return a0.grossProfit / a0.revenue > a1.grossProfit / a1.revenue;
}

/** F9: Asset turnover improved (revenue/assets, year 0 > year 1) */
function signalAssetTurnover(annual: AnnualFundamentalPoint[], bs: BalanceSheetEntry[]): boolean | null {
  const a0 = annual[0];
  const a1 = annual[1];
  const b0 = bs[0];
  const b1 = bs[1];
  if (!a0 || !a1 || !b0 || !b1) return null;
  if (b0.totalAssets == null || b0.totalAssets === 0) return null;
  if (b1.totalAssets == null || b1.totalAssets === 0) return null;
  return a0.revenue / b0.totalAssets > a1.revenue / b1.totalAssets;
}

function computePiotroski(annual: AnnualFundamentalPoint[], bs: BalanceSheetEntry[]): QualityScorecard["piotroski"] {
  const signals: PiotroskiSignal[] = [
    { key: "piotroskiRoa",          pass: signalRoa(annual, bs) },
    { key: "piotroskiCfo",          pass: signalCfo(annual) },
    { key: "piotroskiRoaTrend",     pass: signalRoaTrend(annual, bs) },
    { key: "piotroskiAccrual",      pass: signalAccrual(annual, bs) },
    { key: "piotroskiLeverage",     pass: signalLeverage(bs) },
    { key: "piotroskiCurrentRatio", pass: signalCurrentRatio(bs) },
    { key: "piotroskiDilution",     pass: signalDilution(annual) },
    { key: "piotroskiGrossMargin",  pass: signalGrossMargin(annual) },
    { key: "piotroskiAssetTurnover", pass: signalAssetTurnover(annual, bs) },
  ];

  const available = signals.filter((s) => s.pass !== null);
  const score = available.filter((s) => s.pass === true).length;
  const maxScore = available.length;

  // Interpret against the standard 9-point scale even though max may be < 9
  // when some signals are unavailable.
  let interpretation: "Strong" | "Moderate" | "Weak";
  if (score >= 7) {
    interpretation = "Strong";
  } else if (score >= 4) {
    interpretation = "Moderate";
  } else {
    interpretation = "Weak";
  }

  return { score, maxScore, signals, interpretation };
}

// ─── ROIC vs WACC ─────────────────────────────────────────────────────────────

/**
 * Compute ROIC and spread vs WACC.
 *
 * NOPAT = EBIT × (1 − effectiveTaxRate)
 * Invested Capital = totalEquity + longTermDebt
 * ROIC = NOPAT / Invested Capital
 * Spread = ROIC − WACC
 *
 * effectiveTaxRate is derived as (1 − netIncome / EBIT) to avoid adding
 * a separate financialData module fetch to the Yahoo call.
 */
function computeRoicWacc(
  annual: AnnualFundamentalPoint[],
  bs: BalanceSheetEntry[],
  wacc: number,
): QualityScorecard["roicWacc"] {
  const a0 = annual[0];
  const b0 = bs[0];

  if (!a0 || !b0 || b0.totalEquity == null || b0.longTermDebt == null) {
    return { roic: null, wacc, spread: null };
  }

  const investedCapital = b0.totalEquity + b0.longTermDebt;
  if (investedCapital <= 0 || a0.ebit <= 0) {
    return { roic: null, wacc, spread: null };
  }

  // Clamp effective tax rate to [0, 0.5] to guard against accounting anomalies
  const rawTaxRate = a0.ebit > 0 ? 1 - a0.netIncome / a0.ebit : 0;
  const effectiveTaxRate = Math.max(0, Math.min(0.5, rawTaxRate));

  const nopat = a0.ebit * (1 - effectiveTaxRate);
  const roic = nopat / investedCapital;
  const spread = roic - wacc;

  return { roic, wacc, spread };
}

// ─── FCF Conversion ───────────────────────────────────────────────────────────

/**
 * FCF Conversion = FCF / Net Income.
 *
 * Only meaningful when both are positive: a high conversion rate confirms
 * that accounting earnings translate to real cash.
 */
function computeFcfConversion(annual: AnnualFundamentalPoint[]): number | null {
  const a0 = annual[0];
  if (!a0 || a0.netIncome <= 0) return null;
  return a0.fcf / a0.netIncome;
}

// ─── Altman Z-Score ────────────────────────────────────────────────────────────

/** Sectors for which Altman Z-Score is not calibrated and must be skipped. */
const ALTMAN_EXCLUDED_SECTORS = new Set([
  "Financial Services",
  "Financial",
  "Real Estate",
]);

/**
 * Altman Z-Score for non-financial companies.
 *
 * Z = 1.2×X1 + 1.4×X2 + 3.3×X3 + 0.6×X4 + 1.0×X5
 *   X1 = working capital / total assets
 *   X2 = retained earnings / total assets
 *   X3 = EBIT / total assets
 *   X4 = market cap / total liabilities
 *   X5 = revenue / total assets
 *
 * Returns null for financial/RE sectors and when required data is unavailable.
 */
function computeAltmanZ(
  annual: AnnualFundamentalPoint[],
  bs: BalanceSheetEntry[],
  sector: string | null,
  currentPrice: number,
  sharesOutstanding: number | null,
): number | null {
  if (sector && ALTMAN_EXCLUDED_SECTORS.has(sector)) return null;

  const a0 = annual[0];
  const b0 = bs[0];
  if (!a0 || !b0) return null;

  const { totalAssets, totalCurrentAssets, totalCurrentLiabilities, totalEquity, retainedEarnings } = b0;
  if (
    totalAssets == null || totalAssets === 0 ||
    totalCurrentAssets == null ||
    totalCurrentLiabilities == null ||
    totalEquity == null ||
    retainedEarnings == null
  ) return null;

  const totalLiabilities = totalAssets - totalEquity;
  if (totalLiabilities <= 0) return null;

  // Require shares outstanding for the market cap term
  if (!sharesOutstanding || sharesOutstanding <= 0) return null;

  const marketCap = currentPrice * sharesOutstanding;
  const workingCapital = totalCurrentAssets - totalCurrentLiabilities;

  const x1 = workingCapital / totalAssets;
  const x2 = retainedEarnings / totalAssets;
  const x3 = a0.ebit / totalAssets;
  const x4 = marketCap / totalLiabilities;
  const x5 = a0.revenue / totalAssets;

  return 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the full Quality Scorecard for a ticker.
 *
 * @param fundamentals - Full fundamentals response including annualBalanceSheet
 * @param wacc - WACC from the active base scenario (decimal, e.g. 0.09 = 9%)
 * @param currentPrice - Current market price per share
 * @param sharesOutstanding - Shares outstanding from the quote response
 */
export function computeQualityScorecard(
  fundamentals: FundamentalsResponse,
  wacc: number,
  currentPrice: number,
  sharesOutstanding: number | null,
): QualityScorecard {
  const { annual, annualBalanceSheet, sector } = fundamentals;

  const altmanZSkipped = Boolean(sector && ALTMAN_EXCLUDED_SECTORS.has(sector));

  return {
    piotroski: computePiotroski(annual, annualBalanceSheet),
    roicWacc: computeRoicWacc(annual, annualBalanceSheet, wacc),
    fcfConversion: computeFcfConversion(annual),
    altmanZ: computeAltmanZ(annual, annualBalanceSheet, sector, currentPrice, sharesOutstanding),
    altmanZSkipped,
  };
}
