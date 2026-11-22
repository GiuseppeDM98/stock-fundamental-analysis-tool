// POST /api/ai/research — the research stage: the model collects the company's reported
// financials, historical multiples, peers and forward estimates from primary sources (web
// search + web fetch) and writes them as JSON; the route validates it, verifies every cited
// URL against the transcripts, builds a FinancialDataset with a web source on every row,
// saves it (origin "web") and answers with the dataset and the deterministic reads of its
// preview.
//
// Three requests, one per part (since 2026-11-22, lib/ai/research-parts.ts): statements, then
// multiples and peers, then estimates, each with its own cap of searches and fetches, so that
// none outlives the 300 s of a Hobby function (one request took 245-668 s). The first request
// ({ ticker }) creates a ResearchRun and runs the statements; each next one ({ runId, part })
// runs its part, or records it as skipped, and the request that writes the third record saves
// the dataset. What a part collected stays on the server (ResearchRun), never in the client.
// Each answer is JSON, no stream: a part is data, not prose, and a request Vercel cuts reaches
// the client as an invalid answer, after which the part is asked again.
//
// Position-blind like the valuation: every prompt gets the company's name, exchange and
// trading currency, the parts after the statements also what the statements declared
// (currency, units, calendar), never the price.
//
// Model (2026-10-18): the user's provider decides (researchAiSettings) — Sonnet 5.5 at high
// on Anthropic, the user's DeepSeek model at high on DeepSeek, whose search and fetch run
// client-side on DeepSeek's Search/Fetch APIs with the part's fetch cap applied by the loop.
// The model is chosen at the start and kept on the run.
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { tickerSchema } from "@/lib/ticker";
import { aiModelIdSchema, researchAiSettings } from "@/lib/ai/ai-preferences";
import { buildEffortConfig, buildResearchTools, buildThinkingParam, getAiClient } from "@/lib/ai/client";
import { buildPromptCacheParam, runStreamWithToolLoop } from "@/lib/ai/tool-loop";
import { routeErrorStatus } from "@/lib/ai/error-status";
import { buildResearchPartUserPrompt, buildResearchSystemPrompt, buildResearchUserPrompt } from "@/lib/ai/research-prompt";
import { hasNoFinancialRows, preprocessResearchOutput, RESEARCH_PART_SCHEMAS } from "@/lib/ai/research-schema";
import { combineResearchParts, nextResearchPart, RESEARCH_PART_BUDGET, researchPartsSummary } from "@/lib/ai/research-parts";
import { collectSeenUrls } from "@/lib/ai/transcript-urls";
import { lastJsonFence } from "@/lib/report/parse-deep-value-json";
import { computeDatasetAnchors } from "@/lib/datasets/anchors-bundle";
import { DATASET_WARNING_CODES } from "@/lib/datasets/parse";
import { getFinancialDataset, saveFinancialDataset } from "@/lib/datasets/store";
import { deleteResearchRun, readResearchRun, type ResearchRunRow, saveResearchPart, startResearchRun } from "@/lib/datasets/research-run-store";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import type { ResearchPartRecords } from "@/lib/ai/research-parts";
import { AI_EFFORT_LEVELS, AI_MODEL_CATALOG, type AiModelId } from "@/types/ai-settings";
import { RESEARCH_PARTS, type ResearchMeta, type ResearchPart, type ResearchResponse } from "@/types/dataset";

// Hobby's ceiling, as on the other AI routes (SETUP.md's maxDuration table): it binds one
// part, and each part's cap of tool calls keeps it under 240 s on Claude
// (doc/guide/valutazione.md § 5.3).
export const maxDuration = 300;

const startSchema = z
  .object({
    ticker: tickerSchema,
    // The same optional override as /api/ai/deep-value's model/effort/thinking, nested: only
    // the body carries it (/deep-value, tests); /analyze has no research selector of its own.
    aiSettings: z
      .object({
        model: aiModelIdSchema.optional(),
        effort: z.enum(AI_EFFORT_LEVELS).optional(),
        thinking: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

const partSchema = z.object({ runId: z.string().min(1), part: z.enum(RESEARCH_PARTS), skip: z.boolean().optional() }).strict();

type Run = ResearchRunRow & { records: ResearchPartRecords };
type Context = { runId: string; part: ResearchPart };

const keptCodes: readonly string[] = DATASET_WARNING_CODES;

/** An error answer. After the start it carries the run and the part, so the client asks the
 *  right part again even when the first one failed. */
function fail(error: string, status = 502, context?: Context, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...context, ...extra }, { status });
}

/** The last turn's blocks as "type[:name]", comma-separated: what the model was doing. */
function lastTurnShape(messages: { content: unknown }[]): string {
  const content = messages[messages.length - 1]?.content;
  if (!Array.isArray(content)) return typeof content;
  return content.map((b: { type: string; name?: string }) => (b.name ? `${b.type}:${b.name}` : b.type)).join(",");
}

function missingKeyError(model: AiModelId): string | null {
  const provider = AI_MODEL_CATALOG[model].provider;
  const keyPresent = provider === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.DEEPSEEK_API_KEY;
  if (keyPresent) return null;
  return provider === "anthropic" ? "research requires the Anthropic API key" : "research requires the DeepSeek API key";
}

/** The part's user prompt: the statements part gets the listing; the next ones also what the
 *  statements declared (the route reaches them only after the statements record is done). */
function userPromptOf(run: Run, part: ResearchPart): string {
  const listing = { ticker: run.ticker, companyName: run.companyName, exchange: run.exchange, quoteCurrency: run.quoteCurrency };
  const statements = run.records.statements;
  if (part === "statements" || statements?.status !== "done") return buildResearchUserPrompt(listing);
  const fiscalYears = [...new Set(statements.output.financials.map((row) => row.fiscalYear))].sort((a, b) => a - b);
  return buildResearchPartUserPrompt({ ...listing, meta: statements.output.meta, fiscalYears });
}

/** Runs one part with the model and writes its record. Returns an error answer, or null once
 *  the record is written. */
async function runPart(userId: string, run: Run, part: ResearchPart): Promise<NextResponse | null> {
  const context = { runId: run.id, part };
  const keyError = missingKeyError(run.model);
  if (keyError) return fail(keyError, 503, context);

  const budget = RESEARCH_PART_BUDGET[part];
  const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const startedAt = Date.now();
  const result = await runStreamWithToolLoop(
    getAiClient(run.model),
    {
      model: run.model,
      // Streaming, so the ceiling cannot hit an HTTP timeout; thinking and the tool rounds'
      // reasoning count toward it. A cap, not a target: one part writes a third of the JSON.
      max_tokens: 32000,
      thinking: buildThinkingParam(true, run.model),
      output_config: buildEffortConfig("high"),
      system: buildResearchSystemPrompt({ currentDate, part }),
      tools: buildResearchTools(run.model, budget),
      messages: [{ role: "user", content: userPromptOf(run, part) }],
      // Each resume after a pause_turn re-sends the whole transcript, fetched pages
      // included: the cache makes it pay only the new tokens (Anthropic only, empty on DeepSeek).
      ...buildPromptCacheParam(run.model),
    },
    () => {},
    // One round per tool call and one to write: on Claude it counts the pause_turn resumes,
    // on DeepSeek the client's rounds (its only bound on the searches).
    budget.searches + budget.fetches + 1,
    { fetchBudget: budget.fetches }
  );
  const durationMs = Date.now() - startedAt;
  const seen = collectSeenUrls(result.messages);
  console.log(
    `[research] ${run.ticker} ${part} ${run.model} ${durationMs}ms stop=${result.stopReason} cap=${result.hitIterationCap} ` +
      `searches=${seen.searches} fetches=${seen.fetches} seenUrls=${seen.urls.size} blocksByCaller=${JSON.stringify(seen.blocksByCaller)}`
  );

  // A run that did not end its turn leaves its last blocks in the log, by type and name
  // only: the one way to tell later what the model was doing when it stopped.
  if (result.stopReason !== "end_turn") console.warn(`[research] ${run.ticker} ${part} stopped on ${result.stopReason}; last turn: ${lastTurnShape(result.messages)}`);

  if (result.hitIterationCap) return fail("Research ran out of research rounds", 502, context);
  if (result.stopReason === "max_tokens") return fail("Research truncated: the length limit was reached", 502, context);
  if (result.stopReason === "refusal") return fail("Research refused by the model", 502, context);
  // Seen once on Sonnet 5.5 (2026-10-30, 1 of the 5 Claude runs): the turn ended on
  // "tool_use" with only server tools declared, after 7 searches and 7 fetches and no JSON.
  // Nothing in the transcript can be answered, so the run is a failure to retry, not an
  // invalid dataset.
  if (result.stopReason === "tool_use") return fail("Research stopped on a tool call: run it again", 502, context);

  const fence = lastJsonFence(result.text);
  let raw: unknown;
  try {
    raw = fence == null ? undefined : JSON.parse(fence);
  } catch {
    raw = undefined;
  }
  const preprocessed = preprocessResearchOutput(raw);
  if (part === "statements" && hasNoFinancialRows(preprocessed)) return fail("No financial data found", 502, context);
  const parsed = RESEARCH_PART_SCHEMAS[part].safeParse(preprocessed);
  if (!parsed.success) return fail("Research returned an invalid dataset", 502, context);

  const written = await saveResearchPart(userId, run.id, part, {
    status: "done",
    output: parsed.data,
    seenUrls: [...seen.urls],
    searches: seen.searches,
    fetches: seen.fetches,
    durationMs,
    servedBy: result.servedBy,
  });
  return written === 0 ? fail("research run not found", 404, context) : null;
}

/** Saves the dataset of a run with its three records and deletes the run. Repeatable: a close
 *  that failed after the third record was written is asked again and calls no model. */
async function closeRun(userId: string, run: Run, part: ResearchPart): Promise<NextResponse> {
  const context = { runId: run.id, part };
  const combined = combineResearchParts(run.records);
  if (combined.extract.financials.length === 0) return fail("No financial data found", 502, context);

  const skippedWarnings: ReconciliationWarning[] = combined.skipped.map((skipped) => ({ code: "research_part_skipped", severity: "info", fiscalYear: null, detail: skipped }));
  const research: ResearchMeta = { model: run.model, effort: "high", unverifiedSources: combined.unverified, ...researchPartsSummary(run.records) };
  const datasetId = await saveFinancialDataset(userId, {
    ticker: run.ticker,
    origin: "web",
    dataset: combined.extract,
    blocks: null,
    warnings: [...combined.warnings.filter((w) => keptCodes.includes(w.code)), ...skippedWarnings],
    research,
  });
  // Read back what was stored: the answer is the row as every later reader will see it,
  // and a row that would not parse is caught here instead of at the next reuse.
  const stored = await getFinancialDataset(userId, datasetId);
  if (!stored) return fail("Research dataset could not be read back", 500, context);

  // The anchors read a quote taken now, best-effort as in POST /api/datasets: the run may have
  // started minutes ago, and a quote that fails costs the market-implied read, not the dataset.
  // The price never reaches a prompt.
  let quote: { price: number; currency: string } | null = null;
  try {
    const live = await getQuote(run.ticker);
    quote = { price: live.regularMarketPrice, currency: live.currency };
  } catch {
    quote = null;
  }
  const anchors = computeDatasetAnchors(stored.dataset, quote);
  await deleteResearchRun(userId, run.id);

  const result: ResearchResponse = {
    datasetId,
    dataset: stored.dataset,
    basis: anchors.basis,
    stats: anchors.stats,
    grid: anchors.grid,
    marketImplied: anchors.marketImplied,
    impliedExpectations: anchors.impliedExpectations,
    warnings: [...stored.warnings, ...anchors.warnings],
    research,
  };
  return NextResponse.json({ runId: run.id, part, next: null, result });
}

/** After a part's record is written: the part the client asks next, or the close. */
async function answerAfterWrite(userId: string, runId: string, part: ResearchPart): Promise<NextResponse> {
  const run = await readResearchRun(userId, runId);
  if (!run) return fail("research run not found", 404, { runId, part });
  const next = nextResearchPart(run.records);
  return next === null ? closeRun(userId, run, part) : NextResponse.json({ runId, part, next });
}

async function start(userId: string, body: z.infer<typeof startSchema>): Promise<NextResponse> {
  const quote = await getQuote(body.ticker);
  const settings = await researchAiSettings(userId, body.aiSettings);
  const keyError = missingKeyError(settings.model);
  if (keyError) return fail(keyError, 503);

  const input = { ticker: body.ticker, companyName: quote.shortName, exchange: quote.exchange, quoteCurrency: quote.currency, model: settings.model };
  const runId = await startResearchRun(userId, input);
  const run: Run = { id: runId, userId, ...input, model: settings.model, createdAt: new Date(), records: { statements: null, market: null, estimates: null } };
  try {
    const failed = await runPart(userId, run, "statements");
    return failed ?? (await answerAfterWrite(userId, runId, "statements"));
  } catch (error) {
    return thrown(error, { runId, part: "statements" }, run.ticker);
  }
}

async function continueRun(userId: string, body: z.infer<typeof partSchema>): Promise<NextResponse> {
  const context = { runId: body.runId, part: body.part };
  const run = await readResearchRun(userId, body.runId);
  if (!run) return fail("research run not found", 404, context);
  try {
    return await continueReadRun(userId, run, body);
  } catch (error) {
    return thrown(error, context, run.ticker);
  }
}

async function continueReadRun(userId: string, run: Run, body: z.infer<typeof partSchema>): Promise<NextResponse> {
  const context = { runId: body.runId, part: body.part };
  const next = nextResearchPart(run.records);
  // A run with all three records only needs its close (the one that failed before).
  if (next === null) return closeRun(userId, run, body.part);
  if (body.skip && body.part === "statements") return fail("the statements cannot be skipped", 400, context);
  if (body.part !== next) return fail("part out of order", 409, context, { next });

  if (body.skip) {
    const written = await saveResearchPart(userId, run.id, body.part, { status: "skipped" });
    console.log(`[research] ${run.ticker} ${body.part} skipped`);
    if (written === 0) return fail("research run not found", 404, context);
  } else {
    const failed = await runPart(userId, run, body.part);
    if (failed) return failed;
  }
  return answerAfterWrite(userId, run.id, body.part);
}

/** A thrown error (the SDK's, a stream that ended on an error event, the database's) answers
 *  the client and is logged: the page alone would be the only place it showed. */
function thrown(error: unknown, context?: Context, ticker?: string): NextResponse {
  const message = error instanceof Error ? error.message : "Research failed";
  const status = routeErrorStatus(error);
  console.warn(`[research] ${ticker ?? "?"} ${context?.part ?? "start"} error ${status}: ${message}`);
  return fail(message, status, context);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  // A body naming a run continues it; any other is a start. Both schemas are strict, so a
  // body mixing the two ({ ticker, runId, part }) is refused rather than read as either.
  if (raw != null && typeof raw === "object" && "runId" in raw) {
    const body = partSchema.safeParse(raw);
    if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
    try {
      return await continueRun(session.user.id, body.data);
    } catch (error) {
      return thrown(error, { runId: body.data.runId, part: body.data.part });
    }
  }
  const body = startSchema.safeParse(raw);
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 });
  try {
    return await start(session.user.id, body.data);
  } catch (error) {
    return thrown(error, undefined, body.data.ticker);
  }
}

/** GET /api/ai/research?runId= — the part a run expects next (null once it has all three),
 *  without calling the model or writing: how the client learns whether a part whose answer was
 *  lost had been written. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  const run = await readResearchRun(session.user.id, runId);
  if (!run) return NextResponse.json({ error: "research run not found", runId }, { status: 404 });
  return NextResponse.json({ runId, next: nextResearchPart(run.records) });
}
