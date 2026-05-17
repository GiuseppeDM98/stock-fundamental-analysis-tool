import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { analyzeTickerLite } from "@/lib/ai/lite-analysis";
import { db } from "@/lib/db";
import { z } from "zod";

const bodySchema = z.object({
  tickers: z.array(z.string().min(1).max(20)).min(1).max(5),
});

/**
 * POST /api/compare/analyze
 * Runs AI lite analysis in parallel for up to 5 tickers, then upserts each
 * result into CompareResult so the user can return later without re-running.
 * Requires authentication — each ticker invokes Claude with web_search.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { tickers } = body.data;
  const userId = session.user.id;

  // Run all analyses in parallel — each takes ~10–20s with web_search
  const analysisResults = await Promise.all(
    tickers.map(async (ticker) => {
      const result = await analyzeTickerLite(ticker);
      return { ticker, result };
    })
  );

  // Persist successful results — upsert so returning users see fresh data
  const now = new Date();
  await Promise.all(
    analysisResults
      .filter(({ result }) => result !== null)
      .map(({ ticker, result }) =>
        db.compareResult.upsert({
          where: { userId_ticker: { userId, ticker } },
          create: {
            userId,
            ticker,
            fairValueBull: result!.fairValueBull,
            fairValueBase: result!.fairValueBase,
            fairValueBear: result!.fairValueBear,
            method: result!.method,
            sector: result!.sector,
            currency: result!.currency,
            analyzedAt: now,
          },
          update: {
            fairValueBull: result!.fairValueBull,
            fairValueBase: result!.fairValueBase,
            fairValueBear: result!.fairValueBear,
            method: result!.method,
            sector: result!.sector,
            currency: result!.currency,
            analyzedAt: now,
          },
        })
      )
  );

  return NextResponse.json({ results: analysisResults });
}
