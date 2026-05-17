"use client";

// Client component for the saved analyses page.
// Analyses are grouped by ticker; each group shows the latest analysis with
// bull/base/bear cards and a price-vs-FV bar, plus a collapsible history of
// older saves for the same ticker.
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyses, deleteAnalysis } from "@/lib/analyses";
import { fetchPositions } from "@/lib/portfolio";
import type { SavedAnalysis } from "@/types/analysis";
import type { Position } from "@/types/portfolio";
import { useLanguage } from "@/context/language-context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPrice(price: number, currency?: string): string {
  if (currency) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Groups analyses by ticker, with each group sorted newest-first.
function groupByTicker(analyses: SavedAnalysis[]): Map<string, SavedAnalysis[]> {
  const map = new Map<string, SavedAnalysis[]>();
  for (const a of analyses) {
    const group = map.get(a.ticker) ?? [];
    group.push(a);
    map.set(a.ticker, group);
  }
  // Each group is already newest-first because the API returns createdAt desc.
  return map;
}

// Returns a value in [0, 1] representing where `price` falls in the bear–bull range.
function pricePosition(price: number, bear: number, bull: number): number {
  if (bull <= bear) return 0.5;
  return Math.min(1, Math.max(0, (price - bear) / (bull - bear)));
}

type SortMode = "recent" | "ticker" | "performance";

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Three scenario badges: Bear / Base / Bull */
function FairValueTriple({
  bear,
  base,
  bull,
  bearLabel,
  baseLabel,
  bullLabel,
}: {
  bear?: number | null;
  base?: number | null;
  bull?: number | null;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
}) {
  const dash = "—";
  return (
    <div className="flex gap-2 flex-wrap">
      <div className="flex flex-col items-center rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 min-w-[72px]">
        <span className="text-[10px] font-medium text-red-400 uppercase tracking-wide mb-0.5">
          {bearLabel}
        </span>
        <span className="text-sm font-bold text-red-300">
          {bear != null ? formatPrice(bear) : dash}
        </span>
      </div>
      <div className="flex flex-col items-center rounded-lg bg-slate-700/50 border border-slate-600/40 px-3 py-2 min-w-[72px]">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">
          {baseLabel}
        </span>
        <span className="text-sm font-bold text-slate-100">
          {base != null ? formatPrice(base) : dash}
        </span>
      </div>
      <div className="flex flex-col items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 min-w-[72px]">
        <span className="text-[10px] font-medium text-emerald-400 uppercase tracking-wide mb-0.5">
          {bullLabel}
        </span>
        <span className="text-sm font-bold text-emerald-300">
          {bull != null ? formatPrice(bull) : dash}
        </span>
      </div>
    </div>
  );
}

/**
 * Horizontal bar showing where the current price sits relative to the bear–bull range.
 * Only renders when all three values are available.
 */
function PriceVsFVBar({
  currentPrice,
  bear,
  base,
  bull,
}: {
  currentPrice: number;
  bear: number;
  base: number;
  bull: number;
}) {
  const pct = pricePosition(currentPrice, bear, bull) * 100;
  const basePct = pricePosition(base, bear, bull) * 100;
  const belowBase = currentPrice < base;

  // When price and base are within 8 pct-points, move the price label below the
  // bar so the two labels don't overlap — Base stays above, Prezzo goes below.
  const tooClose = Math.abs(pct - basePct) < 8;

  return (
    <div className="mt-3">
      {/* Labels above the bar: always Base, plus Prezzo when not too close */}
      <div className="relative mb-1" style={{ height: tooClose ? "1.5rem" : "2.5rem" }}>
        {/* Base FV label */}
        <div
          className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
          style={{ left: `clamp(12px, ${basePct}%, calc(100% - 12px))` }}
        >
          <span className="text-[9px] text-yellow-400/70 whitespace-nowrap leading-none">Base</span>
          <span className="text-[10px] font-medium text-yellow-300/80 whitespace-nowrap leading-none">
            {formatPrice(base)}
          </span>
          <span className="text-[8px] text-yellow-500/60 leading-none">▼</span>
        </div>

        {/* Current price label — above bar only when labels won't overlap */}
        {!tooClose && (
          <div
            className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center pointer-events-none"
            style={{ left: `clamp(12px, ${pct}%, calc(100% - 12px))` }}
          >
            <span className="text-[9px] text-slate-400 whitespace-nowrap leading-none">Prezzo</span>
            <span className="text-[10px] font-semibold text-slate-200 whitespace-nowrap leading-none">
              {formatPrice(currentPrice)}
            </span>
            <span className="text-[8px] text-slate-500 leading-none">▼</span>
          </div>
        )}
      </div>

      {/* Gradient track with two markers: base FV (tick) and current price (dot) */}
      <div className="relative h-2 rounded-full overflow-visible bg-gradient-to-r from-red-500/70 via-yellow-500/60 to-emerald-500/70">
        {/* Base FV tick mark */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 bg-yellow-400/50 rounded-full"
          style={{ left: `${basePct}%` }}
        />
        {/* Current price dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-slate-900 bg-white shadow"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Price label below bar — only when it would overlap the Base label above */}
      {tooClose && (
        <div className="relative mt-0.5" style={{ height: "1.5rem" }}>
          <div
            className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
            style={{ left: `clamp(12px, ${pct}%, calc(100% - 12px))` }}
          >
            <span className="text-[8px] text-slate-500 leading-none">▲</span>
            <span className="text-[10px] font-semibold text-slate-200 whitespace-nowrap leading-none">
              {formatPrice(currentPrice)}
            </span>
            <span className="text-[9px] text-slate-400 whitespace-nowrap leading-none">Prezzo</span>
          </div>
        </div>
      )}

      {/* Bear / Under-Above FV / Bull footer */}
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-[10px] text-red-400 font-medium">{formatPrice(bear)}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            belowBase
              ? "bg-emerald-500/15 text-success"
              : "bg-slate-700/60 text-slate-400"
          }`}
        >
          {belowBase ? "Under FV" : "Above FV"}
        </span>
        <span className="text-[10px] text-emerald-400 font-medium">{formatPrice(bull)}</span>
      </div>
    </div>
  );
}

/** Price-change badge since the analysis was saved. */
function PerformanceBadge({
  priceAtAnalysis,
  currentPrice,
}: {
  priceAtAnalysis: number;
  currentPrice: number;
}) {
  const delta = (currentPrice / priceAtAnalysis - 1) * 100;
  const isPositive = delta >= 0;
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
        {isPositive ? "+" : ""}{delta.toFixed(1)}%
      </span>
    </div>
  );
}

/** Inline P&L badge for an open portfolio position. */
function OpenPositionBadge({
  positions,
  currentPrice,
}: {
  positions: Position[];
  currentPrice?: number;
}) {
  const { t } = useLanguage();
  if (positions.length === 0) return null;

  const totalShares = positions.reduce((s, p) => s + p.shares, 0);
  const totalCost = positions.reduce((s, p) => s + p.purchasePrice * p.shares, 0);
  const wac = totalCost / totalShares;
  const currency = positions[0].currency;

  const pnl = currentPrice != null ? (currentPrice - wac) * totalShares : null;
  const returnPct = pnl != null ? (currentPrice! / wac - 1) * 100 : null;
  const isPositive = pnl != null && pnl >= 0;

  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-500">
        {t("positionLabel")} {totalShares} {t("sharesUnit")} @ {formatPrice(wac, currency)}
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

/** Compact row for older analyses in the collapsible history. */
function AnalysisRow({
  analysis,
  onView,
  onDelete,
  isDeleting,
  bearLabel,
  baseLabel,
  bullLabel,
  deleteLabel,
}: {
  analysis: SavedAnalysis;
  onView: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
  deleteLabel: string;
}) {
  const dash = "—";
  const fmtFv = (v?: number | null) => (v != null ? formatPrice(v) : dash);

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-800/50 border border-slate-700/40">
      <div className="flex items-center gap-3 flex-wrap text-xs text-slate-400 min-w-0">
        <span className="text-slate-500 shrink-0">{formatDate(analysis.createdAt)}</span>
        <span className="text-red-400 shrink-0">{bearLabel} {fmtFv(analysis.fairValueBear)}</span>
        <span className="text-slate-300 shrink-0">{baseLabel} {fmtFv(analysis.fairValueBase)}</span>
        <span className="text-emerald-400 shrink-0">{bullLabel} {fmtFv(analysis.fairValueBull)}</span>
        {analysis.mosPercent > 0 && (
          <span className="text-slate-600 shrink-0">MoS {analysis.mosPercent}%</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onView}
          className="rounded px-2 py-1 text-xs text-accent border border-slate-700 hover:border-sky-400/40 transition"
        >
          →
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="rounded px-2 py-1 text-xs text-muted border border-slate-700 hover:border-red-500/50 hover:text-danger transition disabled:opacity-50"
        >
          {isDeleting ? "…" : deleteLabel}
        </button>
      </div>
    </div>
  );
}

/** Card for a single ticker showing its latest analysis and collapsible older ones. */
function TickerGroup({
  ticker,
  analyses,
  currentPrice,
  positions,
  deleting,
  onDelete,
  bearLabel,
  baseLabel,
  bullLabel,
  deleteLabel,
  olderLabel,
}: {
  ticker: string;
  analyses: SavedAnalysis[];
  currentPrice?: number;
  positions: Position[];
  deleting: string | null;
  onDelete: (id: string) => void;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
  deleteLabel: string;
  olderLabel: (n: number) => string;
}) {
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);

  const latest = analyses[0];
  const older = analyses.slice(1);
  const companyName = latest.companyName;

  const hasSnapshot = latest.priceAtAnalysis != null && currentPrice != null;
  const hasFullFvBar =
    currentPrice != null &&
    latest.fairValueBear != null &&
    latest.fairValueBase != null &&
    latest.fairValueBull != null;

  return (
    <div className="card">
      {/* Ticker header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-base font-bold text-accent shrink-0">{ticker}</span>
          <span className="text-sm text-slate-400 truncate">{companyName}</span>
          {latest.valuationMethod && (
            <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 shrink-0">
              {latest.valuationMethod}
            </span>
          )}
        </div>
        <button
          onClick={() => { window.location.href = `/?ticker=${encodeURIComponent(ticker)}`; }}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-accent hover:border-sky-400/40 hover:text-sky-300 transition shrink-0"
        >
          Re-run
        </button>
      </div>

      {/* Latest analysis metadata */}
      <p className="mt-1 text-xs text-slate-500">
        {formatDate(latest.createdAt)}
        {latest.mosPercent > 0 && ` · MoS ${latest.mosPercent}%`}
      </p>

      {/* Fair value triple */}
      <div className="mt-3">
        <FairValueTriple
          bear={latest.fairValueBear}
          base={latest.fairValueBase}
          bull={latest.fairValueBull}
          bearLabel={bearLabel}
          baseLabel={baseLabel}
          bullLabel={bullLabel}
        />
      </div>

      {/* Price-vs-FV bar */}
      {hasFullFvBar && (
        <PriceVsFVBar
          currentPrice={currentPrice!}
          bear={latest.fairValueBear!}
          base={latest.fairValueBase!}
          bull={latest.fairValueBull!}
        />
      )}

      {/* Performance badge */}
      {hasSnapshot && (
        <PerformanceBadge
          priceAtAnalysis={latest.priceAtAnalysis!}
          currentPrice={currentPrice!}
        />
      )}

      {/* Open position */}
      <OpenPositionBadge positions={positions} currentPrice={currentPrice} />

      {/* View report button */}
      <button
        onClick={() => router.push(`/analyses/${latest.id}`)}
        className="mt-3 w-full rounded-lg border border-slate-700/60 py-1.5 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-300 transition text-center"
      >
        View report →
      </button>

      {/* Collapsible older analyses */}
      {older.length > 0 && (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition"
          >
            <span
              className={`inline-block transition-transform duration-150 ${
                historyOpen ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            {olderLabel(older.length)}
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-1.5">
              {older.map((a) => (
                <AnalysisRow
                  key={a.id}
                  analysis={a}
                  onView={() => router.push(`/analyses/${a.id}`)}
                  onDelete={() => onDelete(a.id)}
                  isDeleting={deleting === a.id}
                  bearLabel={bearLabel}
                  baseLabel={baseLabel}
                  bullLabel={bullLabel}
                  deleteLabel={deleteLabel}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnalysesList() {
  const router = useRouter();
  const { t } = useLanguage();
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [positionsByTicker, setPositionsByTicker] = useState<Record<string, Position[]>>({});

  // Filter / sort state
  const [search, setSearch] = useState("");
  const [underFvOnly, setUnderFvOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  useEffect(() => {
    Promise.all([fetchAnalyses(), fetchPositions()])
      .then(([data, posData]) => {
        setAnalyses(data);

        const posMap: Record<string, Position[]> = {};
        for (const p of posData) {
          posMap[p.ticker] = [...(posMap[p.ticker] ?? []), p];
        }
        setPositionsByTicker(posMap);

        // Fetch live prices for all tickers that need a current price:
        // - full FV data available → PriceVsFVBar
        // - priceAtAnalysis saved → PerformanceBadge
        // - open position → OpenPositionBadge
        const tickers = [
          ...new Set([
            ...data
              .filter((a) => a.fairValueBear != null && a.fairValueBase != null && a.fairValueBull != null)
              .map((a) => a.ticker),
            ...data.filter((a) => a.priceAtAnalysis != null).map((a) => a.ticker),
            ...posData.map((p) => p.ticker),
          ]),
        ];
        if (tickers.length > 0) fetchCurrentPrices(tickers);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Failures are silently ignored — price-dependent UI simply won't render.
  async function fetchCurrentPrices(tickers: string[]) {
    const results = await Promise.allSettled(
      tickers.map(async (ticker) => {
        const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        return { ticker, price: data.regularMarketPrice as number };
      })
    );
    const prices: Record<string, number> = {};
    for (const r of results) {
      if (r.status === "fulfilled") prices[r.value.ticker] = r.value.price;
    }
    setCurrentPrices(prices);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError(t("errorFailedDelete"));
    } finally {
      setDeleting(null);
    }
  }

  // Derive visible ticker groups from current state + filters.
  const visibleGroups = useMemo(() => {
    const grouped = groupByTicker(analyses);

    // Filter by search text
    const q = search.trim().toLowerCase();
    const filtered: Array<[string, SavedAnalysis[]]> = [];
    for (const [ticker, group] of grouped) {
      const matchesTicker = ticker.toLowerCase().includes(q);
      const matchesCompany = group[0].companyName.toLowerCase().includes(q);
      if (q && !matchesTicker && !matchesCompany) continue;

      // Filter by Under FV: check if the latest analysis for this ticker is under base FV
      if (underFvOnly) {
        const latest = group[0];
        const price = currentPrices[ticker];
        if (price == null || latest.fairValueBase == null || price >= latest.fairValueBase) {
          continue;
        }
      }

      filtered.push([ticker, group]);
    }

    // Sort groups
    filtered.sort(([tickerA, groupA], [tickerB, groupB]) => {
      if (sortMode === "ticker") return tickerA.localeCompare(tickerB);
      if (sortMode === "performance") {
        const priceA = currentPrices[tickerA];
        const priceB = currentPrices[tickerB];
        const aAt = groupA[0].priceAtAnalysis;
        const bAt = groupB[0].priceAtAnalysis;
        const deltaA = priceA != null && aAt != null ? priceA / aAt : 0;
        const deltaB = priceB != null && bAt != null ? priceB / bAt : 0;
        return deltaB - deltaA;
      }
      // "recent" — latest analysis date desc (already ordered by API, preserve)
      return new Date(groupB[0].createdAt).getTime() - new Date(groupA[0].createdAt).getTime();
    });

    return filtered;
  }, [analyses, search, underFvOnly, sortMode, currentPrices]);

  const olderLabel = (n: number) => {
    const parts = t("olderAnalyses").split("|");
    const word = n === 1 ? (parts[0] ?? t("olderAnalyses")) : (parts[1] ?? t("olderAnalyses"));
    return `${n} ${word}`;
  };

  // ── Loading / error / empty states ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        {t("loadingState")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-danger">{error}</div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 py-16 text-center text-muted">
        <p className="text-lg">{t("noAnalysesYet")}</p>
        <p className="mt-1 text-sm">{t("noAnalysesDesc")}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          {t("goToDashboard")}
        </button>
      </div>
    );
  }

  const totalTickers = groupByTicker(analyses).size;
  const totalAnalyses = analyses.length;

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
        />

        {/* Under FV toggle */}
        <button
          onClick={() => setUnderFvOnly((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            underFvOnly
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
              : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
          }`}
        >
          {t("underFvFilter")}
        </button>

        {/* Sort dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">{t("sortLabel")}</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-xs text-slate-300 focus:border-sky-500/50 focus:outline-none"
          >
            <option value="recent">{t("sortRecent")}</option>
            <option value="ticker">{t("sortTicker")}</option>
            <option value="performance">{t("sortPerformance")}</option>
          </select>
        </div>
      </div>

      {/* Summary count */}
      <p className="text-xs text-slate-600">
        {totalTickers} {t("tickerCountLabel")} · {totalAnalyses} {t("analysesCountLabel")}
      </p>

      {/* Ticker groups */}
      {visibleGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-muted">
          {t("noAnalysesMatchFilter")}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map(([ticker, group]) => (
            <TickerGroup
              key={ticker}
              ticker={ticker}
              analyses={group}
              currentPrice={currentPrices[ticker]}
              positions={positionsByTicker[ticker] ?? []}
              deleting={deleting}
              onDelete={handleDelete}
              bearLabel={t("bearLabel")}
              baseLabel={t("baseLabel")}
              bullLabel={t("bullLabel")}
              deleteLabel={t("deleteBtn")}
              olderLabel={olderLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
