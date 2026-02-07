import { NextResponse } from "next/server";

import { getFundamentals } from "@/lib/yahoo-client";

type RouteContext = { params: Promise<{ ticker: string }> };

/**
 * GET /api/fundamentals/[ticker]
 *
 * Fetches historical fundamental data for a given ticker symbol from Yahoo Finance.
 * Returns up to 5 years of annual income statement and cash flow data.
 *
 * Returns:
 * - 200: Fundamental data (revenue, operating income, FCF, margins, ratios)
 * - 400: Invalid ticker or Yahoo Finance error
 * - 503: Rate limit reached (retry after 30-60 seconds)
 *
 * Example: GET /api/fundamentals/AAPL
 */
export async function GET(_: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const fundamentals = await getFundamentals(params.ticker);
    return NextResponse.json(fundamentals);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch fundamentals.";

    // Return 503 (Service Unavailable) for rate limits instead of 400
    // so clients can distinguish between retriable errors (rate limit)
    // and permanent errors (invalid ticker)
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
