/**
 * GET /api/macro/risk-free-rate
 *
 * Returns the current US 10-Year Treasury yield as a risk-free rate proxy.
 *
 * This endpoint exists to provide context for WACC estimation in the UI.
 * The risk-free rate is not used directly in DCF calculations — it is
 * informational only, helping users set a sensible WACC relative to
 * current market conditions (WACC should exceed Rf by the equity risk premium).
 *
 * Data source: ^TNX via Yahoo Finance (same provider as stock data).
 * No ticker parameter — always fetches the US 10Y rate.
 */
import { NextResponse } from "next/server";

import { getRiskFreeRate } from "@/lib/yahoo-client";

export async function GET() {
  const result = await getRiskFreeRate();

  if (result === null) {
    return NextResponse.json(
      { error: "Risk-free rate temporarily unavailable." },
      { status: 503 }
    );
  }

  return NextResponse.json(result);
}
