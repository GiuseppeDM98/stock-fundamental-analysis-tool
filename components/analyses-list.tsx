"use client";

// Client component for the saved analyses page.
// Analyses are grouped by ticker. Each ticker is a card that is compact by default
// (ticker, live price, buy/watch verdict, mini valuation ruler) and expands to a full
// valuation ruler (one bear→bull axis carrying price, buy zone, analysis FV, reviewer
// FV and consensus), a compact Analysis/Reviewer/Consensus table, P&L metadata, and a
// collapsible history of older saves for the same ticker.
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyses, deleteAnalysis } from "@/lib/analyses";
import { fetchPositions } from "@/lib/portfolio";
import type { SavedAnalysis, AnalystAngle } from "@/types/analysis";
import type { Position } from "@/types/portfolio";
import { useLanguage } from "@/context/language-context";
import { ValuationRuler, ComparisonTable } from "@/components/report/valuation-ruler";
import { getVerdict, VERDICT_BADGE, VERDICT_TEXT, type Verdict } from "@/lib/report/verdict";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { presentAnalysts, consensusTriple } from "@/lib/report/consensus";
import { computeEvolution, type Evolution, type SourceDelta } from "@/lib/report/evolution";
import { EarningsBadge } from "@/components/earnings-badge";
import { isAnalysisStalePreEarnings, isFutureEarnings, formatEarningsDate } from "@/lib/earnings";
import { fetchEarnings, refreshEarnings } from "@/lib/earnings-client";
import type { EarningsEstimate } from "@/types/earnings";

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

type SortMode = "recent" | "ticker" | "performance";

// ─── Metadata badges ─────────────────────────────────────────────────────────

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
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">
        {formatPrice(priceAtAnalysis)} → {formatPrice(currentPrice)}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
          isPositive ? "bg-emerald-500/15 text-success" : "bg-red-500/15 text-danger"
        }`}
      >
        {isPositive ? "+" : ""}
        {delta.toFixed(1)}%
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
    <div className="mt-1 flex flex-wrap items-center gap-2">
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
          ({isPositive ? "+" : ""}
          {returnPct!.toFixed(1)}%)
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/40 bg-slate-800/50 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="shrink-0 text-slate-500">{formatDate(analysis.createdAt)}</span>
        <span className="shrink-0 text-red-400 tabular-nums">{bearLabel} {fmtFv(analysis.fairValueBear)}</span>
        <span className="shrink-0 text-slate-300 tabular-nums">{baseLabel} {fmtFv(analysis.fairValueBase)}</span>
        <span className="shrink-0 text-emerald-400 tabular-nums">{bullLabel} {fmtFv(analysis.fairValueBull)}</span>
        {analysis.mosPercent > 0 && (
          <span className="shrink-0 text-slate-600">MoS {analysis.mosPercent}%</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={onView}
          className="tap rounded border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40"
        >
          →
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="tap rounded border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
        >
          {isDeleting ? "…" : deleteLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Ticker card ─────────────────────────────────────────────────────────────

/** A single ticker: compact by default, expands to the full valuation ruler + table. */
// Static badge classes for the evolution %Δ — kept as a lookup so Tailwind's purge
// can see them (runtime-built class strings get stripped). Near-zero moves stay neutral.
function deltaBadgeClass(pctDelta: number): string {
  if (pctDelta > 0.0005) return "bg-emerald-500/15 text-success";
  if (pctDelta < -0.0005) return "bg-red-500/15 text-danger";
  // Near-zero move: plain (uncolored) chip — avoids washed-out gray-on-tint.
  return "text-slate-400";
}

/**
 * Deterministic estimate-evolution diff for a ticker (base scenario, intrinsic scale).
 * Purely presentational — the numbers come from computeEvolution and never touch an
 * AI prompt; this only lets the user see how the thesis moved vs. the previous save.
 */
function EvolutionDiff({
  evolution,
  title,
  labels,
}: {
  evolution: Evolution;
  title: string;
  labels: { analysis: string; consensus: string };
}) {
  const rows: { label: string; delta: SourceDelta }[] = [
    { label: labels.analysis, delta: evolution.base },
    ...(evolution.consensus ? [{ label: labels.consensus, delta: evolution.consensus }] : []),
  ];

  return (
    <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title} {formatDate(evolution.prevDate)}
      </p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">{row.label}</span>
            <span className="flex items-center gap-1.5 font-mono text-slate-300">
              {row.delta.prev.toFixed(2)} → {row.delta.curr.toFixed(2)}
              <span className={`rounded px-1.5 py-0.5 font-sans font-semibold ${deltaBadgeClass(row.delta.pctDelta)}`}>
                {row.delta.pctDelta >= 0 ? "+" : ""}
                {(row.delta.pctDelta * 100).toFixed(1)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TickerGroup({
  ticker,
  analyses,
  currentPrice,
  earnings,
  refreshingEarnings,
  onRefreshEarnings,
  positions,
  deleting,
  onDelete,
  olderLabel,
}: {
  ticker: string;
  analyses: SavedAnalysis[];
  currentPrice?: number;
  earnings?: EarningsEstimate;
  refreshingEarnings: boolean;
  onRefreshEarnings: (ticker: string, companyName: string) => void;
  positions: Position[];
  deleting: string | null;
  onDelete: (id: string) => void;
  olderLabel: (n: number) => string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  // Display name for each analyst lens (closes over t, so defined in the component body).
  const analystLabel = (angle: AnalystAngle) =>
    angle === "skeptic" ? t("analystSkeptic") : angle === "optimist" ? t("analystOptimist") : t("analystQuality");
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Shared level for the ruler + table: fair value (intrinsic) vs MoS-adjusted buy target.
  const [level, setLevel] = useState<"intrinsic" | "buyTarget">("intrinsic");

  const latest = analyses[0];
  const older = analyses.slice(1);
  const mos = (latest.mosPercent ?? 0) / 100;

  // Nudge to re-run when a fresh quarter has likely been reported since the latest save.
  const earningsStale = isAnalysisStalePreEarnings(latest.createdAt, earnings?.nextEarningsDate ?? null);
  // Only a genuinely future date is a real "next earnings" — display that; the stale pill
  // covers the case where the AI could only find a just-passed report.
  const futureEarningsDate = isFutureEarnings(earnings?.nextEarningsDate ?? null)
    ? earnings!.nextEarningsDate
    : null;

  // Deterministic evolution of the estimate vs. the previous saved analysis (base
  // scenario). Null when there's no prior save or no comparable base value — never
  // fed to an AI prompt, purely a display of how the thesis moved over time.
  const evolution = older.length > 0 ? computeEvolution(older[0], latest) : null;

  const hasFV =
    latest.fairValueBear != null && latest.fairValueBase != null && latest.fairValueBull != null;
  // Analyst-panel opinions present on the latest save, and their consensus with the base.
  const presentAn = presentAnalysts(latest);
  const consensusT = consensusTriple(latest);
  const hasSnapshot = latest.priceAtAnalysis != null && currentPrice != null;

  // Stored fairValues are MoS-adjusted buy targets; intrinsic = target / (1 - mos).
  const grossUp = (v: number) => grossUpToIntrinsic(v, mos);

  // Everything below is only meaningful when the latest analysis carries fair values.
  const ruler = hasFV
    ? {
        buyTargetBase: latest.fairValueBase!,
        intrinsicBase: grossUp(latest.fairValueBase!),
        min: grossUp(latest.fairValueBear!),
        max: grossUp(latest.fairValueBull!),
      }
    : null;

  const verdict =
    ruler && currentPrice != null
      ? getVerdict(currentPrice, ruler.buyTargetBase, ruler.intrinsicBase)
      : null;
  // Distance of the price from the buy target (the actionable reference).
  const buyTargetPct =
    ruler && currentPrice != null
      ? ((currentPrice - ruler.buyTargetBase) / ruler.buyTargetBase) * 100
      : null;

  const verdictLabel = (v: Verdict) =>
    v === "buy" ? t("verdictBuy") : v === "watch" ? t("verdictWatch") : t("verdictOver");

  // Ruler marks, projected to the selected level (FV = intrinsic, or MoS-adjusted buy
  // target). The axis + zones stay on the intrinsic scale; only the marks/values move.
  const project = (v: number) => (level === "intrinsic" && mos > 0 ? grossUp(v) : v);
  const markers = ruler
    ? {
        analysisLabel: level === "intrinsic" ? t("fvShort") : t("buyTargetBarLabel"),
        analysis: project(latest.fairValueBase!),
        analysts: presentAn.map(({ angle, triple }) => ({
          key: angle,
          label: analystLabel(angle),
          value: project(triple.base),
        })),
        consensusLabel: t("consensusLabel"),
        consensus: consensusT ? project(consensusT.base) : undefined,
      }
    : null;

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-base font-bold text-accent">{ticker}</span>
            <span className="truncate text-sm text-slate-400">{latest.companyName}</span>
            {latest.valuationMethod && (
              <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {latest.valuationMethod}
              </span>
            )}
            {(latest.reviewMd || latest.optimistCritiqueMd || latest.qualityCritiqueMd) && (
              <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                ✓ {t("analystReviewBadge")}
              </span>
            )}
          </div>

          {/* Collapsed summary: price + verdict at a glance */}
          {!expanded && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {currentPrice != null ? (
                <span className="tabular-nums text-slate-300">{formatPrice(currentPrice)}</span>
              ) : (
                <span className="text-slate-600">{t("priceNa")}</span>
              )}
              {verdict && buyTargetPct != null && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_BADGE[verdict]}`}>
                  {verdictLabel(verdict)} {buyTargetPct > 0 ? "+" : ""}
                  {buyTargetPct.toFixed(0)}%
                </span>
              )}
            </div>
          )}

          {/* Expanded meta */}
          {expanded && (
            <p className="mt-1 text-xs text-slate-500">
              {formatDate(latest.createdAt)}
              {latest.mosPercent > 0 && ` · MoS ${latest.mosPercent}%`}
            </p>
          )}
        </button>

        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <span className={`inline-block transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>

      {/* Next-earnings row (AI-fetched). Sits outside the header toggle button so its own
          refresh button isn't a nested interactive element. Amber pill nudges a re-run. */}
      <div className="mt-1.5">
        <EarningsBadge
          nextEarningsDate={futureEarningsDate}
          confidence={earnings?.confidence ?? null}
          fetchedAt={earnings?.fetchedAt ?? null}
          stale={earningsStale}
          refreshing={refreshingEarnings}
          onRefresh={() => onRefreshEarnings(ticker, latest.companyName)}
        />
      </div>

      {/* Collapsed mini ruler */}
      {!expanded && ruler && (
        <div className="mt-2">
          <ValuationRuler
            compact
            min={ruler.min}
            max={ruler.max}
            price={currentPrice}
            buyTargetEdge={ruler.buyTargetBase}
            fvEdge={ruler.intrinsicBase}
            priceLabel={t("priceShort")}
          />
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="mt-3">
          {ruler ? (
            <>
              {/* Verdict line */}
              {verdict && buyTargetPct != null && (
                <p className="mb-3 text-xs">
                  <span className={`font-semibold ${VERDICT_TEXT[verdict]}`}>{verdictLabel(verdict)}</span>
                  <span className="text-slate-400">
                    {" · "}
                    {Math.abs(buyTargetPct).toFixed(0)}%{" "}
                    {buyTargetPct <= 0 ? t("belowBuyTargetPhrase") : t("aboveBuyTargetPhrase")}
                  </span>
                </p>
              )}

              <ValuationRuler
                min={ruler.min}
                max={ruler.max}
                price={currentPrice}
                buyTargetEdge={ruler.buyTargetBase}
                fvEdge={ruler.intrinsicBase}
                markers={markers ?? undefined}
                priceLabel={t("priceShort")}
              />

              {/* Level toggle — drives both the ruler marks and the table (only when a
                  margin of safety separates intrinsic value from the buy target). */}
              {mos > 0 && (
                <div className="mt-3 inline-flex rounded-md border border-slate-700 p-0.5 text-[11px]">
                  {(["intrinsic", "buyTarget"] as const).map((lv) => (
                    <button
                      key={lv}
                      onClick={() => setLevel(lv)}
                      aria-pressed={level === lv}
                      className={`tap rounded px-2 py-0.5 transition ${
                        level === lv ? "bg-sky-500/15 text-sky-300" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {lv === "intrinsic" ? t("intrinsicBarLabel") : t("buyTargetBarLabel")}
                    </button>
                  ))}
                </div>
              )}

              <ComparisonTable
                analysis={{ bear: latest.fairValueBear!, base: latest.fairValueBase!, bull: latest.fairValueBull! }}
                analysts={presentAn.map(({ angle, triple }) => ({
                  key: angle,
                  label: analystLabel(angle),
                  triple,
                }))}
                consensus={consensusT ?? undefined}
                mos={mos}
                level={level}
                labels={{
                  analysis: t("analysisLabel"),
                  consensus: t("consensusLabel"),
                  bear: t("bearLabel"),
                  base: t("baseLabel"),
                  bull: t("bullLabel"),
                }}
              />
            </>
          ) : (
            <p className="text-xs text-slate-500">{t("noValuationData")}</p>
          )}

          {/* Estimate evolution vs the previous saved analysis — deterministic, no AI */}
          {evolution && (
            <EvolutionDiff
              evolution={evolution}
              title={t("evolutionTitle")}
              labels={{
                analysis: t("analysisLabel"),
                consensus: t("consensusLabel"),
              }}
            />
          )}

          {/* Metadata: performance + open position */}
          {hasSnapshot && (
            <PerformanceBadge priceAtAnalysis={latest.priceAtAnalysis!} currentPrice={currentPrice!} />
          )}
          <OpenPositionBadge positions={positions} currentPrice={currentPrice} />

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push(`/analyses/${latest.id}`)}
              className="tap rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:brightness-110"
            >
              {t("viewReportBtn")} →
            </button>
            <button
              onClick={() => {
                window.location.href = `/analyze?ticker=${encodeURIComponent(ticker)}`;
              }}
              className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
            >
              {t("reAnalyzeBtn")}
            </button>
            <button
              onClick={() => onDelete(latest.id)}
              disabled={deleting === latest.id}
              className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
            >
              {deleting === latest.id ? "…" : t("deleteBtn")}
            </button>
          </div>

          {/* Collapsible older analyses */}
          {older.length > 0 && (
            <div className="mt-3 border-t border-slate-700/50 pt-3">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-300"
              >
                <span className={`inline-block transition-transform duration-150 ${historyOpen ? "rotate-90" : ""}`}>▶</span>
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
                      bearLabel={t("bearLabel")}
                      baseLabel={t("baseLabel")}
                      bullLabel={t("bullLabel")}
                      deleteLabel={t("deleteBtn")}
                    />
                  ))}
                </div>
              )}
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
  const { t, locale } = useLanguage();
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  // AI-fetched next-earnings estimates per ticker, loaded once from the DB store.
  const [earningsByTicker, setEarningsByTicker] = useState<Record<string, EarningsEstimate>>({});
  // Per-ticker in-flight flag for the "refresh via AI" button.
  const [refreshingEarnings, setRefreshingEarnings] = useState<Record<string, boolean>>({});
  const [positionsByTicker, setPositionsByTicker] = useState<Record<string, Position[]>>({});

  // Filter / sort state
  const [search, setSearch] = useState("");
  const [underFvOnly, setUnderFvOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  useEffect(() => {
    // Earnings estimates load independently — a failure there must not block the list.
    fetchEarnings()
      .then((estimates) => {
        const map: Record<string, EarningsEstimate> = {};
        for (const e of estimates) map[e.ticker] = e;
        setEarningsByTicker(map);
      })
      .catch(() => {});

    Promise.all([fetchAnalyses(), fetchPositions()])
      .then(([data, posData]) => {
        setAnalyses(data);

        const posMap: Record<string, Position[]> = {};
        for (const p of posData) {
          posMap[p.ticker] = [...(posMap[p.ticker] ?? []), p];
        }
        setPositionsByTicker(posMap);

        // Fetch live prices for all tickers that need a current price:
        // - full FV data available → valuation ruler
        // - priceAtAnalysis saved → performance badge
        // - open position → position badge
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

  // Run the AI earnings lookup for one ticker (~10–30s) and store the fresh estimate.
  async function handleRefreshEarnings(ticker: string, companyName: string) {
    setRefreshingEarnings((prev) => ({ ...prev, [ticker]: true }));
    try {
      const estimate = await refreshEarnings(ticker, companyName);
      setEarningsByTicker((prev) => ({ ...prev, [ticker]: estimate }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorFailedSave"));
    } finally {
      setRefreshingEarnings((prev) => ({ ...prev, [ticker]: false }));
    }
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

  // Upcoming-earnings calendar: one entry per analyzed ticker that has a future AI-fetched
  // date, sorted nearest-first, with the per-ticker stale flag from its latest analysis.
  const upcomingEarnings = useMemo(() => {
    const latestByTicker = groupByTicker(analyses); // group[0] = latest save per ticker
    const rows: Array<{ ticker: string; date: string; estimate: boolean; stale: boolean }> = [];
    for (const [ticker, group] of latestByTicker) {
      const info = earningsByTicker[ticker];
      if (!info?.nextEarningsDate || !isFutureEarnings(info.nextEarningsDate)) continue;
      rows.push({
        ticker,
        date: info.nextEarningsDate,
        estimate: info.confidence !== "confirmed",
        stale: isAnalysisStalePreEarnings(group[0].createdAt, info.nextEarningsDate),
      });
    }
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return rows;
  }, [analyses, earningsByTicker]);

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
          className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
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

      {/* Upcoming-earnings calendar strip — nearest first, amber when the analysis is stale */}
      {upcomingEarnings.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-800/30 px-3 py-2.5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("upcomingEarnings")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {upcomingEarnings.map((e) => (
              <span
                key={e.ticker}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  e.stale
                    ? "bg-amber-500/15 font-medium text-amber-400"
                    : "bg-slate-700/50 text-slate-300"
                }`}
              >
                <span className="font-mono font-semibold">{e.ticker}</span>
                <span className="text-slate-500">·</span>
                <span className="tabular-nums">
                  {e.estimate ? "~" : ""}
                  {formatEarningsDate(e.date, locale)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

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
              earnings={earningsByTicker[ticker]}
              refreshingEarnings={refreshingEarnings[ticker] ?? false}
              onRefreshEarnings={handleRefreshEarnings}
              positions={positionsByTicker[ticker] ?? []}
              deleting={deleting}
              onDelete={handleDelete}
              olderLabel={olderLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
