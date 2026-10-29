"use client";

// Banner shown on the analysis detail page when the user holds this ticker.
// The price comes from the page (AnalysisDetailBody resolves it once for every card), so
// the banner never fetches its own: the live P&L appears only when that price is a live
// quote in the lots' currency; otherwise just the shares and the weighted-average cost.
// mounted guard: Intl.NumberFormat without a fixed locale produces different output
// between Node.js (SSR) and the browser, causing hydration mismatches.
import { useState, useEffect } from "react";
import { useLanguage } from "@/context/language-context";

type OpenPositionBannerProps = {
  totalShares: number;
  wac: number;
  currency: string;
  // The live price in `currency`, or null when there is none to compute a P&L on.
  livePrice: number | null;
  // The page is still resolving its price: say so instead of showing no P&L yet.
  isPriceLoading: boolean;
};

export default function OpenPositionBanner({
  totalShares,
  wac,
  currency,
  livePrice,
  isPriceLoading,
}: OpenPositionBannerProps) {
  const [mounted, setMounted] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    setMounted(true);
  }, []);

  const formatPrice = (v: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(v);

  const pnl = livePrice != null ? (livePrice - wac) * totalShares : null;
  const returnPct = pnl != null ? (livePrice! / wac - 1) * 100 : null;
  const isPositive = pnl != null && pnl >= 0;

  if (!mounted) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
      <span className="text-slate-400">
        {t("openPosition")}{" "}
        <span className="text-slate-200 font-medium">
          {totalShares} {t("sharesUnit")} @ {formatPrice(wac)}
        </span>
      </span>
      {pnl != null ? (
        <span
          className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${
            isPositive ? "bg-emerald-500/15 text-success" : "bg-red-500/15 text-danger"
          }`}
        >
          {isPositive ? "+" : ""}
          {pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          ({isPositive ? "+" : ""}{returnPct!.toFixed(1)}%)
        </span>
      ) : (
        isPriceLoading && <span className="text-xs text-slate-600">{t("loadingPnL")}</span>
      )}
    </div>
  );
}
