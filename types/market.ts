/**
 * Geographic region classification for tickers.
 *
 * Used to categorize stocks by primary exchange location for UI grouping
 * and potential region-specific logic (e.g., tax rates, trading hours).
 */
export type Region = "US" | "EU" | "OTHER";

/**
 * Real-time market quote data for a ticker.
 *
 * Normalized response from Yahoo Finance containing current price,
 * market cap, and exchange information. Some fields may be null
 * for tickers with incomplete data (especially non-US markets).
 */
export type QuoteResponse = {
  ticker: string;
  shortName: string;
  currency: string;
  exchange: string;
  region: Region;
  regularMarketPrice: number;
  marketCap: number | null;           // Null if not reported by Yahoo Finance
  sharesOutstanding: number | null;   // Null if not reported (required for DCF)
  fetchedAt: string;                  // ISO 8601 timestamp
};
