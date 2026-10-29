// POST /api/ai/deep-value — fully autonomous AI valuation.
// Claude picks the method, finds all financial data via web search, then streams the
// full Markdown report followed by a closing JSON block (fair values, sensitivity,
// dividend path). Research chatter before the report's start marker never reaches the
// client (lib/ai/stream-gate.ts).
// No Yahoo Finance fundamentals call — only a quote for the current price.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import {
  buildDeepValueSystemPrompt,
  buildDeepValueUserPrompt,
} from "@/lib/ai/deep-value-prompts";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { createStreamGate } from "@/lib/ai/stream-gate";
import { REPORT_START_MARKER, stripTrailingOpenJsonFence } from "@/lib/report/parse-deep-value-json";
import { resolveAiSettings, aiModelIdSchema } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop, DEEP_RESEARCH_MAX_TOOL_ITERATIONS, GROUNDED_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import { fallbackNote } from "@/lib/ai/fallback";
import { routeErrorStatus } from "@/lib/ai/error-status";
import { AI_EFFORT_LEVELS, deepValueDefaultEffort, type AiSettings } from "@/types/ai-settings";
import { groundingPayloadSchema } from "@/lib/grounding/schema";
import { buildGroundingPromptContext, type GroundingPromptContext } from "@/lib/grounding/prompt-format";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

// Vercel's builder rejects any maxDuration above what the *currently deployed* plan
// allows: Hobby with Fluid Compute caps it at 300 (see SETUP.md's maxDuration table), so
// 800 (the Pro ceiling) fails to build on Hobby. A run past 300s is a declared limit of
// the project, run from localhost (2026-10-20). Bump this to 800 only after upgrading to
// Pro. Same value and reason as the verify route; declared here too since 2026-10-29, so the
// limit is visible in the code rather than left to the platform default.
export const maxDuration = 300;

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mosPercent: z.number().min(0).max(80).default(0),
  model: aiModelIdSchema.optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
  // Grounded mode: the client sends only blocks + the confirmed extract; the route
  // recomputes stats/grid/marketImplied/warnings itself from `extract` and its own
  // authoritative currentPrice — never trusting client-sent copies (smaller body, one
  // source of truth).
  grounding: groundingPayloadSchema.optional(),
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

  try {
    const quote = await getQuote(body.ticker);
    const currentPrice = quote.regularMarketPrice;
    const currency = quote.currency ?? "USD";

    // Inject the real current date so Claude doesn't assume it's still in its training year.
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Grounded mode: recompute the deterministic anchors server-side from the client's
    // confirmed extract + our own authoritative currentPrice/currency (never the
    // client's own stats/grid/marketImplied — single source of truth).
    let groundingContext: GroundingPromptContext | undefined;
    if (body.grounding) {
      groundingContext = buildGroundingPromptContext(body.grounding.blocks, body.grounding.extract, currentPrice, currency);
    }

    // The valuation is always independent/position-blind — no portfolio position or
    // prior estimate is ever injected into the prompt, so the fair values can't be
    // anchored to what the user paid or to a previous run. Position-aware hold/exit
    // reasoning happens separately in the Advisor; estimate evolution is shown as a
    // deterministic diff on /analyses (never fed back into a prompt).
    const systemPrompt = buildDeepValueSystemPrompt({ language: body.language, currentDate, mosPercent: body.mosPercent, grounding: groundingContext });
    const userPrompt = buildDeepValueUserPrompt({ ticker: body.ticker, currentPrice, currency, language: body.language, currentDate, mosPercent: body.mosPercent, grounding: groundingContext });

    // An override without an effort is not a complete override: resolveAiSettings then
    // reads the user's stored default, which the Deep Value floor below starts from.
    let aiSettings = await resolveAiSettings(
      session.user.id,
      body.model ? { model: body.model, effort: body.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking } : undefined,
      DEFAULT_SETTINGS
    );
    // No effort chosen for this run: a valuation starts at the higher of the global
    // default and xhigh, stepping down to what the model supports (types/ai-settings.ts).
    if (body.effort == null) {
      aiSettings = { ...aiSettings, effort: deepValueDefaultEffort(aiSettings.model, aiSettings.effort) };
    }
    const thinkingParam = buildThinkingParam(aiSettings.thinking, aiSettings.model, aiSettings.effort);
    const client = getAiClient(aiSettings.model);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Text before the report marker is reasoning the model writes between web
          // search calls: dropped. `forwarded` mirrors what reached the client, so a
          // cut-off run can tell whether it stopped inside the closing JSON block.
          const gate = createStreamGate(REPORT_START_MARKER);
          let forwarded = "";
          const forward = (text: string) => {
            if (!text) return;
            forwarded += text;
            controller.enqueue(new TextEncoder().encode(text));
          };

          const { stopReason, hitIterationCap, servedBy } = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              // Streaming, so a large ceiling can't hit HTTP timeouts (Opus 4.8 allows up
              // to 128k). 64k gives ample room for xhigh adaptive thinking + the full
              // 10-section report + the closing JSON block without truncation. max_tokens is
              // a cap, not a target — the model generates only what it needs, so this
              // doesn't raise cost.
              max_tokens: 64000,
              thinking: thinkingParam,
              output_config: buildEffortConfig(aiSettings.effort),
              system: systemPrompt,
              tools: buildWebSearchTools(aiSettings.model),
              messages: [{ role: "user", content: userPrompt }],
            },
            (text) => forward(gate.push(text)),
            // Deep Value's prompt (ANALYTICAL_RIGOR_BLOCK: ~5y financials, quality
            // metrics, historical multiples, comparables, EV→equity bridge, reverse
            // check) needs far more research rounds than Advisor's default cap —
            // reproduced in production (2026-07-10) with DeepSeek: the default 10 was hit
            // mid-research, discarding everything silently (nothing had reached the
            // start of the report yet) and returning an empty report with no error. See the
            // shared constant for why it's 35. Grounded mode rescopes (not eliminates)
            // web search to just the post-coverage-date update + qualitative material,
            // so it converges in far fewer rounds — GROUNDED_MAX_TOOL_ITERATIONS.
            body.grounding ? GROUNDED_MAX_TOOL_ITERATIONS : DEEP_RESEARCH_MAX_TOOL_ITERATIONS
          );

          // Failsafe: if the model never wrote the report marker (e.g. still researching
          // when the iteration cap hit, or it opened straight into prose), flush the
          // buffered text so the run isn't silently swallowed — and say so in the log.
          const rest = gate.flush();
          forward(rest);
          if (!gate.opened()) console.warn("[deep-value] report marker never arrived; flushed", rest.length);

          const isItalian = body.language === "Italiano" || body.language === "Italian";
          // Surface a token-cap cut or a safety-classifier decline (HTTP 200,
          // stop_reason "refusal") instead of ending on a partial or empty report.
          if (stopReason === "max_tokens") {
            // A cut inside the closing JSON block leaves its fence open: close it, so the
            // parser returns null on the broken block and stripJsonBlock hides it, while
            // the note below stays visible.
            if (stripTrailingOpenJsonFence(forwarded) !== forwarded) forward("\n```\n");
            const note = isItalian
              ? "\n\n_[Analisi troncata: raggiunto il limite di lunghezza. Riavviala per rigenerarla.]_"
              : "\n\n_[Analysis truncated: length limit reached. Re-run it to regenerate.]_";
            controller.enqueue(new TextEncoder().encode(note));
          } else if (stopReason === "refusal") {
            const note = isItalian
              ? "\n\n_[Il modello ha rifiutato questa analisi. Riavviala o scegli un altro modello.]_"
              : "\n\n_[The model declined this analysis. Re-run it or pick another model.]_";
            controller.enqueue(new TextEncoder().encode(note));
          } else if (hitIterationCap) {
            const note = isItalian
              ? "\n\n_[Analisi interrotta: troppi cicli di ricerca web. Riprova, magari con un margine di sicurezza diverso.]_"
              : "\n\n_[Analysis stopped: too many web search rounds. Try again, maybe with a different margin of safety.]_";
            controller.enqueue(new TextEncoder().encode(note));
          }
          // The server-side refusal fallback (Sonnet 5.5) wrote this report with another
          // model: say which, so the saved report is not attributed to the requested one.
          if (servedBy) {
            controller.enqueue(new TextEncoder().encode(`\n\n${fallbackNote(aiSettings.model, servedBy, isItalian)}`));
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
        // The settings this run actually uses (stored default, Deep Value floor, model
        // clamp all applied), so the client saves them with the analysis instead of
        // what it asked for.
        "X-AI-Settings": JSON.stringify({ model: aiSettings.model, effort: aiSettings.effort, thinking: thinkingParam.type !== "disabled" }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    const status = routeErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
