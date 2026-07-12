// POST /api/ai/deep-value — fully autonomous AI valuation.
// Claude picks the method, finds all financial data via web search,
// and streams a JSON block (fair values) + full Markdown report.
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
import { resolveAiSettings } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop, DEEP_RESEARCH_MAX_TOOL_ITERATIONS, GROUNDED_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import { AI_MODEL_IDS, AI_EFFORT_LEVELS, type AiSettings } from "@/types/ai-settings";
import { groundingPayloadSchema } from "@/lib/grounding/schema";
import { buildGroundingPromptContext, type GroundingPromptContext } from "@/lib/grounding/prompt-format";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mosPercent: z.number().min(0).max(80).default(0),
  model: z.enum(AI_MODEL_IDS).optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
  // Grounded mode: the client sends only blocks + the confirmed extract; the route
  // recomputes stats/grid/marketImplied/warnings itself from `extract` and its own
  // authoritative currentPrice — never trusting client-sent copies (spec §6.3).
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
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
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
    // client's own stats/grid/marketImplied — spec §6.3, single source of truth).
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

    const aiSettings = await resolveAiSettings(
      session.user.id,
      body.model ? { model: body.model, effort: body.effort ?? DEFAULT_SETTINGS.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking } : undefined,
      DEFAULT_SETTINGS
    );
    const client = getAiClient(aiSettings.model);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Buffer text before the JSON block to suppress reasoning text that Claude
          // emits between web search tool calls. Only forward once ```json is seen.
          let jsonBlockStarted = false;
          let preJsonBuffer = "";

          const { hitIterationCap } = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              // Streaming, so a large ceiling can't hit HTTP timeouts (Opus 4.8 allows up
              // to 128k). 64k gives ample room for xhigh adaptive thinking + JSON block +
              // the full 10-section report without truncation. max_tokens is a cap, not a
              // target — the model generates only what it needs, so this doesn't raise cost.
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
                // Silently discard pre-JSON reasoning text
              } else {
                controller.enqueue(new TextEncoder().encode(text));
              }
            },
            // Deep Value's prompt (ANALYTICAL_RIGOR_BLOCK: ~5y financials, quality
            // metrics, historical multiples, comparables, EV→equity bridge, reverse
            // check) needs far more research rounds than Advisor's default cap —
            // reproduced in production (2026-07-10) with DeepSeek: the default 10 was hit
            // mid-research, discarding everything silently (nothing had reached the
            // ```json fence yet) and returning an empty report with no error. See the
            // shared constant for why it's 35. Grounded mode rescopes (not eliminates)
            // web search to just the post-coverage-date update + qualitative material
            // (spec §5.6), so it converges in far fewer rounds — GROUNDED_MAX_TOOL_ITERATIONS.
            body.grounding ? GROUNDED_MAX_TOOL_ITERATIONS : DEEP_RESEARCH_MAX_TOOL_ITERATIONS
          );

          // Failsafe: if the model never reached the JSON fence (e.g. still researching
          // when the iteration cap hit, or it opened straight into prose), flush the
          // buffered text so the run isn't silently swallowed.
          if (!jsonBlockStarted && preJsonBuffer) {
            controller.enqueue(new TextEncoder().encode(preJsonBuffer));
          }

          if (hitIterationCap) {
            const isItalian = body.language === "Italiano" || body.language === "Italian";
            const note = isItalian
              ? "\n\n_[Analisi interrotta: troppi cicli di ricerca web. Riprova, magari con un margine di sicurezza diverso.]_"
              : "\n\n_[Analysis stopped: too many web search rounds. Try again, maybe with a different margin of safety.]_";
            controller.enqueue(new TextEncoder().encode(note));
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
