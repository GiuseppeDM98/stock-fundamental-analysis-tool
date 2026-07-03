"use client";

// Triggers the browser's native print dialog, scoped by app/print.css to just
// the `.print-report` subtree — "Save as PDF" in that dialog is the export.
// A tiny client-component wrapper so the (server-component) saved-analysis
// detail page can still offer the button without becoming a client component.
export default function DownloadPdfButton({ label }: { label: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-sky-400 transition hover:border-sky-500/50 hover:text-sky-300 print:hidden"
    >
      {label}
    </button>
  );
}
