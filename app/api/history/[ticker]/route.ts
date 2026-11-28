import { NextResponse } from "next/server";
import { z } from "zod";

import { getCachedPriceHistory } from "@/lib/price-history";
import { tickerSchema } from "@/lib/ticker";

type RouteContext = { params: Promise<{ ticker: string }> };

const rangeSchema = z.enum(["1y", "5y"]).default("1y");

/** A malformed escape (`%E0%A4%A`) is an invalid ticker, not a 500. */
function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * GET /api/history/[ticker]?range=1y|5y
 *
 * Daily closes of a ticker from Yahoo Finance, cached in memory for an hour. Public, like
 * /api/quote: market data, nothing of a user's. Being public is why the ticker is
 * validated before it becomes a cache key or reaches Yahoo.
 *
 * Returns:
 * - 200: PriceHistory ({ ticker, currency, range, points: [{ date, close }] })
 * - 400: invalid ticker or range, or a Yahoo error (unknown symbol)
 * - 503: rate limit reached (retry after 30-60 seconds)
 */
export async function GET(request: Request, context: RouteContext) {
  const params = await context.params;
  const decoded = safeDecode(params.ticker);
  const ticker = decoded == null ? null : tickerSchema.safeParse(decoded);
  if (!ticker?.success) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }
  const range = rangeSchema.safeParse(new URL(request.url).searchParams.get("range") ?? undefined);
  if (!range.success) {
    return NextResponse.json({ error: "Invalid range: use 1y or 5y." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getCachedPriceHistory(ticker.data, range.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch price history.";
    // 503 for a rate limit, so a client can tell a retriable error from a wrong ticker.
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
