import YahooFinance from "yahoo-finance2";

import { FundamentalsResponse } from "@/types/fundamentals";
import { QuoteResponse, Region } from "@/types/market";
import { AnalystEstimates } from "@/types/valuation";

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
 * Map fundamentalsTimeSeries entries into app-level annual data points.
 *
 * fundamentalsTimeSeries returns one object per fiscal year with flat field names
 * (e.g. totalRevenue, EBIT, freeCashFlow). Some entries may have undefined fields
 * if Yahoo doesn't have data for that year — we skip entries missing revenue.
 */
export function mapFundamentalsFromTimeSeries(
  ticker: string,
  entries: any[],
  ratios: { pe: number | null; pb: number | null; ps: number | null; evEbitda?: number | null },
  currency: string
): FundamentalsResponse {
  const annual = entries
    .filter((e: any) => e.totalRevenue != null && e.date instanceof Date)
    .slice(-5) // keep at most 5 years, most recent last
    .map((entry: any) => {
      const revenue = Number(entry.totalRevenue) || 0;
      const ebit = Number(entry.EBIT ?? entry.operatingIncome) || 0;
      const netIncome = Number(entry.netIncome) || 0;
      const fcfDirect = entry.freeCashFlow != null ? Number(entry.freeCashFlow) : null;
      const operatingCash = Number(entry.operatingCashFlow) || 0;
      const capex = Number(entry.capitalExpenditure) || 0; // negative in Yahoo data
      const fcf = fcfDirect ?? operatingCash + capex;

      return {
        year: entry.date.getUTCFullYear(),
        revenue,
        ebit,
        netIncome,
        fcf,
        operatingMargin: revenue > 0 ? ebit / revenue : 0,
        netMargin: revenue > 0 ? netIncome / revenue : 0,
      };
    })
    // Sort descending (most recent first) to match existing conventions
    .sort((a: { year: number }, b: { year: number }) => b.year - a.year);

  return { ticker: ticker.toUpperCase(), currency, annual, ratios };
}

/**
 * Fetch historical financial statements and valuation ratios.
 *
 * Uses fundamentalsTimeSeries (the modern Yahoo API) for income/cashflow data,
 * and quoteSummary for valuation ratios (P/E, P/B, etc.) which still work.
 * The old incomeStatementHistory/cashflowStatementHistory modules have been
 * deprecated by Yahoo since Nov 2024 and return mostly empty data.
 *
 * @param ticker - Stock ticker symbol
 * @returns Fundamental data with normalized annual statements and ratios
 * @throws User-friendly error if ticker not found or rate limit hit
 */
export async function getFundamentals(ticker: string): Promise<FundamentalsResponse> {
  try {
    // Fetch time series (income + cashflow) and ratios in parallel
    const [timeSeries, summary] = await Promise.all([
      withRetry(() =>
        yahooFinance.fundamentalsTimeSeries(ticker, {
          period1: new Date(new Date().getFullYear() - 6, 0, 1).toISOString().slice(0, 10),
          period2: new Date().toISOString().slice(0, 10),
          type: "annual",
          module: "all",
        })
      ),
      withRetry(() =>
        yahooFinance.quoteSummary(ticker, {
          modules: ["summaryDetail", "defaultKeyStatistics", "price"],
        })
      ),
    ]);

    const summaryDetail: any = summary?.summaryDetail ?? {};
    const defaultKeyStatistics: any = summary?.defaultKeyStatistics ?? {};
    const currency = String(summary?.price?.currency || "USD");

    const ratios = {
      pe: extractRawNumber(summaryDetail?.trailingPE),
      pb: extractRawNumber(defaultKeyStatistics?.priceToBook),
      ps: extractRawNumber(summaryDetail?.priceToSalesTrailing12Months),
      evEbitda: extractRawNumber(defaultKeyStatistics?.enterpriseToEbitda),
    };

    return mapFundamentalsFromTimeSeries(ticker, timeSeries, ratios, currency);
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

/**
 * Map Yahoo Finance earningsTrend and financialData into AnalystEstimates.
 *
 * earningsTrend.trend is an array of objects keyed by period:
 *   "0q" = current quarter, "+1q" = next quarter,
 *   "0y" = current year, "+1y" = next year, "+5y" = next 5 years.
 * Each entry contains revenueEstimate.growth and earningsEstimate.growth as decimals.
 *
 * financialData provides trailing (TTM) growth rates and current margins.
 */
export function mapAnalystEstimates(summary: any): AnalystEstimates {
  const trend = summary?.earningsTrend?.trend ?? [];
  const fd = summary?.financialData ?? {};

  // Helper: find a specific period entry in the earningsTrend array
  const findPeriod = (period: string) =>
    trend.find((t: any) => t.period === period);

  const nextYear = findPeriod("+1y");
  const fiveYear = findPeriod("+5y");

  return {
    revenueGrowthNextYear: extractRawNumber(nextYear?.revenueEstimate?.growth) ?? null,
    revenueGrowth5Year: extractRawNumber(fiveYear?.revenueEstimate?.growth) ?? null,
    earningsGrowthNextYear: extractRawNumber(nextYear?.earningsEstimate?.growth) ?? null,
    targetMeanPrice: extractRawNumber(fd?.targetMeanPrice) ?? null,
    numberOfAnalysts: extractRawNumber(fd?.numberOfAnalystOpinions) ?? null,
    operatingMargins: extractRawNumber(fd?.operatingMargins) ?? null,
    revenueGrowthTTM: extractRawNumber(fd?.revenueGrowth) ?? null,
    // financialData provides current FCF and revenue (more reliable than deprecated
    // cashflowStatementHistory which can return incomplete data for some tickers)
    freeCashflow: extractRawNumber(fd?.freeCashflow) ?? null,
    totalRevenue: extractRawNumber(fd?.totalRevenue) ?? null,
  };
}

/**
 * Fetch analyst consensus estimates and current financial metrics.
 *
 * Combines earningsTrend (forward growth estimates from sell-side analysts)
 * with financialData (trailing metrics and analyst price targets) in a single
 * Yahoo Finance call to minimize API usage.
 *
 * @param ticker - Stock ticker symbol
 * @returns Analyst estimates with growth projections and price targets
 * @throws User-friendly error if ticker not found or rate limit hit
 */
export async function getAnalystEstimates(ticker: string): Promise<AnalystEstimates> {
  try {
    const summary = await withRetry(() =>
      yahooFinance.quoteSummary(ticker, {
        modules: ["earningsTrend", "financialData"]
      })
    );

    return mapAnalystEstimates(summary);
  } catch (error) {
    throw normalizeYahooError(error);
  }
}
