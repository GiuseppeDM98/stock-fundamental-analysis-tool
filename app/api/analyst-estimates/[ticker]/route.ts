/**
 * Analyst Estimates API Route
 *
 * Returns analyst consensus estimates and company-specific scenario defaults
 * for a given ticker. The smart scenarios are computed from real financial data
 * (historical fundamentals + analyst growth estimates) instead of generic presets.
 *
 * This endpoint is called when the user searches a new ticker so the scenario
 * panel can auto-populate with company-appropriate assumptions.
 */
import { NextResponse } from "next/server";

import { getAnalystEstimates, getFundamentals } from "@/lib/yahoo-client";
import { getCompanyScenarios } from "@/lib/valuation/scenario-presets";

type RouteContext = { params: Promise<{ ticker: string }> };

/**
 * GET /api/analyst-estimates/[ticker]
 *
 * Returns:
 * - 200: Analyst estimates + smart scenarios
 * - 400: Ticker not found or Yahoo Finance error
 * - 503: Yahoo Finance rate limit
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;

    // Fetch analyst estimates and fundamentals in parallel
    const [analystEstimates, fundamentals] = await Promise.all([
      getAnalystEstimates(params.ticker),
      getFundamentals(params.ticker),
    ]);

    const smartScenarios = getCompanyScenarios(fundamentals, analystEstimates);

    return NextResponse.json({
      ticker: params.ticker.toUpperCase(),
      analystEstimates,
      smartScenarios,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch analyst estimates.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
