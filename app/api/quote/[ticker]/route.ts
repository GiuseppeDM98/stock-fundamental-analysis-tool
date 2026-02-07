import { NextResponse } from "next/server";

import { getQuote } from "@/lib/yahoo-client";

type RouteContext = { params: Promise<{ ticker: string }> };

export async function GET(_: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const quote = await getQuote(params.ticker);
    return NextResponse.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch quote.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
