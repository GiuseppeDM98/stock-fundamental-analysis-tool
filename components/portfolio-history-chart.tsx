"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchSnapshots } from "@/lib/portfolio";
import type { SnapshotPoint } from "@/types/portfolio";
import { useLanguage } from "@/context/language-context";

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

type TooltipEntry = { name: string; value: number; stroke: string };

function ChartTooltip({
  active,
  payload,
  label,
  locale,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  locale: string;
}) {
  if (!active || !payload?.length) return null;

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

  return (
    <div className="card mb-6" style={{ height: 272 }}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t("portfolioValueOverTime")}
      </p>
      <ResponsiveContainer width="100%" height="88%">
        <LineChart
          data={snapshots}
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
          <Tooltip content={<ChartTooltip locale={locale} />} />
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
