"use client";

// The financial dataset of a Deep Value run on /analyze, above <DeepValuePanel>. On a
// ticker it looks for the user's dataset of the last DATASET_REUSE_MAX_AGE_DAYS days: when
// there is one, the section opens on it (its tables and warnings) with "Use this dataset"
// and "Refresh data"; otherwise it holds the paste editor, closed. Nothing is picked or
// searched for the user: reuse is one click, after a look at the numbers.
import { useEffect, useState } from "react";

import { useLanguage } from "@/context/language-context";
import { GroundingInput } from "@/components/grounding-input";
import { DatasetTables } from "@/components/report/dataset-tables";
import { warningLabelKey } from "@/components/report/grounding-preview";
import { fetchLatestDataset } from "@/lib/dataset-client";
import { checkCurrencyMismatch } from "@/lib/grounding/reconcile";
import { normalizeTicker } from "@/lib/ticker";
import { DATASET_REUSE_MAX_AGE_DAYS, type StoredDataset } from "@/types/dataset";
import type { GroundedFinancials, GroundingBlock } from "@/types/grounding";

type DatasetValue = { id: string; extract: GroundedFinancials };

type Props = {
  ticker: string;
  quote: { price: number; currency: string } | null;
  value: DatasetValue | null;
  onChange: (value: DatasetValue | null) => void;
};

type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "reuse"; stored: StoredDataset }
  // `failed`: the lookup itself failed — said once, then the editor as when there is none.
  | { status: "empty"; failed: boolean };

export function DatasetSection({ ticker, quote, value, onChange }: Props) {
  const { t, locale } = useLanguage();
  const [sectionOpen, setSectionOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  // "Refresh data" on the reused dataset: the editor, seeded with that dataset's blocks.
  const [refreshSeed, setRefreshSeed] = useState<GroundingBlock[] | null>(null);

  // A different stock is a different dataset: drop the confirmed one and look again. The
  // abort and the ticker check both keep a slow answer for the previous ticker out.
  useEffect(() => {
    onChange(null);
    setRefreshSeed(null);
    setSectionOpen(false);
    setLookup({ status: "checking" });
    const controller = new AbortController();
    fetchLatestDataset(ticker, DATASET_REUSE_MAX_AGE_DAYS, controller.signal)
      .then((stored) => {
        if (controller.signal.aborted) return;
        if (stored && stored.dataset.datasetMeta.ticker === normalizeTicker(ticker)) {
          setLookup({ status: "reuse", stored });
          setSectionOpen(true);
        } else {
          setLookup({ status: "empty", failed: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookup({ status: "empty", failed: true });
      });
    return () => controller.abort();
    // onChange is a state setter passed fresh each render — depending only on `ticker`
    // avoids re-running this reset on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const stored = lookup.status === "reuse" ? lookup.stored : null;
  const showReuse = stored !== null && refreshSeed === null;
  const reuseWarnings = stored
    ? [...stored.warnings, ...(quote ? [checkCurrencyMismatch(stored.dataset, quote.currency)].filter((w) => w != null) : [])]
    : [];

  return (
    <div className="card print:hidden" data-testid="dataset-section">
      {/* Header — the section's own collapse toggle. The "ready" badge sits inside it
          (plain span, not interactive) so gotcha #24 doesn't apply here. */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setSectionOpen((v) => !v)} aria-expanded={sectionOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{t("groundingSectionTitle")}</span>
            {value && (
              <span className="shrink-0 rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                ✓ {t("groundingReadyBadge")}
              </span>
            )}
          </div>
          {!sectionOpen && <p className="mt-0.5 truncate text-xs text-muted">{t("groundingSectionDesc")}</p>}
        </button>
        <button
          onClick={() => setSectionOpen((v) => !v)}
          aria-label={sectionOpen ? t("groundingCollapseSection") : t("groundingExpandSection")}
          className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <span className={`inline-block transition-transform duration-150 ${sectionOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>

      {/* Hidden, not unmounted, when closed: the editor keeps its preview and results. */}
      {lookup.status !== "idle" && lookup.status !== "checking" && (
        <div className={sectionOpen ? "mt-3 space-y-3" : "hidden"}>
          <p className="text-xs text-muted">{t("groundingSectionDesc")}</p>
          {lookup.status === "empty" && lookup.failed && <p className="text-xs text-warning">{t("datasetLookupError")}</p>}

          {showReuse && (
            <div className="space-y-3">
              <p className="text-sm text-slate-200">
                {t("datasetFoundPrefix")} {new Date(stored.createdAt).toLocaleDateString(locale)} (
                {stored.dataset.datasetMeta.origin === "paste" ? t("datasetOriginPaste") : stored.dataset.datasetMeta.origin})
              </p>
              <DatasetTables extract={stored.dataset} compact />
              {reuseWarnings.length > 0 && (
                <ul className="space-y-1">
                  {reuseWarnings.map((w, i) => (
                    <li key={i} className="text-xs text-warning">
                      ⚠ {t(warningLabelKey(w.code))}
                      {w.fiscalYear != null && ` (FY${w.fiscalYear})`}
                      {w.detail && ` — ${w.detail}`}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-3">
                <button
                  onClick={() => onChange({ id: stored.id, extract: stored.dataset })}
                  disabled={value?.id === stored.id}
                  className="tap rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("datasetUseBtn")}
                </button>
                <button
                  onClick={() => setRefreshSeed(stored.blocks)}
                  className="tap rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
                >
                  {t("datasetRefreshBtn")}
                </button>
                {value?.id === stored.id && <span className="text-xs font-medium text-success">✓ {t("groundingReadyBadge")}</span>}
              </div>
            </div>
          )}

          {(lookup.status === "empty" || refreshSeed !== null) && (
            <GroundingInput
              key={ticker}
              ticker={ticker}
              seedBlocks={refreshSeed ?? undefined}
              valueId={value?.id ?? null}
              onConfirm={onChange}
              onInvalidate={() => onChange(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
