import { NextResponse } from "next/server";

import { getQuote } from "@/lib/yahoo-client";

type RouteContext = { params: Promise<{ ticker: string }> };

/**
 * GET /api/quote/[ticker]
 *
 * Fetches real-time quote data for a given ticker symbol from Yahoo Finance.
 *
 * Returns:
 * - 200: Quote data (ticker, price, market cap, shares outstanding, region)
 * - 400: Invalid ticker or Yahoo Finance error
 * - 503: Rate limit reached (retry after 30-60 seconds)
 *
 * Example: GET /api/quote/AAPL
 */
export async function GET(_: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const quote = await getQuote(params.ticker);
    return NextResponse.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch quote.";

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
