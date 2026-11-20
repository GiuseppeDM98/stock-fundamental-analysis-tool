// POST /api/ai/deep-value/verify — one phase of one independent analyst-panel pass over a
// finished report. A fresh-context pass that reviews the saved Deep Value report through
// one LENS (skeptic / optimist / quality — see `angle`), blind-first on the analysis's
// dataset: it commits to its own valuation from the data before it reads the report, then
// stress-tests the report against it. The lens only swaps persona/focus in the prompt —
// path and streaming machinery are identical, so all three analysts reuse this one route.
//
// Two requests since 2026-10-27, one per phase, each under the 300 s a function lives on
// Vercel Hobby, each written by THIS route as it ends (after the staged "Consulente" run of
// net-worth-tracker):
// - `phase: "blind"` — the commitment, from the data alone; nothing streamed but the stage
//   event; persisted with its rationale in the lens's *BlindJson.
// - `phase: "reconcile"` — the critique, streamed after its start marker
//   (lib/ai/stream-gate.ts), then the lens's own closing JSON (same MoS-adjusted unit as the
//   base analysis, so the base + every analyst average into a consensus); persisted in the
//   lens's critique, fair-value, method and result columns.
// A Phase 2 that the platform cuts is retried alone: the commitment it reasons from is on the row.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { ANALYST_ANGLES, type AnalystAngle } from "@/types/analysis";
import type { GroundedFinancials } from "@/types/grounding";
import type { LensPhase } from "@/types/ai-run";
import { readAnalysisGrounding } from "@/lib/datasets/store";
import {
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
  buildAnalystBlindUserPrompt,
  buildAnalystReconcileUserPrompt,
} from "@/lib/ai/deep-value-prompts";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { createStreamGate } from "@/lib/ai/stream-gate";
import { resolveAiSettings, aiModelIdSchema } from "@/lib/ai/ai-preferences";
import {
  runStreamWithToolLoop,
  buildPromptCacheParam,
  GROUNDED_MAX_TOOL_ITERATIONS,
  RECONCILE_MAX_TOOL_ITERATIONS,
} from "@/lib/ai/tool-loop";
import { fallbackNote } from "@/lib/ai/fallback";
import { routeErrorStatus, runErrorMessage, isRetryableRunError } from "@/lib/ai/error-status";
import { AI_EFFORT_LEVELS, deepValueDefaultEffort, type AiSettings } from "@/types/ai-settings";
import { buildGroundingPromptContext, formatGatesForPrompt, type GroundingPromptContext } from "@/lib/grounding/prompt-format";
import {
  hasFullTriple,
  parseBlindJson,
  parseDeepValueJson,
  sanitizeDeepValueResult,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  CRITIQUE_START_MARKER,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";
import { pickBlindCommitment, buildBlindAssistantTurn } from "@/lib/ai/blind-commitment";
import { checkValuationBridges } from "@/lib/grounding/postcheck";
import { createSseChannel, sseResponse } from "@/lib/ai/sse";
import { readLensRow, saveLensBlind, saveLensFinal, type LensRow } from "@/lib/analyses-store";
import { AnalysisRunGone } from "@/lib/analysis-run-errors";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

// Vercel's builder rejects any maxDuration above what the *currently deployed* plan
// allows: Hobby with Fluid Compute caps it at 300 (see SETUP.md's maxDuration table), so
// 800 (the Pro ceiling) fails to build on Hobby. The ceiling holds for ONE phase of a lens
// (since 2026-10-27 the blind commitment and the critique are two requests). Bump this to
// 800 only after upgrading to Pro.
export const maxDuration = 300;

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  // Which analyst lens is reviewing. Defaults to "skeptic" — the original red-team pass.
  angle: z.enum(ANALYST_ANGLES as [string, ...string[]]).default("skeptic"),
  model: aiModelIdSchema.optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
  // The saved analysis under review: the route re-reads its report, dataset, MoS and saved
  // result from the row (never trusts a client copy, which would also be 100-200KB per lens).
  analysisId: z.string({ error: "analysisId is required" }).min(1, "analysisId is required"),
  phase: z.enum(["blind", "reconcile"], { error: "phase must be blind or reconcile" }),
});

/**
 * The deterministic gates on the BASE report, formatted for the lens's user message
 * (ANALYST_STRUCTURAL_CHECKS #6 in lib/ai/deep-value-prompts.ts — "the lens must address
 * every FAIL explicitly"), on the analysis's dataset. Checked against the live price when the quote
 * resolved, else against the price saved with the analysis — and then the text says so,
 * so the lens never takes it for the current price.
 * @returns undefined when there is no price at all or the base JSON has no full triple.
 */
function buildBaseGatesText(
  analysis: LensRow,
  extract: GroundedFinancials | null,
  livePrice: number | undefined,
  liveCurrency: string
): string | undefined {
  // The result column first, the report's last fence for rows saved before it existed.
  let baseResult: ParsedAnalystResult | null;
  try {
    baseResult = analysis.resultJson ? sanitizeDeepValueResult(JSON.parse(analysis.resultJson)) : parseDeepValueJson(analysis.reportMd);
  } catch {
    baseResult = null;
  }
  const gatePrice = livePrice ?? analysis.priceAtAnalysis ?? null;
  // A price keeps its own currency, even an empty one (then the price gates read
  // "currency mismatch"): borrowing the report's would compare pence with pounds. The
  // price at analysis is in the currency of the quote it came from (priceCurrency, since
  // 2026-10-29); a row saved before that has none, so it is compared with nothing.
  const gateCurrency = livePrice != null ? liveCurrency : analysis.priceCurrency ?? "";
  if (gatePrice == null || !hasFullTriple(baseResult)) return undefined;
  const postCheck = checkValuationBridges(baseResult, analysis.mosPercent, gatePrice, gateCurrency, extract);
  if (!postCheck) return undefined;
  const gatesText = formatGatesForPrompt(postCheck.gates);
  if (livePrice != null) return gatesText;
  const saved = analysis.createdAt.toISOString().slice(0, 10);
  return `Gates computed against the price at analysis (${gatePrice.toFixed(2)} ${gateCurrency}, saved ${saved}) — the live quote was unavailable; this is NOT the current price.\n${gatesText}`;
}

/** Everything both phases of one lens read, prepared before the stream opens. */
type LensContext = {
  id: string;
  userId: string;
  angle: AnalystAngle;
  phase: LensPhase;
  row: LensRow;
  language: string;
  isItalian: boolean;
  aiSettings: AiSettings;
  systemPrompt: string;
  // Phase 1's user message, rebuilt identically in Phase 2 (the cache prefix).
  blindUserPrompt: string;
  // The report under review, its JSON block and markers stripped.
  reportMd: string;
  currentDate: string;
  currentPrice: number | undefined;
  currency: string;
  groundingContext: GroundingPromptContext;
  baseGatesText: string | undefined;
};

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

  let lens: LensContext;
  try {
    const prepared = await prepareLens(session.user.id, body);
    if (prepared instanceof Response) return prepared;
    lens = prepared;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: routeErrorStatus(error) });
  }

  return sseResponse(new ReadableStream<Uint8Array>({ start: (controller) => streamLensPhase(lens, controller) }));
}

/** Row, dataset, quote, settings and prompts — every refusal answered before the stream. */
async function prepareLens(userId: string, body: z.infer<typeof requestSchema>): Promise<LensContext | Response> {
  const angle = body.angle as AnalystAngle;
  // Inject the real current date so Claude doesn't anchor to its training year.
  const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Re-read from the DB, never the request body: the saved analysis's own report, MoS and
  // dataset are authoritative.
  const row = await readLensRow(body.analysisId, userId, angle);
  if (!row) return NextResponse.json({ error: "analysis not found" }, { status: 404 });
  // A lens reviews a finished report: a row still running (or failed) has none yet.
  if (row.runStatus !== "done") return NextResponse.json({ error: "analysis run not finished" }, { status: 409 });
  // One path since 2026-11-09: a lens commits blind on the analysis's data, so an older
  // analysis without one (a report that gathered its own figures) is re-run with a
  // dataset instead; the UI disables Run on it.
  if (row.datasetId == null && row.groundingJson == null) {
    return NextResponse.json({ error: "analysis has no dataset: re-run it with one" }, { status: 400 });
  }

  // Fetch the authoritative live price so the reviewer treats it as ground truth
  // instead of "correcting" it with stale web-searched quotes (a real failure mode:
  // it once flagged a correct price as overstated using month-old quotes). Best-effort
  // — if the quote fails (rate limit, delisted), the review proceeds without it.
  // Phase 2 works on the quote Phase 1 stored with its commitment (2026-11-20): the price
  // is in the system prompt, and a new one would change the prefix the cache serves.
  let currentPrice: number | undefined;
  let currency = "";
  const phase1Quote = body.phase === "reconcile" ? parseBlindJson(row.blindJson ?? "")?.phase1Quote : undefined;
  if (phase1Quote !== undefined) {
    currentPrice = phase1Quote?.price;
    currency = phase1Quote?.currency ?? "";
  } else {
    try {
      const quote = await getQuote(body.ticker);
      currentPrice = quote.regularMarketPrice;
      currency = quote.currency ?? "";
    } catch {
      // Non-fatal — omit the authoritative-price clause and let the review run.
    }
  }

  const grounding = await readAnalysisGrounding(userId, row);
  let groundingContext: GroundingPromptContext | null = null;
  if (grounding) {
    try {
      // Lenses get extract + anchors + warnings + the research notes, never the raw paste
      // — see the doc comment on buildAnalystUserPrompt's `grounding` param for why.
      groundingContext = buildGroundingPromptContext([], grounding.extract, currentPrice ?? null, currency, grounding.warnings, grounding.researchNotes);
    } catch {
      // Anchors that cannot be built on this extract: answered below, like a missing one.
    }
  }
  // A dataset that is gone (deleted, another user's) or no longer parses: the lens has
  // nothing to commit to blind, and running it without the data would bring back the
  // ungrounded review the single path removed.
  if (!groundingContext) {
    return NextResponse.json({ error: "the analysis's dataset could not be read: re-run the analysis with a new one" }, { status: 400 });
  }

  // An override without an effort is not a complete override: resolveAiSettings then
  // reads the user's stored default, which the Deep Value floor below starts from. An
  // effort named without a model applies to the stored model (until 2026-10-29 it was
  // silently dropped, so the run went at the stored effort).
  let aiSettings = await resolveAiSettings(
    userId,
    body.model
      ? { model: body.model, effort: body.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking }
      : body.effort
        ? { effort: body.effort, thinking: body.thinking }
        : undefined,
    DEFAULT_SETTINGS
  );
  // No effort chosen for this run: a lens starts at the same floor as the report it
  // reviews — the higher of the global default and xhigh (types/ai-settings.ts).
  if (body.effort == null) {
    aiSettings = { ...aiSettings, effort: deepValueDefaultEffort(aiSettings.model, aiSettings.effort) };
  }

  const mosPercent = row.mosPercent;
  return {
    id: body.analysisId,
    userId,
    angle,
    phase: body.phase,
    row,
    language: body.language,
    isItalian: body.language === "Italiano" || body.language === "Italian",
    aiSettings,
    // Always blind-first: the system prompt describes both phases, the same in both requests.
    systemPrompt: buildAnalystSystemPrompt({ angle, language: body.language, currentDate, mosPercent, grounding: groundingContext }),
    blindUserPrompt: buildAnalystBlindUserPrompt({
      ticker: body.ticker,
      language: body.language,
      currentDate,
      currentPrice,
      currency,
      mosPercent,
      grounding: groundingContext,
    }),
    reportMd: stripJsonBlock(row.reportMd),
    currentDate,
    currentPrice,
    currency,
    groundingContext,
    // Deterministic gates on the BASE report's own declared bridge, for Phase 2's user
    // message. Undefined without a full triple or any price — the prompts then omit them.
    baseGatesText: buildBaseGatesText(row, groundingContext.extract, currentPrice, currency),
  };
}

/** One phase, from its stage event to the row's write. Never throws. */
async function streamLensPhase(lens: LensContext, controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  const ch = createSseChannel(controller);
  const startedMs = Date.now();
  let outcome = "error";
  // Opens every request: flushes the response headers before a model call that can run
  // for minutes, and gives the panel its phase label.
  ch.send({ type: "stage", stage: lens.phase });
  try {
    outcome = lens.phase === "blind" ? await runBlindPhase(lens, ch) : await runReconcilePhase(lens, ch);
  } catch (err) {
    console.error(`[ai-run] verify ${lens.angle} ${lens.phase} failed`, err);
    outcome = "error";
    ch.send({ type: "error", error: runErrorMessage(err, lens.language), retryable: isRetryableRunError(err) });
  } finally {
    console.info("[ai-run]", "verify", lens.angle, lens.phase, `${Date.now() - startedMs}ms`, lens.aiSettings.model, lens.aiSettings.effort, outcome);
    ch.close();
  }
}

type Channel = ReturnType<typeof createSseChannel>;

function modelParams(lens: LensContext) {
  return {
    model: lens.aiSettings.model,
    thinking: buildThinkingParam(lens.aiSettings.thinking, lens.aiSettings.model, lens.aiSettings.effort),
    output_config: buildEffortConfig(lens.aiSettings.effort),
    system: lens.systemPrompt,
    tools: buildWebSearchTools(lens.aiSettings.model),
    // Phase 1 writes the prefix (system + tools + the blind message) to the prompt cache and
    // Phase 2, seconds later, sends the same prefix and reads it back — unlike this app's
    // other AI calls, which never get a second hit inside the cache TTL. A read only happens
    // at a breakpoint in the current request, so both phases set it.
    ...buildPromptCacheParam(lens.aiSettings.model),
  };
}

/** Phase 1: the commitment from the data alone, persisted with its rationale. */
async function runBlindPhase(lens: LensContext, ch: Channel): Promise<string> {
  const turn = await runStreamWithToolLoop(
    getAiClient(lens.aiSettings.model),
    {
      ...modelParams(lens),
      // Ceiling, not target: Phase 1 is a JSON block + a ≤200-word rationale, not a full
      // critique.
      max_tokens: 32000,
      messages: [{ role: "user", content: lens.blindUserPrompt }],
    },
    // Accumulate only — never forwarded. Half of Phase 1's text would read as "I don't
    // see the report yet, so..."; it's an internal artifact until it's parsed.
    () => {},
    GROUNDED_MAX_TOOL_ITERATIONS
  );

  // A refused Phase 1 (pre-output, or mid-stream after a partial block) is never trusted
  // as a commitment: Phase 2 then degrades to a single-phase review.
  const picked = turn.stopReason === "refusal" ? null : pickBlindCommitment(turn.text);
  const clean = picked ? sanitizeDeepValueResult(picked.result) : null;
  const blind = hasFullTriple(clean) ? clean : null;
  const phase1Quote = lens.currentPrice != null ? { price: lens.currentPrice, currency: lens.currency } : null;
  const count = await saveLensBlind(lens.id, lens.userId, lens.angle, blind && picked ? { ...blind, rationale: picked.rationale, phase1Quote } : null);
  if (count === 0) {
    ch.send({ type: "error", error: runErrorMessage(new AnalysisRunGone(), lens.language), retryable: false });
    return "deleted";
  }
  ch.send({ type: "done", blind, degraded: blind === null });
  return turn.stopReason ?? "unknown";
}

/** Phase 2: the critique, from the commitment stored on the row. */
async function runReconcilePhase(lens: LensContext, ch: Channel): Promise<string> {
  const stored = parseBlindJson(lens.row.blindJson ?? "");
  const blind = hasFullTriple(stored) ? stored : null;
  const mosPercent = lens.row.mosPercent;

  // Three messages (2026-10-27), never Phase 1's transcript: the blind message rebuilt with
  // the same arguments (so dataset and price stay in view and the cached prefix matches),
  // the commitment as an assistant turn of text only — what the model itself produced —
  // and the reconcile prompt, which echoes the blind numbers and states the anti-anchoring
  // rule. Without a commitment (a degraded Phase 1) it is one single-phase review instead.
  const messages = blind
    ? [
        { role: "user" as const, content: lens.blindUserPrompt },
        { role: "assistant" as const, content: buildBlindAssistantTurn(blind, stored?.rationale ?? "") },
        {
          role: "user" as const,
          content: buildAnalystReconcileUserPrompt({
            ticker: lens.row.ticker,
            reportMd: lens.reportMd,
            language: lens.language,
            currentDate: lens.currentDate,
            mosPercent,
            blind: { bear: blind.bear.fairValue, base: blind.base.fairValue, bull: blind.bull.fairValue },
            gatesText: lens.baseGatesText,
          }),
        },
      ]
    : [
        {
          role: "user" as const,
          content: buildAnalystUserPrompt({
            angle: lens.angle,
            ticker: lens.row.ticker,
            reportMd: lens.reportMd,
            language: lens.language,
            currentDate: lens.currentDate,
            currentPrice: lens.currentPrice,
            currency: lens.currency,
            mosPercent,
            grounding: lens.groundingContext,
            gatesText: lens.baseGatesText,
          }),
        },
      ];

  // Text before the critique marker is reasoning the model writes between web-search
  // calls: dropped, as in the Deep Value route. `forwarded` is what reached the client —
  // and what the row stores as the critique, notes included.
  const gate = createStreamGate(CRITIQUE_START_MARKER);
  let forwarded = "";
  const forward = (text: string) => {
    if (!text) return;
    forwarded += text;
    ch.send({ type: "text", text });
  };

  const turn = await runStreamWithToolLoop(
    getAiClient(lens.aiSettings.model),
    {
      ...modelParams(lens),
      // 16k was too low: with xhigh adaptive thinking + web search, the reasoning tokens
      // (which count toward max_tokens) consumed almost the whole budget before the visible
      // critique finished. Ceiling, not target — streaming, so no HTTP-timeout risk.
      max_tokens: 64000,
      messages,
    },
    (text) => forward(gate.push(text)),
    // Reconciliation, not research — far fewer rounds needed than either research cap.
    RECONCILE_MAX_TOOL_ITERATIONS
  );

  const rest = gate.flush();
  forward(rest);
  if (!gate.opened()) console.warn("[verify] critique marker never arrived; flushed", rest.length);
  // Close a fence cut by max_tokens BEFORE any route note: a note written while the fence
  // is still open lands inside it, and stripJsonBlock then hides the note with the broken
  // block (the Phase-1 note below did, until 2026-10-29).
  if (turn.stopReason === "max_tokens" && stripTrailingOpenJsonFence(forwarded) !== forwarded) forward("\n```\n");

  const { isItalian } = lens;
  if (!blind) {
    forward(
      `\n\n${
        isItalian
          ? "_[La Fase 1 (valutazione cieca, prima di leggere il report) non si è completata: nessun impegno cieco valido è stato prodotto, quindi questa è una revisione a turno singolo senza confronto cieco-finale.]_"
          : "_[Phase 1 (the blind valuation, before reading the report) did not complete: no valid blind commitment was produced, so this is a single-phase review with no blind-vs-final comparison.]_"
      }`
    );
  }
  // A lens has no failed outcome on its stop reason: the note says what happened, and a
  // final JSON that is missing clears the lens's numbers (saveLensFinal).
  if (turn.stopReason === "max_tokens") {
    forward(`\n\n${isItalian ? "_[Revisione troncata: raggiunto il limite di lunghezza. Riavviala per rigenerarla.]_" : "_[Review truncated: length limit reached. Re-run it to regenerate.]_"}`);
  } else if (turn.stopReason === "refusal") {
    forward(`\n\n${isItalian ? "_[Il modello ha rifiutato questa revisione. Riavviala o scegli un altro modello.]_" : "_[The model declined this review. Re-run it or pick another model.]_"}`);
  } else if (turn.hitIterationCap) {
    forward(`\n\n${isItalian ? "_[Revisione interrotta: troppi cicli di ricerca web. Riavviala per rigenerarla.]_" : "_[Review stopped: too many web search rounds. Re-run it to regenerate.]_"}`);
  }
  if (turn.servedBy) forward(`\n\n${fallbackNote(lens.aiSettings.model, turn.servedBy, isItalian)}`);

  const count = await saveLensFinal(lens.id, lens.userId, lens.angle, { critiqueMd: stripJsonBlock(forwarded), result: parseDeepValueJson(forwarded) });
  if (count === 0) {
    ch.send({ type: "error", error: runErrorMessage(new AnalysisRunGone(), lens.language), retryable: false });
    return "deleted";
  }
  ch.send({ type: "done" });
  return turn.stopReason ?? "unknown";
}
