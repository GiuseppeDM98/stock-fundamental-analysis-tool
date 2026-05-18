import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

import { computeHistoricalMultiples } from "@/lib/valuation/historical-multiples";
import { extractRawNumber } from "@/lib/yahoo-client";

// Suppress Yahoo Finance survey notices to keep server logs clean
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

type RouteContext = { params: Promise<{ ticker: string }> };

/**
 * GET /api/historical-multiples/[ticker]
 *
 * Fetches 10 years of daily prices and annual fundamentals in parallel,
 * then computes P/E, P/FCF, and EV/EBIT for each fiscal year.
 *
 * EV/EBIT is labeled as such (not EV/EBITDA) because Yahoo's fundamentalsTimeSeries
 * does not expose D&A per fiscal year — see docs/03-historical-multiples.md for context.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { ticker } = await context.params;

  try {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

    // Parallel fetch: 10yr daily prices + annual fundamentals + current stats.
    // chart() replaces the deprecated historical() — map adjclose (lowercase) to adjClose.
    const [chartResult, fundamentals, summary] = await Promise.all([
      yahooFinance.chart(ticker, {
        period1: tenYearsAgo,
        period2: new Date(),
        interval: "1d",
      }),
      yahooFinance.fundamentalsTimeSeries(
        ticker,
        {
          period1: tenYearsAgo,
          period2: new Date(),
          type: "annual",
          module: "all",
        },
        // validateResult: false needed for TYPE:UNKNOWN records from some tickers
        { validateResult: false }
      ),
      yahooFinance.quoteSummary(ticker, {
        modules: ["defaultKeyStatistics"],
      }),
    ]);

    const sharesOutstanding =
      extractRawNumber(summary.defaultKeyStatistics?.sharesOutstanding) ?? 0;
    const netDebt =
      extractRawNumber(summary.defaultKeyStatistics?.netDebt) ?? 0;

    const historicalPrices = (chartResult.quotes ?? []).map((q) => ({
      date: q.date,
      adjClose: q.adjclose ?? null,
      close: q.close ?? null,
    }));

    const dataPoints = computeHistoricalMultiples(
      fundamentals,
      historicalPrices,
      sharesOutstanding,
      netDebt
    );

    return NextResponse.json({ dataPoints });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
