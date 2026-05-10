"use client";

// Portfolio tracker — shows user's stock positions with live P&L.
// Fetches current prices for all unique tickers on mount.
// Summary bar converts all positions to EUR via frankfurter.app (free, no key needed).
import { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { fetchPositions, createPosition, deletePosition } from "@/lib/portfolio";
import type { Position, CreatePositionRequest } from "@/types/portfolio";

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

// ─── Shared input class ───────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30";

// ─── Add Position Modal ───────────────────────────────────────────────────────

type AddPositionModalProps = {
  onClose: () => void;
  onSave: (pos: Position) => void;
};

function AddPositionModal({ onClose, onSave }: AddPositionModalProps) {
  const [form, setForm] = useState<CreatePositionRequest>({
    ticker: "",
    companyName: "",
    purchasePrice: 0,
    shares: 0,
    currency: "EUR",
    purchasedAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(field: keyof CreatePositionRequest, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ticker || !form.companyName || form.purchasePrice <= 0 || form.shares <= 0) {
      setError("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createPosition({
        ...form,
        ticker: form.ticker.toUpperCase().trim(),
        notes: form.notes || undefined,
      });
      onSave(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
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
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add Position</h2>

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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Date *</label>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Company Name *</label>
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Currency *</label>
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Price *</label>
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Shares *</label>
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

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Notes</label>
            <input
              type="text"
              placeholder="Optional notes…"
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
              {saving ? "Saving…" : "Save Position"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-muted transition hover:border-slate-500 hover:text-slate-100"
            >
              Cancel
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
function SummaryBar({
  positions,
  currentPrices,
  fxRates,
}: {
  positions: Position[];
  currentPrices: Record<string, number>;
  // Map currency → rate vs EUR (e.g. USD: 1.08 means 1 EUR = 1.08 USD)
  fxRates: Record<string, number>;
}) {
  let totalCostEur = 0;
  let totalValueEur = 0;
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
    resolved++;
  }

  if (resolved === 0) return null;

  const pnlEur = totalValueEur - totalCostEur;
  const totalReturn = (totalValueEur / totalCostEur - 1) * 100;
  const isPositive = pnlEur >= 0;

  return (
    <div className="card mb-4 grid grid-cols-3 gap-4 text-center">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Total Cost</p>
        <p className="text-lg font-semibold text-slate-100">{formatAmount(totalCostEur, "EUR")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Current Value</p>
        <p className="text-lg font-semibold text-slate-100">{formatAmount(totalValueEur, "EUR")}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Total P&amp;L</p>
        <p className={`text-lg font-semibold ${isPositive ? "text-success" : "text-danger"}`}>
          {isPositive ? "+" : ""}{formatAmount(pnlEur, "EUR")}{" "}
          <span className="text-sm">
            ({isPositive ? "+" : ""}{totalReturn.toFixed(1)}%)
          </span>
        </p>
        <p className="text-[10px] text-slate-600 mt-0.5">converted to EUR · frankfurter.app</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PortfolioList() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  // EUR-based FX rates from frankfurter.app: { USD: 1.08, GBP: 0.85, ... }
  const [fxRates, setFxRates] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchPositions()
      .then((data) => {
        setPositions(data);
        const tickers = [...new Set(data.map((p) => p.ticker))];
        const currencies = [...new Set(data.map((p) => p.currency).filter((c) => c !== "EUR"))];
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
        return { ticker: t, price: data.regularMarketPrice as number };
      })
    );
    const prices: Record<string, number> = {};
    for (const r of results) {
      if (r.status === "fulfilled") prices[r.value.ticker] = r.value.price;
    }
    setCurrentPrices((prev) => ({ ...prev, ...prices }));
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
      setError("Failed to delete. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted">Loading…</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {positions.length > 0 && (
        <SummaryBar positions={positions} currentPrices={currentPrices} fxRates={fxRates} />
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {positions.length === 0
            ? "No positions yet — add your first purchase."
            : `${positions.length} position${positions.length !== 1 ? "s" : ""}`}
          {pricesLoading && <span className="ml-2 text-xs text-slate-600">Loading prices…</span>}
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          + Add Position
        </button>
      </div>

      {positions.length > 0 && (
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
                      </>
                    ) : pricesLoading ? (
                      <>
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-600">loading…</span>
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

                  {pos.notes && (
                    <p className="mt-1 text-xs text-slate-600 italic">{pos.notes}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <a
                    href={`/?ticker=${encodeURIComponent(pos.ticker)}`}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-accent transition hover:border-sky-400/40 hover:text-sky-300"
                  >
                    Analyze
                  </a>
                  <button
                    onClick={() => handleDelete(pos.id)}
                    disabled={deleting === pos.id}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-muted transition hover:border-red-500/50 hover:text-danger disabled:opacity-50"
                  >
                    {deleting === pos.id ? "…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showModal && (
        <AddPositionModal onClose={() => setShowModal(false)} onSave={handlePositionSaved} />
      )}
    </div>
  );
}
