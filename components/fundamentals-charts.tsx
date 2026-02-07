"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { FundamentalsResponse } from "@/types/fundamentals";

type FundamentalsChartsProps = {
  fundamentals: FundamentalsResponse;
  compact?: boolean;
};

/**
 * Renders historical fundamental data charts for revenue, FCF, and margins.
 *
 * Displays two side-by-side charts:
 * - Line chart: Revenue and Free Cash Flow trends over time
 * - Bar chart: Operating and net margin percentages
 *
 * @param fundamentals - Historical annual financial data
 * @param compact - If true, reduces chart height for denser layouts (default: false)
 */
export function FundamentalsCharts({ fundamentals, compact = false }: FundamentalsChartsProps) {
  // Sort by year ascending to ensure chronological display on X-axis
  // Convert margin decimals (0.15) to percentages (15) for readability
  const chartData = [...fundamentals.annual]
    .sort((a, b) => a.year - b.year)
    .map((point) => ({
      year: point.year,
      revenue: point.revenue,
      fcf: point.fcf,
      operatingMargin: Number((point.operatingMargin * 100).toFixed(2)),
      netMargin: Number((point.netMargin * 100).toFixed(2))
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`card ${compact ? "h-[250px]" : "h-[320px]"}`}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Revenue & FCF trend</p>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23314f" />
            <XAxis dataKey="year" stroke="#7b8ba9" />
            <YAxis stroke="#7b8ba9" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="revenue" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="fcf" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`card ${compact ? "h-[250px]" : "h-[320px]"}`}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Margins (%)</p>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23314f" />
            <XAxis dataKey="year" stroke="#7b8ba9" />
            <YAxis stroke="#7b8ba9" />
            <Tooltip />
            <Legend />
            <Bar dataKey="operatingMargin" fill="#38bdf8" radius={4} />
            <Bar dataKey="netMargin" fill="#10b981" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
