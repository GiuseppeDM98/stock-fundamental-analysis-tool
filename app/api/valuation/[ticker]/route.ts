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

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const body = await request.json();
    const payload = requestSchema.parse(body);

    const [quote, fundamentals, netDebt] = await Promise.all([
      getQuote(params.ticker),
      getFundamentals(params.ticker),
      getNetDebtEstimate(params.ticker)
    ]);

    const latestPoint = fundamentals.annual[0];
    if (!latestPoint || latestPoint.revenue <= 0) {
      return NextResponse.json({ error: "Missing revenue data for valuation." }, { status: 422 });
    }

    const sharesOutstanding = payload.sharesOutstandingOverride ?? quote.sharesOutstanding;
    if (!sharesOutstanding || sharesOutstanding <= 0) {
      return NextResponse.json({ error: "Missing shares outstanding." }, { status: 422 });
    }

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

    for (const name of scenarioNames) {
      if (!Number.isFinite(scenarios[name].fairValueAfterMos)) {
        return NextResponse.json({ error: `Invalid output for ${name} scenario.` }, { status: 422 });
      }
    }

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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid valuation payload.", details: error.flatten() }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to run valuation.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
