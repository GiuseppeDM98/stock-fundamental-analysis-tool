/**
 * Single year of financial statement data.
 *
 * Combines income statement and cash flow metrics with calculated margins.
 * Used for historical charting and DCF input (most recent year's revenue).
 * grossProfit and sharesOutstanding are sourced from fundamentalsTimeSeries
 * and are used by quality scorecard signals F7 (dilution) and F8 (gross margin).
 */
export type AnnualFundamentalPoint = {
  year: number;
  revenue: number;
  ebit: number;              // Earnings Before Interest and Tax
  netIncome: number;
  fcf: number;               // Free Cash Flow (operating cash - capex)
  operatingMargin: number;   // EBIT / revenue (decimal, e.g., 0.15 = 15%)
  netMargin: number;         // Net income / revenue (decimal)
  grossProfit: number | null;       // Gross profit (revenue − COGS)
  sharesOutstanding: number | null; // Ordinary shares issued (for dilution tracking)
};

/**
 * Valuation multiples for comparative analysis.
 *
 * All ratios may be null if Yahoo Finance doesn't provide the data
 * (common for non-US tickers or companies without positive earnings).
 */
export type Ratios = {
  pe: number | null;           // Price-to-Earnings
  pb: number | null;           // Price-to-Book
  ps: number | null;           // Price-to-Sales
  evEbitda?: number | null;    // Enterprise Value / EBITDA (optional, not all sources provide)
};

/**
 * One year of balance sheet data from Yahoo balanceSheetHistory.
 *
 * All monetary fields are nullable — Yahoo may not expose all fields for
 * every ticker, particularly non-US companies.
 */
export interface BalanceSheetEntry {
  year: number;
  totalAssets: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  longTermDebt: number | null;
  totalEquity: number | null;        // totalStockholderEquity in Yahoo
  retainedEarnings: number | null;
  cash: number | null;
}

/**
 * Historical financial statements and valuation ratios for a ticker.
 *
 * Contains up to 10 years of annual income/cashflow data, up to 4 years of
 * balance sheet data, and current valuation multiples. Arrays may be shorter
 * for newer companies or tickers with incomplete Yahoo Finance data.
 */
export type FundamentalsResponse = {
  ticker: string;
  currency: string;
  annual: AnnualFundamentalPoint[];
  annualBalanceSheet: BalanceSheetEntry[];   // newest first, up to 4 years
  ratios: Ratios;
  sector: string | null;
  industry: string | null;
  dividendRate: number | null;   // D₀: trailing annual dividend per share
  ebitda: number | null;         // TTM EBITDA derived from EV / EV/EBITDA ratio (for EV/EBITDA engine)
};
