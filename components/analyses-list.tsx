"use client";

// Client component that fetches and displays the user's saved analyses.
// Shows ticker, date, performance vs analysis price, and re-run/delete controls.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyses, deleteAnalysis } from "@/lib/analyses";
import type { SavedAnalysis } from "@/types/analysis";

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
      <span className="text-xs text-slate-500">
        {formatPrice(priceAtAnalysis)} → {formatPrice(currentPrice)}
      </span>
      <span
        className={`text-xs font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}
      >
        {sign}{delta.toFixed(1)}%
      </span>
      {fairValueBase != null && (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            belowFairValue
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-slate-700/60 text-slate-400"
          }`}
        >
          {belowFairValue ? "Under FV" : "Above FV"}
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

  useEffect(() => {
    fetchAnalyses()
      .then((data) => {
        setAnalyses(data);
        // Fetch current prices only for analyses that have a price snapshot
        const tickers = [
          ...new Set(
            data
              .filter((a) => a.priceAtAnalysis != null)
              .map((a) => a.ticker)
          ),
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
      <div className="flex items-center justify-center py-16 text-slate-400">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 py-16 text-center text-slate-500">
        <p className="text-lg">No saved analyses yet.</p>
        <p className="mt-1 text-sm">
          Generate an AI analysis from the dashboard and save it here.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400"
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
                <span className="font-mono text-sm font-bold text-sky-400">
                  {analysis.ticker}
                </span>
                <span className="text-xs text-slate-500">
                  {analysis.companyName}
                </span>
                <span className="ml-auto text-xs text-slate-500">
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
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-sky-400 transition hover:border-sky-500/50 hover:text-sky-300"
                title="Re-run analysis with this ticker"
              >
                Re-run
              </button>
              <button
                onClick={() => handleDelete(analysis.id)}
                disabled={deleting === analysis.id}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
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
