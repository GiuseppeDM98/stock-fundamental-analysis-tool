"use client";

// The status line of an analysis whose run has not finished (2026-10-27): on /analyses it
// sits in the ticker's group above the card, on the detail page in place of the report.
// The server creates the row "running" when the valuation starts, so a run the platform
// cuts at 300 s (or a tab closed mid-stream) still leaves a row that says what happened.
//
// - running, younger than RUN_STALE_AFTER_MS: "in progress" and Delete only — it may be
//   alive in another tab, and the server refuses a second run on it anyway;
// - stale or failed: "interrupted", the run's error, and Retry — a link to /analyze, where
//   the retry starts from a click (never from the link's mount) — or, when the row's
//   dataset is gone, Run again (a new row on a new dataset); Delete always.
//
// A Deep Value run in four requests (2026-11-22) names its phase: the one running, the one
// it was cut in, and what Retry will do (resume from that phase within the hour, start over
// after it). Between two phases no request is in flight (runStartedAt null): the tab was
// closed there, nothing was cut, and the line shows only what Retry will do.
//
// `now` is one instant the parent takes at mount (null until then): never a clock in render.
import { useLanguage } from "@/context/language-context";
import { isRunStale, retryPlanOf, runStateOf } from "@/lib/report/run-status";
import { isDeepValuePhase, type DeepValuePhase } from "@/types/ai-run";
import type { Language, Translations } from "@/lib/i18n/translations";
import type { SavedAnalysis } from "@/types/analysis";

/** The label of each phase of a Deep Value run. */
export const DEEP_VALUE_PHASE_LABEL: Record<DeepValuePhase, keyof Translations> = {
  update: "runPhaseUpdate",
  valuation: "runPhaseValuation",
  report1: "runPhaseReport1",
  report2: "runPhaseReport2",
};

/** A phase's label inside a sentence ("Riprova da: valutazione"): Italian lowercases it,
 *  English keeps its capital ("Retry from: Valuation"). */
export function phaseInSentence(t: (key: keyof Translations) => string, language: Language, phase: DeepValuePhase): string {
  const label = t(DEEP_VALUE_PHASE_LABEL[phase]);
  return language === "it" ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** What Retry will do, in words: resume from the phase reached, or start over. */
export function retryPlanText(
  t: (key: keyof Translations) => string,
  language: Language,
  row: { runPhase?: string | null; createdAt: string },
  now: number
): string {
  const plan = retryPlanOf(row, now);
  return plan.restart ? t("runRetryRestart") : t("runRetryFrom").replace("{phase}", phaseInSentence(t, language, plan.phase));
}

type RunRow = Pick<SavedAnalysis, "id" | "ticker" | "runStatus" | "runStartedAt" | "runError" | "datasetId" | "runPhase" | "createdAt">;

export default function AnalysisRunStatus({
  analysis,
  now,
  deleting = false,
  onDelete,
}: {
  analysis: RunRow;
  now: number | null;
  deleting?: boolean;
  onDelete: (id: string) => void;
}) {
  const { t, language } = useLanguage();
  const phase = isDeepValuePhase(analysis.runPhase) ? analysis.runPhase : null;
  const state = now == null ? "running" : runStateOf(analysis, now);
  const interrupted = state === "stale" || state === "failed";
  // A phased row: a request was in flight when it stopped (cut, or failed), or none was.
  const cutInPhase = phase != null && (analysis.runStatus === "failed" || (analysis.runStartedAt != null && now != null && isRunStale(analysis, now)));
  // The minutes since the run started: createdAt on a phased row (runStartedAt is only the
  // request in flight), runStartedAt on an older one.
  const since = phase != null ? analysis.createdAt : analysis.runStartedAt;
  const minutes = now != null && since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000)) : 0;
  const ticker = encodeURIComponent(analysis.ticker);
  const action = "tap rounded-lg border px-3 py-1.5 text-xs font-medium transition";

  let headline: string;
  if (!interrupted) headline = phase ? t("runRunningPhase").replace("{phase}", phaseInSentence(t, language, phase)) : t("analysisRunning").replace("{m}", String(minutes));
  else if (cutInPhase && phase) headline = t("runCutAtPhase").replace("{phase}", phaseInSentence(t, language, phase));
  else headline = t("analysisCut");
  const retryLabel = phase != null && now != null ? retryPlanText(t, language, analysis, now) : t("analysisRetry");

  return (
    <div
      data-testid="analysis-run-status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 print:hidden ${
        interrupted ? "border-amber-700/50 bg-amber-500/5" : "border-slate-700/60 bg-slate-800/30"
      }`}
    >
      <div className="min-w-0 space-y-0.5">
        <p className={`text-sm ${interrupted ? "text-amber-300" : "text-slate-300"}`}>
          <span className="mr-2 font-mono font-semibold text-sky-400">{analysis.ticker}</span>
          {headline}
        </p>
        {!interrupted && phase && <p className="text-xs text-muted">{t("analysisRunning").replace("{m}", String(minutes))}</p>}
        {interrupted && analysis.runError && <p className="text-xs text-amber-200/80">{analysis.runError}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {interrupted &&
          (analysis.datasetId != null ? (
            <a
              href={`/analyze?ticker=${ticker}&resume=${encodeURIComponent(analysis.id)}`}
              className={`${action} border-violet-600 text-violet-200 hover:bg-violet-900/30`}
            >
              {retryLabel}
            </a>
          ) : (
            <a href={`/analyze?ticker=${ticker}`} className={`${action} border-violet-600 text-violet-200 hover:bg-violet-900/30`}>
              {t("analysisRelaunch")}
            </a>
          ))}
        <button
          onClick={() => onDelete(analysis.id)}
          disabled={deleting}
          className={`${action} border-slate-700 text-slate-400 hover:border-red-500/50 hover:text-red-400 disabled:opacity-50`}
        >
          {t("deleteBtn")}
        </button>
      </div>
    </div>
  );
}
