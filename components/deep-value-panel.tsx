"use client";

// Deep Value Panel — the model picks the valuation method on the user's confirmed dataset
// and streams the full Markdown report, then its closing JSON block (method + fair values).
//
// A staged run (2026-10-27, after the "Consulente" run of net-worth-tracker): the route
// creates the Analysis row when the run starts and writes the report when it ends, so this
// panel never saves anything. It reads Server-Sent Events (stage → text → done | error); a
// stream that ends with neither done nor error — or a read that rejects, which is how a
// function the platform kills at 300 s reaches the browser — is a CUT: the panel re-reads
// the row and offers "Retry" on the same row once the server would accept it.
import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { fetchAnalysis } from "@/lib/analyses";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import ReportBody from "@/components/report/report-body";
import ReportShell from "@/components/report/report-shell";
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
import { forEachSseEvent } from "@/lib/sse-reader";
import { canRetry, isDone, RUN_RETRY_AFTER_MS } from "@/lib/report/run-status";
import type { AiRunEvent } from "@/types/ai-run";
import type { SavedAnalysis } from "@/types/analysis";

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

type Status = "idle" | "loading" | "streaming" | "done" | "cut" | "error";
// What the panel knows of a cut row: enough for canRetry and the Retry/Run-again choice.
type CutRow = { runStatus: string; runStartedAt: string | null; runError: string | null; hasDataset: boolean };
// The way out of an error: retry the same row, or run a new analysis (its dataset is gone).
type ErrorAction = "retry" | "relaunch" | null;

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
  const [report, setReport] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // The row the server writes, from the run's first event (or the ?resume= row).
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [cutRow, setCutRow] = useState<CutRow | null>(null);
  const [errorAction, setErrorAction] = useState<ErrorAction>(null);
  // The instant the retry countdown reads: taken in handlers and ticked by an interval,
  // never Date.now() in render.
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<ParsedAnalystResult | null>(null);
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

  const abortRef = useRef<AbortController | null>(null);
  // One read of the ?resume= row per id: a GET, never a run (a run belongs to the click).
  const resumedRef = useRef<string | null>(null);

  /** Shows a row as the server last wrote it: its report when finished, else the cut state
   *  with what Retry needs. */
  function applyRow(row: SavedAnalysis, fallbackStartedAt: string | null) {
    if (isDone(row)) {
      setReport(row.reportMd);
      setResult(resultOfRow(row));
      setStatus("done");
      return;
    }
    setCutRow({
      runStatus: row.runStatus ?? "running",
      runStartedAt: row.runStartedAt ?? fallbackStartedAt,
      runError: row.runError ?? null,
      hasDataset: row.datasetId != null,
    });
    setNow(Date.now());
    setStatus("cut");
  }

  /** Re-reads a row the stream lost. */
  async function showRow(id: string, fallbackStartedAt: string | null) {
    let row: SavedAnalysis;
    try {
      row = await fetchAnalysis(id);
    } catch {
      // The row could not be read (network, deleted): the server still refuses a retry it
      // cannot accept, so offer it on what the stream said.
      setCutRow({ runStatus: "running", runStartedAt: fallbackStartedAt, runError: null, hasDataset: true });
      setNow(Date.now());
      setStatus("cut");
      return;
    }
    applyRow(row, fallbackStartedAt);
  }

  useEffect(() => {
    if (!resumeId || !session || !ticker || resumedRef.current === resumeId) return;
    resumedRef.current = resumeId;
    fetchAnalysis(resumeId)
      .then((row) => {
        // A row of another ticker (the user searched another one meanwhile) is not shown.
        if (row.ticker !== ticker) return;
        setAnalysisId(row.id);
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
        applyRow(row, row.runStartedAt ?? null);
      })
      .catch(() => {
        // Nothing to show: the page stays as a fresh /analyze.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, session, ticker]);

  /** A new run (no argument) or a retry of the row `retryId`, with the inputs on the row. */
  async function handleGenerate(retryId?: string) {
    if (!ticker) return;
    if (!retryId && !dataset) return;

    if (!session) {
      router.push("/login");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // A retry describes the row it re-runs (same MoS, language and dataset), with the
    // page's latest quote; a new run freezes the page's inputs now.
    const inputs: DeepValueRunInputs =
      retryId && runInputs
        ? { ...runInputs, currentPrice: currentPrice ?? null, currency: currency ?? null }
        : {
            ticker,
            companyName: companyName ?? ticker,
            mosPercent,
            currentPrice: currentPrice ?? null,
            currency: currency ?? null,
            dataset,
            language,
          };
    setRunInputs(inputs);

    setReport("");
    setResult(null);
    setStatus("loading");
    setErrorMsg(null);
    setErrorAction(null);
    setCutRow(null);
    setWatchlistStatus("idle");
    if (!retryId) setAnalysisId(null);

    let id: string | null = retryId ?? null;
    let startedAt: string | null = null;
    let terminal: "done" | "error" | null = null;
    let accumulated = "";

    try {
      const res = await fetch("/api/ai/deep-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A retry sends only the row: every input comes from it, on the server.
        body: JSON.stringify(
          retryId
            ? { analysisId: retryId }
            : {
                ticker: inputs.ticker,
                language: inputs.language,
                mosPercent: inputs.mosPercent,
                model: aiSettings.model,
                effort: aiSettings.effort,
                thinking: aiSettings.thinking,
                datasetId: dataset!.id,
              }
        ),
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const message = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`;
        if (retryId && res.status === 409 && message === "dataset no longer available") {
          setErrorMsg(message);
          setErrorAction("relaunch");
          setStatus("error");
          return;
        }
        // Finished meanwhile, or still in progress: the row says which.
        if (retryId && res.status === 409) return showRow(retryId, null);
        setErrorMsg(res.status === 404 ? t("analysisGone") : message);
        setErrorAction(retryId && (res.status >= 500 || res.status === 429) ? "retry" : null);
        setStatus("error");
        return;
      }

      if (!res.body) throw new Error("No response stream");

      await forEachSseEvent<AiRunEvent>(res.body, (event) => {
        if (event.type === "stage") {
          // The row's id arrives first, so a run cut a second later is already retryable.
          if (event.analysisId) {
            id = event.analysisId;
            setAnalysisId(event.analysisId);
          }
          if (event.runStartedAt) startedAt = event.runStartedAt;
          setStatus("streaming");
        } else if (event.type === "text") {
          accumulated += event.text;
          setReport(accumulated);
        } else if (event.type === "done") {
          terminal = "done";
        } else {
          terminal = "error";
          setErrorMsg(event.error);
          setErrorAction(event.retryable && id ? "retry" : null);
        }
      });
    } catch (err) {
      // The user's stop (or a new Generate): the server still finishes and writes the row.
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      // A rejected read is a cut once the row exists; before it, nothing was started.
      if (!id) {
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
        setStatus("error");
        return;
      }
    }

    if (terminal === "done") {
      // The text streamed is what the server stored as the report.
      setResult(parseDeepValueJson(accumulated));
      setStatus("done");
      return;
    }
    if (terminal === "error") {
      setStatus("error");
      return;
    }
    if (!id) {
      setErrorMsg(t("deepValueCut"));
      setStatus("error");
      return;
    }
    await showRow(id, startedAt);
  }

  // A cut run waits until the server would accept a retry (330 s from its start): tick the
  // countdown each second until then.
  const retryReady = status === "cut" && cutRow != null && canRetry(cutRow, now);
  useEffect(() => {
    if (status !== "cut" || retryReady) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status, retryReady]);
  const retryInSeconds =
    cutRow?.runStartedAt != null ? Math.max(0, Math.ceil((new Date(cutRow.runStartedAt).getTime() + RUN_RETRY_AFTER_MS - now) / 1000)) : 0;

  /** Back to a fresh panel: a new run on the dataset the page has now. */
  function handleRelaunch() {
    setStatus("idle");
    setAnalysisId(null);
    setCutRow(null);
    setErrorMsg(null);
    setErrorAction(null);
    setReport("");
    setResult(null);
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

  const isStreaming = status === "loading" || status === "streaming";
  // The JSON block now closes the report, so while streaming its fence is still open: hide
  // it until it closes. The strip runs in streaming too — a repeated start marker would
  // otherwise show as text.
  const markdownContent = status === "done" ? stripJsonBlock(report) : stripJsonBlock(stripTrailingOpenJsonFence(report));
  const reportDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
            onClick={() => handleGenerate()}
            disabled={!ticker || !dataset || isStreaming}
            title={ticker && !dataset ? t("deepValueNeedsDataset") : undefined}
            className="tap rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {status === "loading" ? t("startingState") : t("analyzingState")}
              </span>
            ) : (
              t("deepAnalysisBtn")
            )}
          </button>
        </div>
      </div>

      {/* No dataset yet: the analysis waits for one (the section above). */}
      {ticker && !dataset && !isStreaming && <p className="text-xs text-muted print:hidden">{t("deepValueNeedsDataset")}</p>}

      {/* Auth hint */}
      {!session && ticker && (
        <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-sm text-violet-300 print:hidden">
          <button onClick={() => router.push("/login")} className="underline hover:no-underline">
            {t("navSignIn")}
          </button>{" "}
          {t("signInToAnalyze")}
        </p>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 print:hidden">
          <p className="text-sm text-red-400">{errorMsg}</p>
          {errorAction === "retry" && analysisId && (
            <button onClick={() => handleGenerate(analysisId)} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {t("deepValueRetry")}
            </button>
          )}
          {errorAction === "relaunch" && (
            <button onClick={handleRelaunch} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {t("deepValueRelaunch")}
            </button>
          )}
        </div>
      )}

      {/* Cut: the stream ended without done or error. The row says what the server last
          wrote; Retry re-runs it, once the server would accept it (330 s from its start). */}
      {status === "cut" && cutRow && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-500/10 px-3 py-2 print:hidden">
          <div className="space-y-1">
            <p className="text-sm text-amber-300">{t("deepValueCut")}</p>
            {cutRow.runError && <p className="text-xs text-amber-200/80">{cutRow.runError}</p>}
          </div>
          {cutRow.hasDataset && analysisId ? (
            <button onClick={() => handleGenerate(analysisId)} disabled={!retryReady} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {retryReady ? t("deepValueRetry") : t("deepValueRetryIn").replace("{s}", String(retryInSeconds))}
            </button>
          ) : (
            <button onClick={handleRelaunch} className="tap rounded-lg border border-violet-600 px-4 py-2 text-sm text-violet-200 transition hover:bg-violet-900/30 disabled:cursor-not-allowed disabled:opacity-50">
              {t("deepValueRelaunch")}
            </button>
          )}
        </div>
      )}

      {/* Full report shell (masthead + badges + cards + body + recap + disclaimer) —
          shown once the analysis completes and the JSON block carries all three scenarios. */}
      {status === "done" && hasFullTriple(result) && ticker && (
        <ReportShell
          ticker={ticker}
          companyName={companyName}
          reportDate={reportDate}
          reportTypeLabel={t("deepValueTitle")}
          markdown={markdownContent}
          result={result}
          currentPrice={currentPrice}
          priceCurrency={currency}
          // The MoS the fair values were computed at, not the slider's current value.
          mosPercent={runInputs?.mosPercent ?? mosPercent}
          labels={{
            recapTableTitle: t("recapTableTitle"),
            recapCurrentPrice: t("recapCurrentPrice"),
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

      {/* Deterministic checks card — every run with a complete block and a price.
          Recomputes the model's own declared bridge from the extract this run actually used
          (not the live input, which may have been edited since), before and independently
          of the saved page. */}
      {status === "done" && hasFullTriple(result) && runInputs?.currentPrice != null && runInputs.dataset && (
        <ValuationChecksCard
          result={result}
          extract={runInputs.dataset.extract}
          mosPercent={runInputs.mosPercent}
          currentPrice={runInputs.currentPrice}
          // An unknown quote currency stays unknown: assuming the report's would compare
          // a price in pence with values in pounds.
          currency={runInputs.currency ?? ""}
          priceSource="live"
          reportMd={stripJsonBlock(report)}
        />
      )}

      {/* A finished run whose valuation block is missing or incomplete: the report still
          shows (raw, below) and is saved without fair values — say so instead of hiding it. */}
      {status === "done" && report && !hasFullTriple(result) && (
        <p className="text-xs text-warning">{t("deepValueIncompleteJson")}</p>
      )}

      {/* Raw streaming report — shown while generating, before the shell above takes over. */}
      {report && !(status === "done" && hasFullTriple(result)) && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          {isStreaming && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400" />
          )}
          <ReportBody markdown={markdownContent} />
        </div>
      )}

      {/* The server saved the row when the run ended: a link to it, and the PDF export. The
          analyst panel (skeptic/optimist/quality) runs on that saved page. */}
      {status === "done" && report && (
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
      {status === "done" && hasFullTriple(result) && ticker && (
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
