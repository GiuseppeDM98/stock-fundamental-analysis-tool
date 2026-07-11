// POST /api/ai/deep-value/verify — one independent analyst-panel pass over a completed
// report. A fresh-context Opus pass that reviews the saved Deep Value report through one
// LENS (skeptic / optimist / quality — see `angle`): it stress-tests numbers/assumptions
// and spot-checks figures via web search. It streams a leading JSON block with the
// analyst's OWN bull/base/bear valuation (same MoS-adjusted unit as the base analysis, so
// the base + every analyst can be averaged into a consensus) followed by the plain-Markdown
// critique. The lens only swaps persona/focus in the prompt — path and streaming machinery
// are identical, so all three analysts reuse this one route.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { ANALYST_ANGLES } from "@/types/analysis";
import {
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
} from "@/lib/ai/deep-value-prompts";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { resolveAiSettings } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop, DEEP_RESEARCH_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import { AI_MODEL_IDS, AI_EFFORT_LEVELS, type AiSettings } from "@/types/ai-settings";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  reportMd: z.string().min(1).max(60000),
  language: z.string().min(1).max(30).default("English"),
  // Which analyst lens is reviewing. Defaults to "skeptic" — the original red-team pass —
  // so older clients that omit it keep their existing behavior.
  angle: z.enum(ANALYST_ANGLES as [string, ...string[]]).default("skeptic"),
  // Applied to the analyst's own fair values so its JSON buy targets match the unit
  // of the base analysis (MoS-adjusted) and they can be averaged into a consensus.
  mosPercent: z.number().min(0).max(80).default(0),
  model: z.enum(AI_MODEL_IDS).optional(),
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
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Inject the real current date so Claude doesn't anchor to its training year.
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Fetch the authoritative live price so the reviewer treats it as ground truth
    // instead of "correcting" it with stale web-searched quotes (a real failure mode:
    // it once flagged a correct price as overstated using month-old quotes). Best-effort
    // — if the quote fails (rate limit, delisted), the review proceeds without it.
    let currentPrice: number | undefined;
    let currency = "";
    try {
      const quote = await getQuote(body.ticker);
      currentPrice = quote.regularMarketPrice;
      currency = quote.currency ?? "";
    } catch {
      // Non-fatal — omit the authoritative-price clause and let the review run.
    }

    const angle = body.angle as (typeof ANALYST_ANGLES)[number];
    const systemPrompt = buildAnalystSystemPrompt(angle, body.language, currentDate, body.mosPercent);
    const userPrompt = buildAnalystUserPrompt(angle, body.ticker, body.reportMd, body.language, currentDate, currentPrice, currency, body.mosPercent);

    const aiSettings = await resolveAiSettings(
      session.user.id,
      body.model ? { model: body.model, effort: body.effort ?? DEFAULT_SETTINGS.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking } : undefined,
      DEFAULT_SETTINGS
    );
    const client = getAiClient(aiSettings.model);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Buffer text before the JSON block to suppress reasoning text Claude emits
          // between web-search tool calls; only forward once ```json is seen. Mirrors
          // the Deep Value route now that the reviewer leads with its own valuation JSON.
          let jsonBlockStarted = false;
          let preJsonBuffer = "";

          const { stopReason, hitIterationCap } = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              // 16k was too low: with xhigh adaptive thinking + web search, the reasoning
              // tokens (which count toward max_tokens) consumed almost the whole budget
              // before the visible critique finished, so a real review truncated mid-word
              // with stop_reason "max_tokens". Matched to the Deep Value route's 64k for a
              // wide anti-truncation margin. Ceiling, not target — normal replies still
              // stop at end_turn and cost the same. Streaming, so no HTTP-timeout risk.
              max_tokens: 64000,
              thinking: buildThinkingParam(aiSettings.thinking),
              output_config: buildEffortConfig(aiSettings.effort),
              system: systemPrompt,
              tools: buildWebSearchTools(aiSettings.model),
              messages: [{ role: "user", content: userPrompt }],
            },
            (text) => {
              if (!jsonBlockStarted) {
                preJsonBuffer += text;
                const jsonIdx = preJsonBuffer.indexOf("```json");
                if (jsonIdx !== -1) {
                  jsonBlockStarted = true;
                  controller.enqueue(new TextEncoder().encode(preJsonBuffer.slice(jsonIdx)));
                  preJsonBuffer = "";
                }
                // Silently discard pre-JSON reasoning text.
              } else {
                controller.enqueue(new TextEncoder().encode(text));
              }
            },
            // Matches the Deep Value route's cap (shared constant): this review does
            // comparably web-search-heavy work — spot-checking figures/assumptions plus
            // the structural checks (bridge/minorities, same-basis comparables, scenario
            // vs. sensitivity, anchoring) — so the shared default of 10 was far too tight
            // and tripped the "too many search rounds" cutoff under the client-executed
            // DeepSeek search loop before the review finished.
            DEEP_RESEARCH_MAX_TOOL_ITERATIONS
          );

          // Failsafe: if the model never emitted a JSON fence (e.g. it opened straight
          // into prose), flush the buffered text so the critique is not swallowed.
          if (!jsonBlockStarted && preJsonBuffer) {
            controller.enqueue(new TextEncoder().encode(preJsonBuffer));
          }

          // Surface a hard token-cap cutoff instead of truncating silently — a clean
          // mid-word cut is indistinguishable from a normal end. Mirrors /api/ai/advisor.
          const isItalian = body.language === "Italiano" || body.language === "Italian";
          if (stopReason === "max_tokens") {
            const note = isItalian
              ? "_[Revisione troncata: raggiunto il limite di lunghezza. Riavviala per rigenerarla.]_"
              : "_[Review truncated: length limit reached. Re-run it to regenerate.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          } else if (hitIterationCap) {
            const note = isItalian
              ? "_[Revisione interrotta: troppi cicli di ricerca web. Riavviala per rigenerarla.]_"
              : "_[Review stopped: too many web search rounds. Re-run it to regenerate.]_";
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
    const message = error instanceof Error ? error.message : "Review failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
