import YahooFinance from "yahoo-finance2";

import { BalanceSheetEntry, FundamentalsResponse } from "@/types/fundamentals";
import { QuoteResponse, Region } from "@/types/market";

// Suppress Yahoo Finance survey notices to keep logs clean
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"]
});

/**
 * Extract a plain numeric value from Yahoo's mixed schema.
 *
 * Yahoo responses can expose values as numbers or as objects with
 * a `raw` numeric payload (e.g., { raw: 123.45, fmt: "123.45" }).
 *
 * @param value - Yahoo API field value (number, object with raw, or other)
 * @returns Extracted number or null if not found/invalid
 */
export function extractRawNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === "object" && "raw" in (value as Record<string, unknown>)) {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }

  return null;
}

/**
 * Detect geographic region based on exchange code.
 *
 * Used to categorize tickers by region for UI grouping and
 * potential future region-specific logic (e.g., trading hours, tax rates).
 *
 * @param exchange - Exchange code from Yahoo Finance (e.g., "NASDAQ", "LSE")
 * @returns Region category: "US", "EU", or "OTHER"
 */
function detectRegion(exchange: string): Region {
  const upper = exchange.toUpperCase();

  if (["NMS", "NASDAQ", "NYQ", "NYSE", "ASE", "AMEX", "BATS", "PCX"].includes(upper)) {
    return "US";
  }

  if (["MIL", "PAR", "FRA", "XETRA", "GER", "LSE", "AMS", "STO", "MCX", "SWX"].includes(upper)) {
    return "EU";
  }

  return "OTHER";
}

/**
 * Retry a Yahoo Finance API call with exponential backoff.
 *
 * Yahoo Finance can intermittently fail due to rate limits or transient network issues.
 * This utility retries up to 3 times total (1 initial + 2 retries) with increasing delays:
 * - Attempt 1: immediate
 * - Attempt 2: 250ms delay
 * - Attempt 3: 500ms delay
 *
 * @param task - Async function to execute
 * @param retries - Number of retry attempts after initial failure
 * @returns Task result on success
 * @throws Last error encountered if all attempts fail
 */
async function withRetry<T>(task: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      // Exponential backoff: 250ms, 500ms, ...
      if (attempt < retries) {
        await new Promise((resolve) => {
          setTimeout(resolve, 250 * (attempt + 1));
        });
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown Yahoo Finance error.");
}

/**
 * Normalize Yahoo Finance errors into user-friendly messages.
 *
 * Yahoo errors can be verbose or technical. This function detects common
 * failure patterns and returns actionable messages for the UI.
 *
 * @param error - Raw error from yahoo-finance2
 * @returns Normalized Error with user-friendly message
 */
function normalizeYahooError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Rate limit detection (HTTP 429 or "too many requests" message)
    if (message.includes("too many requests") || message.includes("429")) {
      return new Error("Yahoo Finance rate limit reached. Retry in 30-60 seconds.");
    }

    // Ticker not found or unavailable
    if (message.includes("not found") || message.includes("no data") || message.includes("symbol")) {
      return new Error("Ticker not found or unavailable on Yahoo Finance.");
    }

    return error;
  }

  return new Error("Unknown Yahoo Finance error.");
}

/**
 * Fetch real-time quote data for a ticker.
 *
 * Retrieves current price, market cap, shares outstanding, and exchange info.
 * Automatically retries on transient failures and normalizes field names
 * for consistent app usage.
 *
 * @param ticker - Stock ticker symbol (e.g., "AAPL", "ASML.AS")
 * @returns Quote data with normalized fields
 * @throws User-friendly error if ticker not found or rate limit hit
 */
export async function getQuote(ticker: string): Promise<QuoteResponse> {
  try {
    const quote = await withRetry(() => yahooFinance.quote(ticker));

    if (!quote) {
      throw new Error("Ticker not found or unavailable on Yahoo Finance.");
    }

    const exchange = String(quote.fullExchangeName || quote.exchange || "UNKNOWN");

    return {
      ticker: String(quote.symbol || ticker).toUpperCase(),
      shortName: String(quote.shortName || quote.longName || ticker),
      currency: String(quote.currency || "USD"),
      exchange,
      region: detectRegion(exchange),
      regularMarketPrice: Number(quote.regularMarketPrice || 0),
      regularMarketChange: Number(quote.regularMarketChange ?? 0),
      regularMarketChangePercent: Number(quote.regularMarketChangePercent ?? 0),
      marketCap: Number.isFinite(quote.marketCap as number) ? Number(quote.marketCap) : null,
      sharesOutstanding: Number.isFinite(quote.sharesOutstanding as number) ? Number(quote.sharesOutstanding) : null,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    throw normalizeYahooError(error);
  }
}

/**
 * Map fundamentalsTimeSeries entries into app-level annual data points.
 *
 * fundamentalsTimeSeries returns one object per fiscal year with flat field names
 * (e.g. totalRevenue, EBIT, freeCashFlow). Some entries may have undefined fields
 * if Yahoo doesn't have data for that year — we skip entries missing revenue.
 *
 * Balance sheet data (totalAssets, equity, debt, etc.) is extracted directly from
 * fundamentalsTimeSeries, which supersedes the now-deprecated balanceSheetHistory
 * quoteSummary module (returns empty data since Nov 2024).
 */
export function mapFundamentalsFromTimeSeries(
  ticker: string,
  entries: any[],
  ratios: { pe: number | null; pb: number | null; ps: number | null; evEbitda?: number | null },
  currency: string,
  sector?: string | null,
  industry?: string | null,
  dividendRate?: number | null,
  ebitda?: number | null,
): FundamentalsResponse {
  const validEntries = entries
    .filter((e: any) => e.totalRevenue != null && e.date instanceof Date)
    .slice(-10); // keep at most 10 years, most recent last

  const annual = validEntries
    .map((entry: any) => {
      const revenue = Number(entry.totalRevenue) || 0;
      const ebit = Number(entry.EBIT ?? entry.operatingIncome) || 0;
      const netIncome = Number(entry.netIncome) || 0;
      const fcfDirect = entry.freeCashFlow != null ? Number(entry.freeCashFlow) : null;
      const operatingCash = Number(entry.operatingCashFlow || entry.cashFlowFromContinuingOperatingActivities) || 0;
      const capex = Number(entry.capitalExpenditure || entry.purchaseOfPPE) || 0; // negative in Yahoo data
      const fcf = fcfDirect ?? operatingCash + capex;

      // grossProfit: direct field or revenue − costOfRevenue
      const grossProfitRaw = entry.grossProfit ?? entry.reconciledCostOfRevenue;
      const grossProfit = grossProfitRaw != null
        ? Number(grossProfitRaw)
        : (entry.costOfRevenue != null ? revenue - Number(entry.costOfRevenue) : null);

      // Ordinary shares issued (not diluted) — used for year-over-year dilution detection
      const sharesRaw = entry.ordinarySharesNumber ?? entry.shareIssued;
      const sharesOutstanding = sharesRaw != null ? Number(sharesRaw) : null;

      return {
        year: entry.date.getUTCFullYear(),
        revenue,
        ebit,
        netIncome,
        fcf,
        operatingMargin: revenue > 0 ? ebit / revenue : 0,
        netMargin: revenue > 0 ? netIncome / revenue : 0,
        grossProfit: grossProfit != null && Number.isFinite(grossProfit) ? grossProfit : null,
        sharesOutstanding: sharesOutstanding != null && Number.isFinite(sharesOutstanding) ? sharesOutstanding : null,
      };
    })
    // Sort descending (most recent first) to match existing conventions
    .sort((a: { year: number }, b: { year: number }) => b.year - a.year);

  // Build annual balance sheet from fundamentalsTimeSeries data.
  // The balanceSheetHistory quoteSummary module is deprecated since Nov 2024 and
  // returns empty entries. fundamentalsTimeSeries includes the same fields with
  // full historical data.
  const annualBalanceSheet: BalanceSheetEntry[] = validEntries
    .map((entry: any): BalanceSheetEntry => ({
      year: (entry.date as Date).getUTCFullYear(),
      totalAssets: entry.totalAssets != null ? Number(entry.totalAssets) : null,
      totalCurrentAssets: entry.currentAssets != null ? Number(entry.currentAssets) : null,
      totalCurrentLiabilities: entry.currentLiabilities != null ? Number(entry.currentLiabilities) : null,
      longTermDebt: entry.longTermDebt != null ? Number(entry.longTermDebt) : null,
      // stockholdersEquity or commonStockEquity (same concept, different field names by ticker/year)
      totalEquity: entry.stockholdersEquity != null
        ? Number(entry.stockholdersEquity)
        : (entry.commonStockEquity != null ? Number(entry.commonStockEquity) : null),
      retainedEarnings: entry.retainedEarnings != null ? Number(entry.retainedEarnings) : null,
      cash: entry.cashAndCashEquivalents != null
        ? Number(entry.cashAndCashEquivalents)
        : (entry.cashEquivalents != null ? Number(entry.cashEquivalents) : null),
    }))
    .sort((a, b) => b.year - a.year);

  return {
    ticker: ticker.toUpperCase(),
    currency,
    annual,
    annualBalanceSheet,
    ratios,
    sector: sector ?? null,
    industry: industry ?? null,
    dividendRate: dividendRate ?? null,
    ebitda: ebitda ?? null,
  };
}
