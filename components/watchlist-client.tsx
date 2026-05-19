"use client";

// Watchlist page client component.
// Fetches watchlist items + settings on mount, live prices in parallel.
// Supports add/edit/remove items and settings (email, frequency, enabled toggle).
import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import type { WatchlistItem, WatchlistSettings } from "@/types/watchlist";
import type { Translations } from "@/lib/i18n/translations";

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUpside(upside: number): string {
  const pct = (upside * 100).toFixed(1);
  return `${upside >= 0 ? "+" : ""}${pct}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Input class ─────────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30";

// ─── Add ticker form ──────────────────────────────────────────────────────────

interface AddFormProps {
  onAdd: (item: { ticker: string; companyName: string; mosPercent: number; notes?: string }) => Promise<void>;
  t: (key: keyof Translations) => string;
}

function AddTickerForm({ onAdd, t }: AddFormProps) {
  const [ticker, setTicker] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [mosPercent, setMosPercent] = useState(0.2);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ticker.trim() || !companyName.trim()) {
      setError(t("errorFillFields"));
      return;
    }
    setLoading(true);
    try {
      await onAdd({ ticker: ticker.toUpperCase(), companyName, mosPercent, notes: notes || undefined });
      setTicker("");
      setCompanyName("");
      setMosPercent(0.2);
      setNotes("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errorFailedSave"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card mb-6 flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("watchlistAddTicker")}</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-none sm:w-28">
          <span className="mb-1 block text-xs text-muted">Ticker</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={10}
            className={inputClass}
          />
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted">{t("fieldCompanyName")}</span>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Apple Inc."
            maxLength={100}
            className={inputClass}
          />
        </label>
        <label className="flex-none sm:w-44">
          <span className="mb-1 block text-xs text-muted">
            {t("watchlistMosPercent")}: {(mosPercent * 100).toFixed(0)}%
          </span>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={mosPercent}
            onChange={(e) => setMosPercent(parseFloat(e.target.value))}
            className="w-full accent-sky-500"
          />
        </label>
      </div>
      <label>
        <span className="mb-1 block text-xs text-muted">{t("watchlistNotes")}</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("fieldNotesPlaceholder")}
          maxLength={500}
          className={inputClass}
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
      >
        {loading ? t("loadingState") : t("watchlistAddTicker")}
      </button>
    </form>
  );
}

// ─── Watchlist row ────────────────────────────────────────────────────────────

interface RowProps {
  item: WatchlistItem;
  currentPrice: number | null;
  onDelete: (id: string) => void;
  onSave: (id: string, mosPercent: number, notes: string | null) => Promise<void>;
  t: (key: keyof Translations) => string;
}

function WatchlistRow({ item, currentPrice, onDelete, onSave, t }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [editMos, setEditMos] = useState(item.mosPercent);
  const [editNotes, setEditNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = item.lastRun;
  const currency = run?.currency ?? "USD";
  const adjustedBase =
    run?.fairValueBase != null ? run.fairValueBase * (1 - item.mosPercent) : null;
  const upside =
    adjustedBase != null && currentPrice != null
      ? (adjustedBase - currentPrice) / currentPrice
      : null;

  // Price proximity to buy target: negative = below target (good), positive = above target
  const priceDist =
    adjustedBase != null && currentPrice != null
      ? (currentPrice - adjustedBase) / adjustedBase * 100
      : null;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(item.id, editMos, editNotes || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-slate-800/60 text-sm">
      {/* Ticker + Company + Method badge + last run date */}
      <td className="py-3 pr-4">
        <span className="font-semibold text-slate-100">{item.ticker}</span>
        <br />
        <span className="text-xs text-muted">{item.companyName}</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {run?.method && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">{run.method}</span>
          )}
          <span className="text-xs text-slate-600">
            {run ? formatDate(run.runAt) : t("watchlistNoLastRun")}
          </span>
          {priceDist != null && (
            priceDist >= 0 ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                {t("priceAtTarget")}
              </span>
            ) : Math.abs(priceDist) <= 10 ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                +{Math.abs(priceDist).toFixed(1)}% to target
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-500">
                +{Math.abs(priceDist).toFixed(1)}% to target
              </span>
            )
          )}
        </div>
        {item.notes && !editing && (
          <p className="mt-1 text-xs italic text-muted">{item.notes}</p>
        )}
      </td>

      {/* MoS% + edit */}
      <td className="py-3 pr-4">
        {editing ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{(editMos * 100).toFixed(0)}%</span>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={editMos}
              onChange={(e) => setEditMos(parseFloat(e.target.value))}
              className="w-28 accent-sky-500"
            />
            <input
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder={t("watchlistNotes")}
              maxLength={500}
              className="mt-1 w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:outline-none"
            />
          </div>
        ) : (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">
            −{(item.mosPercent * 100).toFixed(0)}%
          </span>
        )}
      </td>

      {/* Bear */}
      <td className="py-3 pr-4 text-right text-sm text-slate-500">
        {run?.fairValueBear != null ? formatPrice(run.fairValueBear, currency) : <span className="text-muted">—</span>}
      </td>

      {/* Base (MoS-adjusted) — target buy price, most prominent column */}
      <td className="py-3 pr-4 text-center">
        {adjustedBase != null ? (
          <span className="font-bold text-sky-300">{formatPrice(adjustedBase, currency)}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Bull */}
      <td className="py-3 pr-4 text-right text-sm text-slate-500">
        {run?.fairValueBull != null ? formatPrice(run.fairValueBull, currency) : <span className="text-muted">—</span>}
      </td>

      {/* Current price */}
      <td className="py-3 pr-4 text-right">
        {currentPrice != null ? (
          formatPrice(currentPrice, currency)
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Upside */}
      <td className="py-3 pr-4 text-right">
        {upside != null ? (
          <span className={upside >= 0 ? "font-medium text-emerald-400" : "font-medium text-red-400"}>
            {formatUpside(upside)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 text-right">
        {editing ? (
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
            >
              {saving ? t("savingState") : t("watchlistSaveItem")}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-muted transition hover:text-slate-100"
            >
              {t("cancelBtn")}
            </button>
          </div>
        ) : confirmDelete ? (
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => onDelete(item.id)}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-500"
            >
              {t("deleteBtn")}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-muted transition hover:text-slate-100"
            >
              {t("cancelBtn")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { window.location.href = `/?ticker=${item.ticker}`; }}
                className="rounded-md border border-slate-700/60 px-2.5 py-1 text-xs font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                {t("analyzeBtn")}
              </button>
              <button
                onClick={() => { window.location.href = `/compare?tickers=${item.ticker}`; }}
                className="rounded-md border border-slate-700/60 px-2.5 py-1 text-xs font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                {t("addToCompare")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-muted transition hover:text-slate-100"
              >
                {t("watchlistEditItem")}
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-red-800/50 px-3 py-1 text-xs text-red-400 transition hover:border-red-600 hover:text-red-300"
              >
                {t("deleteBtn")}
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Settings panel ───────────────────────────────────────────────────────────

interface SettingsPanelProps {
  settings: WatchlistSettings;
  onSave: (updates: Partial<WatchlistSettings>) => Promise<void>;
  onManualRun: () => Promise<void>;
  manualRunLoading: boolean;
  cooldownMsg: string | null;
  t: (key: keyof Translations) => string;
}

function SettingsPanel({ settings, onSave, onManualRun, manualRunLoading, cooldownMsg, t }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(settings.watchlistEmail ?? "");
  const [freq, setFreq] = useState(settings.watchlistFreq);
  const [enabled, setEnabled] = useState(settings.watchlistEnabled);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        watchlistEmail: email || null,
        watchlistFreq: freq,
        watchlistEnabled: enabled,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-slate-200"
      >
        <span>{t("watchlistSettingsTitle")}</span>
        <span className="text-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          {/* Enable/disable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setEnabled((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                enabled ? "bg-sky-500" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </div>
            <div>
              <span className="text-sm text-slate-200">{t("watchlistEnabled")}</span>
              <p className="text-xs text-muted">{t("watchlistEnabledHint")}</p>
            </div>
          </label>

          {/* Notification email */}
          <label>
            <span className="mb-1 block text-xs text-muted">{t("watchlistNotifEmail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="leave empty to use account email"
            />
          </label>

          {/* Frequency */}
          <div>
            <span className="mb-2 block text-xs text-muted">
              {freq === "monthly" ? t("watchlistFreqMonthly") : t("watchlistFreqBiweekly")}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFreq("biweekly")}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  freq === "biweekly"
                    ? "border-sky-500 bg-sky-500/10 text-sky-300"
                    : "border-slate-700 text-muted hover:text-slate-100"
                }`}
              >
                {t("watchlistFreqBiweekly")}
              </button>
              <button
                onClick={() => setFreq("monthly")}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  freq === "monthly"
                    ? "border-sky-500 bg-sky-500/10 text-sky-300"
                    : "border-slate-700 text-muted hover:text-slate-100"
                }`}
              >
                {t("watchlistFreqMonthly")}
              </button>
            </div>
          </div>

          {/* Save + Manual run */}
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
            >
              {saving ? t("savingState") : t("watchlistSaveSettings")}
            </button>
            <div className="flex flex-col gap-1">
              <button
                onClick={onManualRun}
                disabled={manualRunLoading || !!cooldownMsg || !enabled}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-slate-100 disabled:opacity-50"
              >
                {manualRunLoading ? t("watchlistRunning") : t("watchlistManualRun")}
              </button>
              {cooldownMsg && (
                <span className="text-xs text-muted">{cooldownMsg}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WatchlistClient() {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [settings, setSettings] = useState<WatchlistSettings>({
    watchlistEmail: null,
    watchlistFreq: "biweekly",
    watchlistEnabled: true,
  });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualRunLoading, setManualRunLoading] = useState(false);
  const [cooldownMsg, setCooldownMsg] = useState<string | null>(null);

  // Avoid SSR mismatch with Intl formatting
  useEffect(() => setMounted(true), []);

  // Load watchlist on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/watchlist");
        if (!res.ok) throw new Error("Failed to load watchlist");
        const data = await res.json();
        setItems(data.items);
        setSettings(data.settings);
      } catch {
        setError(t("errorUnexpected"));
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch live prices for all tickers in parallel after items load
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (items.length === 0) return;
    const tickers = [...new Set(items.map((i) => i.ticker))];
    Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
          if (!res.ok) return null;
          const data = await res.json();
          return { ticker, price: data.regularMarketPrice as number };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const map: Record<string, number> = {};
      for (const r of results) {
        if (r) map[r.ticker] = r.price;
      }
      setPrices(map);
    });
  }, [items]);

  async function handleAdd(payload: { ticker: string; companyName: string; mosPercent: number; notes?: string }) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? t("errorFailedSave"));
    }
    // Reload the full list to get the server-generated id and addedAt
    const listRes = await fetch("/api/watchlist");
    const listData = await listRes.json();
    setItems(listData.items);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleSaveItem(id: string, mosPercent: number, notes: string | null) {
    const res = await fetch(`/api/watchlist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mosPercent, notes }),
    });
    if (!res.ok) return;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, mosPercent, notes } : i))
    );
  }

  async function handleSaveSettings(updates: Partial<WatchlistSettings>) {
    const res = await fetch("/api/watchlist/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    setSettings((prev) => ({ ...prev, ...updates }));
  }

  async function handleManualRun() {
    setManualRunLoading(true);
    setCooldownMsg(null);
    try {
      const res = await fetch("/api/watchlist/run", { method: "POST" });
      const data = await res.json();
      if (res.status === 429 && data.remainingSeconds) {
        const hours = Math.floor(data.remainingSeconds / 3600);
        const minutes = Math.floor((data.remainingSeconds % 3600) / 60);
        const msg = t("watchlistCooldownMsg")
          .replace("{hours}", String(hours))
          .replace("{minutes}", String(minutes));
        setCooldownMsg(msg);
      } else if (res.ok) {
        // Refresh list to show updated last-run data
        const listRes = await fetch("/api/watchlist");
        const listData = await listRes.json();
        setItems(listData.items);
      }
    } finally {
      setManualRunLoading(false);
    }
  }

  if (!mounted || loading) {
    return (
      <div className="mt-8 text-center text-sm text-muted">{t("loadingState")}</div>
    );
  }

  if (error) {
    return <div className="mt-8 text-center text-sm text-red-400">{error}</div>;
  }

  return (
    <div>
      <AddTickerForm onAdd={handleAdd} t={t} />

      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-slate-300">{t("watchlistEmpty")}</p>
          <p className="text-sm text-muted">{t("watchlistEmptyHint")}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 pr-4 text-left text-xs font-medium uppercase tracking-wider text-muted">Ticker</th>
                <th className="pb-3 pr-4 text-left text-xs font-medium uppercase tracking-wider text-muted whitespace-nowrap">MoS%</th>
                <th className="pb-3 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted">Bear</th>
                <th className="pb-3 pr-4 text-center text-xs font-medium uppercase tracking-wider text-sky-400 whitespace-nowrap">Base −MoS% ↓</th>
                <th className="pb-3 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted">Bull</th>
                <th className="pb-3 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted">Prezzo</th>
                <th className="pb-3 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted">Upside</th>
                <th className="pb-3 text-right text-xs font-medium uppercase tracking-wider text-muted whitespace-nowrap">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <WatchlistRow
                  key={item.id}
                  item={item}
                  currentPrice={prices[item.ticker] ?? null}
                  onDelete={handleDelete}
                  onSave={handleSaveItem}
                  t={t}
                />
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Bear e Bull sono i fair value grezzi stimati dall&apos;AI.{" "}
            <span className="text-sky-400">Base −MoS%</span> è il prezzo target di acquisto: fair value base scontato del tuo margine di sicurezza.
          </p>
        </div>
      )}

      <SettingsPanel
        settings={settings}
        onSave={handleSaveSettings}
        onManualRun={handleManualRun}
        manualRunLoading={manualRunLoading}
        cooldownMsg={cooldownMsg}
        t={t}
      />
    </div>
  );
}
