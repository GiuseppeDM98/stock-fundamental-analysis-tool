"use client";

import Link from "next/link";
import { useLanguage } from "@/context/language-context";
import type { LiteAnalysisResult } from "@/types/watchlist";

export type TickerCompareState = {
  ticker: string;
  status: "idle" | "loading" | "ready" | "error";
  result: LiteAnalysisResult | null;
  currentPrice: number | null;
  analyzedAt: string | null;
};

type CompareTableProps = {
  items: TickerCompareState[];
  mosPercent: number;
};

function fmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function pctUpside(fairValue: number, currentPrice: number): number {
  return (fairValue - currentPrice) / currentPrice;
}

function daysSince(analyzedAt: string | null): number | null {
  if (!analyzedAt) return null;
  return Math.floor((Date.now() - new Date(analyzedAt).getTime()) / 86_400_000);
}

function FreshnessBadge({ analyzedAt }: { analyzedAt: string | null }) {
  const days = daysSince(analyzedAt);
  if (days === null) return null;
  if (days === 0)
    return (
      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
        oggi
      </span>
    );
  if (days <= 3)
    return (
      <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
        {days}g fa
      </span>
    );
  return (
    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
      {days}g fa
    </span>
  );
}

function SkeletonCell() {
  return (
    <span className="inline-block h-4 w-16 animate-pulse rounded bg-slate-700" />
  );
}

// Compact upside/downside shown inline next to a fair value
function InlineUpside({ fairValue, currentPrice }: { fairValue: number; currentPrice: number | null }) {
  if (currentPrice === null) return null;
  const pct = pctUpside(fairValue, currentPrice);
  const isPositive = pct >= 0;
  return (
    <span
      className={`ml-1.5 text-xs font-semibold ${
        isPositive ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {fmtPct(pct)}
    </span>
  );
}

type RowKey = "currentPrice" | "bear" | "base" | "bull" | "method" | "sector";

export function CompareTable({ items, mosPercent }: CompareTableProps) {
  const { t } = useLanguage();
  const mosMultiplier = 1 - mosPercent / 100;

  if (items.length === 0) return null;

  const readyItems = items.filter(
    (item) => item.status === "ready" && item.result !== null && item.currentPrice !== null
  );

  // Best-in-class: ticker with highest MoS-adjusted base upside (≥2 ready tickers)
  let bestUpsideTicker: string | null = null;
  if (readyItems.length >= 2) {
    let best = -Infinity;
    for (const item of readyItems) {
      const u = pctUpside(item.result!.fairValueBase * mosMultiplier, item.currentPrice!);
      if (u > best) { best = u; bestUpsideTicker = item.ticker; }
    }
  }

  const baseLabel =
    mosPercent > 0
      ? `${t("compareFairValueBase")} (−${mosPercent}% MoS)`
      : t("compareFairValueBase");

  const rows: { label: string; key: RowKey }[] = [
    { label: t("compareCurrentPrice"), key: "currentPrice" },
    { label: t("compareFairValueBear"), key: "bear" },
    { label: baseLabel, key: "base" },
    { label: t("compareFairValueBull"), key: "bull" },
    { label: t("compareMethod"), key: "method" },
    { label: t("compareSector"), key: "sector" },
  ];

  function renderCell(item: TickerCompareState, key: RowKey) {
    if (item.status === "loading") {
      return <SkeletonCell />;
    }

    if (item.status === "idle" || item.status === "error" || !item.result) {
      return (
        <span className={item.status === "idle" ? "text-muted/40" : "text-muted"}>
          {t("compareNoData")}
        </span>
      );
    }

    const { result, currentPrice } = item;

    switch (key) {
      case "currentPrice":
        return <span>{currentPrice !== null ? fmt(currentPrice, result.currency) : t("compareNoData")}</span>;

      case "bear":
        return (
          <span>
            {fmt(result.fairValueBear, result.currency)}
            <InlineUpside fairValue={result.fairValueBear} currentPrice={currentPrice} />
          </span>
        );

      case "base": {
        const adjustedBase = result.fairValueBase * mosMultiplier;
        return (
          <span>
            {fmt(adjustedBase, result.currency)}
            <InlineUpside fairValue={adjustedBase} currentPrice={currentPrice} />
          </span>
        );
      }

      case "bull":
        return (
          <span>
            {fmt(result.fairValueBull, result.currency)}
            <InlineUpside fairValue={result.fairValueBull} currentPrice={currentPrice} />
          </span>
        );

      case "method":
        return <span>{result.method}</span>;

      case "sector":
        return <span>{result.sector}</span>;
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Metrica
            </th>
            {items.map((item) => (
              <th
                key={item.ticker}
                className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-100"
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="flex items-center gap-1.5">
                    {item.ticker}
                    {item.ticker === bestUpsideTicker && (
                      <span title={t("compareBestUpside")} className="text-amber-400">
                        ★
                      </span>
                    )}
                  </span>
                  {item.status !== "loading" && (
                    <FreshnessBadge analyzedAt={item.analyzedAt} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr
              key={row.key}
              className={`border-b border-slate-800/50 ${
                rowIdx % 2 === 0 ? "bg-transparent" : "bg-slate-900/30"
              } ${row.key === "base" ? "bg-sky-950/20" : ""}`}
            >
              <td className="px-4 py-3 font-medium text-muted">{row.label}</td>
              {items.map((item) => (
                <td key={item.ticker} className="px-4 py-3 text-center text-slate-200">
                  {renderCell(item, row.key)}
                </td>
              ))}
            </tr>
          ))}

          {/* Actions row */}
          <tr className="border-t border-slate-700/60 bg-slate-900/50">
            <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted" />
            {items.map((item) => (
              <td key={item.ticker} className="px-4 py-3 text-center">
                <Link
                  href={`/?ticker=${item.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-sky-800 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:border-sky-500 hover:bg-sky-500/10 hover:text-sky-300"
                >
                  {t("compareDeepAnalysis")}
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
