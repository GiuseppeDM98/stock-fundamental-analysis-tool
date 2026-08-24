// GET  /api/earnings          — the user's stored next-earnings estimates (all tickers)
// POST /api/earnings          — run Sonnet 5 + web search for one ticker, upsert & return it
//
// The date comes only from the AI here (Yahoo was dropped because it doesn't refresh the
// field for many Borsa Italiana tickers). Results are persisted so the calendar survives
// reloads without re-running the model — one row per user per ticker (upserted on refresh).
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildEarningsSystemPrompt, buildEarningsUserPrompt } from "@/lib/ai/earnings-prompt";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { resolveAiSettings } from "@/lib/ai/ai-preferences";
import { runCreateWithToolLoop, DEEP_RESEARCH_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import type { AiSettings } from "@/types/ai-settings";
import type { EarningsConfidence, EarningsEstimate } from "@/types/earnings";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-sonnet-5", effort: "medium", thinking: true };

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  companyName: z.string().min(1).max(120),
});

// Shape the model must return (leading/only JSON block).
const aiResultSchema = z.object({
  nextEarningsDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  confidence: z.enum(["confirmed", "estimated", "unknown"]),
  sourceUrl: z.string().url().nullable().catch(null),
});

/** Serialize a Prisma row (Dates) into the API `EarningsEstimate` shape (ISO strings). */
function serialize(row: {
  ticker: string;
  nextEarningsDate: Date | null;
  confidence: string;
  sourceUrl: string | null;
  fetchedAt: Date;
}): EarningsEstimate {
  return {
    ticker: row.ticker,
    nextEarningsDate: row.nextEarningsDate ? row.nextEarningsDate.toISOString() : null,
    confidence: row.confidence as EarningsConfidence,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.earningsEstimate.findMany({
    where: { userId: session.user.id },
    // Mirror every consumed field here — a Prisma select silently drops unlisted columns.
    select: {
      ticker: true,
      nextEarningsDate: true,
      confidence: true,
      sourceUrl: true,
      fetchedAt: true,
    },
  });

  return NextResponse.json({ estimates: rows.map(serialize) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ticker = body.ticker.toUpperCase();

  try {
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const aiSettings = await resolveAiSettings(session.user.id, undefined, DEFAULT_SETTINGS);
    const client = getAiClient(aiSettings.model);

    // Non-streaming: a single small fact. Sonnet 5 rejects temperature and has adaptive
    // thinking on by default; web-search + thinking tokens count toward max_tokens.
    // maxIterations: DeepSeek's web search is client-executed one query at a time (unlike
    // Claude's server-side search, which never surfaces a client tool_use here), so the
    // default 10-round cap could exhaust itself mid-research on a DeepSeek run, returning
    // the last tool_use call instead of a final answer — the route then finds no ```json
    // block and 502s ("AI returned no parseable result"), reproduced in production
    // (2026-08-24). Reuse the same higher cap as Deep Value/verify rather than inventing a
    // separate knob for a route with much lighter research needs — DeepSeek-only in effect.
    const response = await runCreateWithToolLoop(
      client,
      {
        model: aiSettings.model,
        max_tokens: 6000,
        thinking: buildThinkingParam(aiSettings.thinking),
        output_config: buildEffortConfig(aiSettings.effort),
        system: buildEarningsSystemPrompt({ currentDate }),
        tools: buildWebSearchTools(aiSettings.model),
        messages: [{ role: "user", content: buildEarningsUserPrompt({ ticker, companyName: body.companyName }) }],
      },
      DEEP_RESEARCH_MAX_TOOL_ITERATIONS
    );

    // With web search the content array holds several text blocks (reasoning between tool
    // calls + the final answer). Concatenate ALL of them before matching — the first block
    // is usually intermediate reasoning, not the JSON (AGENTS.md gotcha #13).
    const allText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const match = allText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) {
      return NextResponse.json({ error: "AI returned no parseable result." }, { status: 502 });
    }

    const parsed = aiResultSchema.safeParse(JSON.parse(match[1]));
    if (!parsed.success) {
      return NextResponse.json({ error: "AI returned an invalid result shape." }, { status: 502 });
    }

    const row = await db.earningsEstimate.upsert({
      where: { userId_ticker: { userId: session.user.id, ticker } },
      create: {
        userId: session.user.id,
        ticker,
        nextEarningsDate: parsed.data.nextEarningsDate ? new Date(parsed.data.nextEarningsDate) : null,
        confidence: parsed.data.confidence,
        sourceUrl: parsed.data.sourceUrl,
      },
      update: {
        nextEarningsDate: parsed.data.nextEarningsDate ? new Date(parsed.data.nextEarningsDate) : null,
        confidence: parsed.data.confidence,
        sourceUrl: parsed.data.sourceUrl,
        fetchedAt: new Date(),
      },
    });

    return NextResponse.json({ estimate: serialize(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Earnings lookup failed.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
