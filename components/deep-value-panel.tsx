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
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/types/ai-settings";
import type { GroundingPayload } from "@/types/grounding";
import { GroundingCard } from "@/components/report/grounding-card";

type Props = {
  ticker: string | null;
  companyName?: string;
  mosPercent?: number;
  currentPrice?: number;
  // Quote currency — needed by <GroundingCard>'s currency-mismatch guard (the market-
  // implied read must never divide a price in one currency by an EBITDA in another).
  currency?: string;
  // Confirmed Grounded-mode payload from <GroundingInput>, lifted in analyze-client.tsx.
  // Null (the default) is Quick mode — sent as-is in the POST body, so its absence keeps
  // the request (and thus the prompt) unchanged from before this feature existed.
  grounding?: GroundingPayload | null;
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

export default function DeepValuePanel({ ticker, companyName, mosPercent = 0, currentPrice, currency, grounding = null }: Props) {
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
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);

  // Load the user's global AI default once on mount; the panel's own selector then
  // overrides it per-run without persisting (persisting happens via the NavBar modal).
  useEffect(() => {
    if (!session) return;
    fetchAiSettings()
      .then(setAiSettings)
      .catch(() => {
        // Keep DEFAULT_AI_SETTINGS — non-fatal, generation still works.
      });
  }, [session]);

  // The analyst panel (skeptic/optimist/quality reviews) runs on the SAVED-analysis detail
  // page, not here — the live panel only produces and saves the base analysis.

  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerate() {
    if (!ticker) return;

    if (!session) {
      router.push("/login");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReport("");
    setResult(null);
    setStatus("loading");
    setErrorMsg(null);
    setSaveStatus("idle");
    setWatchlistStatus("idle");

    try {
      const res = await fetch("/api/ai/deep-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          language,
          mosPercent,
          model: aiSettings.model,
          effort: aiSettings.effort,
          thinking: aiSettings.thinking,
          ...(grounding ? { grounding } : {}),
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

      // Defends against a silent empty stream (e.g. the AI provider's tool-use loop
      // hit its iteration cap before producing any output) — without this, status still
      // flipped to "done" with an empty report and nothing rendered, so the button just
      // went back to idle with no explanation.
      if (!accumulated.trim()) {
        setErrorMsg(t("deepValueEmptyResponse"));
        setStatus("error");
        return;
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
        groundingJson: grounding ? JSON.stringify(grounding) : undefined,
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

          <AiSettingsControl value={aiSettings} onChange={setAiSettings} />

          <button
            onClick={() => handleGenerate()}
            disabled={!ticker || isStreaming}
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

      {/* Deterministic post-check card — Grounded runs only. Recomputes the model's own
          declared bridge from `grounding.extract`, independent of whether the save/DB
          persistence (commit 7) has happened yet. */}
      {status === "done" && result && grounding && currentPrice != null && currency && (
        <GroundingCard result={result} extract={grounding.extract} mosPercent={mosPercent} currentPrice={currentPrice} currency={currency} />
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

      {/* The analyst panel (skeptic/optimist/quality) lives on the saved-analysis detail
          page — after saving, the "View saved analyses" link routes there to run it. */}

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
