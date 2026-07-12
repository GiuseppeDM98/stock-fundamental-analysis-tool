"use client";

// The deterministic post-check card — the piece that turns ANALYTICAL_RIGOR_BLOCK item 10
// ("never anchor the multiple to the current price") from a hope into an arithmetic check.
// Recomputes the model's own declared valuation bridge (checkValuationBridges) and shows:
// per-scenario ✓/✗ on the bridge arithmetic + the MoS gross-up, the model's own implied
// multiple vs. the price-implied one (a CONTROL, never an input), the "anchored to price"
// flag, and any reconciliation warnings on the extract. Rendered after status === "done" on
// the live Deep Value panel, and (once persisted, see commit 7) on the saved-analysis detail
// page. See docs/deep-value-grounding-spec.md §5.2 (the card's mockup) / §5.4 (the MoS trap).
import { useLanguage } from "@/context/language-context";
import { checkValuationBridges } from "@/lib/grounding/postcheck";
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

export function GroundingCard({ result, extract, mosPercent, currentPrice, currency }: Props) {
  const { t } = useLanguage();

  const postCheck = checkValuationBridges(result, mosPercent, currentPrice, currency, extract);
  // Null only when there's no historical basis at all to check the bridge against (spec
  // §5.4: `extract.financials` empty) — nothing meaningful to show in that case.
  if (!postCheck) return null;

  const warnings = checkReconciliation(extract);
  const base = postCheck.scenarios.find((s) => s.scenario === "base")!;

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) => (s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel"));

  const gapPct =
    base.impliedMultiple != null && postCheck.marketImplied
      ? (Math.abs(base.impliedMultiple - postCheck.marketImplied.impliedMultiple) / postCheck.marketImplied.impliedMultiple) * 100
      : null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid">
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

      {base.impliedMultiple != null && (
        <p className="text-sm text-slate-300">
          {t("groundingCardBaseMultipleLabel")}: {base.impliedMultiple.toFixed(2)}x
          {base.impliedPercentile != null && ` (${t("groundingPercentileLabel")} ${base.impliedPercentile.toFixed(0)})`}
          {postCheck.marketImplied && (
            <>
              {" · "}
              {t("groundingPriceImpliesLabel")} {postCheck.marketImplied.impliedMultiple.toFixed(2)}x
              {` (${t("groundingPercentileLabel")} ${postCheck.marketImplied.percentile.toFixed(0)})`}
              {gapPct != null && ` · ${t("groundingCardGapLabel")} ${gapPct.toFixed(1)}%`}
            </>
          )}
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
