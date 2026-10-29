import type { DeepValueResult } from "./types";

export function UpsideBadge({ upside }: { upside: number }) {
  const isPositive = upside >= 0;
  return (
    <span
      className={`text-xs font-semibold ${
        isPositive ? "text-emerald-400 print:text-emerald-700" : "text-red-400 print:text-red-700"
      }`}
    >
      {isPositive ? "+" : ""}
      {upside.toFixed(1)}%
    </span>
  );
}

type Props = {
  result: DeepValueResult;
  currentPrice?: number | null;
  mosPercent?: number;
  scenarioLabels: { bull: string; base: string; bear: string };
  fvShort: string;
};

// 3-up Bull/Base/Bear fair-value cards — shared between the live panel and the
// saved-analysis detail page (previously duplicated in both, ~90% identical).
export default function FairValueCards({ result, currentPrice, mosPercent = 0, scenarioLabels, fvShort }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {(["bull", "base", "bear"] as const).map((scenario) => {
        const s = result[scenario];
        const upside =
          currentPrice != null && currentPrice > 0 ? ((s.fairValue - currentPrice) / currentPrice) * 100 : null;
        return (
          <div
            key={scenario}
            className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-2 text-center sm:p-3 print:border-slate-300 print:bg-transparent"
          >
            <p className="text-xs text-slate-400 print:text-slate-600">{scenarioLabels[scenario]}</p>
            <p className="mt-1 text-sm font-bold text-slate-100 sm:text-base print:text-slate-900">
              {result.currency} {s.fairValue.toFixed(2)}
            </p>
            {mosPercent > 0 && (
              <p className="text-[11px] text-slate-500 print:text-slate-600">
                {`${fvShort} ${result.currency} ${(s.fairValue / (1 - mosPercent / 100)).toFixed(2)}`}
              </p>
            )}
            {upside != null && <UpsideBadge upside={upside} />}
          </div>
        );
      })}
    </div>
  );
}
