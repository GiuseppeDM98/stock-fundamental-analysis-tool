"use client";

// Deep Value Panel — Claude autonomously picks the valuation method,
// finds all financial data via web search, and streams a JSON block
// (method + fair values) followed by a full Markdown report.
import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { saveAnalysis } from "@/lib/analyses";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";

type Props = {
  ticker: string | null;
  companyName?: string;
  mosPercent?: number;
};

type Status = "idle" | "loading" | "streaming" | "done" | "error";

type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  bull: { fairValue: number; upside: number };
  base: { fairValue: number; upside: number };
  bear: { fairValue: number; upside: number };
};

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

function parseDeepValueJson(text: string): DeepValueResult | null {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as DeepValueResult;
  } catch {
    return null;
  }
}

function stripJsonBlock(text: string): string {
  return text.replace(/```json\n[\s\S]*?\n```\n?/, "");
}

function UpsideBadge({ upside }: { upside: number }) {
  const isPositive = upside >= 0;
  return (
    <span
      className={`text-xs font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}
    >
      {isPositive ? "+" : ""}
      {upside.toFixed(1)}%
    </span>
  );
}

export default function DeepValuePanel({ ticker, companyName, mosPercent = 0 }: Props) {
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

    try {
      const res = await fetch("/api/ai/deep-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, language, mosPercent }),
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
      });
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
    }
  }

  const isStreaming = status === "loading" || status === "streaming";
  const markdownContent = status === "done" && report ? stripJsonBlock(report) : report;

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{t("deepValueTitle")}</h2>
          <p className="text-sm text-slate-400">{t("deepValueDesc")}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isStreaming}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none disabled:opacity-50"
            aria-label="Report language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>

          <button
            onClick={handleGenerate}
            disabled={!ticker || isStreaming}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
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
        <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-sm text-violet-300">
          <button onClick={() => router.push("/login")} className="underline hover:no-underline">
            {t("navSignIn")}
          </button>{" "}
          {t("signInToAnalyze")}
        </p>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{errorMsg}</p>
      )}

      {/* Method + fair value cards — shown after streaming completes */}
      {status === "done" && result && (
        <div className="space-y-3">
          {/* Method badge */}
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
              {result.sector}
            </span>
            <span className="rounded-full bg-violet-900/50 px-3 py-1 text-xs font-semibold text-violet-300">
              {result.method}
            </span>
          </div>

          {/* Fair value cards */}
          <div className="grid grid-cols-3 gap-3">
            {(["bull", "base", "bear"] as const).map((scenario) => {
              const s = result[scenario];
              const labels = { bull: "Bull", base: "Base", bear: "Bear" };
              return (
                <div
                  key={scenario}
                  className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-3 text-center"
                >
                  <p className="text-xs text-slate-400">{labels[scenario]}</p>
                  <p className="mt-1 text-base font-bold text-slate-100">
                    {result.currency} {s.fairValue.toFixed(2)}
                  </p>
                  <UpsideBadge upside={s.upside} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Streaming report */}
      {report && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          {isStreaming && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400" />
          )}
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-headings:mt-6 prose-headings:mb-2 prose-p:text-slate-300 prose-p:leading-relaxed prose-p:mb-3 prose-strong:text-slate-100 prose-li:text-slate-300 prose-li:my-1 prose-a:text-violet-400 prose-table:w-full prose-th:text-slate-200 prose-td:text-slate-300 prose-hr:border-slate-700/50">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Save controls */}
      {status === "done" && report && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving" || saveStatus === "saved"}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            {saveStatus === "saving" && t("savingState")}
            {saveStatus === "saved" && t("savedState")}
            {saveStatus === "error" && t("retrySave")}
            {saveStatus === "idle" && t("saveReport")}
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
    </div>
  );
}
