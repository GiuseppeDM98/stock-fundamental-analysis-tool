"use client";

// The deterministic post-check card — the piece that turns ANALYTICAL_RIGOR_BLOCK item 10
// ("never anchor the multiple to the current price") and the v2 rigor gates from a hope
// into an arithmetic check. Recomputes the model's own declared valuation bridge
// (checkValuationBridges) and shows: a gate-by-gate dashboard (basis same-ness, horizon
// consistency, bear validity, market anchoring, trailing/forward normalization, net-debt
// trajectory, returns vs cost of capital, probabilities, cross-check), the
// probability-weighted expected value, the model's own implied multiple in BOTH
// statement and provider space (a CONTROL, never an input), and any reconciliation
// warnings on the extract. Rendered after status === "done" on the live Deep Value panel,
// and on the saved-analysis detail page. See docs/deep-value-grounding-spec.md §5.2 and
// docs/deep-value-rigor-v2-spec.md §4/§7.2.
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import { checkValuationBridges, type Gate, type GateCode } from "@/lib/grounding/postcheck";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { warningLabelKey } from "@/components/report/grounding-preview";
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
// in red rather than the standard amber "fail" treatment (spec §7.2).
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
  kill_price: "groundingGateKillPrice",
};

// "fail" first (most actionable), then "unavailable", then "pass" — so the reader sees
// what needs attention before what's already fine (spec §7.2: "I fail in cima").
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

export function GroundingCard({ result, extract, mosPercent, currentPrice, currency }: Props) {
  const { t } = useLanguage();

  const postCheck = checkValuationBridges(result, mosPercent, currentPrice, currency, extract);
  // Null only when there's no historical basis at all to check the bridge against (spec
  // §5.4: `extract.financials` empty) — nothing meaningful to show in that case.
  if (!postCheck) return null;

  const warnings = checkReconciliation(extract, postCheck.basis);
  const base = postCheck.scenarios.find((s) => s.scenario === "base")!;
  const sortedGates = [...postCheck.gates].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) => (s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel"));

  return (
    <div className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
      <h3 className="text-sm font-semibold text-slate-100">{t("groundingCardTitle")}</h3>

      <div className="space-y-1">
        {SCENARIOS.map((s) => {
          const check = postCheck.scenarios.find((sc) => sc.scenario === s)!;
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

      {base.impliedMultiple != null && (
        <p className="text-sm text-slate-300">
          {t("groundingCardBaseMultipleLabel")}: {base.impliedMultiple.toFixed(2)}x
          {base.impliedMultipleProvider != null && ` (${t("groundingImpliedOnProviderLabel")} ${base.impliedMultipleProvider.toFixed(2)}x)`}
          {base.impliedPercentile != null && ` (${t("groundingPercentileLabel")} ${base.impliedPercentile.toFixed(0)})`}
          {postCheck.marketImplied && (
            <>
              {" · "}
              {t("groundingPriceImpliesLabel")} {postCheck.marketImplied.impliedOnStatement.toFixed(2)}x
              {postCheck.marketImplied.impliedOnProvider != null &&
                ` (${t("groundingImpliedOnProviderLabel")} ${postCheck.marketImplied.impliedOnProvider.toFixed(2)}x)`}
            </>
          )}
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
