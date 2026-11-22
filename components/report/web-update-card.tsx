"use client";

// The web update's notes (2026-11-22): what the valuation read beyond the dataset — results
// after its period, restatements, the cost of capital, the qualitative context — each fact
// with its source. Shown above the report on the live panel and on the saved page, open on
// arrival and collapsible. Inside `.print-report` (gotcha 27).
//
// A closed <details> prints only its summary: Chrome hides the body through
// `::details-content`, which a rule on the children does not reach (seen in the owner's
// print preview, 2026-11-22). So the card opens itself before printing and closes again
// after, if the reader had closed it; app/print.css covers the browsers that print without
// firing `beforeprint`.
import { useEffect, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import ReportBody from "@/components/report/report-body";
import { stripJsonBlock } from "@/lib/report/parse-deep-value-json";

export function WebUpdateCard({ notesMd }: { notesMd: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let reopened = false;
    const before = () => {
      const el = ref.current;
      if (el && !el.open) {
        el.open = true;
        reopened = true;
      }
    };
    const after = () => {
      if (reopened && ref.current) ref.current.open = false;
      reopened = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <div className="print-report">
      <details ref={ref} open className="web-update card" data-testid="web-update-card">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-slate-400">{t("webUpdateTitle")}</summary>
        <div className="mt-3">
          <ReportBody markdown={stripJsonBlock(notesMd)} />
        </div>
      </details>
    </div>
  );
}
