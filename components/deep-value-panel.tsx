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
import {
  parseDeepValueJson,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  hasFullTriple,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";
import { toWatchlistMosFraction } from "@/lib/watchlist-mos";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, deepValueDefaultEffort, type AiSettings } from "@/types/ai-settings";
import type { GroundedFinancials } from "@/types/grounding";
import { ValuationChecksCard } from "@/components/report/valuation-checks-card";
import { buildSaveAnalysisRequest, parseResolvedAiSettings, type DeepValueRunInputs } from "@/lib/report/deep-value-run";

type Props = {
  ticker: string | null;
  companyName?: string;
  mosPercent?: number;
  currentPrice?: number;
  // Quote currency — needed by <ValuationChecksCard>'s currency guards (the market-
  // implied read must never divide a price in one currency by an EBITDA in another).
  currency?: string;
  // The confirmed financial dataset from <DatasetSection>, lifted in analyze-client.tsx.
  // Null (the default) is Quick mode — no datasetId in the POST body, so its absence keeps
  // the request (and thus the prompt) unchanged from before this feature existed.
  dataset?: { id: string; extract: GroundedFinancials } | null;
};

type Status = "idle" | "loading" | "streaming" | "done" | "error";
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

export default function DeepValuePanel({ ticker, companyName, mosPercent = 0, currentPrice, currency, dataset = null }: Props) {
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
  const [result, setResult] = useState<ParsedAnalystResult | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState<WatchlistStatus>("idle");
  // A valuation starts at the higher of the global default and xhigh — already before
  // fetchAiSettings answers, and if it fails, so a quick Generate is not a cheaper run.
  const [aiSettings, setAiSettings] = useState<AiSettings>({
    ...DEFAULT_AI_SETTINGS,
    effort: deepValueDefaultEffort(DEFAULT_AI_SETTINGS.model, DEFAULT_AI_SETTINGS.effort),
  });
  // Inputs frozen when Generate is pressed — what Save and the checks card describe,
  // so editing the paste, the MoS slider or the quote after a run can't mislabel it.
  const [runInputs, setRunInputs] = useState<DeepValueRunInputs | null>(null);

  // Load the user's global AI default once on mount; the panel's own selector then
  // overrides it per-run without persisting (persisting happens via the NavBar modal).
  useEffect(() => {
    if (!session) return;
    fetchAiSettings()
      .then((s) => setAiSettings({ ...s, effort: deepValueDefaultEffort(s.model, s.effort) }))
      .catch(() => {
        // Keep the initial settings — non-fatal, generation still works.
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

    const inputs: DeepValueRunInputs = {
      ticker,
      companyName: companyName ?? ticker,
      mosPercent,
      currentPrice: currentPrice ?? null,
      currency: currency ?? null,
      dataset,
      language,
      aiSettingsResolved: null,
    };
    setRunInputs(inputs);

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
          ticker: inputs.ticker,
          language: inputs.language,
          mosPercent: inputs.mosPercent,
          model: aiSettings.model,
          effort: aiSettings.effort,
          thinking: aiSettings.thinking,
          ...(inputs.dataset ? { datasetId: inputs.dataset.id } : {}),
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

      // What the route actually ran (stored default, xhigh floor, model clamp applied) —
      // saved with the analysis instead of what this panel asked for.
      setRunInputs({ ...inputs, aiSettingsResolved: parseResolvedAiSettings(res.headers.get("X-AI-Settings")) });
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
    if (!runInputs || !report) return;

    setSaveStatus("saving");
    try {
      await saveAnalysis(buildSaveAnalysisRequest(runInputs, report, result));
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
    }
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

      {/* Deterministic checks card — every run with a complete block and a price, Quick
          included (its dataset gates read "no dataset"). Recomputes the model's own declared
          bridge from the extract this run actually used (not the live input, which may
          have been edited since), before and independently of any save. */}
      {status === "done" && hasFullTriple(result) && runInputs?.currentPrice != null && (
        <ValuationChecksCard
          result={result}
          extract={runInputs.dataset?.extract ?? null}
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
          shows (raw, below) and saves as Markdown only — say so instead of hiding it. */}
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
