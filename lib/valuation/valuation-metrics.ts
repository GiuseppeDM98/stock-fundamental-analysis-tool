/**
 * Computes "payback" valuation metrics that express price as years of earnings/FCF.
 *
 * These reframe classic multiples (P/E, P/FCF) in plain language: "at today's price,
 * you'd need X years of net income to buy back the whole company." Easier to grasp
 * for non-finance readers than abstract ratio numbers.
 *
 * Each metric also includes a trend direction comparing the latest annual value
 * against the prior year's — so users can see whether the underlying fundamental
 * is improving or deteriorating, independently of price moves.
 */

import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import { formatPercent } from "@/lib/format";
import type { Translations } from "@/lib/i18n/translations";

export type TrendDirection = "up" | "down" | "flat";

export type ValuationMetric = {
  /** Stable identifier used to track which modal is open — never translated */
  key: string;
  label: string;
  value: string;
  /** null when only one year of annual data is available — no trend can be computed */
  trend: TrendDirection | null;
  /** Explains why value is "N/A" when applicable */
  tooltip?: string;
  /** Educational content shown in the clickable info popover */
  info: {
    description: string;
    howToRead: string;
  };
};

/**
 * Returns trend direction for an improving-is-higher metric (e.g. netIncome, FCF).
 * Uses ±5% as the "flat" band to filter out noise.
 *
 * @param current - Latest annual value
 * @param prior - Prior annual value (undefined if only one year exists)
 */
function trendDirection(
  current: number,
  prior: number | undefined
): TrendDirection | null {
  // Not enough data to compute a trend
  if (prior === undefined) return null;
  // Avoid division by zero when prior is exactly 0
  if (prior === 0) return null;

  const delta = (current - prior) / Math.abs(prior);
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "flat";
}

/**
 * Computes the four payback/yield metrics from quote and fundamentals data.
 *
 * Accepts a `t` function so that all user-visible strings (labels, tooltips,
 * modal descriptions) are returned in the active UI language rather than
 * hardcoded Italian. Called inside the component so `t` is always fresh.
 *
 * Depends on annual[] being sorted oldest-first (as returned by the API).
 * If marketCap is null, all four metrics return "N/A" — this happens for some
 * non-US tickers where Yahoo doesn't provide the field.
 */
export function computeValuationMetrics(
  quote: QuoteResponse,
  fundamentals: FundamentalsResponse,
  t: (key: keyof Translations) => string
): ValuationMetric[] {
  const { annual, ratios } = fundamentals;
  const marketCap = quote.marketCap;

  // Shared N/A sentinel when market cap is unavailable
  if (!marketCap || annual.length === 0) {
    const tooltip = !marketCap ? t("metricNaMarketCap") : t("metricNaNoHistory");
    return [
      { key: "yearsEarnings", label: t("metricYearsEarnings"), value: "N/A", trend: null, tooltip, info: { description: t("metricYearsEarningsDesc"), howToRead: t("metricYearsEarningsHow") } },
      { key: "yearsFcf",      label: t("metricYearsFcf"),      value: "N/A", trend: null, tooltip, info: { description: t("metricYearsFcfDesc"),      howToRead: t("metricYearsFcfHow") } },
      { key: "fcfYield",      label: t("metricFcfYield"),      value: "N/A", trend: null, tooltip, info: { description: t("metricFcfYieldDesc"),      howToRead: t("metricFcfYieldHow") } },
      { key: "earningsYield", label: t("metricEarningsYield"), value: "N/A", trend: null, tooltip, info: { description: t("metricEarningsYieldDesc"), howToRead: t("metricEarningsYieldHow") } },
    ];
  }

  const latest = annual[annual.length - 1];
  const prior = annual.length >= 2 ? annual[annual.length - 2] : undefined;

  // ── Years of Earnings (= P/E reframed) ───────────────────────────────────
  // Prefer ratios.pe (TTM-based, more accurate than dividing by one annual year)
  // but fall back to marketCap / latestNetIncome when ratios.pe is missing.
  let anniUtiliValue: string;
  let anniUtiliTooltip: string | undefined;
  const peFromRatios = ratios.pe !== null && ratios.pe !== undefined && ratios.pe > 0 ? ratios.pe : null;
  if (peFromRatios !== null) {
    anniUtiliValue = `${peFromRatios.toFixed(1)}x`;
  } else if (latest.netIncome > 0) {
    anniUtiliValue = `${(marketCap / latest.netIncome).toFixed(1)}x`;
  } else {
    anniUtiliValue = "N/A";
    anniUtiliTooltip = t("metricNaPositiveNI");
  }
  const niTrend = trendDirection(latest.netIncome, prior?.netIncome);

  // ── Years of FCF (= Price/FCF ratio) ─────────────────────────────────────
  let anniFcfValue: string;
  let anniFcfTooltip: string | undefined;
  if (latest.fcf > 0) {
    anniFcfValue = `${(marketCap / latest.fcf).toFixed(1)}x`;
  } else {
    anniFcfValue = "N/A";
    anniFcfTooltip = t("metricNaPositiveFcf");
  }
  const fcfTrend = trendDirection(latest.fcf, prior?.fcf);

  // ── FCF Yield = FCF / marketCap ───────────────────────────────────────────
  // formatPercent expects a decimal (0.05 → "5.00%")
  let fcfYieldValue: string;
  let fcfYieldTooltip: string | undefined;
  if (latest.fcf > 0) {
    fcfYieldValue = formatPercent(latest.fcf / marketCap, 2);
  } else {
    fcfYieldValue = "N/A";
    fcfYieldTooltip = t("metricNaPositiveFcf");
  }

  // ── Earnings Yield = netIncome / marketCap ────────────────────────────────
  let earningsYieldValue: string;
  let earningsYieldTooltip: string | undefined;
  if (latest.netIncome > 0) {
    earningsYieldValue = formatPercent(latest.netIncome / marketCap, 2);
  } else {
    earningsYieldValue = "N/A";
    earningsYieldTooltip = t("metricNaPositiveNI");
  }

  return [
    {
      key: "yearsEarnings",
      label: t("metricYearsEarnings"),
      value: anniUtiliValue,
      trend: anniUtiliValue !== "N/A" ? niTrend : null,
      tooltip: anniUtiliTooltip,
      info: { description: t("metricYearsEarningsDesc"), howToRead: t("metricYearsEarningsHow") },
    },
    {
      key: "yearsFcf",
      label: t("metricYearsFcf"),
      value: anniFcfValue,
      trend: anniFcfValue !== "N/A" ? fcfTrend : null,
      tooltip: anniFcfTooltip,
      info: { description: t("metricYearsFcfDesc"), howToRead: t("metricYearsFcfHow") },
    },
    {
      key: "fcfYield",
      label: t("metricFcfYield"),
      value: fcfYieldValue,
      trend: fcfYieldValue !== "N/A" ? fcfTrend : null,
      tooltip: fcfYieldTooltip,
      info: { description: t("metricFcfYieldDesc"), howToRead: t("metricFcfYieldHow") },
    },
    {
      key: "earningsYield",
      label: t("metricEarningsYield"),
      value: earningsYieldValue,
      trend: earningsYieldValue !== "N/A" ? niTrend : null,
      tooltip: earningsYieldTooltip,
      info: { description: t("metricEarningsYieldDesc"), howToRead: t("metricEarningsYieldHow") },
    },
  ];
}
