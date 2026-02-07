/**
 * DCF Valuation API Route
 *
 * This endpoint runs a 3-scenario (Bull/Base/Bear) discounted cash flow valuation
 * for a given ticker. It validates user inputs with Zod schemas, fetches market data
 * from Yahoo Finance, and returns fair value estimates with margin of safety applied.
 *
 * Input validation constraints:
 * - Revenue growth: -50% to +60% (years 1-5), -50% to +40% (years 6-10)
 * - Operating margin: 0% to 80%
 * - WACC: 3% to 30%
 * - Terminal growth: -2% to 6%
 * - Margin of safety: 0% to 80%
 *
 * NOTE: If you modify scenarioSchema constraints, update:
 * - Default presets in lib/valuation/scenario-presets.ts
 * - Frontend validation in components/scenario-panel.tsx
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { runDcf } from "@/lib/valuation/dcf";
import { getFundamentals, getNetDebtEstimate, getQuote } from "@/lib/yahoo-client";
import { ScenarioName } from "@/types/valuation";

const scenarioSchema = z.object({
  revenueGrowthYears1to5: z.number().min(-0.5).max(0.6),
  revenueGrowthYears6to10: z.number().min(-0.5).max(0.4),
  operatingMarginTarget: z.number().min(0).max(0.8),
  taxRate: z.number().min(0).max(0.6),
  reinvestmentRate: z.number().min(0).max(0.9),
  wacc: z.number().min(0.03).max(0.3),
  terminalGrowth: z.number().min(-0.02).max(0.06)
});

const requestSchema = z.object({
  mosPercent: z.number().min(0).max(80),
  sharesOutstandingOverride: z.number().positive().optional(),
  scenarios: z.object({
    bull: scenarioSchema,
    base: scenarioSchema,
    bear: scenarioSchema
  })
});

/**
 * Classifies valuation status based on base scenario upside percentage.
 *
 * Uses 15% threshold to create a "gray zone" around fair value:
 * - >15% upside: undervalued (worth buying with margin of safety)
 * - -15% to +15%: fair (close to intrinsic value)
 * - <-15% downside: overvalued (avoid or sell)
 *
 * The 15% threshold accounts for model uncertainty and transaction costs.
 */
function getStatus(baseUpsideAfterMos: number): "undervalued" | "fair" | "overvalued" {
  if (baseUpsideAfterMos > 15) {
    return "undervalued";
  }

  if (baseUpsideAfterMos < -15) {
    return "overvalued";
  }

  return "fair";
}

type RouteContext = { params: Promise<{ ticker: string }> };

/**
 * POST /api/valuation/[ticker]
 *
 * Runs a multi-scenario DCF valuation with user-provided scenario inputs.
 *
 * Request body:
 * - mosPercent: Margin of safety (0-80%)
 * - sharesOutstandingOverride: Optional manual shares outstanding override
 * - scenarios: Bull/Base/Bear scenario inputs (growth, margins, WACC, etc.)
 *
 * Returns:
 * - 200: Valuation results with fair values and upside percentages
 * - 400: Invalid input payload (Zod validation errors)
 * - 422: Missing required financial data (revenue, shares outstanding)
 * - 503: Yahoo Finance rate limit
 *
 * Example: POST /api/valuation/AAPL
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    // Parse and validate request payload
    const params = await context.params;
    const body = await request.json();
    const payload = requestSchema.parse(body);

    // Fetch market data in parallel for speed
    const [quote, fundamentals, netDebt] = await Promise.all([
      getQuote(params.ticker),
      getFundamentals(params.ticker),
      getNetDebtEstimate(params.ticker)
    ]);

    // Validate required fundamental data
    const latestPoint = fundamentals.annual[0];
    if (!latestPoint || latestPoint.revenue <= 0) {
      return NextResponse.json({ error: "Missing revenue data for valuation." }, { status: 422 });
    }

    // Use manual override if provided, otherwise use Yahoo Finance data
    // Some non-US tickers don't expose shares outstanding via Yahoo API
    const sharesOutstanding = payload.sharesOutstandingOverride ?? quote.sharesOutstanding;
    if (!sharesOutstanding || sharesOutstanding <= 0) {
      return NextResponse.json({ error: "Missing shares outstanding." }, { status: 422 });
    }

    // Run DCF valuation for all three scenarios
    const scenarioNames: ScenarioName[] = ["bull", "base", "bear"];
    const scenarios = {
      bull: runDcf({
        currentRevenue: latestPoint.revenue,
        netDebt,
        sharesOutstanding,
        currentPrice: quote.regularMarketPrice,
        mosPercent: payload.mosPercent,
        scenario: payload.scenarios.bull
      }),
      base: runDcf({
        currentRevenue: latestPoint.revenue,
        netDebt,
        sharesOutstanding,
        currentPrice: quote.regularMarketPrice,
        mosPercent: payload.mosPercent,
        scenario: payload.scenarios.base
      }),
      bear: runDcf({
        currentRevenue: latestPoint.revenue,
        netDebt,
        sharesOutstanding,
        currentPrice: quote.regularMarketPrice,
        mosPercent: payload.mosPercent,
        scenario: payload.scenarios.bear
      })
    };

    // Sanity check: ensure all fair values are valid numbers
    // Catches edge cases like division by zero or NaN propagation
    for (const name of scenarioNames) {
      if (!Number.isFinite(scenarios[name].fairValueAfterMos)) {
        return NextResponse.json({ error: `Invalid output for ${name} scenario.` }, { status: 422 });
      }
    }

    // Return valuation results with status classification
    return NextResponse.json({
      ticker: quote.ticker,
      currentPrice: quote.regularMarketPrice,
      mosPercent: payload.mosPercent,
      scenarios,
      summary: {
        status: getStatus(scenarios.base.upsideVsPricePercent),
        baseScenarioUpsideAfterMos: scenarios.base.upsideVsPricePercent
      }
    });
  } catch (error) {
    // Return detailed field-level errors for Zod validation failures
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid valuation payload.", details: error.flatten() }, { status: 400 });
    }

    // Return 503 for rate limits so clients can retry, 400 for other errors
    const message = error instanceof Error ? error.message : "Unable to run valuation.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
