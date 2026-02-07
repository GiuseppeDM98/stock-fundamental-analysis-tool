import YahooFinance from "yahoo-finance2";

import { FundamentalsResponse } from "@/types/fundamentals";
import { QuoteResponse, Region } from "@/types/market";

// Suppress Yahoo Finance survey notices to keep logs clean
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"]
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

    const exchange = String(quote.fullExchangeName || quote.exchange || "UNKNOWN");

    return {
      ticker: String(quote.symbol || ticker).toUpperCase(),
      shortName: String(quote.shortName || quote.longName || ticker),
      currency: String(quote.currency || "USD"),
      exchange,
      region: detectRegion(exchange),
      regularMarketPrice: Number(quote.regularMarketPrice || 0),
      marketCap: Number.isFinite(quote.marketCap as number) ? Number(quote.marketCap) : null,
      sharesOutstanding: Number.isFinite(quote.sharesOutstanding as number) ? Number(quote.sharesOutstanding) : null,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    throw normalizeYahooError(error);
  }
}

/**
 * Normalize yahoo-finance2 quoteSummary output to app fundamentals payload.
 *
 * Why this adapter exists:
 * quoteSummary fields vary by ticker/region and some statements can be missing.
 * We keep UI resilient by mapping partial data with safe fallbacks.
 */
export function mapFundamentalsFromSummary(ticker: string, summary: any): FundamentalsResponse {
  const income = summary?.incomeStatementHistory?.incomeStatementHistory ?? [];
  const cashflow = summary?.cashflowStatementHistory?.cashflowStatements ?? [];
  const summaryDetail = summary?.summaryDetail ?? {};
  const defaultKeyStatistics = summary?.defaultKeyStatistics ?? {};
  const price = summary?.price ?? {};

  const annual = income.slice(0, 5).map((statement: any, index: number) => {
    const correspondingCash = cashflow[index] ?? {};

    const revenue = extractRawNumber(statement?.totalRevenue) ?? 0;
    const ebit = extractRawNumber(statement?.ebit) ?? 0;
    const netIncome = extractRawNumber(statement?.netIncome) ?? 0;
    const fcfCandidate = extractRawNumber(correspondingCash?.freeCashFlow);
    const operatingCash = extractRawNumber(correspondingCash?.totalCashFromOperatingActivities) ?? 0;
    const capex = extractRawNumber(correspondingCash?.capitalExpenditures) ?? 0;

    // If free cash flow is missing, approximate using operating cash flow minus capex.
    const fcf = fcfCandidate ?? operatingCash + capex;

    return {
      year: new Date(Number((statement?.endDate?.raw ?? 0) * 1000)).getUTCFullYear() || new Date().getUTCFullYear(),
      revenue,
      ebit,
      netIncome,
      fcf,
      operatingMargin: revenue > 0 ? ebit / revenue : 0,
      netMargin: revenue > 0 ? netIncome / revenue : 0
    };
  });

  return {
    ticker: ticker.toUpperCase(),
    currency: String(price?.currency || "USD"),
    annual,
    ratios: {
      pe: extractRawNumber(summaryDetail?.trailingPE),
      pb: extractRawNumber(defaultKeyStatistics?.priceToBook),
      ps: extractRawNumber(summaryDetail?.priceToSalesTrailing12Months),
      evEbitda: extractRawNumber(defaultKeyStatistics?.enterpriseToEbitda)
    }
  };
}

/**
 * Fetch historical financial statements and valuation ratios.
 *
 * Retrieves up to 5 years of income statements and cash flow data,
 * plus current valuation multiples (P/E, P/B, P/S, EV/EBITDA).
 *
 * @param ticker - Stock ticker symbol
 * @returns Fundamental data with normalized annual statements and ratios
 * @throws User-friendly error if ticker not found or rate limit hit
 */
export async function getFundamentals(ticker: string): Promise<FundamentalsResponse> {
  try {
    const summary = await withRetry(() =>
      yahooFinance.quoteSummary(ticker, {
        modules: [
          "incomeStatementHistory",
          "cashflowStatementHistory",
          "summaryDetail",
          "defaultKeyStatistics",
          "price"
        ]
      })
    );

    return mapFundamentalsFromSummary(ticker, summary);
  } catch (error) {
    throw normalizeYahooError(error);
  }
}

/**
 * Fetch net debt for enterprise value calculation in DCF.
 *
 * Net debt = Total debt - Total cash. Used to convert enterprise value
 * to equity value (which is then divided by shares outstanding for per-share value).
 *
 * @param ticker - Stock ticker symbol
 * @returns Net debt (positive = debt exceeds cash, negative = net cash position)
 * @throws User-friendly error if ticker not found or rate limit hit
 */
export async function getNetDebtEstimate(ticker: string): Promise<number> {
  try {
    const summary = await withRetry(() =>
      yahooFinance.quoteSummary(ticker, {
        modules: ["financialData"]
      })
    );

    const totalDebt = extractRawNumber(summary?.financialData?.totalDebt) ?? 0;
    const totalCash = extractRawNumber(summary?.financialData?.totalCash) ?? 0;

    return totalDebt - totalCash;
  } catch (error) {
    throw normalizeYahooError(error);
  }
}
