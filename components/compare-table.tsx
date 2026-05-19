"use client";

import { useState } from "react";
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

type WatchStatus = "idle" | "loading" | "saved" | "already";

type CompareTableProps = {
  items: TickerCompareState[];
  mosPercent: number;
  watchedTickers?: string[];
  onWatch?: (ticker: string) => Promise<void>;
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

export function CompareTable({ items, mosPercent, watchedTickers = [], onWatch }: CompareTableProps) {
  const { t } = useLanguage();
  const [watchStatuses, setWatchStatuses] = useState<Record<string, WatchStatus>>({});

  async function handleWatch(ticker: string) {
    if (!onWatch) return;
    setWatchStatuses((prev) => ({ ...prev, [ticker]: "loading" }));
    try {
      await onWatch(ticker);
      setWatchStatuses((prev) => ({ ...prev, [ticker]: "saved" }));
    } catch {
      setWatchStatuses((prev) => ({ ...prev, [ticker]: "idle" }));
    }
  }
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

  const baseLabel = t("compareFairValueBase");

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

      case "bear": {
        const buyTargetBear = result.fairValueBear * mosMultiplier;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span>
              {fmt(result.fairValueBear, result.currency)}
              <InlineUpside fairValue={result.fairValueBear} currentPrice={currentPrice} />
            </span>
            {mosPercent > 0 && (
              <span className="text-xs text-amber-400/70">
                {fmt(buyTargetBear, result.currency)}
                <InlineUpside fairValue={buyTargetBear} currentPrice={currentPrice} />
              </span>
            )}
          </div>
        );
      }

      case "base": {
        const buyTargetBase = result.fairValueBase * mosMultiplier;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span>
              {fmt(result.fairValueBase, result.currency)}
              <InlineUpside fairValue={result.fairValueBase} currentPrice={currentPrice} />
            </span>
            {mosPercent > 0 && (
              <span className="text-xs text-amber-400/70">
                {fmt(buyTargetBase, result.currency)}
                <InlineUpside fairValue={buyTargetBase} currentPrice={currentPrice} />
              </span>
            )}
          </div>
        );
      }

      case "bull": {
        const buyTargetBull = result.fairValueBull * mosMultiplier;
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span>
              {fmt(result.fairValueBull, result.currency)}
              <InlineUpside fairValue={result.fairValueBull} currentPrice={currentPrice} />
            </span>
            {mosPercent > 0 && (
              <span className="text-xs text-amber-400/70">
                {fmt(buyTargetBull, result.currency)}
                <InlineUpside fairValue={buyTargetBull} currentPrice={currentPrice} />
              </span>
            )}
          </div>
        );
      }

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
            {items.map((item) => {
              const watchStatus = watchStatuses[item.ticker] ?? "idle";
              const alreadyWatched = watchedTickers.includes(item.ticker) || watchStatus === "saved" || watchStatus === "already";
              return (
                <td key={item.ticker} className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Link
                      href={`/?ticker=${item.ticker}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-sky-800 px-3 py-1.5 text-xs font-semibold text-sky-400 transition hover:border-sky-500 hover:bg-sky-500/10 hover:text-sky-300"
                    >
                      {t("compareDeepAnalysis")}
                    </Link>
                    {onWatch && (
                      alreadyWatched ? (
                        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-500">
                          {t("inWatchlist")}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleWatch(item.ticker)}
                          disabled={watchStatus === "loading"}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700/60 px-2.5 py-1 text-xs font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-60"
                        >
                          {watchStatus === "loading" ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
                          ) : (
                            <span>👁</span>
                          )}
                          {t("compareWatch")}
                        </button>
                      )
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {mosPercent > 0 && (
        <div className="border-t border-slate-800/50 px-4 py-2 text-xs text-slate-500">
          <span className="text-slate-400">Fair value intrinseco</span>
          {" · "}
          <span className="text-amber-400/70">Buy target (−{mosPercent}% MoS)</span>
        </div>
      )}
    </div>
  );
}
