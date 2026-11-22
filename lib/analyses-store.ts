// Every write of a staged run (2026-10-27). On Vercel Hobby a function is stopped at 300 s
// whatever it is streaming, so nothing a run produces may wait for the client: the row is
// created "running" when the valuation starts, and each phase's result is written here, by
// the server, the moment it arrives (after the staged "Consulente" run of
// net-worth-tracker). The client only reads.
//
// Every write that ends a phase is an updateMany scoped to the row, its user and — for the
// Deep Value — the start time of THIS request, and returns how many rows it touched: a
// request that a newer one took over, or a row deleted during the run, touches none, and
// the route ends the phase quietly instead of overwriting (or resurrecting) anything.
//
// A Deep Value run is four requests since 2026-11-22 (types/ai-run.ts): each takes the row
// for its phase with a conditional update (claimRunPhase) and leaves it, written, at the
// next phase with no request in flight (runStartedAt null).
//
// A lens's columns are always named through ANALYST_COLUMNS, never written by hand.
import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import { canRetry, retryPlanOf } from "@/lib/report/run-status";
import type { Phase1Quote } from "@/lib/report/parse-deep-value-json";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";
import type { AnalystAngle } from "@/types/analysis";
import type { DeepValuePhase } from "@/types/ai-run";
import { capEffort, isAiEffort } from "@/types/ai-settings";
import type { AnalystResult } from "@/components/report/types";

/** One request of a valuation: the row, its owner and when this request started. */
export type RunHandle = { id: string; userId: string; runStartedAt: Date };

export type NewRunInput = {
  ticker: string;
  companyName: string;
  datasetId: string;
  mosPercent: number;
  reportLanguage: string;
  aiModel: string;
  aiEffort: string;
  aiThinking: boolean;
  priceAtAnalysis: number | null;
  priceCurrency: string | null;
};

/** What a retry re-runs with: everything comes from the row, nothing from the body. */
export type ResumeInputs = {
  ticker: string;
  companyName: string;
  datasetId: string;
  mosPercent: number;
  reportLanguage: string | null;
  aiModel: string | null;
  aiEffort: string | null;
  aiThinking: boolean | null;
};

// The valuation's columns: what a phase from the valuation on clears when it runs again.
const CLEARED_VALUATION = {
  resultJson: null,
  fairValueBull: null,
  fairValueBase: null,
  fairValueBear: null,
  valuationMethod: null,
  currency: null,
  sector: null,
  valuationMemo: null,
} as const;

// What a phase clears when it runs again: its own output and everything written after it.
// `update` also drops the quote: the phase that runs without one takes a new one, so a
// restart whose quote failed never leaves an old price under a new date.
const CLEARED_FROM: Record<DeepValuePhase, Prisma.AnalysisUpdateManyMutationInput> = {
  update: { updateNotesMd: null, ...CLEARED_VALUATION, reportMd: "", priceAtAnalysis: null, priceCurrency: null },
  valuation: { ...CLEARED_VALUATION, reportMd: "" },
  report1: { reportMd: "" },
  report2: {},
};

/** Creates the row of a new valuation, "running" at its first phase, dated now. */
export async function startAnalysisRun(userId: string, input: NewRunInput): Promise<RunHandle> {
  const now = new Date();
  const row = await db.analysis.create({
    data: {
      userId,
      ticker: input.ticker,
      companyName: input.companyName,
      reportMd: "",
      mosPercent: input.mosPercent,
      datasetId: input.datasetId,
      reportLanguage: input.reportLanguage,
      aiModel: input.aiModel,
      aiEffort: input.aiEffort,
      aiThinking: input.aiThinking,
      priceAtAnalysis: input.priceAtAnalysis,
      priceCurrency: input.priceCurrency,
      runStatus: "running",
      runPhase: "update",
      runStartedAt: now,
      createdAt: now,
    },
    select: { id: true },
  });
  return { id: row.id, userId, runStartedAt: now };
}

/** One phase's attempt: the handle its writes are keyed on, and what it runs with. */
export type ClaimedPhase = RunHandle &
  ResumeInputs & {
    phase: DeepValuePhase;
    restarted: boolean;
    createdAt: Date;
    priceAtAnalysis: number | null;
    priceCurrency: string | null;
    updateNotesMd: string | null;
    resultJson: string | null;
    valuationMemo: string | null;
    reportMd: string;
  };

const CLAIM_SELECT = {
  id: true,
  ticker: true,
  companyName: true,
  datasetId: true,
  mosPercent: true,
  reportLanguage: true,
  aiModel: true,
  aiEffort: true,
  aiThinking: true,
  runStatus: true,
  runStartedAt: true,
  runPhase: true,
  createdAt: true,
  priceAtAnalysis: true,
  priceCurrency: true,
  updateNotesMd: true,
  resultJson: true,
  valuationMemo: true,
  reportMd: true,
} as const satisfies Prisma.AnalysisSelect;

/**
 * Takes the user's run for one phase, before any quote or dataset is read.
 * @param wanted - The phase the panel is chaining to: the row must be running, with no
 *   request in flight, at that very phase (a failed or cut row is a Retry's, never a
 *   chain's). null for a Retry, where the row decides: the phase it reached, or the first
 *   one with everything cleared once the run is older than RUN_RESUME_WINDOW_MS.
 * @throws AnalysisRunNotFound for a row that is missing or another user's;
 *   AnalysisRunConflict when it is done, has a request in flight younger than
 *   RUN_RETRY_AFTER_MS, has lost its dataset, is not where a chain expects it, or was
 *   taken meanwhile.
 * @returns the attempt; on a restart the row's later columns are already cleared and
 *   `createdAt` is now (the date of a report is the start of the run that produced it).
 */
export async function claimRunPhase(userId: string, analysisId: string, wanted: DeepValuePhase | null, now: Date = new Date()): Promise<ClaimedPhase> {
  const row = await db.analysis.findFirst({ where: { id: analysisId, userId }, select: CLAIM_SELECT });
  if (!row) throw new AnalysisRunNotFound();
  if (row.runStatus !== "running" && row.runStatus !== "failed") throw new AnalysisRunConflict("run already finished");
  if (!canRetry(row, now.getTime())) throw new AnalysisRunConflict("run still in progress");
  if (row.datasetId == null) throw new AnalysisRunConflict("dataset no longer available");
  if (wanted !== null && (row.runStatus !== "running" || row.runStartedAt != null || row.runPhase !== wanted)) {
    throw new AnalysisRunConflict("phase out of order");
  }

  const plan = wanted === null ? retryPlanOf(row, now.getTime()) : { phase: wanted, restart: false };
  // A row saved above the cap runs at `high`: the column says the effort that runs.
  const aiEffort = row.aiEffort != null && isAiEffort(row.aiEffort) ? capEffort(row.aiEffort, "high") : row.aiEffort;
  const data: Prisma.AnalysisUpdateManyMutationInput = plan.restart
    ? { ...CLEARED_FROM.update, aiEffort, runStatus: "running", runPhase: "update", runStartedAt: now, createdAt: now, runError: null }
    : { ...CLEARED_FROM[plan.phase], aiEffort, runStatus: "running", runStartedAt: now, runError: null };
  // The claim is the conditional update: a second request for the same phase finds the
  // start it read already replaced, and touches no row.
  const { count } = await db.analysis.updateMany({
    where: { id: row.id, userId, runStatus: row.runStatus, runStartedAt: row.runStartedAt },
    data,
  });
  if (count === 0) throw new AnalysisRunConflict("run still in progress");

  // The row as it now stands: what the phase cleared reads cleared.
  const after = { ...row, ...(data as Record<string, unknown>) } as typeof row;
  return {
    id: row.id,
    userId,
    runStartedAt: now,
    ticker: row.ticker,
    companyName: row.companyName,
    datasetId: row.datasetId,
    mosPercent: row.mosPercent,
    reportLanguage: row.reportLanguage,
    aiModel: row.aiModel,
    aiEffort: after.aiEffort,
    aiThinking: row.aiThinking,
    phase: plan.phase,
    restarted: plan.restart,
    createdAt: plan.restart ? now : row.createdAt,
    priceAtAnalysis: after.priceAtAnalysis,
    priceCurrency: after.priceCurrency,
    updateNotesMd: after.updateNotesMd,
    resultJson: after.resultJson,
    valuationMemo: after.valuationMemo,
    reportMd: after.reportMd,
  };
}

function attemptWhere(handle: RunHandle): Prisma.AnalysisWhereInput {
  return { id: handle.id, userId: handle.userId, runStartedAt: handle.runStartedAt };
}

/** The quote of a phase that runs without one (null, null without one). @returns rows touched. */
export async function setRunPrice(handle: RunHandle, priceAtAnalysis: number | null, priceCurrency: string | null): Promise<number> {
  const { count } = await db.analysis.updateMany({ where: attemptWhere(handle), data: { priceAtAnalysis, priceCurrency } });
  return count;
}

/** The web update's notes; the run moves to the valuation, with no request in flight.
 *  @returns rows touched: 0 when the row was deleted or a newer request owns it. */
export async function finishUpdatePhase(handle: RunHandle, updateNotesMd: string): Promise<number> {
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: { updateNotesMd, runPhase: "valuation", runStartedAt: null },
  });
  return count;
}

/** A memo longer than this is cut: it travels into both report requests. */
export const VALUATION_MEMO_MAX_CHARS = 4000;

/**
 * The fixed valuation: the numbers every reader uses once the run is done, and its memo. The
 * method and sector are trimmed to their columns, the currency kept only as a bare ISO 4217
 * code ("EUR (euro)" would mislabel every figure it travels with). The row stays running:
 * every reader skips it until the report is written.
 * @returns rows touched: 0 when the row was deleted or a newer request owns it.
 */
export async function finishValuationPhase(handle: RunHandle, { result, memo }: { result: AnalystResult; memo: string }): Promise<number> {
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: {
      resultJson: JSON.stringify(result),
      fairValueBull: result.bull.fairValue,
      fairValueBase: result.base.fairValue,
      fairValueBear: result.bear.fairValue,
      valuationMethod: result.method.slice(0, 40),
      currency: /^[A-Z]{3}$/.test(result.currency) ? result.currency : null,
      sector: result.sector ? result.sector.slice(0, 80) : null,
      valuationMemo: memo.slice(0, VALUATION_MEMO_MAX_CHARS),
      runPhase: "report1",
      runStartedAt: null,
    },
  });
  return count;
}

/** One part of the report. The first is kept on the row for the second to continue; the
 *  second writes the whole report and ends the run.
 *  @returns rows touched: 0 when the row was deleted or a newer request owns it. */
export async function finishReportPart(handle: RunHandle, { reportMd, last }: { reportMd: string; last: boolean }): Promise<number> {
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: last
      ? { reportMd, runStatus: "done", runPhase: null, runError: null }
      : { reportMd, runPhase: "report2", runStartedAt: null },
  });
  return count;
}

/** Marks the attempt failed with a product sentence (never the provider's raw message). What
 *  the earlier phases wrote stays: a failed second half keeps the first, and a Retry within
 *  the hour resumes from the phase that failed. */
export async function failAnalysisRun(handle: RunHandle, message: string): Promise<number> {
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: { runStatus: "failed", runError: message.slice(0, 300) },
  });
  return count;
}

/**
 * Writes a lens's blind commitment (with its rationale) and clears the lens's final
 * columns in the same update: a new Phase 1 makes the previous Phase 2 stale, and "blind
 * present, critique absent" is how the panel knows Phase 2 is still to run. A degraded
 * Phase 1 (null) clears the blind column too.
 * @returns rows touched.
 */
export async function saveLensBlind(
  id: string,
  userId: string,
  angle: AnalystAngle,
  blind: (AnalystResult & { rationale: string; phase1Quote: Phase1Quote }) | null
): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = {
    [c.blind]: blind ? JSON.stringify(blind) : null,
    [c.critique]: null,
    [c.bull]: null,
    [c.base]: null,
    [c.bear]: null,
    [c.method]: null,
    [c.result]: null,
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId }, data });
  return count;
}

/**
 * Writes a lens's critique and clears its numbers in the same update: a new critique makes
 * the previous final valuation stale, and "critique present, result absent" is how the panel
 * knows the final numbers are still to run.
 * @returns rows touched.
 */
export async function saveLensCritique(id: string, userId: string, angle: AnalystAngle, critiqueMd: string): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = {
    [c.critique]: critiqueMd,
    [c.bull]: null,
    [c.base]: null,
    [c.bear]: null,
    [c.method]: null,
    [c.result]: null,
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId }, data });
  return count;
}

/**
 * Writes a lens's final valuation next to the critique it answers.
 * @param critiqueMd - The critique the final request read from the row: a row whose critique
 *   is no longer that text (a new Phase 1 cleared it, or another tab wrote a new one) is not
 *   touched, so numbers never sit next to a critique that did not produce them.
 * @returns rows touched.
 */
export async function saveLensResult(id: string, userId: string, angle: AnalystAngle, critiqueMd: string, result: AnalystResult): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = {
    [c.bull]: result.bull.fairValue,
    [c.base]: result.base.fairValue,
    [c.bear]: result.bear.fairValue,
    [c.method]: result.method.slice(0, 40),
    [c.result]: JSON.stringify(result),
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId, [c.critique]: critiqueMd } as Prisma.AnalysisWhereInput, data });
  return count;
}

export type LensRow = {
  runStatus: string;
  reportMd: string;
  datasetId: string | null;
  groundingJson: string | null;
  mosPercent: number;
  reportLanguage: string | null;
  ticker: string;
  blindJson: string | null;
  // The lens's own critique: the assistant turn the final request answers to.
  critiqueMd: string | null;
  // For the base report's gates: its result column, the price saved with it (in the
  // quote's own currency) and the save date the prompt quotes when the quote fails.
  resultJson: string | null;
  priceAtAnalysis: number | null;
  priceCurrency: string | null;
  createdAt: Date;
};

/** The row a lens phase runs on, or null when it is missing or another user's. */
export async function readLensRow(id: string, userId: string, angle: AnalystAngle): Promise<LensRow | null> {
  const { blind: blindColumn, critique: critiqueColumn } = ANALYST_COLUMNS[angle];
  const row = (await db.analysis.findFirst({
    where: { id, userId },
    select: {
      runStatus: true,
      reportMd: true,
      datasetId: true,
      groundingJson: true,
      mosPercent: true,
      reportLanguage: true,
      ticker: true,
      resultJson: true,
      priceAtAnalysis: true,
      priceCurrency: true,
      createdAt: true,
      [blindColumn]: true,
      [critiqueColumn]: true,
    } as Prisma.AnalysisSelect,
  })) as (Omit<LensRow, "blindJson" | "critiqueMd"> & Record<string, unknown>) | null;
  if (!row) return null;
  const blind = row[blindColumn];
  const critique = row[critiqueColumn];
  return { ...row, blindJson: typeof blind === "string" ? blind : null, critiqueMd: typeof critique === "string" ? critique : null } as LensRow;
}
