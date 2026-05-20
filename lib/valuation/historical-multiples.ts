/**
 * Computes historical valuation multiples (P/E, P/FCF, EV/EBIT) for each fiscal year
 * by combining fundamentalsTimeSeries data with historical daily closing prices.
 *
 * EV/EBIT is used as a proxy for EV/EBITDA because Yahoo's fundamentalsTimeSeries
 * does not expose D&A per fiscal year. After a future feature adds balanceSheetHistory,
 * this can be upgraded to true EV/EBITDA with per-year net debt.
 */

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

export interface HistoricalMultiplesDataPoint {
  year: number;
  /** ISO date string of the fiscal year-end */
  fiscalYearEnd: string;
  /** Adjusted closing price at fiscal year-end (split-adjusted) */
  price: number;
  pe: number | null;
  pFcf: number | null;
  evEbit: number | null;
}

interface YahooHistoricalPrice {
  date: Date;
  adjClose?: number | null;
  close?: number | null;
}

/**
 * Find the nearest daily price entry within ±15 calendar days of a target date.
 *
 * Prefers adjClose (split-adjusted) over close. Returns null when no entry
 * falls within the tolerance window, which typically means the fiscal year
 * predates the available price history.
 */
function findNearestPrice(
  sortedPrices: YahooHistoricalPrice[],
  targetDate: Date
): number | null {
  const targetMs = targetDate.getTime();
  let nearestPrice: number | null = null;
  let minDistance = Infinity;

  for (const entry of sortedPrices) {
    const distance = Math.abs(entry.date.getTime() - targetMs);

    if (distance > FIFTEEN_DAYS_MS) {
      // Prices are sorted ascending; once we pass the window, early-exit
      if (entry.date.getTime() > targetMs + FIFTEEN_DAYS_MS) break;
      continue;
    }

    if (distance < minDistance) {
      minDistance = distance;
      const adj = typeof entry.adjClose === "number" && entry.adjClose > 0 ? entry.adjClose : null;
      const raw = typeof entry.close === "number" && entry.close > 0 ? entry.close : null;
      nearestPrice = adj ?? raw;
    }
  }

  return nearestPrice;
}

/**
 * Compute historical multiples for each fiscal year in the fundamentals time series.
 *
 * @param fundamentals - Raw fundamentalsTimeSeries result from Yahoo (may include TYPE:UNKNOWN records)
 * @param historicalPrices - Daily OHLCV data sorted by date ascending
 * @param sharesOutstanding - Current shares outstanding (used as proxy for all years)
 * @param currentNetDebt - Current net debt used for EV calculation across all years
 * @returns Array sorted by year ascending, ready for chart rendering
 */
export function computeHistoricalMultiples(
  fundamentals: any[],
  historicalPrices: YahooHistoricalPrice[],
  sharesOutstanding: number,
  currentNetDebt: number,
): HistoricalMultiplesDataPoint[] {
  // Filter out TYPE:UNKNOWN records and entries without a valid fiscal year date
  const validEntries = fundamentals.filter(
    (e) => e.totalRevenue != null && e.date instanceof Date
  );

  // Sort prices ascending once — used for the nearest-price binary window scan
  const sortedPrices = [...historicalPrices].sort((a, b) => a.date.getTime() - b.date.getTime());

  const dataPoints: HistoricalMultiplesDataPoint[] = [];

  for (const entry of validEntries) {
    const fiscalYearEnd: Date = entry.date;
    const price = findNearestPrice(sortedPrices, fiscalYearEnd);

    // Skip fiscal years with no matching price in history
    if (price === null || price <= 0) continue;
    if (sharesOutstanding <= 0) continue;

    const netIncome: number | null = typeof entry.netIncome === "number" ? entry.netIncome : null;
    const freeCashFlow: number | null = typeof entry.freeCashFlow === "number" ? entry.freeCashFlow : null;
    // EBIT field is uppercase in Yahoo's fundamentalsTimeSeries
    const ebit: number | null =
      typeof entry.EBIT === "number" ? entry.EBIT
      : typeof entry.operatingIncome === "number" ? entry.operatingIncome
      : null;

    // P/E: only meaningful for positive earnings (negative EPS has no valuation meaning)
    const eps = netIncome !== null ? netIncome / sharesOutstanding : null;
    const pe = eps !== null && eps > 0 ? price / eps : null;

    // P/FCF: only meaningful for positive free cash flow
    const fcfPerShare = freeCashFlow !== null ? freeCashFlow / sharesOutstanding : null;
    const pFcf = fcfPerShare !== null && fcfPerShare > 0 ? price / fcfPerShare : null;

    // EV/EBIT: uses current netDebt as proxy for historical net debt
    const marketCap = price * sharesOutstanding;
    const ev = marketCap + currentNetDebt;
    const evEbit = ebit !== null && ebit > 0 ? ev / ebit : null;

    dataPoints.push({
      year: fiscalYearEnd.getUTCFullYear(),
      fiscalYearEnd: fiscalYearEnd.toISOString(),
      price,
      pe,
      pFcf,
      evEbit,
    });
  }

  // Return in chronological order for left-to-right chart rendering
  return dataPoints.sort((a, b) => a.year - b.year);
}
