"use client";

import type { Translations } from "@/lib/i18n/translations";
import { computeImpliedGrowthRate, type ReverseDcfInput } from "@/lib/valuation/dcf";
import { useLanguage } from "@/context/language-context";

export interface ReverseDcfCardProps extends ReverseDcfInput {
  historicalFcfCagr5yr: number | null;
  currency: string;
}

/**
 * Interprets the ratio of implied growth to historical FCF CAGR.
 *
 * ratio < 0.8  → market is pricing in less growth than history → conservative
 * ratio ≤ 1.5  → market is roughly in line with history → reasonable
 * ratio > 1.5  → market expects significantly more growth than history → optimistic
 */
function getInterpretation(
  ratio: number | null,
  t: (key: keyof Translations) => string
): { label: string; color: "emerald" | "amber" | "rose" } {
  if (ratio === null) return { label: t("reverseDcfNoHistorical"), color: "amber" };
  if (ratio < 0.8) return { label: t("reverseDcfConservative"), color: "emerald" };
  if (ratio <= 1.5) return { label: t("reverseDcfReasonable"), color: "amber" };
  return { label: t("reverseDcfOptimistic"), color: "rose" };
}

const badgeClasses: Record<"emerald" | "amber" | "rose", string> = {
  emerald: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  amber:   "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  rose:    "bg-red-500/15 text-rose-400 border border-red-500/30",
};

export function ReverseDcfCard(props: ReverseDcfCardProps) {
  const { t } = useLanguage();

  const impliedGrowth = computeImpliedGrowthRate(props);

  // Return nothing when the price is outside the solvable range — not an error state
  if (impliedGrowth === null) return null;

  const ratio =
    props.historicalFcfCagr5yr !== null && props.historicalFcfCagr5yr > 0
      ? impliedGrowth / props.historicalFcfCagr5yr
      : null;

  const { label, color } = getInterpretation(ratio, t);

  const formatPct = (v: number) =>
    `${(v * 100).toFixed(1)}%`;

  return (
    <div className="card">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
        {t("reverseDcfTitle")}
      </p>

      {/* Hero number */}
      <p className="text-sm text-muted">{t("reverseDcfExplainer")}</p>
      <p className="font-display my-2 text-4xl font-bold text-white">
        {formatPct(impliedGrowth)} / yr
      </p>
      <p className="text-sm text-muted">
        {t("reverseDcfPer10yr")}{" "}
        <span className="font-medium text-white">
          {props.currency} {props.currentPrice.toFixed(2)}
        </span>
      </p>

      {/* Divider */}
      <div className="my-4 border-t border-white/10" />

      {/* Stats row */}
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">{t("reverseDcfHistoricalCagr")}</dt>
          <dd className="font-medium text-white">
            {props.historicalFcfCagr5yr !== null
              ? formatPct(props.historicalFcfCagr5yr)
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t("reverseDcfWacc")}</dt>
          <dd className="font-medium text-white">{formatPct(props.wacc)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t("reverseDcfTerminalGrowth")}</dt>
          <dd className="font-medium text-white">{formatPct(props.terminalGrowthRate)}</dd>
        </div>
      </dl>

      {/* Interpretation badge */}
      <div className="mt-4">
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${badgeClasses[color]}`}>
          {label}
        </span>
      </div>
    </div>
  );
}
