// Every write of a staged run (2026-10-27). On Vercel Hobby a function is stopped at 300 s
// whatever it is streaming, so nothing a run produces may wait for the client: the row is
// created "running" when the valuation starts, and each phase's result is written here, by
// the server, the moment it arrives (after the staged "Consulente" run of
// net-worth-tracker). The client only reads.
//
// Every write that ends a run is an updateMany scoped to the row, its user and — for the
// valuation — the start time of THIS attempt, and returns how many rows it touched: an
// attempt that a newer retry took over, or a row deleted during the run, touches none, and
// the route ends the phase quietly instead of overwriting (or resurrecting) anything.
//
// A lens's columns are always named through ANALYST_COLUMNS, never written by hand.
import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import { canRetry } from "@/lib/report/run-status";
import { hasFullTriple, type ParsedAnalystResult, type Phase1Quote } from "@/lib/report/parse-deep-value-json";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";
import type { AnalystAngle } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";

/** One attempt of a valuation: the row, its owner and when this attempt started. */
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

// The columns of a finished valuation, cleared when an attempt starts over: a retry must
// never show the previous attempt's numbers next to its own report.
const CLEARED_RESULT = {
  reportMd: "",
  resultJson: null,
  fairValueBull: null,
  fairValueBase: null,
  fairValueBear: null,
  valuationMethod: null,
  currency: null,
  sector: null,
  runError: null,
} as const;

/** Creates the row of a new valuation, "running", dated now. */
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
      runStartedAt: now,
      createdAt: now,
    },
    select: { id: true },
  });
  return { id: row.id, userId, runStartedAt: now };
}

/**
 * Takes over the user's row for a retry, before any quote or dataset is read.
 * @throws AnalysisRunNotFound for a row that is missing or another user's;
 *   AnalysisRunConflict when it is done, still running (younger than RUN_RETRY_AFTER_MS) or
 *   has lost its dataset.
 * @returns the new attempt and the row's inputs. The row is "running" again, dated now
 *   (the date of a report is the start of the attempt that produced it), with the previous
 *   attempt's result cleared.
 */
export async function resumeAnalysisRun(userId: string, analysisId: string): Promise<RunHandle & ResumeInputs> {
  const row = await db.analysis.findFirst({
    where: { id: analysisId, userId },
    select: {
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
    },
  });
  if (!row) throw new AnalysisRunNotFound();
  const now = new Date();
  if (row.runStatus !== "running" && row.runStatus !== "failed") throw new AnalysisRunConflict("run already finished");
  if (!canRetry(row, now.getTime())) throw new AnalysisRunConflict("run still in progress");
  if (row.datasetId == null) throw new AnalysisRunConflict("dataset no longer available");

  await db.analysis.update({
    where: { id: row.id },
    data: { ...CLEARED_RESULT, runStatus: "running", runStartedAt: now, createdAt: now },
  });
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
    aiEffort: row.aiEffort,
    aiThinking: row.aiThinking,
  };
}

function attemptWhere(handle: RunHandle): Prisma.AnalysisWhereInput {
  return { id: handle.id, userId: handle.userId, runStartedAt: handle.runStartedAt };
}

/** The quote of a retry's attempt (null, null without one). @returns rows touched. */
export async function setRunPrice(handle: RunHandle, priceAtAnalysis: number | null, priceCurrency: string | null): Promise<number> {
  const { count } = await db.analysis.updateMany({ where: attemptWhere(handle), data: { priceAtAnalysis, priceCurrency } });
  return count;
}

/**
 * Writes the finished report. The result is the server's own reading of the report's last
 * JSON fence: kept only with a full bull/base/bear triple (half a valuation is no
 * valuation), the method and sector trimmed to their columns, the currency only as a bare
 * ISO 4217 code ("EUR (euro)" would mislabel every figure it travels with).
 * @returns rows touched: 0 when the row was deleted or a newer attempt owns it.
 */
export async function finishAnalysisRun(handle: RunHandle, { reportMd, result }: { reportMd: string; result: ParsedAnalystResult | null }): Promise<number> {
  const full = hasFullTriple(result);
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: {
      reportMd,
      resultJson: full ? JSON.stringify(result) : null,
      fairValueBull: full ? result.bull.fairValue : null,
      fairValueBase: full ? result.base.fairValue : null,
      fairValueBear: full ? result.bear.fairValue : null,
      valuationMethod: full ? result.method.slice(0, 40) : null,
      currency: result && /^[A-Z]{3}$/.test(result.currency) ? result.currency : null,
      sector: result?.sector ? result.sector.slice(0, 80) : null,
      runStatus: "done",
      runError: null,
    },
  });
  return count;
}

/** Marks the attempt failed with a product sentence (never the provider's raw message).
 *  The report stays empty: a failed run's text was never a finished report. */
export async function failAnalysisRun(handle: RunHandle, message: string): Promise<number> {
  const { count } = await db.analysis.updateMany({
    where: attemptWhere(handle),
    data: { runStatus: "failed", runError: message.slice(0, 300), reportMd: "" },
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
 * Writes a lens's critique and final valuation. Without a full triple the lens's numbers
 * and result are written null, not left alone: a re-run whose JSON came back incomplete
 * must not keep the previous run's values next to the new critique.
 * @returns rows touched.
 */
export async function saveLensFinal(
  id: string,
  userId: string,
  angle: AnalystAngle,
  { critiqueMd, result }: { critiqueMd: string; result: ParsedAnalystResult | null }
): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const full = hasFullTriple(result);
  const data = {
    [c.critique]: critiqueMd,
    [c.bull]: full ? result.bull.fairValue : null,
    [c.base]: full ? result.base.fairValue : null,
    [c.bear]: full ? result.bear.fairValue : null,
    [c.method]: full ? result.method.slice(0, 40) : null,
    [c.result]: full ? JSON.stringify(result) : null,
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId }, data });
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
  // For the base report's gates: its result column, the price saved with it (in the
  // quote's own currency) and the save date the prompt quotes when the quote fails.
  resultJson: string | null;
  priceAtAnalysis: number | null;
  priceCurrency: string | null;
  createdAt: Date;
};

/** The row a lens phase runs on, or null when it is missing or another user's. */
export async function readLensRow(id: string, userId: string, angle: AnalystAngle): Promise<LensRow | null> {
  const blindColumn = ANALYST_COLUMNS[angle].blind;
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
    } as Prisma.AnalysisSelect,
  })) as (Omit<LensRow, "blindJson"> & Record<string, unknown>) | null;
  if (!row) return null;
  const blind = row[blindColumn];
  return { ...row, blindJson: typeof blind === "string" ? blind : null } as LensRow;
}
