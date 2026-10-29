"use client";

// The verifiable extract preview for the Grounded Deep Value mode — renders what the
// extraction endpoint transcribed + the deterministic anchors computed from it, BEFORE
// the user spends a 30-60s Deep Value run on possibly-mistranscribed data.
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import type { GroundingExtractResponse } from "@/lib/grounding-client";
import type { ImpliedExpectations, MultipleKey, ValuationGrid, ValuationGridRow } from "@/lib/grounding/anchors";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import type { FiscalYearMultiples, GroundingMeta } from "@/types/grounding";
import { BasisReconciliationLine } from "@/components/report/basis-reconciliation-line";

const UNIT_KEY: Record<NonNullable<GroundingMeta["units"]>, keyof Translations> = {
  billions: "groundingUnitBillions",
  millions: "groundingUnitMillions",
  thousands: "groundingUnitThousands",
  units: "groundingUnitUnits",
};

// Standard finance notation — deliberately NOT translated, same treatment as the
// method badges elsewhere in the app (e.g. "EV/EBITDA", "DCF") which render as-is
// regardless of language.
const MULTIPLE_LABEL: Record<MultipleKey, string> = {
  evEbitda: "EV/EBITDA",
  evSales: "EV/Sales",
  pe: "P/E",
  pb: "P/B",
};

const WARNING_KEY: Partial<Record<ReconciliationWarning["code"], keyof Translations>> = {
  eps_mismatch: "groundingWarnEpsMismatch",
  netdebt_mismatch: "groundingWarnNetdebtMismatch",
  share_count_jump: "groundingWarnShareCountJump",
  ebit_gt_ebitda: "groundingWarnEbitGtEbitda",
  value_conflict: "groundingWarnValueConflict",
  currency_mismatch: "groundingWarnCurrencyMismatch",
  no_multiples: "groundingWarnNoMultiples",
  missing_bridge_inputs: "groundingWarnMissingBridgeInputs",
  block_extract_failed: "groundingWarnBlockExtractFailed",
  meta_currency_conflict: "groundingWarnMetaCurrencyConflict",
  meta_units_conflict: "groundingWarnMetaUnitsConflict",
  basis_mismatch: "groundingWarnBasisMismatch",
  basis_unverifiable: "groundingWarnBasisUnverifiable",
  ev_bridge_mismatch: "groundingWarnEvBridgeMismatch",
  dividend_not_covered: "groundingWarnDividendNotCovered",
};

// Exported — reused by valuation-checks-card.tsx so the two surfaces that render
// ReconciliationWarning[] (this pre-generation preview and the post-generation
// deterministic card) never drift onto two different code→translation-key mappings.
export function warningLabelKey(code: ReconciliationWarning["code"]): keyof Translations {
  // roe_mismatch is dormant (lib/grounding/reconcile.ts never emits it) but stays in the
  // union for forward compatibility — the fallback below covers it if that ever changes.
  return WARNING_KEY[code] ?? "groundingWarnGeneric";
}

/**
 * Splits an EV/EBITDA series into the same early/late halves `computeMultipleStats`
 * (lib/grounding/anchors.ts) uses for earlyMean/lateMean, but keeps the fiscal-YEAR
 * labels instead of the mean — purely a display concern, so it isn't in the pure lib.
 * MUST mirror that function's `Math.floor(n / 2)` split so the labels always match the
 * values actually shown.
 */
function evEbitdaYearHalves(multiples: FiscalYearMultiples[]): { earlyRange: string; lateRange: string } | null {
  const years = multiples.filter((m) => m.evEbitda != null).map((m) => m.fiscalYear);
  if (years.length < 2) return null;
  const mid = Math.floor(years.length / 2);
  const early = years.slice(0, mid);
  const late = years.slice(mid);
  const range = (ys: number[]) => (ys.length > 1 ? `${ys[0]}-${ys[ys.length - 1]}` : `${ys[0]}`);
  return { earlyRange: range(early), lateRange: range(late) };
}

type Props = {
  ticker: string;
  result: GroundingExtractResponse;
  confirmed: boolean;
  onEdit: () => void;
  onConfirm: () => void;
};

type T = (key: keyof Translations) => string;

const HORIZON_KEY: Record<ValuationGridRow["horizon"], keyof Translations> = {
  trailing: "groundingHorizonTrailing",
  midcycle: "groundingHorizonMidcycle",
  forward: "groundingHorizonForward",
};

/**
 * The grid row's label, translated at render time from its horizon + driverYear — the
 * pure lib keeps its plain-English `label` (the prompt and the anchor tests read it), so
 * only the display layer localizes. Falls back to that label if the year is missing.
 */
function gridRowLabel(row: ValuationGridRow, t: T): string {
  if (row.horizon === "midcycle") return t("groundingGridRowMedian5y");
  if (row.driverYear == null) return row.label;
  return row.horizon === "trailing" ? `${t("groundingGridRowLastFy")} (${row.driverYear})` : `${row.driverYear}e`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}%`;
}

function ValuationGridTable({ grid, t }: { grid: ValuationGrid; t: T }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t("groundingGridTitle")}{" "}
        <span className="font-normal normal-case tracking-normal">
          ({grid.basisApplied ? t("groundingGridSameBasisTag") : t("groundingGridUnverifiedNote")})
        </span>
      </p>
      <table className="mt-1 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted">
            <th className="py-0.5 pr-2 text-left font-normal">EV/EBITDA</th>
            {grid.columns.map((c) => (
              <th key={c.label} className="py-0.5 pl-2 text-right font-normal">
                {c.label === "median" ? t("groundingMedianLabel") : c.label} {c.multiple.toFixed(1)}x
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, ri) => (
            <tr key={`${row.horizon}-${ri}`} className="border-t border-slate-800/60 text-slate-300">
              <td className="py-1 pr-2 text-left">
                {gridRowLabel(row, t)}{" "}
                <span className="whitespace-nowrap rounded-sm bg-slate-800 px-1 py-0.5 text-[10px] text-muted">{t(HORIZON_KEY[row.horizon])}</span>
              </td>
              {grid.cells[ri].map((c, ci) => (
                <td key={ci} className="py-1 pl-2 text-right font-mono">
                  {c ? c.perShare.toFixed(2) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "What must be true" — the reverse-engineered read of today's price: the EBITDA it
 * requires at the historical median multiple, and the multiple it pays on the next
 * forward estimate. Renders nothing when neither half is computable.
 */
function ImpliedExpectationsBlock({
  expectations,
  latestFy,
  unitsLabel,
  t,
  locale,
}: {
  expectations: ImpliedExpectations;
  latestFy: number | null;
  unitsLabel: string | null;
  t: T;
  locale: string;
}) {
  const { requiredEbitdaAtMedian, vsLatestFyPct, vsNextEstimatePct, nextEstimateYear, multipleAtNextEstimate, multipleAtNextEstimatePercentile } =
    expectations;
  if (requiredEbitdaAtMedian == null && multipleAtNextEstimate == null) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("groundingImpliedTitle")}</p>
      {requiredEbitdaAtMedian != null && (
        <p className="mt-1 text-sm text-slate-300">
          {t("groundingImpliedRequiredEbitda")}{" "}
          <span className="font-medium text-slate-100">
            {Math.round(requiredEbitdaAtMedian).toLocaleString(locale)}
            {unitsLabel ? ` ${unitsLabel}` : ""}
          </span>
          {vsLatestFyPct != null && (
            <>
              {" · "}
              <span className={vsLatestFyPct < 0 ? "text-warning" : "text-slate-300"}>{formatPct(vsLatestFyPct)}</span> {t("groundingImpliedVsLatestFy")}
              {latestFy != null ? ` (${latestFy})` : ""}
            </>
          )}
          {vsNextEstimatePct != null && nextEstimateYear != null && (
            <>
              {" · "}
              {formatPct(vsNextEstimatePct)} {t("groundingImpliedVsEstimate")} {nextEstimateYear}e
            </>
          )}
        </p>
      )}
      {multipleAtNextEstimate != null && nextEstimateYear != null && (
        <p className="mt-0.5 text-sm text-slate-300">
          {t("groundingImpliedMultipleAtEstimate")} ({nextEstimateYear}e) {multipleAtNextEstimate.toFixed(2)}x ({t("groundingImpliedOnProviderLabel")})
          {multipleAtNextEstimatePercentile != null && ` → ${t("groundingPercentileLabel")} ${multipleAtNextEstimatePercentile.toFixed(0)}`}
          <span className="block text-xs text-muted">{t("groundingImpliedCrossHorizonNote")}</span>
        </p>
      )}
    </div>
  );
}

export function GroundingPreview({ ticker, result, confirmed, onEdit, onConfirm }: Props) {
  const { t, locale } = useLanguage();
  const { extract, basis, stats, grid, marketImplied, impliedExpectations, warnings } = result;

  const years = extract.financials.map((f) => f.fiscalYear);
  const yearRange = years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : null;

  const evEbitdaStats = stats.find((s) => s.key === "evEbitda");
  const otherStats = stats.filter((s) => s.key !== "evEbitda");
  const yearHalves = evEbitdaStats ? evEbitdaYearHalves(extract.multiples) : null;
  const trend =
    evEbitdaStats?.earlyMean != null && evEbitdaStats?.lateMean != null
      ? evEbitdaStats.lateMean > evEbitdaStats.earlyMean
        ? t("groundingTrendReRating")
        : evEbitdaStats.lateMean < evEbitdaStats.earlyMean
          ? t("groundingTrendDeRating")
          : null
      : null;

  const peerLines = extract.peers
    .map((p) => {
      const latest = p.multiples[p.multiples.length - 1];
      return latest?.evEbitda != null ? `${p.ticker} ${latest.evEbitda.toFixed(1)}x` : null;
    })
    .filter((s): s is string => s != null);

  return (
    <div className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">
          {t("groundingPreviewTitle")} — {ticker}
          {extract.meta.reportingCurrency ? ` · ${extract.meta.reportingCurrency}` : ""}
          {extract.meta.units ? ` · ${t(UNIT_KEY[extract.meta.units])}` : ""}
          {years.length > 0 ? ` · ${years.length} ${t("groundingFiscalYearsSuffix")}${yearRange ? ` (${yearRange})` : ""}` : ""}
        </h3>
        {extract.meta.latestPeriodLabel && (
          <p className="mt-0.5 text-xs text-muted">
            {t("groundingCoverageLabel")}: {extract.meta.latestPeriodLabel}
          </p>
        )}
      </div>

      {/* Basis reconciliation — a property of the PASTE, so it's shown here, before any
          AI run is spent: the cheapest possible moment to catch a basis mismatch. */}
      <BasisReconciliationLine basis={basis} showPasteHint />

      {evEbitdaStats && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t("groundingEvEbitdaHistoryTitle")} (n={evEbitdaStats.n}){" "}
            {/* The raw table, NOT rescaled by kE — labeled so it's never read as the same
                series as the same-basis grid below, whose columns can differ from it. */}
            <span className="font-normal normal-case tracking-normal">({t("groundingHistoryProviderBasisTag")})</span>
          </p>
          <p className="mt-1 text-sm text-slate-300">
            min {evEbitdaStats.min.toFixed(1)}x · p25 {evEbitdaStats.p25.toFixed(1)}x · {t("groundingMedianLabel")}{" "}
            {evEbitdaStats.median.toFixed(1)}x · p75 {evEbitdaStats.p75.toFixed(1)}x · max {evEbitdaStats.max.toFixed(1)}x
          </p>
          {yearHalves && evEbitdaStats.earlyMean != null && evEbitdaStats.lateMean != null && (
            <p className="mt-0.5 text-xs text-muted">
              {yearHalves.earlyRange} {t("groundingMeanLabel")} {evEbitdaStats.earlyMean.toFixed(1)}x → {yearHalves.lateRange}{" "}
              {t("groundingMeanLabel")} {evEbitdaStats.lateMean.toFixed(1)}x{trend ? ` (${trend})` : ""}
            </p>
          )}
        </div>
      )}

      {otherStats.length > 0 && (
        <p className="text-xs text-muted">
          {otherStats
            .map((s) => `${MULTIPLE_LABEL[s.key]} n=${s.n} · ${t("groundingMedianLabel")} ${s.median.toFixed(1)}x`)
            .join(" · ")}
        </p>
      )}

      {peerLines.length > 0 && (
        <p className="text-sm text-slate-300">
          {t("groundingPeersCurrentLabel")}: {peerLines.join(" · ")}
        </p>
      )}

      {grid && <ValuationGridTable grid={grid} t={t} />}

      {marketImplied ? (
        <p className="text-sm text-slate-300">
          {t("groundingPriceImpliesLabel")} {marketImplied.impliedOnStatement.toFixed(2)}x
          {marketImplied.impliedOnProvider != null ? (
            <>
              {" "}
              ({t("groundingImpliedOnProviderLabel")} {marketImplied.impliedOnProvider.toFixed(2)}x) → {t("groundingPercentileLabel")}{" "}
              {marketImplied.percentile?.toFixed(0)}
            </>
          ) : (
            <span className="text-muted"> — {t("groundingBasisUnverifiableLabel").toLowerCase()}</span>
          )}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("groundingNoMarketImplied")}</p>
      )}

      {impliedExpectations && (
        <ImpliedExpectationsBlock
          expectations={impliedExpectations}
          latestFy={years.length > 0 ? Math.max(...years) : null}
          unitsLabel={
            extract.meta.units
              ? `${extract.meta.reportingCurrency ? `${extract.meta.reportingCurrency} ` : ""}${t(UNIT_KEY[extract.meta.units])}`
              : extract.meta.reportingCurrency
          }
          t={t}
          locale={locale}
        />
      )}

      {warnings.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-warning">{t("groundingWarningsTitle")}</p>
          <ul className="mt-1 space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-warning">
                ⚠ {t(warningLabelKey(w.code))}
                {w.fiscalYear != null && ` (FY${w.fiscalYear})`}
                {w.detail && ` — ${w.detail}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-3">
        <button
          onClick={onEdit}
          className="tap rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
        >
          {t("groundingEditBtn")}
        </button>
        <button
          onClick={onConfirm}
          className="tap rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
        >
          {t("groundingAnalyzeWithDataBtn")}
        </button>
        {confirmed && <span className="text-xs font-medium text-success">✓ {t("groundingReadyBadge")}</span>}
      </div>
    </div>
  );
}
