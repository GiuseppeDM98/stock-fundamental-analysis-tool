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

/** Three scenario badges: Bear / Base / Bull. `baseVariant` tints the base card. */
function FairValueTriple({
  bear,
  base,
  bull,
  bearLabel,
  baseLabel,
  bullLabel,
  baseVariant = "default",
}: {
  bear?: number | null;
  base?: number | null;
  bull?: number | null;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
  baseVariant?: "default" | "violet";
}) {
  const dash = "—";
  const baseCard =
    baseVariant === "violet"
      ? "bg-violet-500/10 border-violet-500/20"
      : "bg-slate-700/50 border-slate-600/40";
  const baseTextLabel = baseVariant === "violet" ? "text-violet-400" : "text-slate-400";
  const baseTextValue = baseVariant === "violet" ? "text-violet-200" : "text-slate-100";

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
      <div className={`flex flex-col items-center rounded-lg border px-3 py-2 min-w-[72px] ${baseCard}`}>
        <span className={`text-[10px] font-medium uppercase tracking-wide mb-0.5 ${baseTextLabel}`}>
          {baseLabel}
        </span>
        <span className={`text-sm font-bold ${baseTextValue}`}>
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

type BarVariant = "violet" | "yellow";

// Separate bg-* and text-* classes per variant — Tailwind requires static strings for
// purging. text-* colors the label spans; bg-* colors the tick mark div.
const VARIANT_TICK_BG: Record<BarVariant, string> = {
  violet: "bg-violet-400",
  yellow: "bg-yellow-400",
};
const VARIANT_LABEL_TEXT: Record<BarVariant, string> = {
  violet: "text-violet-400",
  yellow: "text-yellow-400",
};

/**
 * Single horizontal gradient bar showing where `currentPrice` sits in a given
 * bear–bull range, with a reference tick for the base FV and a dot for price.
 * `showPriceLabel` can be set to false on a second bar where the price label
 * would duplicate the value already visible on the bar above.
 */
function FvBar({
  currentPrice,
  bear,
  base,
  bull,
  variant,
  underLabel,
  overLabel,
  showPriceLabel = true,
}: {
  currentPrice: number;
  bear: number;
  base: number;
  bull: number;
  variant: BarVariant;
  underLabel: string;
  overLabel: string;
  showPriceLabel?: boolean;
}) {
  const pct = pricePosition(currentPrice, bear, bull) * 100;
  const basePct = pricePosition(base, bear, bull) * 100;
  const belowBase = currentPrice < base;

  // When price and base labels are within 8 pct-points, move price label below
  // the bar so they don't overlap — base label stays above, price goes below.
  // tooClose only matters when we're showing the price label.
  const tooClose = showPriceLabel && Math.abs(pct - basePct) < 8;

  const tickBg = VARIANT_TICK_BG[variant];
  const labelText = VARIANT_LABEL_TEXT[variant];

  return (
    <div>
      {/* Labels above the bar */}
      <div
        className="relative mb-1"
        style={{ height: !showPriceLabel || tooClose ? "1.5rem" : "2.5rem" }}
      >
        {/* Base FV label */}
        <div
          className="absolute -translate-x-1/2 flex flex-col items-center pointer-events-none"
          style={{ left: `clamp(12px, ${basePct}%, calc(100% - 12px))` }}
        >
          <span className={`text-[9px] whitespace-nowrap leading-none ${labelText} opacity-70`}>Base</span>
          <span className={`text-[10px] font-medium whitespace-nowrap leading-none ${labelText}`}>
            {formatPrice(base)}
          </span>
          <span className={`text-[8px] leading-none ${labelText} opacity-60`}>▼</span>
        </div>

        {/* Current price label — above bar, only when shown and labels won't overlap */}
        {showPriceLabel && !tooClose && (
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

      {/* Gradient track */}
      <div className="relative h-2 rounded-full overflow-visible bg-gradient-to-r from-red-500/70 via-yellow-500/60 to-emerald-500/70">
        {/* Base FV tick — uses bg-* so the div itself is colored */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 rounded-full opacity-60 ${tickBg}`}
          style={{ left: `${basePct}%` }}
        />
        {/* Current price dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-slate-900 bg-white shadow"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Price label below — only when shown and it would overlap the base label above */}
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

      {/* Bear / status badge / Bull footer */}
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-[10px] text-red-400 font-medium">{formatPrice(bear)}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            belowBase
              ? "bg-emerald-500/15 text-success"
              : "bg-slate-700/60 text-slate-400"
          }`}
        >
          {belowBase ? underLabel : overLabel}
        </span>
        <span className="text-[10px] text-emerald-400 font-medium">{formatPrice(bull)}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal bar(s) showing where the current price sits relative to fair values.
 * When mosPercent > 0, renders two stacked bars: intrinsic value (top) and
 * MoS-adjusted buy target (bottom). When MoS is 0 or no intrinsic values are
 * provided, renders a single bar using the stored (buy target) values.
 */
function PriceVsFVBar({
  currentPrice,
  bear,
  base,
  bull,
  intrinsicBear,
  intrinsicBase,
  intrinsicBull,
  mosPercent,
  intrinsicBarLabel,
  buyTargetBarLabel,
  aboveIntrinsicFv,
  underIntrinsicFv,
  aboveBuyTarget,
  underBuyTarget,
  aboveFv,
  underFv,
}: {
  currentPrice: number;
  bear: number;
  base: number;
  bull: number;
  intrinsicBear?: number;
  intrinsicBase?: number;
  intrinsicBull?: number;
  mosPercent?: number;
  intrinsicBarLabel: string;
  buyTargetBarLabel: string;
  aboveIntrinsicFv: string;
  underIntrinsicFv: string;
  aboveBuyTarget: string;
  underBuyTarget: string;
  aboveFv: string;
  underFv: string;
}) {
  const showDual =
    mosPercent != null && mosPercent > 0 &&
    intrinsicBear != null && intrinsicBase != null && intrinsicBull != null;

  if (showDual) {
    return (
      <div className="mt-3">
        {/* Intrinsic value bar — shows price label and value */}
        <p className="mb-1.5 text-[10px] font-semibold text-violet-400/70 uppercase tracking-wider">
          {intrinsicBarLabel}
        </p>
        <FvBar
          currentPrice={currentPrice}
          bear={intrinsicBear!}
          base={intrinsicBase!}
          bull={intrinsicBull!}
          variant="violet"
          underLabel={underIntrinsicFv}
          overLabel={aboveIntrinsicFv}
          showPriceLabel={true}
        />

        {/* Thin rule separating the two bar contexts */}
        <div className="my-3 border-t border-slate-800/60" />

        {/* Buy target bar — price dot visible, label suppressed (same value shown above) */}
        <p className="mb-1.5 text-[10px] font-semibold text-yellow-400/70 uppercase tracking-wider">
          {buyTargetBarLabel} · MoS {mosPercent}%
        </p>
        <FvBar
          currentPrice={currentPrice}
          bear={bear}
          base={base}
          bull={bull}
          variant="yellow"
          underLabel={underBuyTarget}
          overLabel={aboveBuyTarget}
          showPriceLabel={true}
        />
      </div>
    );
  }

  return (
    <div className="mt-3">
      <FvBar
        currentPrice={currentPrice}
        bear={bear}
        base={base}
        bull={bull}
        variant="yellow"
        underLabel={underFv}
        overLabel={aboveFv}
      />
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
          className="tap rounded px-2 py-1 text-xs text-accent border border-slate-700 hover:border-sky-400/40 transition"
        >
          →
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="tap rounded px-2 py-1 text-xs text-muted border border-slate-700 hover:border-red-500/50 hover:text-danger transition disabled:opacity-50"
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
  reviewedLabel,
  olderLabel,
  intrinsicBarLabel,
  buyTargetBarLabel,
  aboveIntrinsicFv,
  underIntrinsicFv,
  aboveBuyTarget,
  underBuyTarget,
  aboveFv,
  underFv,
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
  reviewedLabel: string;
  olderLabel: (n: number) => string;
  intrinsicBarLabel: string;
  buyTargetBarLabel: string;
  aboveIntrinsicFv: string;
  underIntrinsicFv: string;
  aboveBuyTarget: string;
  underBuyTarget: string;
  aboveFv: string;
  underFv: string;
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

  // Reconstruct intrinsic values from buy targets when MoS > 0.
  // Stored fairValues are already buy targets: intrinsic = stored / (1 - mos).
  const mos = (latest.mosPercent ?? 0) / 100;
  const intrinsicBear = mos > 0 && latest.fairValueBear != null ? latest.fairValueBear / (1 - mos) : undefined;
  const intrinsicBase = mos > 0 && latest.fairValueBase != null ? latest.fairValueBase / (1 - mos) : undefined;
  const intrinsicBull = mos > 0 && latest.fairValueBull != null ? latest.fairValueBull / (1 - mos) : undefined;

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
          {/* Marks tickers whose latest analysis carries an Analyst Review. */}
          {latest.reviewMd && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 shrink-0">
              ✓ {reviewedLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => { window.location.href = `/analyze?ticker=${encodeURIComponent(ticker)}`; }}
            className="tap rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-accent hover:border-sky-400/40 hover:text-sky-300 transition"
          >
            Re-run
          </button>
          {/* Delete the latest/only analysis — the collapsible history below only covers older ones,
              so without this the single most-recent analysis (and a ticker's sole analysis) can't be removed. */}
          <button
            onClick={() => onDelete(latest.id)}
            disabled={deleting === latest.id}
            aria-label={deleteLabel}
            className="tap rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-muted hover:border-red-500/50 hover:text-danger transition disabled:opacity-50"
          >
            {deleting === latest.id ? "…" : deleteLabel}
          </button>
        </div>
      </div>

      {/* Latest analysis metadata */}
      <p className="mt-1 text-xs text-slate-500">
        {formatDate(latest.createdAt)}
        {latest.mosPercent > 0 && ` · MoS ${latest.mosPercent}%`}
      </p>

      {/* Fair value cards — dual section when MoS > 0 */}
      <div className="mt-3">
        {mos > 0 && intrinsicBear != null && intrinsicBase != null && intrinsicBull != null ? (
          <div className="space-y-2.5">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold text-violet-400/70 uppercase tracking-wider">
                {intrinsicBarLabel}
              </p>
              <FairValueTriple
                bear={intrinsicBear}
                base={intrinsicBase}
                bull={intrinsicBull}
                bearLabel={bearLabel}
                baseLabel={baseLabel}
                bullLabel={bullLabel}
                baseVariant="violet"
              />
            </div>
            <div className="border-t border-slate-800/60" />
            <div>
              <p className="mb-1.5 text-[10px] font-semibold text-yellow-400/70 uppercase tracking-wider">
                {buyTargetBarLabel} · MoS {latest.mosPercent}%
              </p>
              <FairValueTriple
                bear={latest.fairValueBear}
                base={latest.fairValueBase}
                bull={latest.fairValueBull}
                bearLabel={bearLabel}
                baseLabel={baseLabel}
                bullLabel={bullLabel}
              />
            </div>
          </div>
        ) : (
          <FairValueTriple
            bear={latest.fairValueBear}
            base={latest.fairValueBase}
            bull={latest.fairValueBull}
            bearLabel={bearLabel}
            baseLabel={baseLabel}
            bullLabel={bullLabel}
          />
        )}
      </div>

      {/* Price-vs-FV bar */}
      {hasFullFvBar && (
        <PriceVsFVBar
          currentPrice={currentPrice!}
          bear={latest.fairValueBear!}
          base={latest.fairValueBase!}
          bull={latest.fairValueBull!}
          intrinsicBear={intrinsicBear}
          intrinsicBase={intrinsicBase}
          intrinsicBull={intrinsicBull}
          mosPercent={latest.mosPercent}
          intrinsicBarLabel={intrinsicBarLabel}
          buyTargetBarLabel={buyTargetBarLabel}
          aboveIntrinsicFv={aboveIntrinsicFv}
          underIntrinsicFv={underIntrinsicFv}
          aboveBuyTarget={aboveBuyTarget}
          underBuyTarget={underBuyTarget}
          aboveFv={aboveFv}
          underFv={underFv}
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
          onClick={() => router.push("/advisor")}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          {t("hubPrimaryCta")}
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
          className={`tap rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
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
            className="tap rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-xs text-slate-300 focus:border-sky-500/50 focus:outline-none"
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
              reviewedLabel={t("analystReviewBadge")}
              olderLabel={olderLabel}
              intrinsicBarLabel={t("intrinsicBarLabel")}
              buyTargetBarLabel={t("buyTargetBarLabel")}
              aboveIntrinsicFv={t("aboveIntrinsicFv")}
              underIntrinsicFv={t("underIntrinsicFv")}
              aboveBuyTarget={t("aboveBuyTarget")}
              underBuyTarget={t("underBuyTarget")}
              aboveFv={t("aboveFv")}
              underFv={t("underFv")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
