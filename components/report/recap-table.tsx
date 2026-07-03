import type { DeepValueResult } from "./types";

type Props = {
  result: DeepValueResult;
  currentPrice?: number | null;
  mosPercent?: number;
  title: string;
  currentPriceLabel: string;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
};

// Recap table — quick at-a-glance summary of all three scenarios vs. the live
// price. Shared between the live panel and the saved-analysis detail page
// (previously duplicated in both). Uses the `.rtable` responsive utility
// (defined in globals.css) to collapse into label/value cards below 640px.
export default function RecapTable({
  result,
  currentPrice,
  mosPercent = 0,
  title,
  currentPriceLabel,
  bearLabel,
  baseLabel,
  bullLabel,
}: Props) {
  // Upside vs. the live price, computed deterministically from the displayed value.
  // The AI's JSON `upside` field is unreliable (it sometimes returns the ratio unscaled,
  // e.g. 1.4 instead of 143), so we recompute. null when there's no price to compare to.
  const computeUpside = (value: number): number | null =>
    currentPrice != null && currentPrice > 0 ? ((value - currentPrice) / currentPrice) * 100 : null;

  // Intrinsic fair value = the buy target grossed back up by the MoS (stored values are buy targets).
  // null when MoS = 0 (then the displayed value already IS the fair value).
  const intrinsicOf = (buyTarget: number): number | null =>
    mosPercent > 0 ? buyTarget / (1 - mosPercent / 100) : null;

  const valueColumnLabel = `${result.currency} ${mosPercent > 0 ? `Buy Target (-${mosPercent}%)` : "Fair Value"}`;

  const rows: { label: string; value: number | null; intrinsic?: number | null; upside: number | null; highlight?: "base" }[] = [
    ...(currentPrice != null ? [{ label: currentPriceLabel, value: currentPrice, upside: null as null }] : []),
    { label: bearLabel, value: result.bear.fairValue, intrinsic: intrinsicOf(result.bear.fairValue), upside: computeUpside(result.bear.fairValue) },
    { label: baseLabel, value: result.base.fairValue, intrinsic: intrinsicOf(result.base.fairValue), upside: computeUpside(result.base.fairValue), highlight: "base" as const },
    { label: bullLabel, value: result.bull.fairValue, intrinsic: intrinsicOf(result.bull.fairValue), upside: computeUpside(result.bull.fairValue) },
  ];

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 print:border-slate-300 print:bg-transparent break-inside-avoid">
      <h3 className="mb-3 text-sm font-semibold text-slate-200 print:text-slate-900">{title}</h3>
      <table className="rtable w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-slate-700/60 print:border-slate-300">
            <th className="pb-2 pr-2 text-left font-medium text-slate-400 sm:pr-4 print:text-slate-600">Scenario</th>
            <th className="pb-2 text-right font-medium text-slate-400 print:text-slate-600">{valueColumnLabel}</th>
            <th className="pb-2 pl-2 text-right font-medium text-slate-400 sm:pl-4 print:text-slate-600">vs. Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isBase = row.highlight === "base";
            const isCurrentPrice = row.upside === null;
            return (
              <tr
                key={row.label}
                className={`border-b border-slate-700/30 last:border-0 print:border-slate-200 ${
                  isBase ? "ring-1 ring-inset ring-violet-500/30 rounded" : ""
                }`}
              >
                <td
                  className={`rcell-block py-2.5 pr-2 font-medium sm:pr-4 ${
                    isCurrentPrice
                      ? "text-slate-400 print:text-slate-600"
                      : isBase
                        ? "text-violet-300 print:text-violet-700"
                        : "text-slate-300 print:text-slate-800"
                  }`}
                >
                  {row.label}
                </td>
                <td className="py-2.5 text-right text-slate-200 print:text-slate-900" data-label={valueColumnLabel}>
                  {row.value != null ? row.value.toFixed(2) : "—"}
                  {row.intrinsic != null && (
                    <span className="block text-xs font-normal text-slate-500 print:text-slate-600">{`FV ${row.intrinsic.toFixed(2)}`}</span>
                  )}
                </td>
                <td className="py-2.5 pl-2 text-right sm:pl-4" data-label="vs. Price">
                  {row.upside != null ? (
                    <span
                      className={`font-semibold ${
                        row.upside >= 0 ? "text-emerald-400 print:text-emerald-700" : "text-red-400 print:text-red-700"
                      }`}
                    >
                      {row.upside >= 0 ? "+" : ""}
                      {row.upside.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-slate-500 print:text-slate-500">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
