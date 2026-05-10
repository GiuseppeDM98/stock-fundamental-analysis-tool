"use client";

// Client component that fetches and displays the user's saved analyses.
// Shows ticker, date, performance vs analysis price, and re-run/delete controls.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyses, deleteAnalysis } from "@/lib/analyses";
import { fetchPositions } from "@/lib/portfolio";
import type { SavedAnalysis } from "@/types/analysis";
import type { Position } from "@/types/portfolio";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPrice(price: number): string {
  // Use compact notation for large prices; no currency symbol since we don't track it here
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Badge showing price change since analysis was saved. */
function PerformanceBadge({
  priceAtAnalysis,
  currentPrice,
  fairValueBase,
}: {
  priceAtAnalysis: number;
  currentPrice: number;
  fairValueBase?: number | null;
}) {
  const delta = (currentPrice / priceAtAnalysis - 1) * 100;
  const isPositive = delta >= 0;
  const sign = isPositive ? "+" : "";

  // Whether the current price is still below the MoS-adjusted base-case fair value
  const belowFairValue = fairValueBase != null && currentPrice < fairValueBase;

  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      <span className="text-xs text-muted">
        {formatPrice(priceAtAnalysis)} → {formatPrice(currentPrice)}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
          isPositive
            ? "bg-emerald-500/15 text-success"
            : "bg-red-500/15 text-danger"
        }`}
      >
        {sign}{delta.toFixed(1)}%
      </span>
      {fairValueBase != null && (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            belowFairValue
              ? "bg-emerald-500/15 text-success"
              : "bg-slate-700/60 text-slate-400"
          }`}
        >
          {belowFairValue ? "Under FV" : "Above FV"}
        </span>
      )}
    </div>
  );
}

/** Inline badge showing an open portfolio position for this analysis's ticker. */
function OpenPositionBadge({
  positions,
  currentPrice,
}: {
  positions: Position[];
  currentPrice?: number;
}) {
  if (positions.length === 0) return null;

  const totalShares = positions.reduce((s, p) => s + p.shares, 0);
  const totalCost = positions.reduce((s, p) => s + p.purchasePrice * p.shares, 0);
  const wac = totalCost / totalShares;
  const currency = positions[0].currency;

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

  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-500">
        Posizione: {totalShares} shares @ {formatPrice(wac)}
      </span>
      {pnl != null && (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            isPositive ? "bg-emerald-500/15 text-success" : "bg-red-500/15 text-danger"
          }`}
        >
          {isPositive ? "+" : ""}
          {pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
          ({isPositive ? "+" : ""}{returnPct!.toFixed(1)}%)
        </span>
      )}
    </div>
  );
}

export default function AnalysesList() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Map of ticker → current price, fetched once on mount
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [positionsByTicker, setPositionsByTicker] = useState<Record<string, Position[]>>({});

  useEffect(() => {
    // Fetch analyses and positions in parallel — used to cross-link the two views.
    Promise.all([fetchAnalyses(), fetchPositions()])
      .then(([data, posData]) => {
        setAnalyses(data);

        const posMap: Record<string, Position[]> = {};
        for (const p of posData) {
          posMap[p.ticker] = [...(posMap[p.ticker] ?? []), p];
        }
        setPositionsByTicker(posMap);

        // Fetch live prices for tickers with a snapshot (performance badge)
        // OR with an open position (P&L in position badge).
        const tickers = [
          ...new Set([
            ...data.filter((a) => a.priceAtAnalysis != null).map((a) => a.ticker),
            ...posData.map((p) => p.ticker),
          ]),
        ];
        if (tickers.length > 0) {
          fetchCurrentPrices(tickers);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetches live prices for a set of tickers in parallel.
  // Failures are silently ignored — performance badge simply won't render.
  async function fetchCurrentPrices(tickers: string[]) {
    const results = await Promise.allSettled(
      tickers.map(async (t) => {
        const res = await fetch(`/api/quote/${encodeURIComponent(t)}`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        return { ticker: t, price: data.regularMarketPrice as number };
      })
    );

    const prices: Record<string, number> = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        prices[result.value.ticker] = result.value.price;
      }
    }
    setCurrentPrices(prices);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Failed to delete. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 py-16 text-center text-muted">
        <p className="text-lg">No saved analyses yet.</p>
        <p className="mt-1 text-sm">
          Generate an AI analysis from the dashboard and save it here.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {analyses.map((analysis) => {
        const currentPrice = currentPrices[analysis.ticker];
        const hasSnapshot =
          analysis.priceAtAnalysis != null && currentPrice != null;

        return (
          <li key={analysis.id} className="card flex items-start justify-between gap-4">
            {/* Clickable report preview */}
            <button
              className="flex-1 text-left"
              onClick={() => router.push(`/analyses/${analysis.id}`)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-accent">
                  {analysis.ticker}
                </span>
                <span className="text-xs text-muted">
                  {analysis.companyName}
                </span>
                <span className="ml-auto text-xs text-muted">
                  MoS {analysis.mosPercent}%
                </span>
              </div>

              {/* Performance badge — only shown when we have a price snapshot + live price */}
              {hasSnapshot && (
                <PerformanceBadge
                  priceAtAnalysis={analysis.priceAtAnalysis!}
                  currentPrice={currentPrice}
                  fairValueBase={analysis.fairValueBase}
                />
              )}

              {/* Open position badge — shown when the user holds this ticker */}
              <OpenPositionBadge
                positions={positionsByTicker[analysis.ticker] ?? []}
                currentPrice={currentPrice}
              />

              <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                {analysis.reportMd
                  .replace(/^```json\n[\s\S]*?\n```\n?/, "")
                  .slice(0, 220)
                  .replace(/[#*`]/g, "")}…
              </p>
              <p className="mt-1 text-xs text-slate-600">{formatDate(analysis.createdAt)}</p>
            </button>

            {/* Actions: Re-run + Delete */}
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <button
                onClick={() => {
                  window.location.href = `/?ticker=${encodeURIComponent(analysis.ticker)}`;
                }}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
                title="Re-run analysis with this ticker"
              >
                Re-run
              </button>
              <button
                onClick={() => handleDelete(analysis.id)}
                disabled={deleting === analysis.id}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
              >
                {deleting === analysis.id ? "…" : "Delete"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
