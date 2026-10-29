"use client";

// The deterministic post-check card — the piece that turns ANALYTICAL_RIGOR_BLOCK item 10
// ("never anchor the multiple to the current price") and the rigor gates from a hope
// into an arithmetic check. Recomputes the model's own declared valuation bridge
// (checkValuationBridges) and shows: the basis reconciliation (kE, confidence, kB), a
// gate-by-gate dashboard (basis same-ness, horizon consistency, bear validity, market
// anchoring, trailing/forward normalization, net-debt trajectory, returns vs cost of
// capital, probabilities, cross-check), the market-implied multiple with its percentile and
// its explicit gap to the base multiple (a CONTROL, never an input), the model's own implied
// multiple in BOTH statement and provider space, the probability-weighted expected value,
// and any reconciliation warnings on the extract (including why a price-implied read is
// missing). Rendered after status === "done" on the live Deep Value panel,
// and on the saved-analysis detail page.
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import { checkValuationBridges, type Gate, type GateCode, type PostCheck } from "@/lib/grounding/postcheck";
import { checkReconciliation, type ReconciliationWarning } from "@/lib/grounding/reconcile";
import { computeBaseVsMarketGap } from "@/lib/grounding-display";
import { buildMarketImpliedWarnings } from "@/lib/grounding-warnings";
import { warningLabelKey } from "@/components/report/grounding-preview";
import { BasisReconciliationLine } from "@/components/report/basis-reconciliation-line";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";

type Props = {
  result: DeepValueResult;
  extract: GroundedFinancials;
  mosPercent: number;
  currentPrice: number;
  currency: string;
};

const SCENARIOS = ["bear", "base", "bull"] as const;

// A fail on any of these three would, on its own, have invalidated the Iren report — shown
// in red rather than the standard amber "fail" treatment.
const SEVERE_FAIL_GATES: GateCode[] = ["basis_same", "bear_breaks_price", "roic_vs_wacc"];

const GATE_LABEL_KEY: Record<GateCode, keyof Translations> = {
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

type CardData = { postCheck: PostCheck; warnings: ReconciliationWarning[] };

/**
 * Runs the post-check and gathers every warning the card shows. The model's JSON block is
 * unvalidated LLM output (a saved report can carry any shape that once parsed), so a throw
 * anywhere in here must degrade to a "checks unavailable" line rather than take down the
 * report page around the card. Returns null when there's nothing to check against
 * (no pasted financials), "failed" when the checks threw.
 */
function computeCardData(
  result: DeepValueResult,
  extract: GroundedFinancials,
  mosPercent: number,
  currentPrice: number,
  currency: string
): CardData | null | "failed" {
  try {
    const postCheck = checkValuationBridges(result, mosPercent, currentPrice, currency, extract);
    if (!postCheck) return null;
    // The market-implied warnings explain a missing price-implied read (currency mismatch,
    // missing bridge inputs, no history) — the same explanation the pre-run preview gave.
    const warnings = [
      ...checkReconciliation(extract, postCheck.basis),
      ...buildMarketImpliedWarnings(extract, currency, postCheck.marketImplied),
    ];
    return { postCheck, warnings };
  } catch (err) {
    console.warn("GroundingCard: deterministic post-check failed on this valuation block", err);
    return "failed";
  }
}

export function GroundingCard({ result, extract, mosPercent, currentPrice, currency }: Props) {
  const { t } = useLanguage();

  const data = computeCardData(result, extract, mosPercent, currentPrice, currency);
  // Null only when there's no historical basis at all to check the bridge against
  // (`extract.financials` empty) — nothing meaningful to show in that case.
  if (data === null) return null;

  if (data === "failed") {
    return (
      <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
        <h3 className="text-sm font-semibold text-slate-100">{t("groundingCardTitle")}</h3>
        <p className="text-sm text-muted">{t("groundingCardGatesUnavailable")}</p>
      </div>
    );
  }

  const { postCheck, warnings } = data;
  const base = postCheck.scenarios.find((s) => s.scenario === "base");
  const marketGap = computeBaseVsMarketGap(base, postCheck.marketImplied);
  const sortedGates = [...postCheck.gates].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) => (s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel"));

  return (
    <div className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
      <h3 className="text-sm font-semibold text-slate-100">{t("groundingCardTitle")}</h3>

      <BasisReconciliationLine basis={postCheck.basis} />

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
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("groundingGateDashboardTitle")}</p>
        <div className="mt-1 space-y-1">
          {sortedGates.map((gate) => (
            <GateRow key={gate.code} gate={gate} t={t} />
          ))}
        </div>
      </div>

      {/* The market-implied multiple is a CONTROL, never an input: its percentile and its
          explicit gap to the base multiple are what make a price-anchored fair value visible. */}
      {postCheck.marketImplied ? (
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

      {base?.impliedMultiple != null && (
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

      {postCheck.crossCheckBridge && (
        <p className="text-sm text-slate-300">
          <span className="font-medium text-slate-100">{t("groundingCrossCheckBridgeLabel")}</span>:{" "}
          {postCheck.crossCheckBridge.arithmeticOk != null && (
            <span className={postCheck.crossCheckBridge.arithmeticOk ? "text-success" : "text-danger"}>
              {postCheck.crossCheckBridge.arithmeticOk ? "✓" : "✗"} {t("groundingCardArithmeticLabel")}
            </span>
          )}
          {postCheck.crossCheckBridge.impliedMultiple != null && (
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
