// POST /api/ai/analyze — streams a Claude-generated investment analysis report.
//
// Design notes:
// - Requires auth: only logged-in users can consume API credits
// - Re-runs DCF server-side to get fair values — we don't accept pre-computed
//   numbers from the client to prevent prompt injection of arbitrary price targets
// - Streams text/plain chunks as Claude generates them for immediate feedback
// - Web search is enabled via Anthropic's built-in web_search_20250305 tool
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getQuote, getFundamentals, getNetDebtEstimate, getAnalystEstimates } from "@/lib/yahoo-client";
import { runDcf } from "@/lib/valuation/dcf";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts";

const scenarioSchema = z.object({
  revenueGrowthYears1to5: z.number().min(-0.5).max(0.6),
  revenueGrowthYears6to10: z.number().min(-0.5).max(0.4),
  operatingMarginTarget: z.number().min(0).max(0.8),
  taxRate: z.number().min(0).max(0.6),
  reinvestmentRate: z.number().min(0).max(0.9),
  wacc: z.number().min(0.03).max(0.3),
  terminalGrowth: z.number().min(-0.02).max(0.06),
});

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  mosPercent: z.number().min(0).max(80),
  scenarios: z.object({
    bull: scenarioSchema,
    base: scenarioSchema,
    bear: scenarioSchema,
  }),
  // Language for the report — e.g. "English", "Italiano", "Español"
  language: z.string().min(1).max(30).default("English"),
});

export async function POST(request: Request) {
  // Auth check: streaming AI analysis requires a logged-in user.
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Fetch market data and run DCF in parallel for speed.
    const [quote, fundamentals, netDebt, analystData] = await Promise.all([
      getQuote(body.ticker),
      getFundamentals(body.ticker),
      getNetDebtEstimate(body.ticker),
      getAnalystEstimates(body.ticker).catch(() => null),
    ]);

    const latestPoint = fundamentals.annual[0];
    if (!latestPoint || latestPoint.revenue <= 0) {
      return NextResponse.json({ error: "Missing revenue data." }, { status: 422 });
    }

    const sharesOutstanding = quote.sharesOutstanding;
    if (!sharesOutstanding || sharesOutstanding <= 0) {
      return NextResponse.json({ error: "Missing shares outstanding." }, { status: 422 });
    }

    // Run DCF server-side — ensures the price targets in the prompt are genuine.
    const dcfBase = {
      currentRevenue: latestPoint.revenue,
      netDebt,
      sharesOutstanding,
      currentPrice: quote.regularMarketPrice,
      mosPercent: body.mosPercent,
    };

    const bull = runDcf({ ...dcfBase, scenario: body.scenarios.bull });
    const base = runDcf({ ...dcfBase, scenario: body.scenarios.base });
    const bear = runDcf({ ...dcfBase, scenario: body.scenarios.bear });

    const analystEstimates = analystData ?? null;

    const systemPrompt = buildSystemPrompt(body.language);
    const userPrompt = buildUserPrompt({
      ticker: body.ticker,
      quote,
      analystEstimates,
      bull,
      base,
      bear,
      mosPercent: body.mosPercent,
      language: body.language,
    });

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Stream the response back to the client as plain text chunks.
    // Using text/plain streaming (not SSE) for simplicity — the client reads raw chunks.
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Claude Sonnet 4.6 with web search enabled for up-to-date information.
          const stream = client.messages.stream({
            model: "claude-sonnet-4-6",
            // 4096 was too low for full reports (especially non-English + web search).
            // Sonnet 4.6 supports up to 64K output tokens; 16000 covers any report length.
            max_tokens: 16000,
            system: systemPrompt,
            tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
            messages: [{ role: "user", content: userPrompt }],
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
            }
          }
        } catch (streamErr) {
          const msg = streamErr instanceof Error ? streamErr.message : "AI error";
          controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${msg}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
