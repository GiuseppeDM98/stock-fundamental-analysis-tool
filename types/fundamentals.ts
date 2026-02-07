/**
 * Single year of financial statement data.
 *
 * Combines income statement and cash flow metrics with calculated margins.
 * Used for historical charting and DCF input (most recent year's revenue).
 */
export type AnnualFundamentalPoint = {
  year: number;
  revenue: number;
  ebit: number;              // Earnings Before Interest and Tax
  netIncome: number;
  fcf: number;               // Free Cash Flow (operating cash - capex)
  operatingMargin: number;   // EBIT / revenue (decimal, e.g., 0.15 = 15%)
  netMargin: number;         // Net income / revenue (decimal)
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
 * Historical financial statements and valuation ratios for a ticker.
 *
 * Contains up to 5 years of annual data plus current valuation multiples.
 * Annual array may have fewer than 5 elements for newer companies or
 * tickers with incomplete Yahoo Finance data.
 */
export type FundamentalsResponse = {
  ticker: string;
  currency: string;
  annual: AnnualFundamentalPoint[];
  ratios: Ratios;
};
