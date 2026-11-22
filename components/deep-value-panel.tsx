"use client";

// Deep Value Panel — the model picks the valuation method on the user's confirmed dataset.
// A run is four requests (2026-11-22): the web update, the valuation, and the report in two
// halves; components/use-deep-value-run.ts chains them, and this panel shows the four
// phases, the web notes once the update ends and the report as it streams.
//
// A staged run (2026-10-27, after the "Consulente" run of net-worth-tracker): the route
// creates the Analysis row when the run starts and writes each phase as it ends, so this
// panel never saves anything, and once the run ends it reads the numbers and the price from
// the row the server wrote, never from the stream. A request the platform cuts at 300 s is
// a CUT: the panel shows the row and what Retry will do (resume from the phase reached
// within the hour, start over after it), once the server would accept it.
import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { fetchAnalysis } from "@/lib/analyses";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import ReportBody from "@/components/report/report-body";
import ReportShell from "@/components/report/report-shell";
import { WebUpdateCard } from "@/components/report/web-update-card";
import {
  parseDeepValueJson,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  hasFullTriple,
  sanitizeDeepValueResult,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";
import { toWatchlistMosFraction } from "@/lib/watchlist-mos";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/types/ai-settings";
import type { GroundedFinancials } from "@/types/grounding";
import { ValuationChecksCard } from "@/components/report/valuation-checks-card";
import type { DeepValueRunInputs } from "@/lib/report/deep-value-run";
import { canRetry, isDone, RUN_RETRY_AFTER_MS } from "@/lib/report/run-status";
import { DEEP_VALUE_PHASES, type DeepValuePhase } from "@/types/ai-run";
import type { SavedAnalysis } from "@/types/analysis";
import { useDeepValueRun, DEEP_VALUE_PHASE_TYPICAL_SECONDS, type DeepValuePhaseState } from "@/components/use-deep-value-run";
import { DEEP_VALUE_PHASE_LABEL, retryPlanText } from "@/components/analysis-run-status";

type Props = {
  ticker: string | null;
  companyName?: string;
  mosPercent?: number;
  currentPrice?: number;
  // Quote currency — needed by <ValuationChecksCard>'s currency guards (the market-
  // implied read must never divide a price in one currency by an EBITDA in another).
  currency?: string;
  // The confirmed financial dataset from <DatasetSection>, lifted in analyze-client.tsx.
  // Every run is built on one (the route answers 400 without a datasetId): while it is
  // null the Generate button stays disabled, with a hint.
  dataset?: { id: string; extract: GroundedFinancials } | null;
  // A cut run to show from /analyses (?resume=<id>): the panel reads the row and shows its
  // retry state; it never starts a run on mount — the retry belongs to the click.
  resumeId?: string | null;
};

/** The valuation a finished row holds: its result column, else its report's last fence. */
function resultOfRow(row: SavedAnalysis): ParsedAnalystResult | null {
  if (row.resultJson) {
    try {
      return sanitizeDeepValueResult(JSON.parse(row.resultJson));
    } catch {
      // Fall through to the report.
    }
  }
  return parseDeepValueJson(row.reportMd);
}

// The mark of each phase state in the list; the running one shows its seconds instead.
const PHASE_MARK: Record<DeepValuePhaseState, string> = { waiting: "○", running: "●", done: "✓", failed: "✕" };
const PHASE_TEXT: Record<DeepValuePhaseState, string> = {
  waiting: "text-slate-500",
  running: "text-violet-300",
  done: "text-emerald-400",
  failed: "text-amber-300",
};
type WatchlistStatus = "idle" | "loading" | "saved" | "already" | "error";

const LANGUAGES = [
  { value: "English", label: "🇬🇧 English" },
  { value: "Italiano", label: "🇮🇹 Italiano" },
  { value: "Español", label: "🇪🇸 Español" },
  { value: "Français", label: "🇫🇷 Français" },
  { value: "Deutsch", label: "🇩🇪 Deutsch" },
  { value: "Português", label: "🇵🇹 Português" },
  { value: "中文", label: "🇨🇳 中文" },
  { value: "日本語", label: "🇯🇵 日本語" },
];

export default function DeepValuePanel({ ticker, companyName, mosPercent = 0, currentPrice, currency, dataset = null, resumeId = null }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const { language: globalLanguage, t } = useLanguage();

  // Track whether the user has manually overridden the language for this panel.
  // While unoverridden, the panel language follows the global app language.
  const userOverrideRef = useRef(false);
  const [language, setAiLanguage] = useState(() => APP_TO_AI_LANGUAGE[globalLanguage] ?? "English");

  useEffect(() => {
    if (!userOverrideRef.current) {
      setAiLanguage(APP_TO_AI_LANGUAGE[globalLanguage] ?? "English");
    }
  }, [globalLanguage]);

  function setLanguage(lang: string) {
    userOverrideRef.current = true;
    setAiLanguage(lang);
  }
  const run = useDeepValueRun();
  // The ?resume= row, shown in its cut state until a click starts something.
  const [resumeRow, setResumeRow] = useState<SavedAnalysis | null>(null);
  // The instant the countdown and the phase timer read: ticked by an interval, never
  // Date.now() in render.
  const [now, setNow] = useState(0);
  // When the phase now running started (on this screen), for its elapsed seconds.
  const [phaseStartMs, setPhaseStartMs] = useState(0);
  const [watchlistStatus, setWatchlistStatus] = useState<WatchlistStatus>("idle");
  // The app's default until fetchAiSettings answers (and if it fails); no floor of its own
  // since 2026-11-20: a valuation runs at the user's default, which the catalog caps at `high`.
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  // Inputs frozen when Generate is pressed — what the checks card and the watchlist describe,
  // so editing the paste, the MoS slider or the quote after a run can't mislabel it.
  const [runInputs, setRunInputs] = useState<DeepValueRunInputs | null>(null);

  // Load the user's global AI default once on mount; the panel's own selector then
  // overrides it per-run without persisting (persisting happens via the NavBar modal).
  useEffect(() => {
    if (!session) return;
    fetchAiSettings()
      .then(setAiSettings)
      .catch(() => {
        // Keep the initial settings — non-fatal, generation still works.
      });
  }, [session]);

  // The analyst panel (skeptic/optimist/quality reviews) runs on the SAVED-analysis detail
  // page, not here — the live panel only produces the base analysis.

  // One read of the ?resume= row per id: a GET, never a run (a run belongs to the click).
  const resumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resumeId || !session || !ticker || resumedRef.current === resumeId) return;
    resumedRef.current = resumeId;
    fetchAnalysis(resumeId)
      .then((row) => {
        // A row of another ticker (the user searched another one meanwhile) is not shown.
        if (row.ticker !== ticker) return;
        setRunInputs({
          ticker: row.ticker,
          companyName: row.companyName,
          mosPercent: row.mosPercent,
          currentPrice: currentPrice ?? null,
          currency: currency ?? null,
          // The retry runs on the dataset the row names, which the server reads itself.
          dataset: null,
          language: row.reportLanguage ?? language,
        });
        setNow(Date.now());
        setResumeRow(row);
      })
      .catch(() => {
        // Nothing to show: the page stays as a fresh /analyze.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, session, ticker]);

  // What the screen shows: the run once a click started one, else the ?resume= row.
  const fromResume = run.state === "idle" && resumeRow != null;
  const view = fromResume ? (isDone(resumeRow) ? "done" : "cut") : run.state;
  const row = fromResume ? resumeRow : run.row;
  const analysisId = run.analysisId ?? resumeRow?.id ?? null;
  const notes = fromResume ? (resumeRow.updateNotesMd ?? "") : run.notes;
  const report = fromResume ? resumeRow.reportMd : run.report;
  const isStreaming = view === "running";
  const runningPhase = DEEP_VALUE_PHASES.find((p) => run.phases[p] === "running") ?? null;

  // The phase timer restarts with each phase; the interval ticks while a run is in flight,
  // and while a cut waits for the server to accept a retry (330 s from its request's start).
  useEffect(() => {
    if (runningPhase) setPhaseStartMs(Date.now());
  }, [runningPhase]);
  const retryReady = view === "cut" && (row == null || canRetry(row, now));
  useEffect(() => {
    if (!isStreaming && (view !== "cut" || retryReady)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isStreaming, view, retryReady]);
  const retryInSeconds =
    row?.runStartedAt != null ? Math.max(0, Math.ceil((new Date(row.runStartedAt).getTime() + RUN_RETRY_AFTER_MS - now) / 1000)) : 0;
  // What Retry will do, said on its button (resume from a phase, or start over).
  const retryLabel = row?.runPhase && row.createdAt && now > 0 ? retryPlanText(t, globalLanguage, row, now) : t("deepValueRetry");

  /** A new run: the page's inputs frozen now, the four phases chained from the click. */
  function handleGenerate() {
    if (!ticker || !dataset) return;
    if (!session) {
      router.push("/login");
      return;
    }
    setRunInputs({ ticker, companyName: companyName ?? ticker, mosPercent, currentPrice: currentPrice ?? null, currency: currency ?? null, dataset, language });
    setWatchlistStatus("idle");
    run.start({
      ticker,
      language,
      mosPercent,
      datasetId: dataset.id,
      model: aiSettings.model,
      effort: aiSettings.effort,
      thinking: aiSettings.thinking,
    });
  }

  /** Retry of the cut row: the server picks the phase; only the id is sent. */
  function handleRetry() {
    if (!analysisId) return;
    if (!session) {
      router.push("/login");
      return;
    }
    setWatchlistStatus("idle");
    run.retry(analysisId);
  }

  /** Back to a fresh panel: a new run on the dataset the page has now. */
  function handleRelaunch() {
    setResumeRow(null);
    run.reset();
  }

  async function handleAddToWatchlist() {
    if (!ticker || !runInputs) return;
    setWatchlistStatus("loading");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          companyName: companyName ?? ticker,
          // The watchlist stores a FRACTION; the panel's MoS is a percent. The MoS frozen at
          // Generate, not the slider's current value: the item gets the analysis's MoS.
          mosPercent: toWatchlistMosFraction(runInputs.mosPercent),
        }),
      });
      if (res.status === 409) {
        // Already in watchlist (unique constraint)
        setWatchlistStatus("already");
        return;
      }
      if (!res.ok) throw new Error();
      setWatchlistStatus("saved");
    } catch {
      // Shown, not swallowed: sending the raw percent made this fail silently (2026-10-11).
      setWatchlistStatus("error");
    }
  }

  // The numbers of a finished run come from the row the server wrote; a run whose row could
  // not be re-read shows its report and asks for a reload instead of parsing the stream.
  const result = view === "done" && row ? resultOfRow(row) : null;
  const rowMissing = view === "done" && row == null;
  // The price the valuation was run against, as the server stored it with the row.
  const runPrice = row?.priceAtAnalysis ?? null;
  const runCurrency = row?.priceCurrency ?? null;
  const markdownContent = view === "done" ? stripJsonBlock(report) : stripJsonBlock(stripTrailingOpenJsonFence(report));
  const reportDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const showPhases = view === "running" || view === "cut" || (view === "error" && analysisId != null);
  const phaseStates = fromResume && row ? phasesOfResumeRow(row) : run.phases;
  const elapsed = runningPhase && phaseStartMs > 0 && now >= phaseStartMs ? Math.floor((now - phaseStartMs) / 1000) : 0;
  const cutHasDataset = row?.datasetId != null || row == null;

  return (
    <div className="card space-y-4 print:border-0 print:bg-transparent print:p-0 print:shadow-none">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{t("deepValueTitle")}</h2>
          <p className="text-sm text-slate-400">{t("deepValueDesc")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isStreaming}
            className="tap rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-hidden disabled:opacity-50"
            aria-label={t("reportLanguageAria")}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>

          <AiSettingsControl value={aiSettings} onChange={setAiSettings} />

          <button
            onClick={handleGenerate}
            disabled={!ticker || !dataset || isStreaming}
            title={ticker && !dataset ? t("deepValueNeedsDataset") : undefined}
            className="tap rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("analyzingState")}
              </span>
            ) : (
              t("deepAnalysisBtn")
            )}
          </button>
        </div>
      </div>

      {/* No dataset yet: the analysis waits for one (the section above). */}
      {ticker && !dataset && !isStreaming && view !== "cut" && <p className="text-xs text-muted print:hidden">{t("deepValueNeedsDataset")}</p>}

      {/* Auth hint */}
      {!session && ticker && (
        <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-sm text-violet-300 print:hidden">
          <button onClick={() => router.push("/login")} className="underline hover:no-underline">
            {t("navSignIn")}
          </button>{" "}
          {t("signInToAnalyze")}
        </p>
      )}

      {/* The four phases: done, running (with its seconds), waiting with their usual minutes. */}
      {showPhases && (
        <ol className="grid gap-1.5 sm:grid-cols-2 print:hidden" data-testid="deep-value-phases">
          {DEEP_VALUE_PHASES.map((phase: DeepValuePhase) => {
            const state = phaseStates[phase];
            return (
              <li key={phase} data-phase={phase} data-state={state} className={`flex items-baseline gap-2 text-sm ${PHASE_TEXT[state]}`}>
                <span aria-hidden className="w-4 text-center">
                  {PHASE_MARK[state]}
                </span>
                <span>{t(DEEP_VALUE_PHASE_LABEL[phase])}</span>
                <span className="font-mono text-xs text-muted">
                  {state === "running" ? `${elapsed} s` : state === "waiting" ? t("runPhaseTypical").replace("{minutes}", String(Math.round(DEEP_VALUE_PHASE_TYPICAL_SECONDS[phase] / 60))) : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Error */}
      {view === "error" && run.error && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 print:hidden">
          <p className="text-sm text-red-400">{run.error.message}</p>
          {run.error.retryable && analysisId && (
            <button onClick={handleRetry} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {retryLabel}
            </button>
          )}
          {!run.error.retryable && (
            <button onClick={handleRelaunch} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {t("deepValueRelaunch")}
            </button>
          )}
        </div>
      )}

      {/* Cut: a request ended without done or error. The row says what the server last wrote;
          Retry resumes it once the server would accept it (330 s from the request's start;
          at once when no request was in flight). */}
      {view === "cut" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-500/10 px-3 py-2 print:hidden" data-testid="deep-value-cut">
          <div className="space-y-1">
            <p className="text-sm text-amber-300">{t("deepValueCut")}</p>
            {row?.runError && <p className="text-xs text-amber-200/80">{row.runError}</p>}
          </div>
          {cutHasDataset && analysisId ? (
            <button onClick={handleRetry} disabled={!retryReady} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {retryReady ? retryLabel : t("deepValueRetryIn").replace("{s}", String(retryInSeconds))}
            </button>
          ) : (
            <button onClick={handleRelaunch} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {t("deepValueRelaunch")}
            </button>
          )}
        </div>
      )}

      {/* The web update's notes, once that phase has written them. */}
      {notes && (view !== "running" || runningPhase !== "update") && <WebUpdateCard notesMd={notes} />}
      {notes && view === "running" && runningPhase === "update" && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400" />
          <ReportBody markdown={stripJsonBlock(notes)} />
        </div>
      )}

      {/* Full report shell (masthead + badges + cards + body + recap + disclaimer) —
          shown once the run ends and the row's valuation carries all three scenarios. */}
      {view === "done" && hasFullTriple(result) && ticker && (
        <ReportShell
          ticker={ticker}
          companyName={companyName}
          reportDate={reportDate}
          reportTypeLabel={t("deepValueTitle")}
          markdown={markdownContent}
          result={result}
          currentPrice={runPrice ?? undefined}
          priceCurrency={runCurrency ?? undefined}
          // The MoS the fair values were computed at, not the slider's current value.
          mosPercent={row?.mosPercent ?? runInputs?.mosPercent ?? mosPercent}
          labels={{
            recapTableTitle: t("recapTableTitle"),
            recapCurrentPrice: t("recapPriceAtAnalysis"),
            bearLabel: t("bearLabel"),
            baseLabel: t("baseLabel"),
            bullLabel: t("bullLabel"),
            disclaimer: t("reportDisclaimer"),
            scenarioHeader: t("recapScenario"),
            vsPriceHeader: t("recapVsPrice"),
            buyTargetHeader: t("recapBuyTarget"),
            fairValueHeader: t("recapFairValue"),
            fvShort: t("fvShort"),
            recapCurrencyMismatch: t("recapCurrencyMismatch"),
          }}
        />
      )}

      {/* Deterministic checks card — every run with a complete block and a stored price.
          Recomputes the model's own declared bridge from the extract this run used (not the
          live input, which may have been edited since), at the price the run was valued at. */}
      {view === "done" && hasFullTriple(result) && runPrice != null && runInputs?.dataset && (
        <ValuationChecksCard
          result={result}
          extract={runInputs.dataset.extract}
          mosPercent={row?.mosPercent ?? runInputs.mosPercent}
          currentPrice={runPrice}
          // An unknown quote currency stays unknown: assuming the report's would compare
          // a price in pence with values in pounds.
          currency={runCurrency ?? ""}
          priceSource="analysis"
          reportMd={stripJsonBlock(report)}
        />
      )}

      {/* The run ended but its row could not be re-read: the numbers are on the saved page. */}
      {rowMissing && <p className="text-xs text-warning">{t("deepValueReloadForNumbers")}</p>}

      {/* A finished run whose valuation block is missing or incomplete: the report still
          shows (raw, below) and is saved without fair values — say so instead of hiding it. */}
      {view === "done" && row && report && !hasFullTriple(result) && <p className="text-xs text-warning">{t("deepValueIncompleteJson")}</p>}

      {/* Raw report — shown while generating (and when stopped), before the shell takes over. */}
      {report && !(view === "done" && hasFullTriple(result)) && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          {isStreaming && <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400" />}
          <ReportBody markdown={markdownContent} />
        </div>
      )}

      {/* The server saved the row as the run ended: a link to it, and the PDF export. The
          analyst panel (skeptic/optimist/quality) runs on that saved page. */}
      {view === "done" && report && (
        <div className="flex flex-wrap items-center gap-3 pt-1 print:hidden">
          <button
            onClick={() => window.print()}
            className="tap rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
          >
            {t("downloadPdf")}
          </button>

          {analysisId && (
            // A full navigation, not router.push: the saved page must read the row the server
            // just wrote, never a Router-Cache copy (AGENTS.md, Router-Cache gotcha).
            <a href={"/analyses/" + encodeURIComponent(analysisId)} className="text-sm text-violet-400 hover:text-violet-300">
              {t("deepValueOpenSaved")}
            </a>
          )}
        </div>
      )}

      {/* Decision Panel — pipeline routing after analysis completes */}
      {view === "done" && hasFullTriple(result) && ticker && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-4 print:hidden">
          {/* Add to Watchlist */}
          <button
            onClick={handleAddToWatchlist}
            disabled={watchlistStatus === "loading" || watchlistStatus === "saved" || watchlistStatus === "already"}
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-amber-800/50 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:border-amber-600 hover:bg-amber-900/20 disabled:cursor-default disabled:opacity-70"
          >
            {watchlistStatus === "loading" && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            )}
            {(watchlistStatus === "saved" || watchlistStatus === "already") ? (
              <>
                <span>✓</span>
                {t("inWatchlist")}
              </>
            ) : (
              <>
                <span>👁</span>
                {t("addToWatchlist")}
              </>
            )}
          </button>
          {watchlistStatus === "error" && <p className="basis-full text-xs text-danger">{t("watchlistAddError")}</p>}
        </div>
      )}
    </div>
  );
}

/** The phases of a ?resume= row: those before its phase done, its phase failed. */
function phasesOfResumeRow(row: SavedAnalysis): Record<DeepValuePhase, DeepValuePhaseState> {
  const at = typeof row.runPhase === "string" ? DEEP_VALUE_PHASES.indexOf(row.runPhase as DeepValuePhase) : -1;
  return Object.fromEntries(
    DEEP_VALUE_PHASES.map((p, i) => [p, isDone(row) || i < at ? "done" : i === at ? "failed" : "waiting"])
  ) as Record<DeepValuePhase, DeepValuePhaseState>;
}
