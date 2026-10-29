"use client";

// The deterministic checks card — the piece that turns ANALYTICAL_RIGOR_BLOCK item 10
// ("never anchor the multiple to the current price") and the rigor gates from a hope
// into an arithmetic check, on EVERY analysis with a complete valuation block and a price,
// with or without pasted data. Recomputes the model's own declared valuation bridge
// (checkValuationBridges) and shows: the basis reconciliation (kE, confidence, kB), a
// gate-by-gate dashboard (every gate of postcheck.ts plus sections_present, read from the
// Markdown), the market-implied multiple with its percentile and its explicit gap to the
// base multiple (a CONTROL, never an input), the model's own implied multiple in BOTH
// statement and provider space, the probability-weighted expected value, and any
// reconciliation warnings on the extract (including why a price-implied read is missing).
// Without a dataset the basis line, the market-implied section, the warnings and the
// implied multiples are not drawn, and one line says so. The subtitle names the price every gate was checked against
// (live, or the price saved with the analysis). Rendered after status === "done" on the
// live Deep Value panel, and on the saved-analysis detail page (AnalysisDetailBody).
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import {
  checkReportStructure,
  checkValuationBridges,
  datasetOrNull,
  type Gate,
  type GateCode,
  type PostCheck,
} from "@/lib/grounding/postcheck";
import { checkReconciliation, type ReconciliationWarning } from "@/lib/grounding/reconcile";
import { computeBaseVsMarketGap } from "@/lib/grounding-display";
import { buildMarketImpliedWarnings } from "@/lib/grounding-warnings";
import { warningLabelKey } from "@/components/report/grounding-preview";
import { BasisReconciliationLine } from "@/components/report/basis-reconciliation-line";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";

type Props = {
  result: DeepValueResult;
  // null (or no financial rows) = no dataset: the dataset gates read "no dataset".
  extract: GroundedFinancials | null;
  mosPercent: number;
  // Always a finite price — the caller draws its own "no price" line instead of the card.
  currentPrice: number;
  currency: string;
  // Which price the gates were checked against, named in the subtitle.
  priceSource: "live" | "analysis";
  // The report Markdown, JSON stripped — when given, sections_present joins the gates.
  reportMd?: string;
};

const SCENARIOS = ["bear", "base", "bull"] as const;

// A fail on any of the first three would, on its own, have invalidated the Iren report; a
// scenario order or a sensitivity centre that fails means the numbers contradict
// themselves. All shown in red rather than the standard amber "fail" treatment.
const SEVERE_FAIL_GATES: GateCode[] = ["basis_same", "bear_breaks_price", "roic_vs_wacc", "scenario_order", "sensitivity_center"];

// The reader-facing name of each gate; the codes are for the prompts and the tests.
export const GATE_LABEL_KEY: Record<GateCode, keyof Translations> = {
  basis_same: "groundingGateBasisSame",
  horizon_consistent: "groundingGateHorizonConsistent",
  bear_breaks_price: "groundingGateBearBreaksPrice",
  multiple_vs_market: "groundingGateMultipleVsMarket",
  trailing_forward: "groundingGateTrailingForward",
  netdebt_trajectory: "groundingGateNetdebtTrajectory",
  roic_vs_wacc: "groundingGateRoicVsWacc",
  probabilities: "groundingGateProbabilities",
  cross_check: "groundingGateCrossCheck",
  cross_check_basis: "groundingGateCrossCheckBasis",
  kill_price: "groundingGateKillPrice",
  scenario_order: "groundingGateScenarioOrder",
  method_distinct: "groundingGateMethodDistinct",
  sensitivity_center: "groundingGateSensitivityCenter",
  dividend_coverage: "groundingGateDividendCoverage",
  units_match: "groundingGateUnitsMatch",
  sections_present: "groundingGateSectionsPresent",
};

// "fail" first (most actionable), then "unavailable", then "pass" — so the reader sees
// what needs attention before what's already fine.
const STATUS_ORDER: Record<Gate["status"], number> = { fail: 0, unavailable: 1, pass: 2 };

function GateRow({ gate, t }: { gate: Gate; t: (key: keyof Translations) => string }) {
  const severe = gate.status === "fail" && SEVERE_FAIL_GATES.includes(gate.code);
  const icon = gate.status === "pass" ? "✓" : gate.status === "fail" ? "✗" : "—";
  const colorClass = gate.status === "pass" ? "text-success" : gate.status === "unavailable" ? "text-muted" : severe ? "text-danger" : "text-warning";
  return (
    <p className={`text-sm ${gate.status === "unavailable" ? "text-muted" : "text-slate-300"}`}>
      <span className={`font-medium ${colorClass}`}>
        {icon} {t(GATE_LABEL_KEY[gate.code])}
      </span>
      {gate.detail && <span className="text-xs text-muted"> — {gate.detail}</span>}
    </p>
  );
}

type CardData = { postCheck: PostCheck; gates: Gate[]; warnings: ReconciliationWarning[]; hasDataset: boolean };

/**
 * Runs the post-check and gathers every gate and warning the card shows. The model's JSON
 * block is unvalidated LLM output (a saved report can carry any shape that once parsed),
 * so a throw anywhere in here must degrade to a "checks unavailable" line rather than take
 * down the report page around the card. Returns null only when the result isn't an object,
 * "failed" when the checks threw.
 */
function computeCardData(
  result: DeepValueResult,
  extract: GroundedFinancials | null,
  mosPercent: number,
  currentPrice: number,
  currency: string,
  reportMd: string | undefined
): CardData | null | "failed" {
  try {
    const dataset = datasetOrNull(extract);
    const postCheck = checkValuationBridges(result, mosPercent, currentPrice, currency, dataset);
    if (!postCheck) return null;
    const gates = reportMd != null ? [...postCheck.gates, checkReportStructure(reportMd)] : postCheck.gates;
    // The market-implied warnings explain a missing price-implied read (currency mismatch,
    // missing bridge inputs, no history) — the same explanation the pre-run preview gave.
    // Without a dataset there is no extract to warn about.
    const warnings = dataset
      ? [...checkReconciliation(dataset, postCheck.basis), ...buildMarketImpliedWarnings(dataset, currency, postCheck.marketImplied)]
      : [];
    return { postCheck, gates, warnings, hasDataset: dataset != null };
  } catch (err) {
    console.warn("ValuationChecksCard: deterministic post-check failed on this valuation block", err);
    return "failed";
  }
}

export function ValuationChecksCard({ result, extract, mosPercent, currentPrice, currency, priceSource, reportMd }: Props) {
  const { t } = useLanguage();

  const data = computeCardData(result, extract, mosPercent, currentPrice, currency, reportMd);
  if (data === null) return null;

  if (data === "failed") {
    return (
      <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
        <h3 className="text-sm font-semibold text-slate-100">{t("valuationChecksTitle")}</h3>
        <p className="text-sm text-muted">{t("groundingCardGatesUnavailable")}</p>
      </div>
    );
  }

  const { postCheck, gates, warnings, hasDataset } = data;
  const base = postCheck.scenarios.find((s) => s.scenario === "base");
  const marketGap = computeBaseVsMarketGap(base, postCheck.marketImplied);
  const sortedGates = [...gates].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) => (s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel"));

  return (
    <div className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{t("valuationChecksTitle")}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {priceSource === "live" ? t("valuationChecksPriceLive") : t("valuationChecksPriceAtAnalysis")} · {currentPrice.toFixed(2)} {currency}
        </p>
      </div>

      {hasDataset ? <BasisReconciliationLine basis={postCheck.basis} /> : <p className="text-sm text-muted">{t("valuationChecksNoDataset")}</p>}

      <div className="space-y-1">
        {SCENARIOS.map((s) => {
          const check = postCheck.scenarios.find((sc) => sc.scenario === s);
          if (!check) return null;
          const noBridge = check.arithmeticOk == null && check.mosOk == null;
          return (
            <p key={s} className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">{scenarioLabel(s)}</span>{" "}
              {noBridge ? (
                <span className="text-muted">{t("groundingCardNoBridge")}</span>
              ) : (
                <>
                  {check.arithmeticOk != null && (
                    <span className={check.arithmeticOk ? "text-success" : "text-danger"}>
                      {check.arithmeticOk ? "✓" : "✗"} {t("groundingCardArithmeticLabel")}
                    </span>
                  )}
                  {check.arithmeticOk != null && " · "}
                  <span className={check.mosOk ? "text-success" : "text-danger"}>
                    {check.mosOk ? "✓" : "✗"} {t("groundingCardMosLabel")}
                  </span>
                </>
              )}
            </p>
          );
        })}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("valuationChecksGatesSubtitle")}</p>
        <div className="mt-1 space-y-1">
          {sortedGates.map((gate) => (
            <GateRow key={gate.code} gate={gate} t={t} />
          ))}
        </div>
      </div>

      {/* The market-implied multiple is a CONTROL, never an input: its percentile and its
          explicit gap to the base multiple are what make a price-anchored fair value visible.
          It needs the dataset's EBITDA, so without one the section is not drawn at all. */}
      {!hasDataset ? null : postCheck.marketImplied ? (
        <div className="space-y-0.5">
          <p className="text-sm text-slate-300">
            {t("groundingPriceImpliesLabel")} {postCheck.marketImplied.impliedOnStatement.toFixed(2)}x
            {postCheck.marketImplied.impliedOnProvider != null &&
              ` (${t("groundingImpliedOnProviderLabel")} ${postCheck.marketImplied.impliedOnProvider.toFixed(2)}x)`}
            {postCheck.marketImplied.percentile != null &&
              ` → ${t("groundingPercentileLabel")} ${postCheck.marketImplied.percentile.toFixed(0)}`}
          </p>
          {marketGap && (
            <p className="text-sm text-slate-300">
              {t("groundingGateMultipleVsMarket")}: {marketGap.baseMultiple.toFixed(2)}x vs {marketGap.marketMultiple.toFixed(2)}x{" "}
              <span className="text-xs text-muted">({t("groundingImpliedOnProviderLabel")})</span> · {t("groundingCardGapLabel")}{" "}
              <span className={postCheck.priceAnchoringFlag ? "font-medium text-warning" : "font-medium text-slate-100"}>
                {marketGap.gapPct >= 0 ? "+" : ""}
                {(marketGap.gapPct * 100).toFixed(1)}%
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("groundingNoMarketImplied")}</p>
      )}

      {/* The implied multiples need the dataset too: with no history there is nothing to
          rank them against, and a driver that is not a total (a DPS per share on a DDM
          cross-check) turns (equity + net debt) / driver into a meaningless number. Without
          one, the cross-check row stays only for its arithmetic check. */}
      {hasDataset && base?.impliedMultiple != null && (
        <p className="text-sm text-slate-300">
          {t("groundingCardBaseMultipleLabel")}: {base.impliedMultiple.toFixed(2)}x
          {base.impliedMultipleProvider != null && ` (${t("groundingImpliedOnProviderLabel")} ${base.impliedMultipleProvider.toFixed(2)}x)`}
          {base.impliedPercentile != null && ` (${t("groundingPercentileLabel")} ${base.impliedPercentile.toFixed(0)})`}
          {base.impliedMultipleLtm != null && (
            <>
              {" · "}
              {t("groundingLtmEquivLabel")} {base.impliedMultipleLtm.toFixed(2)}x
              {base.impliedPercentileLtm != null && ` (${t("groundingPercentileLabel")} ${base.impliedPercentileLtm.toFixed(0)})`}
              {base.growthWedgePct != null && (
                <>
                  {" · "}
                  {t("groundingWedgeLabel")} {base.growthWedgePct >= 0 ? "+" : ""}
                  {(base.growthWedgePct * 100).toFixed(0)}%{" "}
                  <span className="text-muted">({t("groundingWedgeCaveat")})</span>
                </>
              )}
            </>
          )}
        </p>
      )}

      {postCheck.crossCheckBridge && (hasDataset || postCheck.crossCheckBridge.arithmeticOk != null) && (
        <p className="text-sm text-slate-300">
          <span className="font-medium text-slate-100">{t("groundingCrossCheckBridgeLabel")}</span>:{" "}
          {postCheck.crossCheckBridge.arithmeticOk != null && (
            <span className={postCheck.crossCheckBridge.arithmeticOk ? "text-success" : "text-danger"}>
              {postCheck.crossCheckBridge.arithmeticOk ? "✓" : "✗"} {t("groundingCardArithmeticLabel")}
            </span>
          )}
          {hasDataset && postCheck.crossCheckBridge.impliedMultiple != null && (
            <>
              {postCheck.crossCheckBridge.arithmeticOk != null && " · "}
              {postCheck.crossCheckBridge.impliedMultiple.toFixed(2)}x
              {postCheck.crossCheckBridge.impliedMultipleProvider != null &&
                ` (${t("groundingImpliedOnProviderLabel")} ${postCheck.crossCheckBridge.impliedMultipleProvider.toFixed(2)}x)`}
              {postCheck.crossCheckBridge.impliedPercentile != null && ` (${t("groundingPercentileLabel")} ${postCheck.crossCheckBridge.impliedPercentile.toFixed(0)})`}
            </>
          )}
        </p>
      )}

      {postCheck.expectedValue && (
        <p className="text-sm text-slate-300">
          <span className="font-medium text-slate-100">{t("groundingExpectedValueTitle")}</span>:{" "}
          {t("groundingExpectedValueIntrinsicLabel")} {postCheck.expectedValue.intrinsic.toFixed(2)} · {t("groundingExpectedValueBuyTargetLabel")}{" "}
          {postCheck.expectedValue.buyTarget.toFixed(2)} · {t("groundingExpectedValueUpsideLabel")}{" "}
          <span className={postCheck.expectedValue.upsidePct >= 0 ? "text-success" : "text-danger"}>
            {(postCheck.expectedValue.upsidePct * 100).toFixed(1)}%
          </span>
        </p>
      )}

      {postCheck.priceAnchoringFlag && <p className="text-sm font-medium text-warning">⚠ {t("groundingCardAnchoringFlag")}</p>}

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
    </div>
  );
}
