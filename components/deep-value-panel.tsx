"use client";

// Deep Value Panel — Claude autonomously picks the valuation method,
// finds all financial data via web search, and streams a JSON block
// (method + fair values) followed by a full Markdown report.
import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { saveAnalysis } from "@/lib/analyses";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import ReportBody from "@/components/report/report-body";
import ReportShell from "@/components/report/report-shell";
import type { DeepValueResult } from "@/components/report/types";
import { parseDeepValueJson, stripJsonBlock } from "@/lib/report/parse-deep-value-json";

type Props = {
  ticker: string | null;
  companyName?: string;
  mosPercent?: number;
  currentPrice?: number;
  exitReviewContext?: { wac: number; prevFv: number } | null;
};

type Status = "idle" | "loading" | "streaming" | "done" | "error";
type WatchlistStatus = "idle" | "loading" | "saved" | "already";

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

export default function DeepValuePanel({ ticker, companyName, mosPercent = 0, currentPrice, exitReviewContext }: Props) {
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
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [result, setResult] = useState<DeepValueResult | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState<WatchlistStatus>("idle");

  // Analyst Review — an independent fresh-context Opus pass that red-teams the report.
  const [reviewText, setReviewText] = useState<string>("");
  const [reviewStatus, setReviewStatus] = useState<Status>("idle");
  // The reviewer's own bull/base/bear valuation, parsed from the review's JSON block.
  const [reviewResult, setReviewResult] = useState<DeepValueResult | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Tracks which button triggered the current analysis for spinner placement
  const [isReviewMode, setIsReviewMode] = useState(false);

  async function handleGenerate(reviewContext?: { wac: number; prevFv: number }) {
    if (!ticker) return;

    if (!session) {
      router.push("/login");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsReviewMode(!!reviewContext);
    setReport("");
    setResult(null);
    setStatus("loading");
    setErrorMsg(null);
    setSaveStatus("idle");
    setWatchlistStatus("idle");
    // A new analysis invalidates any prior review.
    reviewAbortRef.current?.abort();
    setReviewText("");
    setReviewStatus("idle");
    setReviewResult(null);

    try {
      const res = await fetch("/api/ai/deep-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          language,
          mosPercent,
          ...(reviewContext ? { reviewContext } : {}),
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
      }

      if (!res.body) throw new Error("No response stream");

      setStatus("streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !streamDone });
          accumulated += chunk;
          setReport(accumulated);
        }
      }

      // Parse the JSON block once streaming is complete.
      const parsed = parseDeepValueJson(accumulated);
      setResult(parsed);
      setReport(accumulated);
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  async function handleRunReview() {
    if (!ticker || !report) return;

    reviewAbortRef.current?.abort();
    const controller = new AbortController();
    reviewAbortRef.current = controller;

    setReviewText("");
    setReviewResult(null);
    setReviewStatus("loading");

    try {
      const res = await fetch("/api/ai/deep-value/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the report without the machine-readable JSON block — the reviewer
        // only needs the human-readable analysis to critique. mosPercent lets the
        // reviewer emit its own fair values in the same (MoS-adjusted) unit as the base.
        body: JSON.stringify({ ticker, reportMd: stripJsonBlock(report), language, mosPercent }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      setReviewStatus("streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          accumulated += decoder.decode(value, { stream: !streamDone });
          setReviewText(accumulated);
        }
      }

      // Parse the reviewer's own valuation once streaming completes (null if it
      // emitted no valid JSON — the critique still stands on its own).
      setReviewResult(parseDeepValueJson(accumulated));
      setReviewStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setReviewStatus("idle");
        return;
      }
      setReviewStatus("error");
    }
  }

  async function handleSave() {
    if (!ticker || !report) return;

    setSaveStatus("saving");
    try {
      await saveAnalysis({
        ticker,
        companyName: companyName ?? ticker,
        reportMd: report,
        mosPercent,
        // Snapshot fair values from the parsed JSON result so we can track performance
        fairValueBull: result?.bull.fairValue,
        fairValueBase: result?.base.fairValue,
        fairValueBear: result?.bear.fairValue,
        valuationMethod: result?.method,
        // Attach the Analyst Review only if it has already completed for this report.
        // Store the critique without its JSON block (the numbers live in the columns
        // below); the reviewer's own fair values feed the consensus on the list page.
        reviewMd: reviewStatus === "done" && reviewText ? stripJsonBlock(reviewText) : undefined,
        reviewFairValueBull: reviewResult?.bull.fairValue,
        reviewFairValueBase: reviewResult?.base.fairValue,
        reviewFairValueBear: reviewResult?.bear.fairValue,
        reviewValuationMethod: reviewResult?.method,
      });
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
    }
  }

  async function handleAddToWatchlist() {
    if (!ticker) return;
    setWatchlistStatus("loading");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          companyName: companyName ?? ticker,
          mosPercent,
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
      setWatchlistStatus("idle");
    }
  }

  const isStreaming = status === "loading" || status === "streaming";
  const markdownContent = status === "done" && report ? stripJsonBlock(report) : report;
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
            className="tap rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            aria-label="Report language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>

          {exitReviewContext && (
            <button
              onClick={() => handleGenerate(exitReviewContext)}
              disabled={!ticker || isStreaming}
              className="tap rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/20 hover:border-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isStreaming && isReviewMode ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                  {status === "loading" ? t("startingState") : t("analyzingState")}
                </span>
              ) : (
                t("reviewPositionBtn")
              )}
            </button>
          )}

          <button
            onClick={() => handleGenerate()}
            disabled={!ticker || isStreaming}
            className="tap rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming && !isReviewMode ? (
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

      {/* Position review context banner — shown when navigated from the portfolio exit signal */}
      {exitReviewContext && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 print:hidden">
          <span>WAC: {exitReviewContext.wac.toFixed(2)} · Prev. FV: {exitReviewContext.prevFv.toFixed(2)}</span>
          <span className="text-amber-600">·</span>
          <span>{t("reviewPositionBtnHint")}</span>
        </div>
      )}

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
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 print:hidden">{errorMsg}</p>
      )}

      {/* Full report shell (masthead + badges + cards + body + recap + disclaimer) —
          shown once the analysis completes and the JSON block parsed successfully. */}
      {status === "done" && result && ticker && (
        <ReportShell
          ticker={ticker}
          companyName={companyName}
          reportDate={reportDate}
          reportTypeLabel={t("deepValueTitle")}
          markdown={markdownContent}
          result={result}
          currentPrice={currentPrice}
          mosPercent={mosPercent}
          labels={{
            recapTableTitle: t("recapTableTitle"),
            recapCurrentPrice: t("recapCurrentPrice"),
            bearLabel: t("bearLabel"),
            baseLabel: t("baseLabel"),
            bullLabel: t("bullLabel"),
          }}
        />
      )}

      {/* Raw streaming report — shown while generating, before the shell above takes over. */}
      {report && !(status === "done" && result) && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          {isStreaming && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400" />
          )}
          <ReportBody markdown={markdownContent} />
        </div>
      )}

      {/* Save + export controls */}
      {status === "done" && report && (
        <div className="flex flex-wrap items-center gap-3 pt-1 print:hidden">
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving" || saveStatus === "saved"}
            className="tap rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            {saveStatus === "saving" && t("savingState")}
            {saveStatus === "saved" && t("savedState")}
            {saveStatus === "error" && t("retrySave")}
            {saveStatus === "idle" && t("saveReport")}
          </button>

          <button
            onClick={() => window.print()}
            className="tap rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
          >
            {t("downloadPdf")}
          </button>

          {saveStatus === "saved" && (
            <button
              onClick={() => router.push("/analyses")}
              className="text-sm text-violet-400 hover:text-violet-300"
            >
              {t("viewSavedAnalyses")}
            </button>
          )}

          {saveStatus === "error" && (
            <p className="text-sm text-red-400">{t("errorFailedSaveReport")}</p>
          )}
        </div>
      )}

      {/* Analyst Review — independent red-team pass over the completed report.
          Included in the PDF export only when a review actually exists; the
          interactive controls (button/spinner/error) stay screen-only. */}
      {status === "done" && report && (
        <div className={`rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 ${reviewText ? "break-inside-avoid" : "print:hidden"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-violet-300 print:text-violet-700">{t("analystReviewTitle")}</h3>
            {reviewStatus === "idle" && (
              <button
                onClick={handleRunReview}
                className="tap rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 print:hidden"
              >
                {t("analystReviewButton")}
              </button>
            )}
            {(reviewStatus === "loading" || reviewStatus === "streaming") && (
              <span className="flex items-center gap-2 text-xs text-violet-300 print:hidden">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                {t("analystReviewRunning")}
              </span>
            )}
            {/* Regenerate — e.g. after a truncated run, or to refresh the critique. */}
            {reviewStatus === "done" && reviewText && (
              <button
                onClick={handleRunReview}
                className="tap rounded-lg border border-violet-500/40 px-2.5 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 print:hidden"
              >
                {t("analystReviewRerun")}
              </button>
            )}
          </div>

          {reviewStatus === "error" && (
            <div className="mt-3 flex items-center gap-3 print:hidden">
              <p className="text-sm text-red-400">{t("analystReviewError")}</p>
              <button
                onClick={handleRunReview}
                className="tap rounded-lg border border-violet-500/40 px-3 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10"
              >
                {t("analystReviewButton")}
              </button>
            </div>
          )}

          {reviewText && (
            <div className="mt-3">
              {reviewStatus === "streaming" && (
                <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400 print:hidden" />
              )}
              <ReportBody markdown={stripJsonBlock(reviewText)} />
            </div>
          )}
        </div>
      )}

      {/* Decision Panel — pipeline routing after analysis completes */}
      {status === "done" && result && ticker && (
        <div className="flex flex-wrap gap-2 border-t border-slate-800/60 pt-4 print:hidden">
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
        </div>
      )}
    </div>
  );
}
