import { ScenarioName, ScenarioResult } from "@/types/valuation";
import { formatCurrency } from "@/lib/format";

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
  const upside = result.upsideVsPricePercent;
  const upsideColor = upside >= 0 ? "text-success" : "text-danger";

  return (
    <div className={`card border ${scenarioPalette[scenario]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{scenario} scenario</p>
      <div className="mt-3 space-y-2 text-sm">
        <p>
          Current price: <strong>{formatCurrency(currentPrice, currency)}</strong>
        </p>
        <p>
          Fair value: <strong>{formatCurrency(result.fairValuePerShare, currency)}</strong>
        </p>
        <p>
          Fair value (MoS): <strong>{formatCurrency(result.fairValueAfterMos, currency)}</strong>
        </p>
        <p className={upsideColor}>
          Upside vs price: <strong>{upside.toFixed(2)}%</strong>
        </p>
      </div>
    </div>
  );
}
