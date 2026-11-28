// POST /api/ai/advisor — streaming AI portfolio advisor chat.
// Fetches the user's positions and saved analyses, sums each ticker up in code
// (lib/stocks/ticker-summary.ts), injects the summaries as context into the system
// prompt, then streams a Claude response.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuote } from "@/lib/yahoo-client";
import { buildAdvisorSystemPrompt, buildAdvisorUserPrompt, buildDiscoverySystemPrompt } from "@/lib/ai/advisor-prompts";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { resolveAiSettings, aiModelIdSchema } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop } from "@/lib/ai/tool-loop";
import { fallbackNote } from "@/lib/ai/fallback";
import { routeErrorStatus } from "@/lib/ai/error-status";
import { ANALYSIS_SUMMARY_SELECT } from "@/lib/analyses-select";
import { latestAnalysisWithValues } from "@/lib/report/latest-analysis";
import { buildTickerSummary } from "@/lib/stocks/ticker-summary";
import { AI_EFFORT_LEVELS, type AiSettings } from "@/types/ai-settings";
import type { SavedAnalysis } from "@/types/analysis";
import type { EarningsConfidence } from "@/types/earnings";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-sonnet-5-5", effort: "high", thinking: true };

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mode: z.enum(["portfolio", "discovery"]).default("portfolio"),
  model: aiModelIdSchema.optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Ensure the last message is from the user.
  if (body.messages[body.messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Last message must be from user" }, { status: 400 });
  }

  try {
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let systemPrompt: string;

    if (body.mode === "discovery") {
      systemPrompt = buildDiscoverySystemPrompt({ currentDate, language: body.language });
    } else {
      const userId = session.user.id;
      // Fetch portfolio context in parallel — only fields needed for the prompt.
      // Open lots only (2026-10-28): a sold lot sent as "held" made the Advisor reason about
      // shares the user no longer owns; realized history is not hold/add/exit context.
      const [positions, analysisRows, watchlistItems, earningsEstimates] = await Promise.all([
        db.position.findMany({
          where: { userId, closedAt: null },
          orderBy: { purchasedAt: "desc" },
          select: {
            ticker: true,
            companyName: true,
            shares: true,
            purchasePrice: true,
            currency: true,
            purchasedAt: true,
          },
        }),
        db.analysis.findMany({
          // Finished analyses only: a run in progress or cut has no valuation (2026-10-27).
          where: { userId, runStatus: "done" },
          orderBy: { createdAt: "desc" },
          // The numbers without the text blobs: the prompt gets one computed line per
          // ticker, never a report or a critique.
          select: ANALYSIS_SUMMARY_SELECT,
        }),
        // One query each for the whole user, not one per ticker.
        db.watchlistItem.findMany({ where: { userId }, select: { ticker: true, mosPercent: true } }),
        db.earningsEstimate.findMany({
          where: { userId },
          select: { ticker: true, nextEarningsDate: true, confidence: true, fetchedAt: true },
        }),
      ]);

      // Group by ticker, newest first as the query returned them. Dates go to ISO strings,
      // the shape SavedAnalysis has over the wire and the pure helpers read.
      const analysesByTicker = new Map<string, SavedAnalysis[]>();
      for (const row of analysisRows) {
        const analysis = {
          ...row,
          createdAt: row.createdAt.toISOString(),
          runStartedAt: row.runStartedAt ? row.runStartedAt.toISOString() : null,
        } as unknown as SavedAnalysis;
        analysesByTicker.set(row.ticker, [...(analysesByTicker.get(row.ticker) ?? []), analysis]);
      }
      const lotsByTicker = new Map<string, typeof positions>();
      for (const p of positions) lotsByTicker.set(p.ticker, [...(lotsByTicker.get(p.ticker) ?? []), p]);
      const watchlistByTicker = new Map(watchlistItems.map((w) => [w.ticker, w]));
      const earningsByTicker = new Map(earningsEstimates.map((e) => [e.ticker, e]));

      // Fetch authoritative live prices and inject them as ground truth. Without this the
      // model has no current price in context (only the purchase price) and fills the gap
      // from a stale web quote or memory — the real failure that reported a price of 2.28
      // for a stock actually trading at 2.16. Quoted: every open position, and every ticker
      // whose analysis carries values, since a verdict needs a price (until 2026-11-28 only
      // the owned ones, so an analysed-only ticker had fair values and nothing to weigh
      // them against). Best-effort: Yahoo can 429 (known issue), so a failed quote for one
      // ticker must not abort the reply — allSettled keeps the others.
      const valuedTickers = [...analysesByTicker].filter(([, group]) => latestAnalysisWithValues(group) != null).map(([t]) => t);
      const quotedTickers = [...new Set([...positions.map((p) => p.ticker), ...valuedTickers])];
      const quoteResults = await Promise.allSettled(quotedTickers.map((t) => getQuote(t)));
      // Keyed by the ticker ASKED, not the symbol Yahoo answers with: the summaries look
      // the quote up by the ticker the rows are saved under.
      const livePrices = quoteResults.flatMap((r, i) =>
        r.status === "fulfilled"
          ? [{
              ticker: quotedTickers[i],
              price: r.value.regularMarketPrice,
              currency: r.value.currency,
              changePercent: r.value.regularMarketChangePercent,
            }]
          : [],
      );
      const quoteByTicker = new Map(livePrices.map((lp) => [lp.ticker, lp]));

      // One summary per ticker the user analysed, then per ticker held with no analysis
      // (it reads "no valuation": the Advisor still knows the holding has none).
      const summaryTickers = [...new Set([...analysesByTicker.keys(), ...lotsByTicker.keys()])];
      const summaries = summaryTickers.map((ticker) => {
        const lots = lotsByTicker.get(ticker) ?? [];
        const earnings = earningsByTicker.get(ticker);
        return buildTickerSummary({
          ticker,
          analyses: analysesByTicker.get(ticker) ?? [],
          price: quoteByTicker.get(ticker)?.price ?? null,
          currency: quoteByTicker.get(ticker)?.currency ?? null,
          positions: lots,
          // One currency for the holding, or none when the lots mix currencies (no P&L then).
          positionCurrency: lots.length > 0 && lots.every((l) => l.currency === lots[0].currency) ? lots[0].currency : null,
          watchlistItem: watchlistByTicker.get(ticker) ?? null,
          earnings: earnings
            ? {
                nextEarningsDate: earnings.nextEarningsDate ? earnings.nextEarningsDate.toISOString() : null,
                confidence: earnings.confidence as EarningsConfidence,
                fetchedAt: earnings.fetchedAt.toISOString(),
              }
            : null,
          // Dividends are not hold/add/exit context the prompt carries yet.
          dividendsReceivedEur: null,
        });
      });

      systemPrompt = buildAdvisorSystemPrompt({
        positions,
        summaries,
        livePrices,
        currentDate,
        language: body.language,
      });
    }

    // Map chat history: all messages except the last go as conversation history;
    // the last user message is sent as the final turn.
    const anthropicMessages = body.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: buildAdvisorUserPrompt(m.content),
    }));

    // An effort named without a model applies to the stored model (until 2026-10-29 it was
    // silently dropped, as in the Deep Value routes).
    const aiSettings = await resolveAiSettings(
      session.user.id,
      body.model
        ? { model: body.model, effort: body.effort ?? DEFAULT_SETTINGS.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking }
        : body.effort
          ? { effort: body.effort, thinking: body.thinking }
          : undefined,
      DEFAULT_SETTINGS
    );
    const client = getAiClient(aiSettings.model);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const { stopReason, hitIterationCap, servedBy } = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              // Headroom for adaptive thinking + web-search reasoning, which count
              // toward max_tokens alongside the visible answer. At 4096 a long
              // multi-candidate Discovery reply (thinking + several web searches +
              // prose) exhausted the budget and got cut off mid-word with
              // stop_reason "max_tokens". This is a ceiling, not a target — the model
              // still stops at end_turn, so normal replies cost the same.
              max_tokens: 16000,
              thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model),
              output_config: buildEffortConfig(aiSettings.effort),
              system: systemPrompt,
              tools: buildWebSearchTools(aiSettings.model),
              messages: anthropicMessages,
            },
            (text) => controller.enqueue(new TextEncoder().encode(text))
          );

          // Surface a hard token-cap cutoff instead of truncating silently — a
          // clean mid-word cut with no marker is indistinguishable from a normal
          // end for the user. See DEVELOPMENT_GUIDELINES: never swallow failures.
          if (stopReason === "max_tokens") {
            const note = body.language === "Italian"
              ? "_[Risposta troncata: raggiunto il limite di lunghezza.]_"
              : "_[Response truncated: length limit reached.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          } else if (stopReason === "refusal") {
            // A safety classifier declined the turn: HTTP 200, stop_reason "refusal",
            // little or no text. Say so instead of ending on an empty reply.
            const note = body.language === "Italian"
              ? "_[Il modello ha rifiutato questa richiesta. Riformulala o scegli un altro modello.]_"
              : "_[The model declined this request. Rephrase it or pick another model.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          } else if (hitIterationCap) {
            // The DeepSeek custom web_search tool loop (lib/ai/tool-loop.ts) ran out of
            // rounds while still researching — surface it instead of returning silence.
            const note = body.language === "Italian"
              ? "_[Ricerca interrotta: troppi cicli di ricerca web. Riprova con una domanda più mirata.]_"
              : "_[Research stopped: too many web search rounds. Try a more specific question.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          }
          // The server-side refusal fallback (Sonnet 5.5) answered with another model:
          // name it, since the selector still shows the one that was requested.
          if (servedBy) {
            const note = fallbackNote(aiSettings.model, servedBy, body.language === "Italian");
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
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
    const message = error instanceof Error ? error.message : "Advisor request failed";
    const status = routeErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
