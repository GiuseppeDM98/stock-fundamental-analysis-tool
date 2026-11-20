"use client";

// Breadcrumb and footer actions of the saved-analysis detail page. The page is a server
// component and cannot call t(); these two pieces used to hardcode English (2026-10-11),
// so they live here and read the app language like every other surface.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/context/language-context";
import DownloadPdfButton from "@/components/download-pdf-button";
import AnalysisRunStatus from "@/components/analysis-run-status";
import { deleteAnalysis } from "@/lib/analyses";
import type { SavedAnalysis } from "@/types/analysis";

export function DetailBreadcrumb({ ticker }: { ticker: string }) {
  const { t } = useLanguage();
  return (
    <div className="mb-6 flex items-center gap-2 text-sm text-slate-400 print:hidden">
      <Link href="/analyses" className="hover:text-slate-200">
        {t("navSavedAnalyses")}
      </Link>
      <span>/</span>
      <span className="font-mono text-sky-400">{ticker}</span>
    </div>
  );
}

/** A row whose run has not finished has no report: no PDF and no Re-run, only the way back. */
export function DetailFooterActions({ ticker, finished = true }: { ticker: string; finished?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="mt-6 flex items-center justify-between print:hidden">
      <Link href="/analyses" className="text-sm text-slate-400 hover:text-slate-200">
        {t("backToSavedAnalyses")}
      </Link>
      {finished && (
        <div className="flex items-center gap-3">
          <DownloadPdfButton label={t("downloadPdf")} />
          {/* Re-run opens the analyze page with this ticker pre-loaded */}
          <a
            href={`/analyze?ticker=${encodeURIComponent(ticker)}`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-sky-400 transition hover:border-sky-500/50 hover:text-sky-300"
          >
            {t("rerunAnalysis")}
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * The detail page of a row whose run has not finished (2026-10-27): the status line in place
 * of the report, with no analyst panel. Delete goes back to the list.
 */
export function DetailRunStatus({ analysis }: { analysis: Pick<SavedAnalysis, "id" | "ticker" | "runStatus" | "runStartedAt" | "runError" | "datasetId"> }) {
  const { t } = useLanguage();
  const [now, setNow] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setNow(Date.now()), []);

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await deleteAnalysis(id);
      window.location.href = "/analyses";
    } catch {
      setError(true);
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-2">
      <AnalysisRunStatus analysis={analysis} now={now} deleting={deleting} onDelete={handleDelete} />
      {error && <p className="text-sm text-red-400">{t("errorFailedDelete")}</p>}
    </div>
  );
}
