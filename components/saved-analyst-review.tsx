"use client";

// Analyst Review section for the saved-analysis detail page.
//
// Mirrors the live review box in deep-value-panel.tsx but persists its result:
// when a saved analysis has no review yet, the user can generate one here and it
// is attached to the analysis via PATCH /api/analyses/:id. If a review already
// exists (run before saving, or generated here earlier) it is rendered directly.
//
// This makes the review order-independent — it no longer matters whether the
// user ran it before or after saving the report.
import { useState, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import { updateAnalysisReview } from "@/lib/analyses";
import ReportBody from "@/components/report/report-body";

type Status = "idle" | "loading" | "streaming" | "done" | "error";

type Props = {
  analysisId: string;
  ticker: string;
  // The report Markdown WITHOUT its JSON block — what the reviewer critiques.
  reportMd: string;
  // Existing review, if this analysis already has one.
  initialReviewMd: string | null;
};

export default function SavedAnalystReview({ analysisId, ticker, reportMd, initialReviewMd }: Props) {
  const { language: globalLanguage, t } = useLanguage();

  const [reviewText, setReviewText] = useState<string>(initialReviewMd ?? "");
  // If a review already exists we start in "done"; otherwise it's idle until run.
  const [status, setStatus] = useState<Status>(initialReviewMd ? "done" : "idle");
  const abortRef = useRef<AbortController | null>(null);

  async function handleRunReview() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReviewText("");
    setStatus("loading");

    try {
      const res = await fetch("/api/ai/deep-value/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          reportMd,
          language: APP_TO_AI_LANGUAGE[globalLanguage] ?? "English",
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      setStatus("streaming");

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

      setStatus("done");

      // Persist the completed review. A save failure is non-fatal — the review is
      // still shown; the user can re-run to retry persistence.
      try {
        await updateAnalysisReview(analysisId, accumulated);
      } catch (saveErr) {
        console.error("Failed to persist analyst review:", saveErr);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("error");
    }
  }

  const isRunning = status === "loading" || status === "streaming";

  return (
    // Included in the PDF export only once a review exists; controls stay screen-only.
    <div className={`mt-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 ${reviewText ? "break-inside-avoid" : "print:hidden"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-violet-300 print:text-violet-700">{t("analystReviewTitle")}</h3>

        {status === "idle" && (
          <button
            onClick={handleRunReview}
            className="tap rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 print:hidden"
          >
            {t("analystReviewButton")}
          </button>
        )}

        {isRunning && (
          <span className="flex items-center gap-2 text-xs text-violet-300 print:hidden">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
            {t("analystReviewRunning")}
          </span>
        )}

        {status === "done" && reviewText && (
          <div className="flex items-center gap-3 print:hidden">
            <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400/70">
              ✓ {t("analystReviewSavedNote")}
            </span>
            {/* Regenerate — e.g. after a truncated run, or to refresh the critique. */}
            <button
              onClick={handleRunReview}
              className="tap rounded-lg border border-violet-500/40 px-2.5 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10"
            >
              {t("analystReviewRerun")}
            </button>
          </div>
        )}
      </div>

      {/* Prompt copy — only before the first run. */}
      {status === "idle" && (
        <p className="mt-2 text-xs text-slate-400 print:hidden">{t("analystReviewSavedDesc")}</p>
      )}

      {status === "error" && (
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
          {status === "streaming" && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400 print:hidden" />
          )}
          <ReportBody markdown={reviewText} />
        </div>
      )}
    </div>
  );
}
