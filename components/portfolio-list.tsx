"use client";

// Portfolio tracker — shows user's stock positions with live P&L.
// Fetches current prices for all unique tickers on mount.
// Summary bar converts all positions to EUR via frankfurter.app (free, no key needed).
import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
  fetchPositions,
  createPosition,
  deletePosition,
  closePosition,
  fetchSnapshots,
} from "@/lib/portfolio";
import { fetchAnalyses } from "@/lib/analyses";
import { realizedPnlNative, holdingDays, estimateCapitalGainsTax } from "@/lib/portfolio-math";
import type {
  Position,
  CreatePositionRequest,
  ClosePositionRequest,
  AggregatedPosition,
} from "@/types/portfolio";
import type { SavedAnalysis } from "@/types/analysis";
import { useLanguage } from "@/context/language-context";
import { EarningsBadge } from "@/components/earnings-badge";
import { isFutureEarnings } from "@/lib/earnings";
import { fetchEarnings, refreshEarnings } from "@/lib/earnings-client";
import type { EarningsEstimate } from "@/types/earnings";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK"];

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatAmount(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(price);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregateByTicker(positions: Position[]): AggregatedPosition[] {
  const map = new Map<string, Position[]>();
  for (const p of positions) {
    map.set(p.ticker, [...(map.get(p.ticker) ?? []), p]);
  }
  return [...map.entries()].map(([ticker, purchases]) => {
    const sorted = [...purchases].sort(
      (a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime()
    );
    const totalShares = sorted.reduce((s, p) => s + p.shares, 0);
    const totalCost = sorted.reduce((s, p) => s + p.purchasePrice * p.shares, 0);
    return {
      ticker,
      companyName: sorted[0].companyName,
      currency: sorted[0].currency,
      totalShares,
      weightedAvgCost: totalCost / totalShares,
      totalCost,
      purchases: sorted,
      capitalGainsTaxRate: sorted[0].capitalGainsTaxRate ?? null,
    };
  });
}

// ─── Exit signal detection ────────────────────────────────────────────────────

// A value investor's margin of safety is exhausted when price reaches fair value base.
// Returns the signal state based on the most recent analysis with a fairValueBase.
// Comparison is against the intrinsic base fair value (before MoS discount), not the
// stored buy target — otherwise the alert fires at the entry price, not the exit target.
function getExitSignal(
  currentPrice: number | undefined,
  analyses: SavedAnalysis[]
): { triggered: boolean; fairValueBase: number | null } {
  const latest = analyses.find((a) => a.fairValueBase != null);
  if (!latest || currentPrice == null) return { triggered: false, fairValueBase: null };
  const mos = (latest.mosPercent ?? 0) / 100;
  const intrinsicBase = mos > 0 ? latest.fairValueBase! / (1 - mos) : latest.fairValueBase!;
  return {
    triggered: currentPrice >= intrinsicBase,
    fairValueBase: intrinsicBase,
  };
}

// ─── Shared input class ───────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30";

// ─── Ticker Analyses Inline ───────────────────────────────────────────────────

// Collapsible list of saved analyses for a ticker, shown inside each portfolio row.
// When the current price has reached the base fair value of the most recent analysis,
// an exit signal banner is shown inside the collapse prompting a review.
function TickerAnalysesInline({
  analyses,
  ticker,
  currentPrice,
}: {
  analyses: SavedAnalysis[];
  ticker: string;
  currentPrice?: number;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  if (analyses.length === 0) return null;

  const exitSignal = getExitSignal(currentPrice, analyses);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-sky-400 hover:text-sky-300 transition"
      >
        {analyses.length} {analyses.length === 1 ? t("savedAnalysisSingular") : t("savedAnalysisPlural")}{" "}
        {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1">
          {exitSignal.triggered && (
            <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-300">
                {t("exitSignalReviewReached")}
                {exitSignal.fairValueBase != null && (
                  <span className="ml-1 font-mono">({exitSignal.fairValueBase.toFixed(2)})</span>
                )}
                {". "}{t("exitSignalReviewConsider")}
              </p>
              <button
                onClick={() => {
                  // Re-analyze always means a clean, position-blind Deep Value run —
                  // no WAC/prevFv is passed, so the new valuation stays independent.
                  // Hold/exit reasoning is done afterwards in the Advisor.
                  window.location.href = `/analyze?ticker=${encodeURIComponent(ticker)}`;
                }}
                className="mt-1.5 rounded border border-amber-500/40 px-2 py-0.5 text-xs text-amber-400 transition hover:border-amber-400 hover:text-amber-300"
              >
                {t("exitSignalCta")} →
              </button>
            </div>
          )}
          <ul className="space-y-1 pl-2 border-l border-slate-700">
            {analyses.map((a) => (
              <li key={a.id} className="text-xs text-slate-400">
                <a
                  href={`/analyses/${a.id}`}
                  className="hover:text-slate-200 transition"
                >
                  {formatDate(a.createdAt)} · MoS {a.mosPercent}%
                  {a.fairValueBase != null && (
                    a.mosPercent > 0
                      ? ` · Buy Target ${a.fairValueBase.toFixed(2)} · FV ${(a.fairValueBase / (1 - a.mosPercent / 100)).toFixed(2)}`
                      : ` · FV base ${a.fairValueBase.toFixed(2)}`
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Aggregated Position Row ──────────────────────────────────────────────────

type DailyChange = { change: number; changePct: number };

type AggregatedPositionRowProps = {
  agg: AggregatedPosition;
  currentPrice?: number;
  dailyChange?: DailyChange;
  earnings?: EarningsEstimate;
  refreshingEarnings?: boolean;
  onRefreshEarnings: (ticker: string, companyName: string) => void;
  onDelete: (id: string) => void;
  onClose: (position: Position) => void;
  onAddPurchase: (agg: AggregatedPosition) => void;
  deleting: string | null;
  pricesLoading: boolean;
  tickerAnalyses: SavedAnalysis[];
};

function AggregatedPositionRow({
  agg,
  currentPrice,
  dailyChange,
  earnings,
  refreshingEarnings,
  onRefreshEarnings,
  onDelete,
  onClose,
  onAddPurchase,
  deleting,
  pricesLoading,
  tickerAnalyses,
}: AggregatedPositionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const currentValue = currentPrice != null ? currentPrice * agg.totalShares : null;
  const pnl = currentValue != null ? currentValue - agg.totalCost : null;
  const returnPct = pnl != null ? (currentValue! / agg.totalCost - 1) * 100 : null;
  const isPositive = pnl != null && pnl >= 0;
  const hasMultiple = agg.purchases.length > 1;
  const taxAmount = pnl != null ? estimateCapitalGainsTax(pnl, agg.capitalGainsTaxRate) : 0;
  const hasTax = taxAmount > 0;
  const netPnl = hasTax ? pnl! - taxAmount : null;
  const exitSignal = getExitSignal(currentPrice, tickerAnalyses);

  return (
    <li className="card">
      {/* Summary row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/analyze?ticker=${encodeURIComponent(agg.ticker)}`}
              className="font-mono text-sm font-bold text-accent hover:text-sky-300"
            >
              {agg.ticker}
            </a>
            <span className="text-xs text-muted">{agg.companyName}</span>
            <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-400">
              {agg.currency}
            </span>
            {hasMultiple && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition"
              >
                {expanded ? "▲" : "▼"} {agg.purchases.length} {t("purchases")}
              </button>
            )}
            {!hasMultiple && (
              <span className="ml-auto text-xs text-muted">
                {formatDate(agg.purchases[0].purchasedAt)}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted">
              {agg.totalShares} {t("sharesUnit")} · WAC {formatPrice(agg.weightedAvgCost, agg.currency)}
            </span>
            {currentPrice != null ? (
              <>
                <span className="text-slate-600">→</span>
                <span className="text-slate-200">{formatPrice(currentPrice, agg.currency)}</span>
                {dailyChange != null && (
                  <span className={`text-[11px] ${dailyChange.changePct >= 0 ? "text-success" : "text-danger"}`}>
                    {dailyChange.changePct >= 0 ? "▲" : "▼"}{" "}
                    {dailyChange.changePct >= 0 ? "+" : ""}{dailyChange.changePct.toFixed(2)}%{" "}
                    {t("dailyChange")}
                  </span>
                )}
              </>
            ) : pricesLoading ? (
              <>
                <span className="text-slate-600">→</span>
                <span className="text-slate-600">{t("loadingState")}</span>
              </>
            ) : null}
            {pnl != null && (
              <span
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  isPositive
                    ? "bg-emerald-500/15 text-success"
                    : "bg-red-500/15 text-danger"
                }`}
              >
                {isPositive ? "+" : ""}{formatAmount(pnl, agg.currency)}{" "}
                ({isPositive ? "+" : ""}{returnPct!.toFixed(1)}%)
              </span>
            )}
            {exitSignal.triggered && (
              <>
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-400">
                  ⚠ {t("exitSignalBadge")}
                </span>
                <button
                  onClick={() => {
                    // Clean, position-blind re-analysis (see TickerAnalysesInline).
                    window.location.href = `/analyze?ticker=${encodeURIComponent(agg.ticker)}`;
                  }}
                  className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[11px] text-amber-400 transition hover:border-amber-400 hover:text-amber-300"
                >
                  {t("exitSignalCta")} →
                </button>
              </>
            )}
          </div>

          {hasTax && (
            <div className="mt-1 text-[11px] text-slate-500">
              {t("estimatedTax")} {formatAmount(-taxAmount, agg.currency)} · {t("netPnl")}{" "}
              <span className="text-success">+{formatAmount(netPnl!, agg.currency)}</span>
            </div>
          )}

          {/* Next-earnings date for this holding (AI-fetched, via the badge's button). No
              stale nudge here: the portfolio has no reference analysis per ticker (that
              lives on /analyses). Only a future date is shown as "next earnings". */}
          <div className="mt-1">
            <EarningsBadge
              nextEarningsDate={
                isFutureEarnings(earnings?.nextEarningsDate ?? null) ? earnings!.nextEarningsDate : null
              }
              confidence={earnings?.confidence ?? null}
              fetchedAt={earnings?.fetchedAt ?? null}
              refreshing={refreshingEarnings}
              onRefresh={() => onRefreshEarnings(agg.ticker, agg.companyName)}
            />
          </div>

          <TickerAnalysesInline
            analyses={tickerAnalyses}
            ticker={agg.ticker}
            currentPrice={currentPrice}
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <a
            href={`/analyze?ticker=${encodeURIComponent(agg.ticker)}`}
            className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
          >
            {t("analyzeBtn")}
          </a>
          <button
            onClick={() => onAddPurchase(agg)}
            className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-sky-400/40 hover:text-sky-300"
          >
            {t("addPurchaseBtn")}
          </button>
          {/* Close/Delete only shown for single-purchase tickers; multi-purchase uses drill-down */}
          {!hasMultiple && (
            <>
              <button
                onClick={() => onClose(agg.purchases[0])}
                className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-sky-400/40 hover:text-sky-300"
              >
                {t("closePositionBtn")}
              </button>
              <button
                onClick={() => onDelete(agg.purchases[0].id)}
                disabled={deleting === agg.purchases[0].id}
                className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
              >
                {deleting === agg.purchases[0].id ? "…" : t("deleteBtn")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Drill-down: individual purchases */}
      {expanded && hasMultiple && (
        <ul className="mt-3 space-y-1 pl-4 border-l border-slate-700">
          {agg.purchases.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {formatDate(p.purchasedAt)} · {p.shares} @ {formatPrice(p.purchasePrice, p.currency)}
              </span>
              <span className="ml-4 flex items-center gap-1.5">
                <button
                  onClick={() => onClose(p)}
                  className="rounded border border-slate-700 px-1.5 py-0.5 text-muted transition hover:border-sky-400/40 hover:text-sky-300"
                >
                  {t("closePositionBtn")}
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  disabled={deleting === p.id}
                  className="rounded border border-slate-700 px-1.5 py-0.5 text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
                >
                  {deleting === p.id ? "…" : "×"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Add Position Modal ───────────────────────────────────────────────────────

type AddPositionModalProps = {
  onClose: () => void;
  onSave: (pos: Position) => void;
  existingPositions: Position[];
  // Pre-fills ticker/companyName/currency/isin/capitalGainsTaxRate when adding a
  // purchase to a ticker already held — date/price/shares/notes stay blank/today.
  prefill?: Partial<CreatePositionRequest>;
};

function AddPositionModal({ onClose, onSave, existingPositions, prefill }: AddPositionModalProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState<CreatePositionRequest>({
    ticker: "",
    isin: "",
    companyName: "",
    purchasePrice: 0,
    shares: 0,
    currency: "EUR",
    purchasedAt: new Date().toISOString().slice(0, 10),
    notes: "",
    capitalGainsTaxRate: undefined,
    ...prefill,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether the user has manually edited the ISIN field to avoid overriding their input
  const isinManuallyEdited = useRef(false);

  // Auto-fill ISIN when ticker matches an existing position that already has one
  useEffect(() => {
    if (isinManuallyEdited.current || !form.ticker) return;
    const match = existingPositions.find(
      (p) => p.ticker.toUpperCase() === form.ticker.toUpperCase() && p.isin
    );
    if (match?.isin) {
      setForm((prev) => ({ ...prev, isin: match.isin! }));
    }
  }, [form.ticker, existingPositions]);

  function handleChange(field: keyof CreatePositionRequest, value: string | number | undefined) {
    if (field === "isin") isinManuallyEdited.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker || !form.companyName || form.purchasePrice <= 0 || form.shares <= 0) {
      setError(t("errorFillFields"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createPosition({
        ...form,
        ticker: form.ticker.toUpperCase().trim(),
        isin: form.isin?.trim() || undefined,
        notes: form.notes || undefined,
      });
      onSave(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorFailedSave"));
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="my-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700/60 bg-[var(--card)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100 mb-4">{t("addPositionTitle")}</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Ticker *</label>
              <input
                type="text"
                placeholder="ENI.MI"
                value={form.ticker}
                onChange={(e) => handleChange("ticker", e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldDate")} *</label>
              <input
                type="date"
                value={form.purchasedAt}
                onChange={(e) => handleChange("purchasedAt", e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldCompanyName")} *</label>
            <input
              type="text"
              placeholder="ENI S.p.A."
              value={form.companyName}
              onChange={(e) => handleChange("companyName", e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldCurrency")} *</label>
              <select
                value={form.currency}
                onChange={(e) => handleChange("currency", e.target.value)}
                className={inputClass}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-span-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldPrice")} *</label>
              <input
                type="number"
                placeholder="22.5850"
                min="0.0001"
                step="0.0001"
                value={form.purchasePrice || ""}
                onChange={(e) => handleChange("purchasePrice", parseFloat(e.target.value) || 0)}
                className={inputClass}
                required
              />
            </div>
            <div className="col-span-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldShares")} *</label>
              <input
                type="number"
                placeholder="100"
                min="0.001"
                step="0.001"
                value={form.shares || ""}
                onChange={(e) => handleChange("shares", parseFloat(e.target.value) || 0)}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldCapGainsTax")}</label>
              <input
                type="number"
                placeholder="26"
                min="0"
                max="100"
                step="0.1"
                value={form.capitalGainsTaxRate ?? ""}
                onChange={(e) => handleChange("capitalGainsTaxRate", e.target.value ? parseFloat(e.target.value) : undefined)}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-600">{t("fieldCapGainsTaxHint")}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldIsin")}</label>
              <input
                type="text"
                placeholder="IT0003128367"
                value={form.isin ?? ""}
                onChange={(e) => handleChange("isin", e.target.value.toUpperCase())}
                maxLength={12}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-600">{t("fieldIsinHint")}</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("fieldNotes")}</label>
            <input
              type="text"
              placeholder={t("fieldNotesPlaceholder")}
              value={form.notes ?? ""}
              onChange={(e) => handleChange("notes", e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="tap flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t("savingState") : t("savePosition")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="tap rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-muted transition hover:border-slate-500 hover:text-slate-100"
            >
              {t("cancelBtn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

// ─── Close Position Modal ─────────────────────────────────────────────────────

// Records a sale of a lot. Sell price pre-fills from the live price when available.
// Shares-to-sell defaults to the whole lot; a smaller value performs a partial close
// (the API splits the lot). A live realized-P&L preview is shown in the lot's currency.
type ClosePositionModalProps = {
  position: Position;
  currentPrice?: number;
  onCancel: () => void;
  onClosed: (rows: Position[]) => void;
};

function ClosePositionModal({ position, currentPrice, onCancel, onClosed }: ClosePositionModalProps) {
  const { t } = useLanguage();
  const [sellPrice, setSellPrice] = useState<number>(currentPrice ?? position.purchasePrice);
  const [sellDate, setSellDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sharesToSell, setSharesToSell] = useState<number>(position.shares);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPartial = sharesToSell > 0 && sharesToSell < position.shares;
  const realized =
    sellPrice > 0 && sharesToSell > 0
      ? realizedPnlNative(sellPrice, position.purchasePrice, sharesToSell)
      : null;
  const realizedPositive = realized != null && realized >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sellPrice <= 0) {
      setError(t("errorFillFields"));
      return;
    }
    if (sharesToSell <= 0 || sharesToSell > position.shares) {
      setError(t("closeErrorShares"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: ClosePositionRequest = {
        sellPrice,
        sellDate,
        // Omit sharesToSell on a full close so the server updates in place (no lot split).
        ...(isPartial ? { sharesToSell } : {}),
      };
      const rows = await closePosition(position.id, payload);
      onClosed(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorFailedSave"));
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="my-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700/60 bg-[var(--card)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t("closePositionTitle")}</h2>
        <p className="mb-4 text-xs text-muted">
          <span className="font-mono text-accent">{position.ticker}</span> · {position.companyName} ·{" "}
          {position.shares} {t("sharesUnit")} @ {formatPrice(position.purchasePrice, position.currency)}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("sellPriceField")} *</label>
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={sellPrice || ""}
                onChange={(e) => setSellPrice(parseFloat(e.target.value) || 0)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">{t("sellDateField")} *</label>
              <input
                type="date"
                value={sellDate}
                onChange={(e) => setSellDate(e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              {t("sharesToSellField")} * <span className="text-slate-600 normal-case">/ {position.shares}</span>
            </label>
            <input
              type="number"
              min="0.001"
              max={position.shares}
              step="0.001"
              value={sharesToSell || ""}
              onChange={(e) => setSharesToSell(parseFloat(e.target.value) || 0)}
              className={inputClass}
              required
            />
            {isPartial && (
              <p className="mt-1 text-[11px] text-slate-500">{t("closePartialHint")}</p>
            )}
          </div>

          {realized != null && (
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-0.5">{t("realizedPreview")}</p>
              <p className={`text-base font-semibold ${realizedPositive ? "text-success" : "text-danger"}`}>
                {realizedPositive ? "+" : ""}{formatAmount(realized, position.currency)}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="tap flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t("savingState") : t("confirmCloseBtn")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="tap rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-muted transition hover:border-slate-500 hover:text-slate-100"
            >
              {t("cancelBtn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

// ─── Closed Positions Section ─────────────────────────────────────────────────

// Archive of sold lots with realized P&L (in each lot's own currency) and holding period.
// Collapsible; kept separate from the open holdings so current-value math stays clean.
function ClosedPositionsSection({
  closed,
  onDelete,
  deleting,
}: {
  closed: Position[];
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  if (closed.length === 0) return null;

  // Newest sales first.
  const sorted = [...closed].sort(
    (a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime()
  );

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-slate-300"
      >
        {open ? "▲" : "▼"} {t("closedPositionsTitle")} ({closed.length})
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {sorted.map((p) => {
            const realized = realizedPnlNative(p.sellPrice!, p.purchasePrice, p.shares);
            const returnPct = (p.sellPrice! / p.purchasePrice - 1) * 100;
            const positive = realized >= 0;
            const days = holdingDays(p.purchasedAt, p.closedAt);
            const taxAmount = estimateCapitalGainsTax(realized, p.capitalGainsTaxRate);
            const hasTax = taxAmount > 0;
            return (
              <li key={p.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-slate-300">{p.ticker}</span>
                      <span className="text-xs text-muted">{p.companyName}</span>
                      <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-400">
                        {p.currency}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-muted">
                      <span>
                        {p.shares} {t("sharesUnit")} · {formatPrice(p.purchasePrice, p.currency)} →{" "}
                        {formatPrice(p.sellPrice!, p.currency)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-semibold ${
                          positive ? "bg-emerald-500/15 text-success" : "bg-red-500/15 text-danger"
                        }`}
                      >
                        {positive ? "+" : ""}{formatAmount(realized, p.currency)}{" "}
                        ({positive ? "+" : ""}{returnPct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("soldOn")} {formatDate(p.closedAt!)} · {t("heldFor")} {days} {t("daysUnit")}
                    </div>
                    {hasTax && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {t("estimatedTax")} {formatAmount(-taxAmount, p.currency)} · {t("netPnl")}{" "}
                        <span className="text-success">+{formatAmount(realized - taxAmount, p.currency)}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(p.id)}
                    disabled={deleting === p.id}
                    className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
                  >
                    {deleting === p.id ? "…" : t("deleteBtn")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Portfolio Summary Bar ────────────────────────────────────────────────────

// Converts open positions to EUR using Frankfurter rates and shows aggregate P&L.
// Realized P&L is summed from closed lots (sold), so the bar separates unrealized
// (open holdings) from realized (booked) and shows their total.
// totalDividendsEur is summed from historical snapshots — it accumulates over time.
function SummaryBar({
  positions,
  closedPositions,
  currentPrices,
  fxRates,
  totalDividendsEur,
}: {
  positions: Position[]; // open positions only
  closedPositions: Position[];
  currentPrices: Record<string, number>;
  // Map currency → rate vs EUR (e.g. USD: 1.08 means 1 EUR = 1.08 USD)
  fxRates: Record<string, number>;
  totalDividendsEur: number;
}) {
  const { t } = useLanguage();
  let totalCostEur = 0;
  let totalValueEur = 0;
  let totalTaxEur = 0;
  let resolved = 0;

  // Realized P&L across closed lots, converted to EUR at current FX (approximation;
  // realized figures are not stored in EUR on the position).
  let realizedEur = 0;
  let realizedTaxEur = 0;
  let realizedResolved = 0;
  for (const p of closedPositions) {
    if (p.sellPrice == null) continue;
    const rate = p.currency === "EUR" ? 1 : (fxRates[p.currency] ?? null);
    if (rate == null) continue;
    const lotRealizedNative = realizedPnlNative(p.sellPrice, p.purchasePrice, p.shares);
    realizedEur += lotRealizedNative / rate;
    realizedTaxEur += estimateCapitalGainsTax(lotRealizedNative, p.capitalGainsTaxRate) / rate;
    realizedResolved++;
  }
  const hasRealized = realizedResolved > 0;
  const netRealizedEur = realizedEur - realizedTaxEur;
  const hasRealizedTaxEstimate = realizedEur > 0 && realizedTaxEur > 0;

  for (const p of positions) {
    const cp = currentPrices[p.ticker];
    if (cp == null) continue;

    const rate = p.currency === "EUR" ? 1 : (fxRates[p.currency] ?? null);
    if (rate == null) continue;

    // frankfurter base=EUR: rate = how many units of currency per 1 EUR
    const costEur = (p.purchasePrice * p.shares) / rate;
    const valueEur = (cp * p.shares) / rate;
    totalCostEur += costEur;
    totalValueEur += valueEur;
    const positionPnlEur = valueEur - costEur;
    totalTaxEur += estimateCapitalGainsTax(positionPnlEur, p.capitalGainsTaxRate);
    resolved++;
  }

  // Render if there are open holdings to value OR realized results to show.
  if (resolved === 0 && !hasRealized) return null;

  // Only show the Frankfurter attribution when conversion actually happened
  const hasNonEurPositions =
    positions.some((p) => p.currency !== "EUR") ||
    closedPositions.some((p) => p.currency !== "EUR");
  const pnlEur = totalValueEur - totalCostEur;
  const totalReturn = resolved > 0 ? (totalValueEur / totalCostEur - 1) * 100 : 0;
  const isPositive = pnlEur >= 0;
  // Gated on the portfolio-level total, not just per-position sign: a single winning
  // position can contribute to totalTaxEur while other losing positions drag the
  // overall unrealized P&L negative — showing an estimated tax against a net loss
  // would be misleading, so hide it whenever the total isn't itself a net gain.
  const hasTaxEstimate = pnlEur > 0 && totalTaxEur > 0;
  const netPnlEur = pnlEur - totalTaxEur;
  const hasDividends = totalDividendsEur > 0;
  // Total = unrealized (open) + realized (closed). Shown only when there are realized results.
  const totalPnlEur = pnlEur + realizedEur;
  const realizedPositive = realizedEur >= 0;
  const totalPositive = totalPnlEur >= 0;

  // Compute net dividends using a simple average tax rate across positions that have one set.
  const positionsWithTax = positions.filter((p) => p.capitalGainsTaxRate != null && p.capitalGainsTaxRate > 0);
  const avgTaxRate = positionsWithTax.length > 0
    ? positionsWithTax.reduce((sum, p) => sum + p.capitalGainsTaxRate!, 0) / positionsWithTax.length
    : null;
  const netDividendsEur = avgTaxRate != null ? totalDividendsEur * (1 - avgTaxRate / 100) : null;

  // Secondary ledger cells beneath the headline figure. Built in one array so the
  // ruled row adapts its column count to whatever data is present.
  const TONE = {
    neutral: "text-slate-100",
    pos: "text-success",
    neg: "text-danger",
    div: "text-emerald-400",
  } as const;
  type LedgerCell = { key: string; label: string; value: string; tone: keyof typeof TONE; hint?: string };
  const cells: LedgerCell[] = [
    { key: "cost", label: t("totalCost"), value: formatAmount(totalCostEur, "EUR"), tone: "neutral" },
  ];
  if (hasRealized) {
    cells.push({
      key: "realized",
      label: t("realizedPnL"),
      value: `${realizedPositive ? "+" : ""}${formatAmount(realizedEur, "EUR")}`,
      tone: realizedPositive ? "pos" : "neg",
      hint: hasRealizedTaxEstimate
        ? `${t("estimatedTax")} -${formatAmount(realizedTaxEur, "EUR")} · ${t("netPnl")} +${formatAmount(netRealizedEur, "EUR")}`
        : undefined,
    });
    cells.push({
      key: "total",
      label: t("totalReturn"),
      value: `${totalPositive ? "+" : ""}${formatAmount(totalPnlEur, "EUR")}`,
      tone: totalPositive ? "pos" : "neg",
      hint: t("totalReturnHint"),
    });
  }
  if (hasDividends) {
    cells.push({
      key: "div",
      label: t("totalDividends"),
      value: `+${formatAmount(totalDividendsEur, "EUR")}`,
      tone: "div",
      hint:
        netDividendsEur != null
          ? `${t("dividendsNet")}: +${formatAmount(netDividendsEur, "EUR")} (${avgTaxRate!.toFixed(0)}%)`
          : `Borsa Italiana · ${t("dividendsGross")}`,
    });
  }
  // Static column map so Tailwind can purge the classes (no dynamic string interpolation).
  const SM_COLS: Record<number, string> = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
  };
  const sign = isPositive ? "+" : "";

  return (
    <div className="card mb-4">
      {/* Headline: portfolio value on the left, live unrealized P&L on the right — the two
          figures the investor opens the page to read. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("currentValue")}</p>
          <p className="mt-1.5 font-display text-3xl font-bold leading-none text-slate-50 tabular-nums">
            {formatAmount(totalValueEur, "EUR")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {hasRealized ? t("unrealizedPnL") : t("totalPnL")}
          </p>
          <p
            className={`mt-1.5 font-display text-2xl font-bold leading-none tabular-nums ${
              isPositive ? "text-success" : "text-danger"
            }`}
          >
            {sign}{formatAmount(pnlEur, "EUR")}{" "}
            <span className="text-base font-semibold">({sign}{totalReturn.toFixed(1)}%)</span>
          </p>
          {hasTaxEstimate && (
            <p className="mt-1 text-[11px] text-slate-500">
              {t("estimatedTax")} {formatAmount(-totalTaxEur, "EUR")} · {t("netPnl")}{" "}
              <span className={netPnlEur >= 0 ? "text-success" : "text-danger"}>
                {netPnlEur >= 0 ? "+" : ""}{formatAmount(netPnlEur, "EUR")}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Ruled secondary figures — 1px gaps over a slate fill read as ledger column rules,
          not floating stat cards. */}
      <div
        className={`mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800/60 bg-slate-800/50 ${SM_COLS[cells.length]}`}
      >
        {cells.map((c) => (
          <div key={c.key} className="bg-[var(--card)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.label}</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${TONE[c.tone]}`}>{c.value}</p>
            {c.hint && <p className="mt-0.5 text-[10px] text-slate-600">{c.hint}</p>}
          </div>
        ))}
      </div>

      {hasNonEurPositions && (
        <p className="mt-2 text-right text-[10px] text-slate-600">{t("convertedToEur")}</p>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PortfolioList() {
  const { t } = useLanguage();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Pre-fills the Add Position modal when opened via a row's "+ Purchase" button
  // (ticker/companyName/currency/isin/capitalGainsTaxRate); null = a blank "new position" form.
  const [prefill, setPrefill] = useState<Partial<CreatePositionRequest> | null>(null);
  // The lot currently being closed (drives the Close modal); null = modal hidden.
  const [closingPosition, setClosingPosition] = useState<Position | null>(null);
  const [viewMode, setViewMode] = useState<"aggregated" | "flat">("aggregated");
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [dailyChanges, setDailyChanges] = useState<Record<string, DailyChange>>({});
  // AI-fetched next-earnings estimates per ticker, loaded once from the DB store.
  const [earnings, setEarnings] = useState<Record<string, EarningsEstimate>>({});
  const [refreshingEarnings, setRefreshingEarnings] = useState<Record<string, boolean>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  // EUR-based FX rates from frankfurter.app: { USD: 1.08, GBP: 0.85, ... }
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [analysesByTicker, setAnalysesByTicker] = useState<Record<string, SavedAnalysis[]>>({});
  const [totalDividendsEur, setTotalDividendsEur] = useState(0);

  useEffect(() => {
    // Fetch positions, analyses, and snapshots in parallel — no sequential dependency.
    Promise.all([fetchPositions(), fetchAnalyses(), fetchSnapshots()])
      .then(([posData, analysesData, snapshots]) => {
        setPositions(posData);

        const map: Record<string, SavedAnalysis[]> = {};
        for (const a of analysesData) {
          map[a.ticker] = [...(map[a.ticker] ?? []), a];
        }
        setAnalysesByTicker(map);

        // Sum dividends received across all historical snapshots
        const divTotal = snapshots.reduce((sum, s) => sum + (s.dividendsEur ?? 0), 0);
        setTotalDividendsEur(divTotal);

        const tickers = [...new Set(posData.map((p) => p.ticker))];
        const currencies = [...new Set(posData.map((p) => p.currency).filter((c) => c !== "EUR"))];
        if (tickers.length > 0) loadPrices(tickers);
        if (currencies.length > 0) loadFxRates(currencies);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function loadPrices(tickers: string[]) {
    setPricesLoading(true);
    const results = await Promise.allSettled(
      tickers.map(async (t) => {
        const res = await fetch(`/api/quote/${encodeURIComponent(t)}`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        return {
          ticker: t,
          price: data.regularMarketPrice as number,
          change: data.regularMarketChange as number,
          changePct: data.regularMarketChangePercent as number,
        };
      })
    );
    const prices: Record<string, number> = {};
    const changes: Record<string, DailyChange> = {};
    for (const r of results) {
      if (r.status === "fulfilled") {
        prices[r.value.ticker] = r.value.price;
        changes[r.value.ticker] = { change: r.value.change, changePct: r.value.changePct };
      }
    }
    setCurrentPrices((prev) => ({ ...prev, ...prices }));
    setDailyChanges((prev) => ({ ...prev, ...changes }));
    setPricesLoading(false);
  }

  // Load AI-fetched earnings estimates once (independent — a failure must not block the list).
  useEffect(() => {
    fetchEarnings()
      .then((estimates) => {
        const map: Record<string, EarningsEstimate> = {};
        for (const e of estimates) map[e.ticker] = e;
        setEarnings(map);
      })
      .catch(() => {});
  }, []);

  // Run the AI earnings lookup for one ticker (~10–30s) and store the fresh estimate.
  async function handleRefreshEarnings(ticker: string, companyName: string) {
    setRefreshingEarnings((prev) => ({ ...prev, [ticker]: true }));
    try {
      const estimate = await refreshEarnings(ticker, companyName);
      setEarnings((prev) => ({ ...prev, [ticker]: estimate }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Earnings lookup failed.");
    } finally {
      setRefreshingEarnings((prev) => ({ ...prev, [ticker]: false }));
    }
  }

  // Fetch EUR-based exchange rates from Frankfurter for the currencies in use.
  // Failures are silently ignored — summary bar simply won't render for those positions.
  async function loadFxRates(currencies: string[]) {
    try {
      const res = await fetch(
        `https://api.frankfurter.app/latest?base=EUR&symbols=${currencies.join(",")}`
      );
      if (!res.ok) return;
      const data = await res.json() as { rates: Record<string, number> };
      setFxRates((prev) => ({ ...prev, ...data.rates }));
    } catch {
      // Non-critical — summary bar degrades gracefully
    }
  }

  function handlePositionSaved(pos: Position) {
    setPositions((prev) => [pos, ...prev]);
    setShowModal(false);
    setPrefill(null);
    if (currentPrices[pos.ticker] == null) loadPrices([pos.ticker]);
    if (pos.currency !== "EUR" && fxRates[pos.currency] == null) loadFxRates([pos.currency]);
  }

  // Opens the Add Position modal pre-filled with an existing ticker's metadata —
  // avoids retyping company name/currency (and a mismatch typo silently breaking
  // aggregateByTicker's grouping) when recording an additional purchase.
  function handleAddPurchase(agg: AggregatedPosition) {
    setPrefill({
      ticker: agg.ticker,
      companyName: agg.companyName,
      currency: agg.currency,
      isin: agg.purchases[0].isin ?? undefined,
      capitalGainsTaxRate: agg.capitalGainsTaxRate ?? undefined,
    });
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deletePosition(id);
      setPositions((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError(t("errorFailedDelete"));
    } finally {
      setDeleting(null);
    }
  }

  // Merge the rows returned by a close: a full close returns [updatedRow] (same id),
  // a partial close returns [shrunkOpenLot, newClosedLot]. Replace by id, add any new row.
  function handleClosed(rows: Position[]) {
    setPositions((prev) => {
      const returnedIds = new Set(rows.map((r) => r.id));
      return [...rows, ...prev.filter((p) => !returnedIds.has(p.id))];
    });
    setClosingPosition(null);
  }

  // Split open vs closed once — used across the summary bar, lists, and archive section.
  const openPositions = positions.filter((p) => !p.closedAt);
  const closedPositions = positions.filter((p) => p.closedAt);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted">{t("loadingState")}</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {positions.length > 0 && (
        <SummaryBar
          positions={openPositions}
          closedPositions={closedPositions}
          currentPrices={currentPrices}
          fxRates={fxRates}
          totalDividendsEur={totalDividendsEur}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {openPositions.length === 0
            ? positions.length === 0
              ? t("noPositionsYet")
              : t("noOpenPositions")
            : viewMode === "aggregated"
            ? (() => {
                const tickers = new Set(openPositions.map((p) => p.ticker)).size;
                return `${tickers} ticker${tickers !== 1 ? "s" : ""}, ${openPositions.length} purchase${openPositions.length !== 1 ? "s" : ""}`;
              })()
            : `${openPositions.length} position${openPositions.length !== 1 ? "s" : ""}`}
          {pricesLoading && <span className="ml-2 text-xs text-slate-600">{t("loadingPrices")}</span>}
        </p>
        <div className="flex items-center gap-2">
          {positions.length > 0 && (
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setViewMode("aggregated")}
                className={`tap px-3 py-1.5 transition ${
                  viewMode === "aggregated"
                    ? "bg-slate-700 text-slate-100"
                    : "text-muted hover:text-slate-300"
                }`}
              >
                {t("aggregatedView")}
              </button>
              <button
                onClick={() => setViewMode("flat")}
                className={`tap px-3 py-1.5 transition ${
                  viewMode === "flat"
                    ? "bg-slate-700 text-slate-100"
                    : "text-muted hover:text-slate-300"
                }`}
              >
                {t("perPurchaseView")}
              </button>
            </div>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="tap rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
          >
            {t("addPositionBtn")}
          </button>
        </div>
      </div>

      {openPositions.length > 0 && viewMode === "aggregated" && (
        <ul className="space-y-3">
          {aggregateByTicker(openPositions).map((agg) => (
            <AggregatedPositionRow
              key={agg.ticker}
              agg={agg}
              currentPrice={currentPrices[agg.ticker]}
              dailyChange={dailyChanges[agg.ticker]}
              earnings={earnings[agg.ticker]}
              refreshingEarnings={refreshingEarnings[agg.ticker] ?? false}
              onRefreshEarnings={handleRefreshEarnings}
              onDelete={handleDelete}
              onClose={setClosingPosition}
              onAddPurchase={handleAddPurchase}
              deleting={deleting}
              pricesLoading={pricesLoading}
              tickerAnalyses={analysesByTicker[agg.ticker] ?? []}
            />
          ))}
        </ul>
      )}

      {openPositions.length > 0 && viewMode === "flat" && (
        <ul className="space-y-3">
          {openPositions.map((pos) => {
            const cp = currentPrices[pos.ticker];
            const costBasis = pos.purchasePrice * pos.shares;
            const currentValue = cp != null ? cp * pos.shares : null;
            const pnl = currentValue != null ? currentValue - costBasis : null;
            const returnPct = pnl != null ? (currentValue! / costBasis - 1) * 100 : null;
            const isPositive = pnl != null && pnl >= 0;

            return (
              <li key={pos.id} className="card flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Header: ticker, company, currency badge, date */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`/analyze?ticker=${encodeURIComponent(pos.ticker)}`}
                      className="font-mono text-sm font-bold text-accent hover:text-sky-300"
                    >
                      {pos.ticker}
                    </a>
                    <span className="text-xs text-muted">{pos.companyName}</span>
                    <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-400">
                      {pos.currency}
                    </span>
                    <span className="ml-auto text-xs text-muted">{formatDate(pos.purchasedAt)}</span>
                  </div>

                  {/* Financials: shares × buy price → current price, P&L badge */}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-muted">
                      {pos.shares} × {formatPrice(pos.purchasePrice, pos.currency)}
                    </span>
                    {cp != null ? (
                      <>
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-200">{formatPrice(cp, pos.currency)}</span>
                        {dailyChanges[pos.ticker] != null && (
                          <span className={`text-[11px] ${dailyChanges[pos.ticker].changePct >= 0 ? "text-success" : "text-danger"}`}>
                            {dailyChanges[pos.ticker].changePct >= 0 ? "▲" : "▼"}{" "}
                            {dailyChanges[pos.ticker].changePct >= 0 ? "+" : ""}{dailyChanges[pos.ticker].changePct.toFixed(2)}%{" "}
                            {t("dailyChange")}
                          </span>
                        )}
                      </>
                    ) : pricesLoading ? (
                      <>
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-600">{t("loadingState")}</span>
                      </>
                    ) : null}
                    {pnl != null && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-semibold ${
                          isPositive
                            ? "bg-emerald-500/15 text-success"
                            : "bg-red-500/15 text-danger"
                        }`}
                      >
                        {isPositive ? "+" : ""}{formatAmount(pnl, pos.currency)}{" "}
                        ({isPositive ? "+" : ""}{returnPct!.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                  {(() => {
                    const flatTaxAmount = pnl != null ? estimateCapitalGainsTax(pnl, pos.capitalGainsTaxRate) : 0;
                    return flatTaxAmount > 0 ? (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {t("estimatedTax")} {formatAmount(-flatTaxAmount, pos.currency)} · {t("netPnl")}{" "}
                        <span className="text-success">+{formatAmount(pnl! - flatTaxAmount, pos.currency)}</span>
                      </div>
                    ) : null;
                  })()}

                  {pos.notes && (
                    <p className="mt-1 text-xs text-slate-600 italic">{pos.notes}</p>
                  )}

                  <TickerAnalysesInline
                    analyses={analysesByTicker[pos.ticker] ?? []}
                    ticker={pos.ticker}
                    currentPrice={currentPrices[pos.ticker]}
                  />
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <a
                    href={`/analyze?ticker=${encodeURIComponent(pos.ticker)}`}
                    className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
                  >
                    {t("analyzeBtn")}
                  </a>
                  <button
                    onClick={() => setClosingPosition(pos)}
                    className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-sky-400/40 hover:text-sky-300"
                  >
                    {t("closePositionBtn")}
                  </button>
                  <button
                    onClick={() => handleDelete(pos.id)}
                    disabled={deleting === pos.id}
                    className="tap rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
                  >
                    {deleting === pos.id ? "…" : t("deleteBtn")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ClosedPositionsSection
        closed={closedPositions}
        onDelete={handleDelete}
        deleting={deleting}
      />

      {showModal && (
        <AddPositionModal
          onClose={() => { setShowModal(false); setPrefill(null); }}
          onSave={handlePositionSaved}
          existingPositions={positions}
          prefill={prefill ?? undefined}
        />
      )}

      {closingPosition && (
        <ClosePositionModal
          position={closingPosition}
          currentPrice={currentPrices[closingPosition.ticker]}
          onCancel={() => setClosingPosition(null)}
          onClosed={handleClosed}
        />
      )}
    </div>
  );
}
