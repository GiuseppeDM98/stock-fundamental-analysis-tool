// The three runners of a Deep Value run's four requests (2026-11-22): the web update, the
// valuation, and a half of the report. Each runs one model call for the phase the route
// claimed, writes its result on the row (lib/analyses-store.ts) before it answers `done`,
// and leaves the row at the next phase with no request in flight — so a stream lost after
// the write is not a cut, and the panel chains on (components/use-deep-value-run.ts).
//
// Each phase has its own role, model and tools: the update collects facts with web search
// on Sonnet 5.5 (collecting needs no larger model); the valuation and the report run on the
// run's model with no tools, so neither can wander back into research, and both stay well
// under the 300 s a function lives on Vercel Hobby. The report explains numbers already
// fixed: the server, not the model, appends the valuation's JSON as its last fence.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { runStreamWithToolLoop, buildPromptCacheParam } from "@/lib/ai/tool-loop";
import { createStreamGate } from "@/lib/ai/stream-gate";
import { fallbackNote } from "@/lib/ai/fallback";
import { classifyRunEnd, classifyValuationEnd } from "@/lib/ai/run-outcome";
import { runErrorMessage } from "@/lib/ai/error-status";
import { updatePhaseSettings } from "@/lib/ai/ai-preferences";
import type { createSseChannel } from "@/lib/ai/sse";
import {
  UPDATE_MAX_SEARCHES,
  buildUpdateSystemPrompt,
  buildUpdateUserPrompt,
  buildValuationSystemPrompt,
  buildValuationUserPrompt,
  buildReportSystemPrompt,
  buildReportUserPrompt,
  buildReportContinuationPrompt,
} from "@/lib/ai/deep-value-prompts";
import {
  NOTES_START_MARKER,
  REPORT_START_MARKER,
  hasFullTriple,
  parseDeepValueJson,
  stripJsonBlock,
  withResultFence,
} from "@/lib/report/parse-deep-value-json";
import {
  failAnalysisRun,
  finishReportPart,
  finishUpdatePhase,
  finishValuationPhase,
  VALUATION_MEMO_MAX_CHARS,
  type ClaimedPhase,
} from "@/lib/analyses-store";
import { AnalysisRunGone } from "@/lib/analysis-run-errors";
import { callSiteDefaultEffort, capEffort, type AiEffort, type AiSettings } from "@/types/ai-settings";
import type { DeepValuePhase } from "@/types/ai-run";
import type { GroundingPromptContext } from "@/lib/grounding/prompt-format";
import type { StoredDataset } from "@/types/dataset";

// The lever if the valuation runs past 240 s in a real run: `medium` (decided 2026-11-20).
const VALUATION_EFFORT_CEILING: AiEffort = "high";

// The web update's rounds: Claude's searches resume a paused turn at most a few times under
// their own cap; on DeepSeek, whose search is the client's tool, the rounds are the only cap.
const UPDATE_MAX_TOOL_ITERATIONS = 10;

type Channel = ReturnType<typeof createSseChannel>;

/** What one phase runs with: the claimed row, its dataset and the run's frozen inputs. */
export type PhaseContext = {
  claimed: ClaimedPhase;
  stored: StoredDataset;
  // Built on the row's price and currency, so both report halves send the same prefix.
  grounding: GroundingPromptContext;
  language: string;
  // The run's date (its createdAt), never today's: one report, one date.
  currentDate: string;
  currentPrice: number;
  currency: string;
  // The run's own settings, as the row records them.
  aiSettings: AiSettings;
};

/** The model, effort and thinking each phase runs on: the update on Sonnet 5.5 (on DeepSeek
 *  the run's model), the valuation capped by its lever, the report at the run's own effort
 *  (it has no lever: the user's selector holds for it in full). */
export function phaseModelSettings(phase: DeepValuePhase, run: AiSettings): AiSettings {
  if (phase === "update") return updatePhaseSettings(run.model);
  if (phase === "valuation") return { ...run, effort: callSiteDefaultEffort(run.model, capEffort(run.effort, VALUATION_EFFORT_CEILING)) };
  return { ...run, effort: callSiteDefaultEffort(run.model, run.effort) };
}

function isItalian(language: string): boolean {
  return language === "Italiano" || language === "Italian";
}

function modelBase(settings: AiSettings) {
  return {
    model: settings.model,
    thinking: buildThinkingParam(settings.thinking, settings.model),
    output_config: buildEffortConfig(settings.effort),
  };
}

/** Ends the phase failed: the row says why, the client gets the same sentence. */
async function failPhase(ctx: PhaseContext, ch: Channel, message: string, retryable: boolean): Promise<void> {
  await failAnalysisRun(ctx.claimed, message);
  ch.send({ type: "error", error: message, retryable });
}

/** A phase whose inputs are not on the row (a write that never landed): no model call. */
async function failMissingInput(ctx: PhaseContext, ch: Channel, what: string): Promise<string> {
  console.warn(`[deep-value] ${ctx.claimed.phase}: ${what} missing on the row`);
  await failPhase(ctx, ch, runErrorMessage(new Error(`${what} missing`), ctx.language), false);
  return "missing_input";
}

/** A write that touched no row: the row was deleted, or a newer request owns it. */
function sendGone(ctx: PhaseContext, ch: Channel): string {
  ch.send({ type: "error", error: runErrorMessage(new AnalysisRunGone(), ctx.language), retryable: false });
  return "deleted";
}

/** Streams the text after `marker` to the client and returns what was forwarded. The text
 *  before it is the model's commentary between searches: dropped. */
function gatedForwarder(marker: string, ch: Channel) {
  const gate = createStreamGate(marker);
  let forwarded = "";
  const forward = (text: string) => {
    if (!text) return;
    forwarded += text;
    ch.send({ type: "text", text });
  };
  return {
    push: (text: string) => forward(gate.push(text)),
    // Failsafe (gotcha 26): a marker that never came still leaves the text, not nothing.
    flush: (label: string) => {
      const rest = gate.flush();
      forward(rest);
      if (!gate.opened()) console.warn(`[deep-value] ${label} marker never arrived; flushed`, rest.length);
    },
    append: forward,
    text: () => forwarded,
  };
}

/** The web update: notes on what the dataset cannot hold, a source per fact. */
export async function runUpdatePhase(ctx: PhaseContext, ch: Channel): Promise<string> {
  const settings = phaseModelSettings("update", ctx.aiSettings);
  const meta = ctx.stored.dataset.meta;
  const out = gatedForwarder(NOTES_START_MARKER, ch);
  const turn = await runStreamWithToolLoop(
    getAiClient(settings.model),
    {
      ...modelBase(settings),
      // Notes under 600 words plus the reasoning between searches: a ceiling, not a target.
      max_tokens: 16000,
      system: buildUpdateSystemPrompt({ language: ctx.language, currentDate: ctx.currentDate }),
      // On DeepSeek the search is the client's tool and has no cap of its own: the rounds bind.
      tools: buildWebSearchTools(settings.model, { maxUses: UPDATE_MAX_SEARCHES }),
      messages: [
        {
          role: "user",
          content: buildUpdateUserPrompt({
            ticker: ctx.claimed.ticker,
            companyName: ctx.claimed.companyName,
            currency: ctx.currency,
            latestPeriodLabel: meta.latestPeriodLabel,
            fiscalYearEnd: meta.fiscalYearEnd,
            reportingCurrency: meta.reportingCurrency,
            researchNotes: ctx.stored.research?.notes ?? null,
          }),
        },
      ],
    },
    out.push,
    UPDATE_MAX_TOOL_ITERATIONS
  );
  out.flush("notes");

  const end = classifyRunEnd({ text: out.text(), stopReason: turn.stopReason, hitIterationCap: turn.hitIterationCap });
  if (end.kind === "failed") {
    await failPhase(ctx, ch, runErrorMessage(end, ctx.language), end.retryable);
    return turn.stopReason ?? "failed";
  }
  // Notes cut by the round cap are still notes: the valuation reads what they hold, and the
  // line tells it (and the reader) that they may be incomplete.
  const italian = isItalian(ctx.language);
  if (turn.hitIterationCap) {
    out.append(
      italian
        ? "\n\n_[Aggiornamento parziale: raggiunto il limite dei cicli di ricerca.]_"
        : "\n\n_[Partial update: the search-round limit was reached.]_"
    );
  }
  if (turn.servedBy) out.append(`\n\n${fallbackNote(settings.model, turn.servedBy, italian)}`);

  if ((await finishUpdatePhase(ctx.claimed, out.text())) === 0) return sendGone(ctx, ch);
  ch.send({ type: "done", analysisId: ctx.claimed.id });
  return turn.stopReason ?? "unknown";
}

/** The valuation: a rationale, then the JSON that fixes the numbers. Nothing is streamed. */
export async function runValuationPhase(ctx: PhaseContext, ch: Channel): Promise<string> {
  const { claimed } = ctx;
  if (!claimed.updateNotesMd) return failMissingInput(ctx, ch, "web update");
  const settings = phaseModelSettings("valuation", ctx.aiSettings);
  const turn = await runStreamWithToolLoop(
    getAiClient(settings.model),
    {
      ...modelBase(settings),
      // A rationale under 400 words and a JSON of about 3k tokens, plus the reasoning.
      max_tokens: 32000,
      system: buildValuationSystemPrompt({ language: ctx.language, currentDate: ctx.currentDate, mosPercent: claimed.mosPercent, grounding: ctx.grounding }),
      messages: [
        {
          role: "user",
          content: buildValuationUserPrompt({
            ticker: claimed.ticker,
            currentPrice: ctx.currentPrice,
            currency: ctx.currency,
            currentDate: ctx.currentDate,
            mosPercent: claimed.mosPercent,
            grounding: ctx.grounding,
            updateNotes: claimed.updateNotesMd,
          }),
        },
      ],
    },
    // The rationale is the report's input, not something to read while it is written.
    () => {},
    1
  );

  const result = parseDeepValueJson(turn.text);
  const full = hasFullTriple(result);
  const end = classifyValuationEnd({ stopReason: turn.stopReason, hasTriple: full });
  if (end.kind === "failed" || !full) {
    const failed = end.kind === "failed" ? end : ({ kind: "failed", reason: "no_valuation", retryable: true } as const);
    await failPhase(ctx, ch, runErrorMessage(failed, ctx.language), failed.retryable);
    return end.kind === "failed" ? failed.reason : "no_valuation";
  }

  // The rationale is the text before the JSON. An empty one does not fail the phase (the
  // numbers are the contract); a long one is cut, since both report requests carry it.
  const memo = stripJsonBlock(turn.text).trim();
  if (memo.length > VALUATION_MEMO_MAX_CHARS) console.warn("[deep-value] memo truncated", memo.length);
  if ((await finishValuationPhase(claimed, { result, memo })) === 0) return sendGone(ctx, ch);
  ch.send({ type: "done", analysisId: claimed.id });
  return turn.stopReason ?? "unknown";
}

/** A half of the report: sections 1-5, or 6-10 continuing the first half stored on the row. */
export async function runReportPart(ctx: PhaseContext, ch: Channel): Promise<string> {
  const { claimed } = ctx;
  const last = claimed.phase === "report2";
  if (!claimed.resultJson) return failMissingInput(ctx, ch, "valuation");
  if (last && !claimed.reportMd) return failMissingInput(ctx, ch, "first half of the report");
  const settings = phaseModelSettings(claimed.phase, ctx.aiSettings);

  // Byte for byte the same in both halves, every input read from the row: the second half
  // reads the first one's prompt cache only on an identical prefix.
  const firstMessage = buildReportUserPrompt({
    ticker: claimed.ticker,
    currentPrice: ctx.currentPrice,
    currency: ctx.currency,
    language: ctx.language,
    currentDate: ctx.currentDate,
    mosPercent: claimed.mosPercent,
    grounding: ctx.grounding,
    updateNotes: claimed.updateNotesMd ?? "",
    resultJson: claimed.resultJson,
    memo: claimed.valuationMemo ?? "",
  });
  const messages: Anthropic.MessageParam[] = last
    ? [
        { role: "user", content: firstMessage },
        // The first half as the server saved it: what the model continues.
        { role: "assistant", content: `${REPORT_START_MARKER}\n${claimed.reportMd}` },
        { role: "user", content: buildReportContinuationPrompt({ language: ctx.language }) },
      ]
    : [{ role: "user", content: firstMessage }];

  const out = gatedForwarder(REPORT_START_MARKER, ch);
  const turn = await runStreamWithToolLoop(
    getAiClient(settings.model),
    {
      ...modelBase(settings),
      // Five sections of a report, 5-8k tokens, plus the reasoning.
      max_tokens: 16000,
      system: buildReportSystemPrompt({ language: ctx.language, mosPercent: claimed.mosPercent }),
      // The two halves share system prompt and first message: the second reads the cache
      // the first wrote, seconds earlier (a read happens only at a breakpoint of the current
      // request, so both set it).
      ...buildPromptCacheParam(settings.model),
      messages,
    },
    out.push,
    1
  );
  out.flush("report");

  const end = classifyRunEnd({ text: out.text(), stopReason: turn.stopReason, hitIterationCap: turn.hitIterationCap });
  if (end.kind === "failed") {
    await failPhase(ctx, ch, runErrorMessage(end, ctx.language), end.retryable);
    return turn.stopReason ?? "failed";
  }
  if (turn.servedBy) out.append(`\n\n${fallbackNote(settings.model, turn.servedBy, isItalian(ctx.language))}`);

  const reportMd = last ? withResultFence(`${claimed.reportMd}\n\n${out.text()}`, claimed.resultJson) : out.text();
  if ((await finishReportPart(claimed, { reportMd, last })) === 0) return sendGone(ctx, ch);
  ch.send({ type: "done", analysisId: claimed.id });
  return turn.stopReason ?? "unknown";
}
