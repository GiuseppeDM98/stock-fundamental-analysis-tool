"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchSnapshots } from "@/lib/portfolio";
import type { SnapshotPoint } from "@/types/portfolio";
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";

// ─── Types ────────────────────────────────────────────────────────────────────

// Extends SnapshotPoint with optional capital deployment delta for tooltip display.
// capitalDelta is set when costEur grew by more than €50 vs the previous snapshot.
type SnapshotChartPoint = SnapshotPoint & { capitalDelta?: number };

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatXAxisDate(isoString: string, locale: string): string {
  return new Date(isoString).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

function formatEurCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEurFull(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

type TooltipEntry = { name: string; value: number; stroke: string; payload: SnapshotChartPoint };

function ChartTooltip({
  active,
  payload,
  label,
  locale,
  t,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  locale: string;
  t: (key: keyof Translations) => string;
}) {
  if (!active || !payload?.length) return null;

  // The full data point is available via payload[0].payload — used to read
  // capitalDelta and dividendsEur which are not exposed as Line dataKeys.
  const raw = payload[0]?.payload;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-[var(--card)] px-3 py-2 shadow-lg text-xs">
      <p className="mb-1.5 font-semibold text-slate-300">
        {label ? formatXAxisDate(label, locale) : ""}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.stroke }}>
          {entry.name}:{" "}
          <span className="font-semibold">{formatEurFull(entry.value, locale)}</span>
        </p>
      ))}
      {raw?.capitalDelta !== undefined && (
        <p style={{ color: "#f59e0b" }} className="mt-1 border-t border-slate-700/40 pt-1">
          {t("capitalDeployedMarkerLabel")}:{" "}
          <span className="font-semibold">+{formatEurFull(raw.capitalDelta, locale)}</span>
        </p>
      )}
      {(raw?.dividendsEur ?? 0) > 0 && (
        <p style={{ color: "#34d399" }} className="mt-1 border-t border-slate-700/40 pt-1">
          {t("dividendMarkerLabel")}:{" "}
          <span className="font-semibold">+{formatEurFull(raw!.dividendsEur!, locale)}</span>
        </p>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="card mb-6 h-[272px] animate-pulse">
      <div className="mb-3 h-3 w-48 rounded bg-slate-700/60" />
      <div className="h-[220px] rounded-xl bg-slate-800/40" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PortfolioHistoryChart() {
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, locale } = useLanguage();

  useEffect(() => {
    fetchSnapshots()
      .then(setSnapshots)
      .catch(() => {
        // Silently degrade — chart absence is not critical to portfolio functionality
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ChartSkeleton />;

  if (snapshots.length < 2) {
    return (
      <div className="card mb-6 flex h-28 items-center justify-center">
        <p className="text-sm text-muted text-center">
          {t("chartEmptyState")}
        </p>
      </div>
    );
  }

  // Enrich each snapshot with capitalDelta: the cost basis increase vs the previous day.
  // €50 threshold suppresses FX rounding drift on unchanged positions.
  const chartData: SnapshotChartPoint[] = snapshots.map((s, i) => ({
    ...s,
    capitalDelta:
      i > 0 && s.costEur - snapshots[i - 1].costEur > 50
        ? s.costEur - snapshots[i - 1].costEur
        : undefined,
  }));

  const dividendDays = chartData.filter((s) => (s.dividendsEur ?? 0) > 0);
  const capitalEventDays = chartData.filter((s) => s.capitalDelta !== undefined);

  return (
    <div className="card mb-6" style={{ height: 272 }}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t("portfolioValueOverTime")}
      </p>
      <ResponsiveContainer width="100%" height="88%">
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2d47" />
          <XAxis
            dataKey="takenAt"
            stroke="#7b8ba9"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => formatXAxisDate(v, locale)}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#7b8ba9"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => formatEurCompact(v, locale)}
            width={68}
          />
          <Tooltip content={<ChartTooltip locale={locale} t={t} />} />
          {/* Vertical markers for days when dividends were paid — label shown inline */}
          {dividendDays.map((s) => (
            <ReferenceLine
              key={s.takenAt}
              x={s.takenAt}
              stroke="#34d399"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              label={{
                value: `${t("dividendMarkerLabel")} +${formatEurFull(s.dividendsEur!, locale)}`,
                position: "insideTopRight",
                fill: "#34d399",
                fontSize: 10,
              }}
            />
          ))}
          {/* Vertical markers for days when new capital was deployed (new position or DCA).
              No inline label — amount is shown in the tooltip to avoid edge clipping. */}
          {capitalEventDays.map((s) => (
            <ReferenceLine
              key={`cap-${s.takenAt}`}
              x={s.takenAt}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          ))}
          {/* Market value of the portfolio */}
          <Line
            type="monotone"
            dataKey="totalEur"
            name={t("valueLabel")}
            stroke="#38bdf8"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          {/* Cost basis — lets user see breakeven at a glance */}
          <Line
            type="monotone"
            dataKey="costEur"
            name={t("costLabel")}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
