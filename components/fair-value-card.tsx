"use client";

import { ScenarioName, ScenarioResult } from "@/types/valuation";
import { formatCurrency } from "@/lib/format";
import { useLanguage } from "@/context/language-context";

type FairValueCardProps = {
  currency: string;
  currentPrice: number;
  scenario: ScenarioName;
  result: ScenarioResult;
};

const scenarioPalette: Record<ScenarioName, string> = {
  bull: "border-emerald-500/40",
  base: "border-sky-500/40",
  bear: "border-rose-500/40"
};

export function FairValueCard({ currency, currentPrice, scenario, result }: FairValueCardProps) {
  const { t } = useLanguage();
  const upside = result.upsideVsPricePercent;
  const upsideColor = upside >= 0 ? "text-success" : "text-danger";

  const scenarioLabel: Record<ScenarioName, string> = {
    bull: t("scenarioBull"),
    base: t("scenarioBase"),
    bear: t("scenarioBear"),
  };

  return (
    <div className={`card border ${scenarioPalette[scenario]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{scenarioLabel[scenario]}</p>
      <div className="mt-3 space-y-2 text-sm">
        <p>
          {t("currentPriceLabel")} <strong>{formatCurrency(currentPrice, currency)}</strong>
        </p>
        <p>
          {t("fairValueLabel")} <strong>{formatCurrency(result.fairValuePerShare, currency)}</strong>
        </p>
        <p>
          {t("fairValueMosLabel")} <strong>{formatCurrency(result.fairValueAfterMos, currency)}</strong>
        </p>
        <p className={upsideColor}>
          {t("upsideLabel")} <strong>{upside.toFixed(2)}%</strong>
        </p>
      </div>
    </div>
  );
}
