"use client";

// Dividend per share: the reported years as bars, the model's three-year path as three
// dashed lines (bull, base, bear) on the path's years only — never joined to the last bar,
// and a year the data lacks is never drawn. A year both reported and on the path shows both.
//
// Accessibility: role="img" sits on the chart ALONE, and the data table is its sibling, not
// its child — ARIA makes every child of role="img" presentational, so a table inside it
// would be hidden from screen readers. Each scenario has its own dash pattern besides its
// colour (bull and bear are hard to tell apart for a deuteranope, measured 2026-11-23), and
// the legend names them. Animations are off: they carry no information.
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLanguage } from "@/context/language-context";
import { SourceChip } from "@/components/report/source-chip";
import { SourceLegend } from "@/components/report/source-legend";
import type { DividendPathYear } from "@/components/report/types";
import type { DividendStats } from "@/lib/dividends/projection";
import type { DataSource } from "@/types/dataset";
import type { GroundedFinancials } from "@/types/grounding";

type Scenario = "bull" | "base" | "bear";

export type DividendChartPoint = {
  fiscalYear: number;
  dps?: number;
  bull?: number;
  base?: number;
  bear?: number;
  // The income statement's source for a reported year (DPS lives on it), read by the tooltip.
  source: DataSource | null;
};

// Bull, base and bear in the order a reader scans them, each with its token and its dash.
const SCENARIOS: { key: Scenario; color: string; dash: string }[] = [
  { key: "bull", color: "var(--chart-2)", dash: "2 4" },
  { key: "base", color: "var(--chart-3)", dash: "8 4" },
  { key: "bear", color: "var(--chart-4)", dash: "14 4 2 4" },
];

/** One point per fiscal year in the sorted union of the reported years and the path's. */
export function buildDividendChartData(
  stats: DividendStats | null,
  path: DividendPathYear[] | null,
  extract: GroundedFinancials | null
): DividendChartPoint[] {
  const years = new Set<number>([...(stats?.years ?? []).map((y) => y.fiscalYear), ...(path ?? []).map((p) => p.year)]);
  return [...years]
    .sort((a, b) => a - b)
    .map((fiscalYear) => {
      const reported = stats?.years.find((y) => y.fiscalYear === fiscalYear);
      const projected = path?.find((p) => p.year === fiscalYear);
      return {
        fiscalYear,
        dps: reported?.dps,
        bull: projected?.bull,
        base: projected?.base,
        bear: projected?.bear,
        source: extract?.financials.find((f) => f.fiscalYear === fiscalYear)?.sources?.income ?? null,
      };
    });
}

type Props = {
  stats: DividendStats | null;
  path: DividendPathYear[] | null;
  extract: GroundedFinancials | null;
  currency: string;
};

export function DividendChart({ stats, path, extract, currency }: Props) {
  const { t, locale } = useLanguage();
  const data = buildDividendChartData(stats, path, extract);
  if (data.length === 0) return null;

  const format = (v: number | undefined) =>
    v == null ? "—" : v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const scenarioLabel = (s: Scenario) => (s === "bull" ? t("bullLabel") : s === "base" ? t("baseLabel") : t("bearLabel"));
  const hasPath = data.some((p) => p.base != null);
  const hasHistory = data.some((p) => p.dps != null);

  return (
    <figure className="space-y-2">
      <div role="img" aria-label={t("dividendChartAria")}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="fiscalYear" stroke="var(--chart-axis)" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickLine={false} />
            <YAxis
              stroke="var(--chart-axis)"
              tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => format(v)}
            />
            <Tooltip
              cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
              content={<DividendTooltip format={format} scenarioLabel={scenarioLabel} reportedLabel={t("dividendChartReported")} currency={currency} />}
            />
            <Bar dataKey="dps" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            {SCENARIOS.map(({ key, color, dash }) => (
              <Line
                key={key}
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dash}
                strokeLinecap="round"
                connectNulls={false}
                dot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>{t("dividendChartAria")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("dividendChartYear")}</th>
            <th scope="col">
              {t("dividendChartReported")} ({currency})
            </th>
            {SCENARIOS.map(({ key }) => (
              <th key={key} scope="col">
                {scenarioLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.fiscalYear}>
              <th scope="row">{p.fiscalYear}</th>
              <td>{format(p.dps)}</td>
              {SCENARIOS.map(({ key }) => (
                <td key={key}>{format(p[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* The legend: identity is never colour alone (a swatch or a dash sample beside each
          name). Hidden from screen readers, which read the same names in the table. */}
      <figcaption className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 print:text-slate-700" aria-hidden="true">
          {hasHistory && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-1" />
              {t("dividendChartReported")} ({currency})
            </span>
          )}
          {hasPath &&
            SCENARIOS.map(({ key, color, dash }) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <svg width="22" height="8" aria-hidden="true">
                  <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
                </svg>
                {scenarioLabel(key)}
              </span>
            ))}
        </div>
        <SourceLegend extract={extract} statement="income" />
      </figcaption>
    </figure>
  );
}

type TooltipEntry = { payload: DividendChartPoint };

/** One year: the reported DPS with its source, then the path's three values when it has them. */
function DividendTooltip({
  active,
  payload,
  format,
  scenarioLabel,
  reportedLabel,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  format: (v: number | undefined) => string;
  scenarioLabel: (s: Scenario) => string;
  reportedLabel: string;
  currency: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-lg">
      <p className="font-semibold text-slate-100">{point.fiscalYear}</p>
      {point.dps != null && (
        <p className="flex items-center gap-2">
          <span>
            {reportedLabel}: {format(point.dps)} {currency}
          </span>
          <SourceChip source={point.source} />
        </p>
      )}
      {SCENARIOS.filter(({ key }) => point[key] != null).map(({ key }) => (
        <p key={key}>
          {scenarioLabel(key)}: {format(point[key])} {currency}
        </p>
      ))}
    </div>
  );
}
