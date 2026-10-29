"use client";

// Breadcrumb and footer actions of the saved-analysis detail page. The page is a server
// component and cannot call t(); these two pieces used to hardcode English (2026-10-11),
// so they live here and read the app language like every other surface.
import Link from "next/link";
import { useLanguage } from "@/context/language-context";
import DownloadPdfButton from "@/components/download-pdf-button";

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

export function DetailFooterActions({ ticker }: { ticker: string }) {
  const { t } = useLanguage();
  return (
    <div className="mt-6 flex items-center justify-between print:hidden">
      <Link href="/analyses" className="text-sm text-slate-400 hover:text-slate-200">
        {t("backToSavedAnalyses")}
      </Link>
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
    </div>
  );
}
