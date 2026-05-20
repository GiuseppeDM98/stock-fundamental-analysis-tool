"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import { quartiles, percentileRank } from "@/lib/valuation/statistics";
import type { HistoricalMultiplesDataPoint } from "@/lib/valuation/historical-multiples";

export interface MultiplesHistoryChartProps {
  ticker: string;
  /** Current trailing P/E (from existing fundamentals) — used as reference line */
  currentPe: number | null;
  /** Current P/FCF (marketCap / latestFCF) — used as reference line */
  currentPFcf: number | null;
  /** Current EV/EBIT (approx: marketCap / latestEBIT) — used as reference line */
  currentEvEbit: number | null;
}

type ActiveMetric = "pe" | "pFcf" | "evEbit";

/**
 * Determine the percentile color band for the summary table cell.
 *
 * < 30th percentile → emerald (historically cheap)
 * 30–70th          → amber (mid-range)
 * > 70th           → rose (historically expensive)
 */
function percentileColorClass(rank: number): string {
  if (rank < 30) return "text-emerald-400";
  if (rank <= 70) return "text-amber-400";
  return "text-rose-400";
}

/**
 * Percentile badge label for the given rank and `t` function.
 */
function percentileLabel(rank: number, t: (key: keyof Translations) => string): string {
  if (rank < 30) return t("multiplesPercentileCheap");
  if (rank <= 70) return t("multiplesPercentileMid");
  return t("multiplesPercentileExpensive");
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number | null; payload: HistoricalMultiplesDataPoint }>;
  label?: number;
  activeMetric: ActiveMetric;
  metricLabel: string;
  currentValue: number | null;
  todayLabel: string;
  priceLabel: string;
}

function CustomTooltip({ active, payload, label, activeMetric, metricLabel, currentValue, todayLabel, priceLabel }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const raw = payload[0]?.payload;
  const value = raw?.[activeMetric];

  return (
    <div className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-white">{label}</p>
      <p className="text-muted">
        {metricLabel}:{" "}
        <span className="font-medium text-sky-300">
          {value != null ? `${value.toFixed(1)}×` : "N/A"}
        </span>
      </p>
      <p className="text-muted">
        {priceLabel}:{" "}
        <span className="font-medium text-white">{raw?.price?.toFixed(2) ?? "—"}</span>
      </p>
      {currentValue != null && (
        <p className="mt-1 border-t border-white/10 pt-1 text-muted">
          {todayLabel}:{" "}
          <span className="font-medium text-sky-400">{currentValue.toFixed(1)}×</span>
        </p>
      )}
    </div>
  );
}

/**
 * Historical multiples chart showing P/E, P/FCF, and EV/EBIT over 10 years.
 *
 * Displays a quartile band (25th–75th percentile), a median reference line,
 * and a current-multiple reference line so users can immediately see whether
 * the stock is cheap or expensive relative to its own history.
 */
export function MultiplesHistoryChart({
  ticker,
  currentPe,
  currentPFcf,
  currentEvEbit,
}: MultiplesHistoryChartProps) {
  const { t } = useLanguage();

  const [data, setData] = useState<HistoricalMultiplesDataPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeMetric, setActiveMetric] = useState<ActiveMetric>("pe");

  useEffect(() => {
    if (!ticker) return;

    setLoading(true);
    setError(false);
    setData(null);

    fetch(`/api/historical-multiples/${ticker}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((d: { dataPoints: HistoricalMultiplesDataPoint[] }) => setData(d.dataPoints))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [ticker]);

  // Labels defined inside the component so they update on language change
  const metricLabels: Record<ActiveMetric, string> = {
    pe: t("multiplesMetricPE"),
    pFcf: t("multiplesMetricPFCF"),
    evEbit: t("multiplesMetricEVEBIT"),
  };

  const currentValues: Record<ActiveMetric, number | null> = {
    pe: currentPe,
    pFcf: currentPFcf,
    evEbit: currentEvEbit,
  };

  if (loading) {
    return (
      <div className="card">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t("multiplesChartTitle")}
        </p>
        {/* Skeleton matching chart + summary table height */}
        <div className="animate-pulse space-y-3">
          <div className="h-[240px] rounded bg-white/5" />
          <div className="h-8 w-full rounded bg-white/5" />
        </div>
      </div>
    );
  }

  if (error || (data !== null && data.length === 0)) {
    return (
      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t("multiplesChartTitle")}
        </p>
        <p className="text-sm text-muted">{t("multiplesNoData")}</p>
      </div>
    );
  }

  // Wait until data is loaded before rendering the chart
  if (data === null) return null;

  // Extract valid (non-null) values for the active metric
  const validValues = data
    .map((d) => d[activeMetric])
    .filter((v): v is number => v != null);

  const { p25, median, p75 } = quartiles(validValues);
  const minVal = validValues.length > 0 ? Math.min(...validValues) : null;
  const maxVal = validValues.length > 0 ? Math.max(...validValues) : null;
  const currentValue = currentValues[activeMetric];

  const rank =
    currentValue != null && validValues.length > 0
      ? percentileRank(validValues, currentValue)
      : null;

  // Compute Y-axis domain to accommodate both historical data and current value line
  const allValues = currentValue != null ? [...validValues, currentValue] : validValues;
  const domainMin = allValues.length > 0 ? Math.max(0, Math.min(...allValues) * 0.9) : 0;
  const domainMax = allValues.length > 0 ? Math.max(...allValues) * 1.1 : 10;

  const formatMultiple = (v: number) => `${v.toFixed(1)}×`;

  return (
    <div className="card">
      {/* Header + metric toggle */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t("multiplesChartTitle")}
        </p>
        <div className="flex gap-1">
          {(["pe", "pFcf", "evEbit"] as ActiveMetric[]).map((metric) => (
            <button
              key={metric}
              onClick={() => setActiveMetric(metric)}
              className={
                activeMetric === metric
                  ? "rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-300"
                  : "rounded-full border border-white/10 px-3 py-1 text-xs text-muted hover:border-white/20 hover:text-white"
              }
            >
              {metricLabels[metric]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="year"
              stroke="#7b8ba9"
              tick={{ fill: "#7b8ba9", fontSize: 11 }}
            />
            <YAxis
              stroke="#7b8ba9"
              tick={{ fill: "#7b8ba9", fontSize: 11 }}
              tickFormatter={formatMultiple}
              domain={[domainMin, domainMax]}
              width={44}
            />
            <Tooltip
              content={
                <CustomTooltip
                  activeMetric={activeMetric}
                  metricLabel={metricLabels[activeMetric]}
                  currentValue={currentValue}
                  todayLabel={t("multiplesToday")}
                  priceLabel={t("multiplesPrice")}
                />
              }
            />

            {/* Quartile band: 25th–75th percentile — cheap/expensive zone */}
            {validValues.length >= 4 && (
              <ReferenceArea
                y1={p25}
                y2={p75}
                fill="#38bdf8"
                fillOpacity={0.06}
                strokeOpacity={0}
              />
            )}

            {/* Median reference line */}
            {validValues.length >= 2 && (
              <ReferenceLine
                y={median}
                stroke="#38bdf8"
                strokeDasharray="4 2"
                strokeOpacity={0.35}
              />
            )}

            {/* Current multiple — where the stock trades today vs history */}
            {currentValue != null && (
              <ReferenceLine
                y={currentValue}
                stroke="#38bdf8"
                strokeWidth={1.5}
                strokeOpacity={0.85}
              />
            )}

            <Line
              type="monotone"
              dataKey={activeMetric}
              stroke="#38bdf8"
              strokeWidth={2}
              dot={{ r: 3, fill: "#38bdf8", strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Summary row */}
      {validValues.length > 0 && (
        <div className="mt-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-1.5 pr-4 font-medium">{metricLabels[activeMetric]}</th>
                <th className="pb-1.5 pr-4 font-medium">{t("multiplesCurrent")}</th>
                <th className="pb-1.5 pr-4 font-medium">{t("multiplesMedian")}</th>
                <th className="pb-1.5 pr-4 font-medium">{t("multiplesMin")}</th>
                <th className="pb-1.5 pr-4 font-medium">{t("multiplesMax")}</th>
                {rank !== null && (
                  <th className="pb-1.5 font-medium">{t("multiplesPercentile")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="text-white">
                <td className="pr-4 font-semibold">{metricLabels[activeMetric]}</td>
                <td className="pr-4">
                  {currentValue != null ? formatMultiple(currentValue) : "—"}
                </td>
                <td className="pr-4">{formatMultiple(median)}</td>
                <td className="pr-4">{minVal != null ? formatMultiple(minVal) : "—"}</td>
                <td className="pr-4">{maxVal != null ? formatMultiple(maxVal) : "—"}</td>
                {rank !== null && (
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${percentileColorClass(rank)} bg-white/5`}
                      title={`${rank.toFixed(0)}th percentile`}
                    >
                      {percentileLabel(rank, t)} · {rank.toFixed(0)}°
                    </span>
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
