"use client";

// Banner shown on the analysis detail page when the user holds this ticker.
// Fetches the current price client-side to compute live P&L.
// mounted guard: Intl.NumberFormat without a fixed locale produces different output
// between Node.js (SSR) and the browser, causing hydration mismatches.
import { useState, useEffect } from "react";
import { useLanguage } from "@/context/language-context";

type OpenPositionBannerProps = {
  ticker: string;
  totalShares: number;
  wac: number;
  currency: string;
};

export default function OpenPositionBanner({
  ticker,
  totalShares,
  wac,
  currency,
}: OpenPositionBannerProps) {
  const [mounted, setMounted] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    setMounted(true);
    fetch(`/api/quote/${encodeURIComponent(ticker)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.regularMarketPrice != null) {
          setCurrentPrice(data.regularMarketPrice as number);
        }
      })
      .catch(() => {});
  }, [ticker]);

  const formatPrice = (v: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(v);

  const pnl = currentPrice != null ? (currentPrice - wac) * totalShares : null;
  const returnPct = pnl != null ? (currentPrice! / wac - 1) * 100 : null;
  const isPositive = pnl != null && pnl >= 0;

  if (!mounted) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
      <span className="text-slate-400">
        {t("openPosition")}{" "}
        <span className="text-slate-200 font-medium">
          {totalShares} shares @ {formatPrice(wac)}
        </span>
      </span>
      {pnl != null ? (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            isPositive ? "bg-emerald-500/15 text-success" : "bg-red-500/15 text-danger"
          }`}
        >
          {isPositive ? "+" : ""}
          {pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          ({isPositive ? "+" : ""}{returnPct!.toFixed(1)}%)
        </span>
      ) : (
        <span className="text-xs text-slate-600">{t("loadingPnL")}</span>
      )}
    </div>
  );
}
