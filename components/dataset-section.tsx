"use client";

// The financial dataset of a Deep Value run on /analyze, above <DeepValuePanel>. Every
// analysis starts from one (single path since 2026-11-09: the report is built on numbers
// with a source per row, never on figures the model gathers while it writes). On a ticker
// it looks for the user's dataset of the last DATASET_REUSE_MAX_AGE_DAYS days and opens on
// it ("Use this dataset", "Refresh data", "Edit the pasted data"); otherwise it offers the
// web research and the paste editor. Nothing is picked or researched for the user: a
// research run takes minutes and costs, so it starts from a click, and every dataset is
// previewed before it is used.
//
// A paste confirmed while a web dataset is on screen is merged with it on the server
// (POST /api/datasets, origin "merged"): the merged dataset is previewed in its turn.
import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/context/language-context";
import { GroundingInput } from "@/components/grounding-input";
import { DatasetTables } from "@/components/report/dataset-tables";
import { GroundingPreview, warningLabelKey } from "@/components/report/grounding-preview";
import { createMergedDataset, fetchLatestDataset, researchDataset } from "@/lib/dataset-client";
import { checkCurrencyMismatch } from "@/lib/grounding/reconcile";
import { normalizeTicker } from "@/lib/ticker";
import { DATASET_REUSE_MAX_AGE_DAYS, type DatasetOrigin, type MergedDatasetResponse, type ResearchResponse, type StoredDataset } from "@/types/dataset";
import type { GroundedFinancials, GroundingBlock } from "@/types/grounding";
import type { Translations } from "@/lib/i18n/translations";

type DatasetValue = { id: string; extract: GroundedFinancials };

type Props = {
  ticker: string;
  quote: { price: number; currency: string } | null;
  value: DatasetValue | null;
  onChange: (value: DatasetValue | null) => void;
};

type Bundle = ResearchResponse | MergedDatasetResponse;

// `pasteDatasetId` on researching/error: the paste the new web dataset is merged with once
// the research answers ("Refresh data" on a paste or merged dataset), null for a plain run.
type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "reuse"; stored: StoredDataset }
  // `failed`: the lookup itself failed — said once, then the same choices as when there is none.
  | { status: "empty"; failed: boolean }
  | { status: "researching"; startedAt: number; pasteDatasetId: string | null }
  | { status: "error"; message: string; pasteDatasetId: string | null }
  | { status: "preview"; bundle: Bundle; origin: "web" | "merged"; mergeError: string | null };

const ORIGIN_LABEL: Record<DatasetOrigin, keyof Translations> = {
  paste: "datasetOriginPaste",
  web: "datasetOriginWeb",
  merged: "datasetOriginMerged",
};

/** The web dataset a new paste is merged with: the one on screen, or the web half of a
 *  merged one. Null when no web dataset is on screen — the paste is then used alone. */
function webDatasetIdOf(lookup: Lookup): string | null {
  if (lookup.status === "reuse") {
    const meta = lookup.stored.dataset.datasetMeta;
    return meta.origin === "web" ? lookup.stored.id : meta.origin === "merged" ? meta.webDatasetId : null;
  }
  if (lookup.status === "preview") {
    return lookup.origin === "web" ? lookup.bundle.datasetId : lookup.bundle.dataset.datasetMeta.webDatasetId;
  }
  return null;
}

/** The paste a refreshed research is merged with: the reused paste itself, or the paste
 *  half of a merged one. */
function pasteDatasetIdOf(stored: StoredDataset): string | null {
  const meta = stored.dataset.datasetMeta;
  return meta.origin === "paste" ? stored.id : meta.origin === "merged" ? meta.pasteDatasetId : null;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "");

function ResearchingCounter({ startedAt }: { startedAt: number }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <p className="flex items-center gap-2 text-sm text-slate-200" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
      {t("datasetResearchingState").replace("{s}", String(seconds))}
    </p>
  );
}

const SECONDARY_BTN =
  "tap rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-400 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BTN =
  "tap rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40";

export function DatasetSection({ ticker, quote, value, onChange }: Props) {
  const { t, locale } = useLanguage();
  const [sectionOpen, setSectionOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  // The paste editor: closed (null), open empty ("Add pasted data", the editor's own draft)
  // or seeded with the reused dataset's blocks ("Edit the pasted data").
  const [editor, setEditor] = useState<{ seed: GroundingBlock[] | undefined } | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // The ticker an answer arrives for is compared with this one: a research or a merge
  // started for the previous ticker never lands on the new one (its dataset is saved, and
  // offered for reuse when the user comes back to that ticker).
  const tickerRef = useRef(ticker);

  // A different stock is a different dataset: drop the confirmed one and look again. The
  // abort and the ticker check both keep a slow answer for the previous ticker out.
  useEffect(() => {
    tickerRef.current = ticker;
    onChange(null);
    setEditor(null);
    setMergeError(null);
    setMerging(false);
    setSectionOpen(false);
    setLookup({ status: "checking" });
    const controller = new AbortController();
    fetchLatestDataset(ticker, DATASET_REUSE_MAX_AGE_DAYS, controller.signal)
      .then((stored) => {
        if (controller.signal.aborted) return;
        if (stored && stored.dataset.datasetMeta.ticker === normalizeTicker(ticker)) {
          setLookup({ status: "reuse", stored });
        } else {
          setLookup({ status: "empty", failed: false });
        }
        // Open either way: there is no analysis without a dataset, so its choices are the
        // first thing to see.
        setSectionOpen(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLookup({ status: "empty", failed: true });
        setSectionOpen(true);
      });
    return () => controller.abort();
    // onChange is a state setter passed fresh each render — depending only on `ticker`
    // avoids re-running this reset on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function runResearch(pasteDatasetId: string | null) {
    const forTicker = ticker;
    // The confirmed dataset is being replaced: no analysis runs on it in the meantime.
    onChange(null);
    setEditor(null);
    setMergeError(null);
    setLookup({ status: "researching", startedAt: Date.now(), pasteDatasetId });
    let web: ResearchResponse;
    try {
      web = await researchDataset(forTicker);
    } catch (err) {
      if (tickerRef.current === forTicker) setLookup({ status: "error", message: errorMessage(err), pasteDatasetId });
      return;
    }
    if (tickerRef.current !== forTicker) return;
    if (!pasteDatasetId) {
      setLookup({ status: "preview", bundle: web, origin: "web", mergeError: null });
      return;
    }
    try {
      const merged = await createMergedDataset(forTicker, pasteDatasetId, web.datasetId);
      if (tickerRef.current === forTicker) setLookup({ status: "preview", bundle: merged, origin: "merged", mergeError: null });
    } catch (err) {
      // The research succeeded and is saved: show it, and say the merge did not happen.
      if (tickerRef.current === forTicker) setLookup({ status: "preview", bundle: web, origin: "web", mergeError: errorMessage(err) });
    }
  }

  // The editor saved a paste dataset: with a web dataset on screen the two are merged on
  // the server and the merge is previewed; alone, the paste is the dataset (the editor's
  // own preview was the look at the numbers).
  async function handlePasteConfirm(paste: DatasetValue) {
    const webDatasetId = webDatasetIdOf(lookup);
    if (!webDatasetId) {
      onChange(paste);
      return;
    }
    const forTicker = ticker;
    setMerging(true);
    setMergeError(null);
    try {
      const merged = await createMergedDataset(forTicker, paste.id, webDatasetId);
      if (tickerRef.current !== forTicker) return;
      setLookup({ status: "preview", bundle: merged, origin: "merged", mergeError: null });
      setEditor(null);
    } catch (err) {
      if (tickerRef.current === forTicker) setMergeError(errorMessage(err));
    } finally {
      if (tickerRef.current === forTicker) setMerging(false);
    }
  }

  const stored = lookup.status === "reuse" ? lookup.stored : null;
  const reuseWarnings = stored
    ? [...stored.warnings, ...(quote ? [checkCurrencyMismatch(stored.dataset, quote.currency)].filter((w) => w != null) : [])]
    : [];
  const researching = lookup.status === "researching";

  const researchButton = (pasteDatasetId: string | null, label: keyof Translations = "datasetResearchBtn") => (
    <button onClick={() => runResearch(pasteDatasetId)} disabled={researching || merging} className={PRIMARY_BTN}>
      {t(label)}
    </button>
  );
  const addPasteButton = (
    <button onClick={() => setEditor({ seed: undefined })} disabled={researching || merging} className={SECONDARY_BTN}>
      {t("datasetAddPasteBtn")}
    </button>
  );

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

          {editor === null && lookup.status === "empty" && (
            <div className="space-y-3">
              {lookup.failed && <p className="text-xs text-warning">{t("datasetLookupError")}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {researchButton(null)}
                {addPasteButton}
              </div>
            </div>
          )}

          {lookup.status === "researching" && <ResearchingCounter startedAt={lookup.startedAt} />}

          {editor === null && lookup.status === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-red-400" role="alert">
                {t("datasetResearchError")}
                {lookup.message && ` — ${lookup.message}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {researchButton(lookup.pasteDatasetId, "datasetRetryResearch")}
                {addPasteButton}
              </div>
            </div>
          )}

          {editor === null && stored && (
            <div className="space-y-3">
              <p className="text-sm text-slate-200">
                {t("datasetFoundPrefix")} {new Date(stored.createdAt).toLocaleDateString(locale)} ({t(ORIGIN_LABEL[stored.dataset.datasetMeta.origin])})
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
                <button onClick={() => onChange({ id: stored.id, extract: stored.dataset })} disabled={value?.id === stored.id} className={PRIMARY_BTN}>
                  {t("datasetUseBtn")}
                </button>
                <button onClick={() => runResearch(pasteDatasetIdOf(stored))} className={SECONDARY_BTN}>
                  {t("datasetRefreshBtn")}
                </button>
                {stored.blocks.length > 0 ? (
                  <button onClick={() => setEditor({ seed: stored.blocks })} className={SECONDARY_BTN}>
                    {t("datasetEditPasteBtn")}
                  </button>
                ) : (
                  addPasteButton
                )}
                {value?.id === stored.id && <span className="text-xs font-medium text-success">✓ {t("groundingReadyBadge")}</span>}
              </div>
            </div>
          )}

          {editor === null && lookup.status === "preview" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-200">
                {t("datasetFoundPrefix")} {new Date(lookup.bundle.dataset.datasetMeta.createdAt).toLocaleDateString(locale)} (
                {t(ORIGIN_LABEL[lookup.origin])})
              </p>
              {lookup.mergeError !== null && (
                <p className="text-xs text-warning">
                  {t("datasetSaveError")}
                  {lookup.mergeError && ` — ${lookup.mergeError}`}
                </p>
              )}
              <GroundingPreview
                ticker={ticker}
                result={{ ...lookup.bundle, extract: lookup.bundle.dataset, blockResults: [], failedBlockIds: [] }}
                confirmed={value?.id === lookup.bundle.datasetId}
                onConfirm={() => onChange({ id: lookup.bundle.datasetId, extract: lookup.bundle.dataset })}
              />
              {(lookup.bundle.research?.unverifiedSources.length ?? 0) > 0 && (
                <div data-testid="dataset-unverified-sources">
                  <p className="text-xs font-semibold uppercase tracking-wider text-warning">{t("datasetUnverifiedSources")}</p>
                  <ul className="mt-1 space-y-0.5">
                    {lookup.bundle.research!.unverifiedSources.map((url) => (
                      <li key={url} className="break-all text-xs text-muted">
                        {url}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lookup.origin === "web" && <div className="flex flex-wrap items-center gap-2">{addPasteButton}</div>}
            </div>
          )}

          {editor !== null && (
            <div className="space-y-2">
              <GroundingInput
                key={ticker}
                ticker={ticker}
                seedBlocks={editor.seed}
                valueId={value?.id ?? null}
                onConfirm={handlePasteConfirm}
                onInvalidate={() => onChange(null)}
              />
              {merging && <p className="text-xs text-muted">{t("savingState")}</p>}
              {mergeError !== null && (
                <p className="text-xs text-warning">
                  {t("datasetSaveError")}
                  {mergeError && ` — ${mergeError}`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
