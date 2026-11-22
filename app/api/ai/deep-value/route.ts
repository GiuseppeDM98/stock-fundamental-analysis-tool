// POST /api/ai/deep-value — the AI valuation, on the user's confirmed financial dataset, in
// four requests (2026-11-22): the web update (Sonnet 5.5 with web search: what the dataset
// cannot hold), the valuation (the run's model, no tools: a rationale and the JSON that
// fixes the numbers), then the report in two halves that explain them (the run's model, no
// tools). One request did all of it until then and ran past the 300 s a function lives on
// Vercel Hobby. The runners live in lib/ai/deep-value-phases.ts.
// No Yahoo Finance fundamentals call — only a quote for the current price, taken once when
// the run starts: every later phase reads it from the row, so a report never mixes prices.
//
// A staged run (2026-10-27, after the "Consulente" run of net-worth-tracker): the Analysis
// row is created "running" BEFORE the model is called and each phase is written by this
// route as it ends — never by the client, so a request the platform cuts at 300 s, or a tab
// closed mid-stream, still leaves a row that says where the run stands. The response is
// Server-Sent Events (lib/ai/sse.ts): `stage` first (with the row's id), then `text`, then
// `done` or `error`; a stream that ends with neither was cut.
// Three bodies: a new run (runs `update`); `{ analysisId, phase }`, the panel chaining to the
// next phase; `{ analysisId }`, a Retry, where the row decides between resuming from the
// phase it reached and starting over (lib/report/run-status.ts, retryPlanOf).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { buildThinkingParam } from "@/lib/ai/client";
import { resolveAiSettings, aiModelIdSchema } from "@/lib/ai/ai-preferences";
import { routeErrorStatus, runErrorMessage, isRetryableRunError } from "@/lib/ai/error-status";
import { AI_EFFORT_LEVELS, isAiEffort, type AiSettings } from "@/types/ai-settings";
import { DEEP_VALUE_PHASES } from "@/types/ai-run";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { getFinancialDataset } from "@/lib/datasets/store";
import { normalizeTicker } from "@/lib/ticker";
import { createSseChannel, sseResponse } from "@/lib/ai/sse";
import { phaseModelSettings, runReportPart, runUpdatePhase, runValuationPhase, type PhaseContext } from "@/lib/ai/deep-value-phases";
import { claimRunPhase, failAnalysisRun, setRunPrice, startAnalysisRun, type ClaimedPhase } from "@/lib/analyses-store";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "high", thinking: true };

// Vercel's builder rejects any maxDuration above what the *currently deployed* plan
// allows: Hobby with Fluid Compute caps it at 300 (see SETUP.md's maxDuration table), so
// 800 (the Pro ceiling) fails to build on Hobby. Since 2026-10-27 the ceiling holds for ONE
// request — one phase of the run — not for the whole run, whose rows are written by the
// server as each request ends. Bump this to 800 only after upgrading to Pro. Same value and
// reason as the verify and research routes.
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
  // extract and the run's authoritative price.
  datasetId: z.string({ error: "datasetId is required" }).min(1, "datasetId is required"),
});

// A continuation carries only the row's id (and, for a chain, the phase): every input comes
// from the row, so a retry cannot re-run a saved analysis with another dataset, MoS or model
// than the one it records.
const continueSchema = z.object({ analysisId: z.string().min(1), phase: z.enum(DEEP_VALUE_PHASES).optional() }).strict();

const requestSchema = z.union([continueSchema, newRunSchema]);

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

/** A new run: dataset → quote → settings, then the row is created at `update`. Answers a
 *  Response for every refusal before the row exists. */
async function prepareNewRun(userId: string, body: z.infer<typeof newRunSchema>): Promise<PhaseContext | Response> {
  const stored = await getFinancialDataset(userId, body.datasetId);
  if (!stored) return NextResponse.json({ error: "dataset not found" }, { status: 400 });
  const ticker = normalizeTicker(body.ticker);
  if (stored.dataset.datasetMeta.ticker !== ticker) {
    return NextResponse.json({ error: "dataset ticker mismatch" }, { status: 400 });
  }
  const quote = await getQuote(body.ticker);
  const aiSettings = await resolveNewRunSettings(userId, body);
  const input = {
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
  };
  const handle = await startAnalysisRun(userId, input);
  const claimed: ClaimedPhase = {
    ...handle,
    ...input,
    phase: "update",
    restarted: false,
    createdAt: handle.runStartedAt,
    updateNotesMd: null,
    resultJson: null,
    valuationMemo: null,
    reportMd: "",
  };
  return phaseContext(claimed, stored, aiSettings);
}

/** A chained phase or a Retry: the row first (404/409 before any quote or dataset), then the
 *  quote when the phase runs without one, then the dataset the row names. A failure after
 *  the claim marks the row failed. */
async function prepareContinuation(userId: string, body: z.infer<typeof continueSchema>): Promise<PhaseContext | Response> {
  let claimed: ClaimedPhase;
  try {
    claimed = await claimRunPhase(userId, body.analysisId, body.phase ?? null);
  } catch (err) {
    if (err instanceof AnalysisRunNotFound) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof AnalysisRunConflict) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  const language = claimed.reportLanguage ?? "English";

  // A restart (or a resume of the first phase) cleared the price: this run takes a new one,
  // the price every later phase reads from the row.
  if (claimed.phase === "update" && claimed.priceAtAnalysis == null) {
    try {
      const quote = await getQuote(claimed.ticker);
      claimed.priceAtAnalysis = quote.regularMarketPrice > 0 ? quote.regularMarketPrice : null;
      claimed.priceCurrency = quote.currency ?? null;
      await setRunPrice(claimed, claimed.priceAtAnalysis, claimed.priceCurrency);
    } catch (err) {
      await failAnalysisRun(claimed, runErrorMessage(err, language));
      return NextResponse.json({ error: err instanceof Error ? err.message : "quote failed" }, { status: routeErrorStatus(err) });
    }
  }

  const stored = await getFinancialDataset(userId, claimed.datasetId);
  if (!stored) {
    await failAnalysisRun(claimed, runErrorMessage(new AnalysisRunConflict("dataset no longer available"), language));
    return NextResponse.json({ error: "dataset no longer available" }, { status: 409 });
  }

  // The settings recorded on the row (its effort already capped by the claim), clamped again
  // to what the model supports today.
  const aiSettings = await resolveAiSettings(
    userId,
    claimed.aiModel && claimed.aiEffort && isAiEffort(claimed.aiEffort) && claimed.aiThinking != null
      ? { model: claimed.aiModel, effort: claimed.aiEffort, thinking: claimed.aiThinking }
      : undefined,
    DEFAULT_SETTINGS
  );
  return phaseContext(claimed, stored, aiSettings);
}

/** The phase's frozen inputs, all from the row: its price (0 without one, as a run that
 *  started on a non-positive quote), its currency, its date. */
function phaseContext(claimed: ClaimedPhase, stored: NonNullable<Awaited<ReturnType<typeof getFinancialDataset>>>, aiSettings: AiSettings): PhaseContext {
  const currentPrice = claimed.priceAtAnalysis ?? 0;
  const currency = claimed.priceCurrency ?? "USD";
  // The run's date, not today's: the four requests write one report, dated when it started
  // (and it keeps the model off its training year).
  const currentDate = claimed.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return {
    claimed,
    stored,
    // The deterministic anchors recomputed from the stored extract and the run's own price;
    // the dataset's own warnings join the recomputed ones, and a web dataset's research
    // notes lead the extract.
    grounding: buildGroundingPromptContext(stored.blocks, stored.dataset, currentPrice, currency, stored.warnings, stored.research?.notes ?? null),
    language: claimed.reportLanguage ?? "English",
    currentDate,
    currentPrice,
    currency,
    aiSettings,
  };
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

  let ctx: PhaseContext;
  try {
    const prepared = "analysisId" in body ? await prepareContinuation(session.user.id, body) : await prepareNewRun(session.user.id, body);
    if (prepared instanceof Response) return prepared;
    ctx = prepared;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: routeErrorStatus(error) });
  }

  return sseResponse(new ReadableStream<Uint8Array>({ start: (controller) => streamPhase(ctx, controller) }));
}

/** One phase, from its first event to the row's write. Never throws: every failure ends as
 *  an `error` event and, when the row can still be written, a failed row. */
async function streamPhase(ctx: PhaseContext, controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  const { claimed } = ctx;
  const ch = createSseChannel(controller);
  const startedMs = Date.now();
  let outcome = "error";
  // The row's id reaches the client first, so a request cut a second later is retryable.
  ch.send({ type: "stage", stage: claimed.phase, analysisId: claimed.id, runStartedAt: claimed.runStartedAt.toISOString() });

  // The valuation is always independent/position-blind — no portfolio position or prior
  // estimate is ever injected into any phase's prompt, so the fair values can't be anchored
  // to what the user paid or to a previous run. Position-aware hold/exit reasoning happens
  // separately in the Advisor; estimate evolution is a deterministic diff on /analyses.
  try {
    outcome =
      claimed.phase === "update"
        ? await runUpdatePhase(ctx, ch)
        : claimed.phase === "valuation"
          ? await runValuationPhase(ctx, ch)
          : await runReportPart(ctx, ch);
  } catch (err) {
    console.error(`[ai-run] deep-value ${claimed.phase} failed`, err);
    outcome = "error";
    const message = runErrorMessage(err, ctx.language);
    try {
      await failAnalysisRun(claimed, message);
    } catch (dbErr) {
      console.error(`[ai-run] deep-value ${claimed.phase}: could not mark the row failed`, dbErr);
    }
    ch.send({ type: "error", error: message, retryable: isRetryableRunError(err) });
  } finally {
    // The update's model and effort are its own (Sonnet 5.5 on Anthropic): this line is the
    // only place that records them, the row keeps the run's.
    const settings = phaseModelSettings(claimed.phase, ctx.aiSettings);
    console.info("[ai-run]", "deep-value", claimed.phase, `${Date.now() - startedMs}ms`, settings.model, settings.effort, outcome);
    ch.close();
  }
}
