"use client";

// Portfolio tracker — shows user's stock positions with live P&L.
// Fetches current prices for all unique tickers on mount.
// Summary bar converts all positions to EUR via frankfurter.app (free, no key needed).
import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { fetchPositions, createPosition, deletePosition, fetchSnapshots } from "@/lib/portfolio";
import { fetchAnalyses } from "@/lib/analyses";
import type { Position, CreatePositionRequest, AggregatedPosition } from "@/types/portfolio";
import type { SavedAnalysis } from "@/types/analysis";
import { useLanguage } from "@/context/language-context";

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

// ─── Shared input class ───────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30";

// ─── Ticker Analyses Inline ───────────────────────────────────────────────────

// Collapsible list of saved analyses for a ticker, shown inside each portfolio row.
function TickerAnalysesInline({ analyses }: { analyses: SavedAnalysis[] }) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  if (analyses.length === 0) return null;

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
        <ul className="mt-1 space-y-1 pl-2 border-l border-slate-700">
          {analyses.map((a) => (
            <li key={a.id} className="text-xs text-slate-400">
              <a
                href={`/analyses/${a.id}`}
                className="hover:text-slate-200 transition"
              >
                {formatDate(a.createdAt)} · MoS {a.mosPercent}%
                {a.fairValueBase != null && ` · FV base ${a.fairValueBase.toFixed(2)}`}
              </a>
            </li>
          ))}
        </ul>
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
  onDelete: (id: string) => void;
  deleting: string | null;
  pricesLoading: boolean;
  tickerAnalyses: SavedAnalysis[];
};

function AggregatedPositionRow({
  agg,
  currentPrice,
  dailyChange,
  onDelete,
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
  const taxRate = agg.capitalGainsTaxRate;
  const hasTax = taxRate != null && taxRate > 0 && pnl != null && pnl > 0;
  const taxAmount = hasTax ? pnl! * (taxRate! / 100) : null;
  const netPnl = hasTax ? pnl! - taxAmount! : null;

  return (
    <li className="card">
      {/* Summary row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/?ticker=${encodeURIComponent(agg.ticker)}`}
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
          </div>

          {hasTax && (
            <div className="mt-1 text-[11px] text-slate-500">
              {t("estimatedTax")} {formatAmount(-taxAmount!, agg.currency)} · {t("netPnl")}{" "}
              <span className="text-success">+{formatAmount(netPnl!, agg.currency)}</span>
            </div>
          )}

          <TickerAnalysesInline analyses={tickerAnalyses} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <a
            href={`/?ticker=${encodeURIComponent(agg.ticker)}`}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
          >
            {t("analyzeBtn")}
          </a>
          {/* Delete only shown for single-purchase tickers; multi-purchase uses drill-down */}
          {!hasMultiple && (
            <button
              onClick={() => onDelete(agg.purchases[0].id)}
              disabled={deleting === agg.purchases[0].id}
              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
            >
              {deleting === agg.purchases[0].id ? "…" : t("deleteBtn")}
            </button>
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
              <button
                onClick={() => onDelete(p.id)}
                disabled={deleting === p.id}
                className="ml-4 rounded border border-slate-700 px-1.5 py-0.5 text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
              >
                {deleting === p.id ? "…" : "×"}
              </button>
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
};

function AddPositionModal({ onClose, onSave, existingPositions }: AddPositionModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-[var(--card)] border border-slate-700/60 p-6 shadow-2xl"
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
              className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t("savingState") : t("savePosition")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-muted transition hover:border-slate-500 hover:text-slate-100"
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

// ─── Portfolio Summary Bar ────────────────────────────────────────────────────

// Converts all positions to EUR using Frankfurter rates and shows aggregate P&L.
// totalDividendsEur is summed from historical snapshots — it accumulates over time.
function SummaryBar({
  positions,
  currentPrices,
  fxRates,
  totalDividendsEur,
}: {
  positions: Position[];
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
    // Apply tax only on gains (not on losses) and only when the rate is set
    const positionPnlEur = valueEur - costEur;
    if (p.capitalGainsTaxRate != null && p.capitalGainsTaxRate > 0 && positionPnlEur > 0) {
      totalTaxEur += positionPnlEur * (p.capitalGainsTaxRate / 100);
    }
    resolved++;
  }

  if (resolved === 0) return null;

  // Only show the Frankfurter attribution when conversion actually happened
  const hasNonEurPositions = positions.some((p) => p.currency !== "EUR");
  const pnlEur = totalValueEur - totalCostEur;
  const totalReturn = (totalValueEur / totalCostEur - 1) * 100;
  const isPositive = pnlEur >= 0;
  const hasTaxEstimate = totalTaxEur > 0;
  const netPnlEur = pnlEur - totalTaxEur;
  const hasDividends = totalDividendsEur > 0;

  // Compute net dividends using a simple average tax rate across positions that have one set.
  const positionsWithTax = positions.filter((p) => p.capitalGainsTaxRate != null && p.capitalGainsTaxRate > 0);
  const avgTaxRate = positionsWithTax.length > 0
    ? positionsWithTax.reduce((sum, p) => sum + p.capitalGainsTaxRate!, 0) / positionsWithTax.length
    : null;
  const netDividendsEur = avgTaxRate != null ? totalDividendsEur * (1 - avgTaxRate / 100) : null;

  return (
    <div className={`card mb-4 grid gap-4 text-center ${hasDividends ? "grid-cols-4" : "grid-cols-3"}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{t("totalCost")}</p>
        <p className="text-lg font-semibold text-slate-100">{formatAmount(totalCostEur, "EUR")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{t("currentValue")}</p>
        <p className="text-lg font-semibold text-slate-100">{formatAmount(totalValueEur, "EUR")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{t("totalPnL")}</p>
        <p className={`text-lg font-semibold ${isPositive ? "text-success" : "text-danger"}`}>
          {isPositive ? "+" : ""}{formatAmount(pnlEur, "EUR")}{" "}
          <span className="text-sm">
            ({isPositive ? "+" : ""}{totalReturn.toFixed(1)}%)
          </span>
        </p>
        {hasTaxEstimate && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            {t("estimatedTax")} {formatAmount(-totalTaxEur, "EUR")} · {t("netPnl")}{" "}
            <span className={netPnlEur >= 0 ? "text-success" : "text-danger"}>
              {netPnlEur >= 0 ? "+" : ""}{formatAmount(netPnlEur, "EUR")}
            </span>
          </p>
        )}
        {hasNonEurPositions && (
          <p className="text-[10px] text-slate-600 mt-0.5">{t("convertedToEur")}</p>
        )}
      </div>
      {hasDividends && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">{t("totalDividends")}</p>
          <p className="text-lg font-semibold text-emerald-400">+{formatAmount(totalDividendsEur, "EUR")}</p>
          {netDividendsEur != null ? (
            <p className="text-[10px] text-slate-500 mt-0.5">
              {t("dividendsGross")} · {t("dividendsNet")}: +{formatAmount(netDividendsEur, "EUR")}{" "}
              ({t("dividendsAvgRate")} {avgTaxRate!.toFixed(0)}%)
            </p>
          ) : (
            <p className="text-[10px] text-slate-600 mt-0.5">Borsa Italiana · {t("dividendsGross")}</p>
          )}
        </div>
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
  const [viewMode, setViewMode] = useState<"aggregated" | "flat">("aggregated");
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [dailyChanges, setDailyChanges] = useState<Record<string, DailyChange>>({});
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
    if (currentPrices[pos.ticker] == null) loadPrices([pos.ticker]);
    if (pos.currency !== "EUR" && fxRates[pos.currency] == null) loadFxRates([pos.currency]);
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
          positions={positions}
          currentPrices={currentPrices}
          fxRates={fxRates}
          totalDividendsEur={totalDividendsEur}
        />
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {positions.length === 0
            ? t("noPositionsYet")
            : viewMode === "aggregated"
            ? (() => {
                const tickers = new Set(positions.map((p) => p.ticker)).size;
                return `${tickers} ticker${tickers !== 1 ? "s" : ""}, ${positions.length} purchase${positions.length !== 1 ? "s" : ""}`;
              })()
            : `${positions.length} position${positions.length !== 1 ? "s" : ""}`}
          {pricesLoading && <span className="ml-2 text-xs text-slate-600">{t("loadingPrices")}</span>}
        </p>
        <div className="flex items-center gap-2">
          {positions.length > 0 && (
            <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
              <button
                onClick={() => setViewMode("aggregated")}
                className={`px-3 py-1.5 transition ${
                  viewMode === "aggregated"
                    ? "bg-slate-700 text-slate-100"
                    : "text-muted hover:text-slate-300"
                }`}
              >
                {t("aggregatedView")}
              </button>
              <button
                onClick={() => setViewMode("flat")}
                className={`px-3 py-1.5 transition ${
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
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
          >
            {t("addPositionBtn")}
          </button>
        </div>
      </div>

      {positions.length > 0 && viewMode === "aggregated" && (
        <ul className="space-y-3">
          {aggregateByTicker(positions).map((agg) => (
            <AggregatedPositionRow
              key={agg.ticker}
              agg={agg}
              currentPrice={currentPrices[agg.ticker]}
              dailyChange={dailyChanges[agg.ticker]}
              onDelete={handleDelete}
              deleting={deleting}
              pricesLoading={pricesLoading}
              tickerAnalyses={analysesByTicker[agg.ticker] ?? []}
            />
          ))}
        </ul>
      )}

      {positions.length > 0 && viewMode === "flat" && (
        <ul className="space-y-3">
          {positions.map((pos) => {
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
                      href={`/?ticker=${encodeURIComponent(pos.ticker)}`}
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
                  {pos.capitalGainsTaxRate != null && pos.capitalGainsTaxRate > 0 && pnl != null && pnl > 0 && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {t("estimatedTax")} {formatAmount(-(pnl * pos.capitalGainsTaxRate / 100), pos.currency)} · {t("netPnl")}{" "}
                      <span className="text-success">+{formatAmount(pnl * (1 - pos.capitalGainsTaxRate / 100), pos.currency)}</span>
                    </div>
                  )}

                  {pos.notes && (
                    <p className="mt-1 text-xs text-slate-600 italic">{pos.notes}</p>
                  )}

                  <TickerAnalysesInline analyses={analysesByTicker[pos.ticker] ?? []} />
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <a
                    href={`/?ticker=${encodeURIComponent(pos.ticker)}`}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
                  >
                    {t("analyzeBtn")}
                  </a>
                  <button
                    onClick={() => handleDelete(pos.id)}
                    disabled={deleting === pos.id}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
                  >
                    {deleting === pos.id ? "…" : t("deleteBtn")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showModal && (
        <AddPositionModal
          onClose={() => setShowModal(false)}
          onSave={handlePositionSaved}
          existingPositions={positions}
        />
      )}
    </div>
  );
}
