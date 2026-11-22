// POST /api/ai/deep-value — the AI valuation, on the user's confirmed financial dataset.
// Claude picks the method, takes the history from the dataset and web-searches only what it
// cannot hold, then streams the full Markdown report followed by a closing JSON block (fair
// values, sensitivity, dividend path). Research chatter before the report's start marker
// never reaches the client (lib/ai/stream-gate.ts).
// No Yahoo Finance fundamentals call — only a quote for the current price.
//
// A staged run (2026-10-27, after the "Consulente" run of net-worth-tracker): the Analysis
// row is created "running" BEFORE the model is called and written by this route when the
// run ends — never by the client, so a run the platform cuts at 300 s, or a tab closed
// mid-stream, still leaves a row that says what happened. The response is Server-Sent
// Events (lib/ai/sse.ts): `stage` first (with the row's id), then `text`, then `done` or
// `error`; a stream that ends with neither was cut. A body with only `analysisId` retries
// that row with the inputs stored on it.
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
import { REPORT_START_MARKER, parseDeepValueJson } from "@/lib/report/parse-deep-value-json";
import { resolveAiSettings, aiModelIdSchema } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop, GROUNDED_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import { fallbackNote } from "@/lib/ai/fallback";
import { routeErrorStatus, runErrorMessage, isRetryableRunError } from "@/lib/ai/error-status";
import { AI_EFFORT_LEVELS, isAiEffort, type AiSettings } from "@/types/ai-settings";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { getFinancialDataset } from "@/lib/datasets/store";
import { normalizeTicker } from "@/lib/ticker";
import { createSseChannel, sseResponse } from "@/lib/ai/sse";
import { classifyRunEnd } from "@/lib/ai/run-outcome";
import {
  startAnalysisRun,
  resumeAnalysisRun,
  setRunPrice,
  finishAnalysisRun,
  failAnalysisRun,
  type RunHandle,
} from "@/lib/analyses-store";
import { AnalysisRunConflict, AnalysisRunGone, AnalysisRunNotFound } from "@/lib/analysis-run-errors";
import type { QuoteResponse } from "@/types/market";
import type { StoredDataset } from "@/types/dataset";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "high", thinking: true };

// Vercel's builder rejects any maxDuration above what the *currently deployed* plan
// allows: Hobby with Fluid Compute caps it at 300 (see SETUP.md's maxDuration table), so
// 800 (the Pro ceiling) fails to build on Hobby. Since 2026-10-27 the ceiling holds for ONE
// request — this valuation, with all its search rounds — not for the whole run, whose rows
// are written by the server as each request ends. Bump this to 800 only after upgrading to
// Pro. Same value and reason as the verify and research routes.
export const maxDuration = 300;

const newRunSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mosPercent: z.number().min(0).max(80).default(0),
  model: aiModelIdSchema.optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
  // The id of the user's confirmed dataset, required since 2026-11-09 (one path: every
  // report is built on a dataset). The route reads its blocks, extract, stored warnings and
  // research notes, and recomputes stats/grid/marketImplied/warnings itself from the
  // extract and its own authoritative currentPrice.
  datasetId: z.string({ error: "datasetId is required" }).min(1, "datasetId is required"),
});

// A retry carries only the row's id: every input comes from the row, so a retry cannot
// re-run a saved analysis with another dataset, MoS or model than the one it records.
const retrySchema = z.object({ analysisId: z.string().min(1) }).strict();

const requestSchema = z.union([retrySchema, newRunSchema]);

/** What one attempt runs with, whichever branch prepared it. */
type PreparedRun = {
  handle: RunHandle;
  ticker: string;
  language: string;
  mosPercent: number;
  quote: QuoteResponse;
  stored: StoredDataset;
  aiSettings: AiSettings;
};

/** The run's settings for a new run: request override > stored default. No floor since
 *  2026-11-20: a valuation runs at the user's default, which the catalog caps at `high`. */
async function resolveNewRunSettings(userId: string, body: z.infer<typeof newRunSchema>): Promise<AiSettings> {
  // An override without an effort is not a complete override: resolveAiSettings then
  // reads the user's stored effort. An effort named without a model applies to the stored
  // model (until 2026-10-29 it was silently dropped, so the run went at the stored effort).
  return resolveAiSettings(
    userId,
    body.model
      ? { model: body.model, effort: body.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking }
      : body.effort
        ? { effort: body.effort, thinking: body.thinking }
        : undefined,
    DEFAULT_SETTINGS
  );
}

/** Whether the thinking the provider receives is on — what the row records as aiThinking
 *  (Sonnet 5.5's "between_tools", its off, counts as on). */
function thinkingRecorded(settings: AiSettings): boolean {
  return buildThinkingParam(settings.thinking, settings.model).type !== "disabled";
}

/** A new run: dataset → quote → settings, then the row is created. Answers a Response for
 *  every refusal before the row exists. */
async function prepareNewRun(userId: string, body: z.infer<typeof newRunSchema>): Promise<PreparedRun | Response> {
  const stored = await getFinancialDataset(userId, body.datasetId);
  if (!stored) return NextResponse.json({ error: "dataset not found" }, { status: 400 });
  const ticker = normalizeTicker(body.ticker);
  if (stored.dataset.datasetMeta.ticker !== ticker) {
    return NextResponse.json({ error: "dataset ticker mismatch" }, { status: 400 });
  }
  const quote = await getQuote(body.ticker);
  const aiSettings = await resolveNewRunSettings(userId, body);
  const handle = await startAnalysisRun(userId, {
    ticker,
    companyName: quote.shortName || ticker,
    datasetId: stored.id,
    mosPercent: body.mosPercent,
    reportLanguage: body.language,
    aiModel: aiSettings.model,
    aiEffort: aiSettings.effort,
    aiThinking: thinkingRecorded(aiSettings),
    priceAtAnalysis: quote.regularMarketPrice > 0 ? quote.regularMarketPrice : null,
    priceCurrency: quote.currency ?? null,
  });
  return { handle, ticker, language: body.language, mosPercent: body.mosPercent, quote, stored, aiSettings };
}

/** A retry: the row first (404/409 before any quote or dataset), then the quote and the
 *  dataset the row names. A failure after the takeover marks the row failed. */
async function prepareRetry(userId: string, analysisId: string): Promise<PreparedRun | Response> {
  let row: Awaited<ReturnType<typeof resumeAnalysisRun>>;
  try {
    row = await resumeAnalysisRun(userId, analysisId);
  } catch (err) {
    if (err instanceof AnalysisRunNotFound) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof AnalysisRunConflict) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  const handle: RunHandle = { id: row.id, userId, runStartedAt: row.runStartedAt };
  const language = row.reportLanguage ?? "English";

  let quote: QuoteResponse;
  try {
    quote = await getQuote(row.ticker);
  } catch (err) {
    await failAnalysisRun(handle, runErrorMessage(err, language));
    return NextResponse.json({ error: err instanceof Error ? err.message : "quote failed" }, { status: routeErrorStatus(err) });
  }
  // The row describes the attempt that produced it: this attempt's quote, in its currency.
  await setRunPrice(handle, quote.regularMarketPrice > 0 ? quote.regularMarketPrice : null, quote.currency ?? null);

  const stored = await getFinancialDataset(userId, row.datasetId);
  if (!stored) {
    await failAnalysisRun(handle, runErrorMessage(new AnalysisRunConflict("dataset no longer available"), language));
    return NextResponse.json({ error: "dataset no longer available" }, { status: 409 });
  }

  // The settings recorded on the row, clamped again to what the model supports today.
  const aiSettings = await resolveAiSettings(
    userId,
    row.aiModel && row.aiEffort && isAiEffort(row.aiEffort) && row.aiThinking != null
      ? { model: row.aiModel, effort: row.aiEffort, thinking: row.aiThinking }
      : undefined,
    DEFAULT_SETTINGS
  );
  return { handle, ticker: row.ticker, language, mosPercent: row.mosPercent, quote, stored, aiSettings };
}

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
      // A union reports every branch: name the new run's first problem, the body most
      // clients send ("datasetId is required" rather than "analysisId: Required").
      const issue = err.issues[0];
      const nested = issue.code === "invalid_union" ? issue.errors.at(-1)?.[0] : undefined;
      return NextResponse.json({ error: (nested ?? issue).message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let run: PreparedRun;
  try {
    const prepared = "analysisId" in body ? await prepareRetry(session.user.id, body.analysisId) : await prepareNewRun(session.user.id, body);
    if (prepared instanceof Response) return prepared;
    run = prepared;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: routeErrorStatus(error) });
  }

  return sseResponse(new ReadableStream<Uint8Array>({ start: (controller) => streamValuation(run, controller) }));
}

/** The valuation itself, from the first event to the row's last write. Never throws: every
 *  failure ends as an `error` event and, when the row can still be written, a failed row. */
async function streamValuation(run: PreparedRun, controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  const { handle, quote, stored, aiSettings, language, mosPercent } = run;
  const ch = createSseChannel(controller);
  const startedMs = Date.now();
  let outcome = "error";
  // The row's id reaches the client first, so a run cut a second later is already retryable.
  ch.send({ type: "stage", stage: "valuation", analysisId: handle.id, runStartedAt: handle.runStartedAt.toISOString() });

  try {
    const currentPrice = quote.regularMarketPrice;
    const currency = quote.currency ?? "USD";
    // Inject the real current date so Claude doesn't assume it's still in its training year.
    const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Recompute the deterministic anchors server-side from the stored extract + our own
    // authoritative currentPrice/currency; the dataset's own warnings (from its extraction
    // or research run) join the recomputed ones, and a web dataset's research notes lead
    // the extract.
    const groundingContext = buildGroundingPromptContext(stored.blocks, stored.dataset, currentPrice, currency, stored.warnings, stored.research?.notes ?? null);

    // The valuation is always independent/position-blind — no portfolio position or
    // prior estimate is ever injected into the prompt, so the fair values can't be
    // anchored to what the user paid or to a previous run. Position-aware hold/exit
    // reasoning happens separately in the Advisor; estimate evolution is shown as a
    // deterministic diff on /analyses (never fed back into a prompt).
    const systemPrompt = buildDeepValueSystemPrompt({ language, currentDate, mosPercent, grounding: groundingContext });
    const userPrompt = buildDeepValueUserPrompt({ ticker: run.ticker, currentPrice, currency, language, currentDate, mosPercent, grounding: groundingContext });

    // Text before the report marker is reasoning the model writes between web search
    // calls: dropped. `forwarded` is what reached the client — and what the row stores as
    // the report, so the saved page reads exactly what the user watched stream.
    const gate = createStreamGate(REPORT_START_MARKER);
    let forwarded = "";
    const forward = (text: string) => {
      if (!text) return;
      forwarded += text;
      ch.send({ type: "text", text });
    };

    const { stopReason, hitIterationCap, servedBy } = await runStreamWithToolLoop(
      getAiClient(aiSettings.model),
      {
        model: aiSettings.model,
        // Streaming, so a large ceiling can't hit HTTP timeouts (Opus 4.8 allows up
        // to 128k). 64k gives ample room for adaptive thinking + the full
        // 10-section report + the closing JSON block without truncation. max_tokens is
        // a cap, not a target — the model generates only what it needs, so this
        // doesn't raise cost.
        max_tokens: 64000,
        thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model),
        output_config: buildEffortConfig(aiSettings.effort),
        system: systemPrompt,
        tools: buildWebSearchTools(aiSettings.model),
        messages: [{ role: "user", content: userPrompt }],
      },
      (text) => forward(gate.push(text)),
      // The dataset rescopes (not eliminates) web search to the post-coverage update
      // and the qualitative material, so the run converges in far fewer rounds than
      // the 35 a report that gathered its own history needed (until 2026-11-09).
      GROUNDED_MAX_TOOL_ITERATIONS
    );
    outcome = stopReason ?? "unknown";

    // Failsafe: if the model never wrote the report marker (e.g. still researching
    // when the iteration cap hit, or it opened straight into prose), flush the
    // buffered text so the run isn't silently swallowed — and say so in the log.
    const rest = gate.flush();
    forward(rest);
    if (!gate.opened()) console.warn("[deep-value] report marker never arrived; flushed", rest.length);

    const end = classifyRunEnd({ text: forwarded, stopReason, hitIterationCap });
    if (end.kind === "failed") {
      // The streamed text stays on screen while the tab is open, but a cut or declined
      // run is not a report: the row keeps an empty report and says why.
      const message = runErrorMessage(end, language);
      await failAnalysisRun(handle, message);
      ch.send({ type: "error", error: message, retryable: end.retryable });
      return;
    }

    const isItalian = language === "Italiano" || language === "Italian";
    if (hitIterationCap) {
      forward(
        isItalian
          ? "\n\n_[Analisi interrotta: troppi cicli di ricerca web. Riprova, magari con un margine di sicurezza diverso.]_"
          : "\n\n_[Analysis stopped: too many web search rounds. Try again, maybe with a different margin of safety.]_"
      );
    }
    // The server-side refusal fallback (Sonnet 5.5) wrote this report with another
    // model: say which, so the saved report is not attributed to the requested one.
    if (servedBy) forward(`\n\n${fallbackNote(aiSettings.model, servedBy, isItalian)}`);

    // The parser reads the LAST fence of everything forwarded (gotcha #13); a cut inside
    // the closing JSON block can only come from max_tokens, which failed above.
    const count = await finishAnalysisRun(handle, { reportMd: forwarded, result: parseDeepValueJson(forwarded) });
    if (count === 0) {
      outcome = "deleted";
      ch.send({ type: "error", error: runErrorMessage(new AnalysisRunGone(), language), retryable: false });
      return;
    }
    ch.send({ type: "done", analysisId: handle.id });
  } catch (err) {
    console.error("[ai-run] deep-value valuation failed", err);
    outcome = "error";
    const message = runErrorMessage(err, language);
    try {
      await failAnalysisRun(handle, message);
    } catch (dbErr) {
      console.error("[ai-run] deep-value valuation: could not mark the row failed", dbErr);
    }
    ch.send({ type: "error", error: message, retryable: isRetryableRunError(err) });
  } finally {
    console.info("[ai-run]", "deep-value", "valuation", `${Date.now() - startedMs}ms`, aiSettings.model, aiSettings.effort, outcome);
    ch.close();
  }
}
