"use client";

// Watchlist page client component.
// Fetches watchlist items + settings on mount, live prices in parallel.
// Supports add/edit/remove items and settings (notification email, enabled toggle).
//
// Each ticker is a card (compact → expandable) that reuses the saved-analyses valuation
// ruler: it sources the user's latest saved Deep Value analysis per ticker, shows the
// intrinsic fair value AND the (item-MoS-adjusted) buy target on one bear→bull axis, and —
// when a red-team Analyst Review exists — the reviewer's fair value + the analysis↔reviewer
// consensus. The buy target uses the *watchlist item's own* MoS (the user's per-ticker knob),
// which is distinct from the analysis's MoS.
import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import { fetchAnalyses } from "@/lib/analyses";
import type { WatchlistItem, WatchlistSettings } from "@/types/watchlist";
import type { SavedAnalysis, AnalystAngle } from "@/types/analysis";
import type { Translations } from "@/lib/i18n/translations";
import { ValuationRuler, ComparisonTable, type Triple } from "@/components/report/valuation-ruler";
import { getVerdict, VERDICT_BADGE, VERDICT_TEXT, type Verdict } from "@/lib/report/verdict";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { presentAnalysts, meanTriple } from "@/lib/report/consensus";
import { EarningsBadge } from "@/components/earnings-badge";
import { isAnalysisStalePreEarnings, isFutureEarnings } from "@/lib/earnings";
import { fetchEarnings, refreshEarnings } from "@/lib/earnings-client";
import type { EarningsEstimate } from "@/types/earnings";

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30";

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
        className="tap self-start rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
      >
        {loading ? t("loadingState") : t("watchlistAddTicker")}
      </button>
    </form>
  );
}

// ─── Watchlist card ───────────────────────────────────────────────────────────

interface CardProps {
  item: WatchlistItem;
  currentPrice: number | null;
  // Currency of the live quote — formats every value; falls back to EUR (never USD, since
  // most watched tickers here are EUR-denominated). The Analysis row has no currency column.
  priceCurrency: string | null;
  // Latest saved Deep Value analysis for this ticker, or null if not analyzed yet.
  analysis: SavedAnalysis | null;
  // AI-fetched next-earnings estimate for this ticker, or null if never fetched.
  earnings: EarningsEstimate | null;
  refreshingEarnings: boolean;
  onRefreshEarnings: (ticker: string, companyName: string) => void;
  onDelete: (id: string) => void;
  onSave: (id: string, mosPercent: number, notes: string | null) => Promise<void>;
  t: (key: keyof Translations) => string;
}

/**
 * One ticker: compact by default (price + verdict + mini ruler), expands to the full
 * valuation ruler + comparison table + edit controls. Reuses the saved-analyses ruler so
 * the two pages read identically. The buy target uses the *watchlist item's* MoS (the user's
 * per-ticker knob), distinct from the analysis's own MoS; reviewer + consensus are secondary
 * marks (verdict/Δ% are driven by the analysis buy target, matching /analyses).
 */
function WatchlistCard({ item, currentPrice, priceCurrency, analysis, earnings, refreshingEarnings, onRefreshEarnings, onDelete, onSave, t }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editMos, setEditMos] = useState(item.mosPercent);
  const [editNotes, setEditNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Ruler/table level: intrinsic fair value vs the (item-MoS-adjusted) buy target.
  const [level, setLevel] = useState<"intrinsic" | "buyTarget">("intrinsic");

  const currency = priceCurrency ?? "EUR";
  const itemMos = item.mosPercent; // fraction 0–0.8, the user's per-ticker knob
  // Display name for each analyst lens (closes over the passed-in t).
  const analystLabel = (angle: AnalystAngle) =>
    angle === "skeptic" ? t("analystSkeptic") : angle === "optimist" ? t("analystOptimist") : t("analystQuality");

  // ── Valuation, derived from the latest saved analysis ──
  const aMos = (analysis?.mosPercent ?? 0) / 100; // the analysis's own MoS
  const hasFV =
    analysis?.fairValueBear != null &&
    analysis?.fairValueBase != null &&
    analysis?.fairValueBull != null;

  // Intrinsic scale: stored fair values are buy targets discounted by the analysis MoS —
  // gross them back up. Buy-target scale: discount the intrinsic by the *item's* MoS.
  const toIntrinsic = (v: number) => grossUpToIntrinsic(v, aMos);
  const toBuyTarget = (v: number) => v * (1 - itemMos);
  const toIntrinsicTriple = (t3: Triple): Triple => ({
    bear: toIntrinsic(t3.bear),
    base: toIntrinsic(t3.base),
    bull: toIntrinsic(t3.bull),
  });

  const intrinsic: Triple | null = hasFV
    ? {
        bear: toIntrinsic(analysis!.fairValueBear!),
        base: toIntrinsic(analysis!.fairValueBase!),
        bull: toIntrinsic(analysis!.fairValueBull!),
      }
    : null;
  // Analyst-panel opinions on the latest analysis, grossed up to the intrinsic scale.
  const analystsIntrinsic = analysis
    ? presentAnalysts(analysis).map(({ angle, triple }) => ({ angle, triple: toIntrinsicTriple(triple) }))
    : [];
  // Consensus (mean of base + every analyst) on the intrinsic scale — null until an analyst runs.
  const consensusIntrinsic: Triple | null =
    intrinsic && analystsIntrinsic.length > 0
      ? meanTriple([intrinsic, ...analystsIntrinsic.map((a) => a.triple)])
      : null;

  const buyTargetBase = intrinsic ? toBuyTarget(intrinsic.base) : null;
  const verdict: Verdict | null =
    intrinsic && buyTargetBase != null && currentPrice != null
      ? getVerdict(currentPrice, buyTargetBase, intrinsic.base)
      : null;
  // Distance of the price from the buy target (the actionable reference).
  const buyTargetPct =
    buyTargetBase != null && currentPrice != null
      ? ((currentPrice - buyTargetBase) / buyTargetBase) * 100
      : null;

  const verdictLabel = (v: Verdict) =>
    v === "buy" ? t("verdictBuy") : v === "watch" ? t("verdictWatch") : t("verdictOver");

  // Ruler marks projected to the selected level (axis + zones stay on the intrinsic scale).
  const projectMark = (v: number) => (level === "buyTarget" ? toBuyTarget(v) : v);
  const markers = intrinsic
    ? {
        analysisLabel: level === "intrinsic" ? t("fvShort") : t("buyTargetBarLabel"),
        analysis: projectMark(intrinsic.base),
        analysts: analystsIntrinsic.map(({ angle, triple }) => ({
          key: angle,
          label: analystLabel(angle),
          value: projectMark(triple.base),
        })),
        consensusLabel: t("consensusLabel"),
        consensus: consensusIntrinsic ? projectMark(consensusIntrinsic.base) : undefined,
      }
    : null;

  // ComparisonTable takes buy-target triples + the item MoS; it re-derives intrinsic.
  const toBuyTargetTriple = (t3: Triple): Triple => ({
    bear: toBuyTarget(t3.bear),
    base: toBuyTarget(t3.base),
    bull: toBuyTarget(t3.bull),
  });
  const analysisBT = intrinsic ? toBuyTargetTriple(intrinsic) : null;
  const analystsBT = analystsIntrinsic.map(({ angle, triple }) => ({
    key: angle,
    label: analystLabel(angle),
    triple: toBuyTargetTriple(triple),
  }));
  const consensusBT = consensusIntrinsic ? toBuyTargetTriple(consensusIntrinsic) : undefined;

  async function handleSaveEdit() {
    setSaving(true);
    try {
      await onSave(item.id, editMos, editNotes || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      {/* Header — toggles expand */}
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-base font-bold text-accent">{item.ticker}</span>
            <span className="truncate text-sm text-slate-400">{item.companyName}</span>
            {analysis?.valuationMethod && (
              <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {analysis.valuationMethod}
              </span>
            )}
            {(analysis?.reviewMd || analysis?.optimistCritiqueMd || analysis?.qualityCritiqueMd) && (
              <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                ✓ {t("analystReviewBadge")}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-medium text-slate-300">
              MoS −{(itemMos * 100).toFixed(0)}%
            </span>
          </div>

          {/* Collapsed summary: price + verdict at a glance */}
          {!expanded && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {currentPrice != null ? (
                <span className="tabular-nums text-slate-300">{formatPrice(currentPrice, currency)}</span>
              ) : (
                <span className="text-slate-600">{t("priceNa")}</span>
              )}
              {verdict && buyTargetPct != null ? (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_BADGE[verdict]}`}>
                  {verdictLabel(verdict)} {buyTargetPct > 0 ? "+" : ""}
                  {buyTargetPct.toFixed(0)}%
                </span>
              ) : !hasFV ? (
                <span className="text-[10px] text-slate-600">{t("watchlistNoLastRun")}</span>
              ) : null}
            </div>
          )}

          {expanded && analysis && (
            <p className="mt-1 text-xs text-slate-500">{formatDate(analysis.createdAt)}</p>
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

      {/* Next-earnings row (AI-fetched). Outside the header toggle so its refresh button
          isn't nested inside another button. Stale pill only when a saved analysis exists. */}
      <div className="mt-1.5">
        <EarningsBadge
          nextEarningsDate={
            isFutureEarnings(earnings?.nextEarningsDate ?? null) ? earnings!.nextEarningsDate : null
          }
          confidence={earnings?.confidence ?? null}
          fetchedAt={earnings?.fetchedAt ?? null}
          stale={
            analysis != null &&
            isAnalysisStalePreEarnings(analysis.createdAt, earnings?.nextEarningsDate ?? null)
          }
          refreshing={refreshingEarnings}
          onRefresh={() => onRefreshEarnings(item.ticker, item.companyName)}
        />
      </div>

      {/* Collapsed mini ruler */}
      {!expanded && intrinsic && buyTargetBase != null && (
        <div className="mt-2">
          <ValuationRuler
            compact
            min={intrinsic.bear}
            max={intrinsic.bull}
            price={currentPrice ?? undefined}
            buyTargetEdge={buyTargetBase}
            fvEdge={intrinsic.base}
            priceLabel={t("priceShort")}
          />
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="mt-3">
          {intrinsic && buyTargetBase != null ? (
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
                min={intrinsic.bear}
                max={intrinsic.bull}
                price={currentPrice ?? undefined}
                buyTargetEdge={buyTargetBase}
                fvEdge={intrinsic.base}
                markers={markers ?? undefined}
                priceLabel={t("priceShort")}
                currency={currency}
              />

              {/* Level toggle — drives the ruler marks + the table (only when the item's
                  margin of safety separates the buy target from the intrinsic value). */}
              {itemMos > 0 && (
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
                analysis={analysisBT!}
                analysts={analystsBT}
                consensus={consensusBT}
                mos={itemMos}
                level={level}
                currency={currency}
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
            <p className="text-xs text-slate-500">{t("watchlistNoLastRun")}</p>
          )}

          {item.notes && !editing && <p className="mt-3 text-xs italic text-muted">{item.notes}</p>}

          {/* Edit form / actions */}
          {editing ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-slate-700/50 pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">
                  {t("watchlistMosPercent")}: {(editMos * 100).toFixed(0)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={editMos}
                  onChange={(e) => setEditMos(parseFloat(e.target.value))}
                  className="w-full max-w-xs accent-sky-500"
                />
              </label>
              <input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t("watchlistNotes")}
                maxLength={500}
                className="w-full max-w-md rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="tap rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? t("savingState") : t("watchlistSaveItem")}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditMos(item.mosPercent);
                    setEditNotes(item.notes ?? "");
                  }}
                  className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-muted transition hover:text-slate-100"
                >
                  {t("cancelBtn")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  window.location.href = `/analyze?ticker=${encodeURIComponent(item.ticker)}`;
                }}
                className="tap rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:brightness-110"
              >
                {t("navDeepValue")}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-muted transition hover:text-slate-100"
              >
                {t("watchlistEditItem")}
              </button>
              {confirmDelete ? (
                <>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="tap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
                  >
                    {t("deleteBtn")}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-muted transition hover:text-slate-100"
                  >
                    {t("cancelBtn")}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="tap rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-muted transition hover:border-red-500/50 hover:text-danger"
                >
                  {t("deleteBtn")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
  const [enabled, setEnabled] = useState(settings.watchlistEnabled);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        watchlistEmail: email || null,
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

          {/* Cadence — the digest is sent daily for everyone (no per-user frequency). */}
          <p className="text-xs text-muted">{t("watchlistDailyNote")}</p>

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
    watchlistEnabled: true,
  });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  // AI-fetched next-earnings estimates per ticker, loaded once from the DB store.
  const [earnings, setEarnings] = useState<Record<string, EarningsEstimate>>({});
  const [refreshingEarnings, setRefreshingEarnings] = useState<Record<string, boolean>>({});
  // Latest saved Deep Value analysis per ticker — the full row, so the card can read the
  // reviewer's fair values + consensus (not just a lossy derived shape).
  const [latestAnalyses, setLatestAnalyses] = useState<Record<string, SavedAnalysis>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualRunLoading, setManualRunLoading] = useState(false);
  const [cooldownMsg, setCooldownMsg] = useState<string | null>(null);

  // Avoid SSR mismatch with Intl formatting
  useEffect(() => setMounted(true), []);

  // Watchlist values come from the user's latest saved Deep Value analysis per ticker
  // (the lite WatchlistRun engine was removed, and lite analysis was removed entirely with Compare).
  useEffect(() => {
    fetchAnalyses()
      .then((analyses) => {
        const latest: Record<string, SavedAnalysis> = {};
        for (const a of analyses) {
          if (a.fairValueBase == null) continue;
          const existing = latest[a.ticker];
          if (!existing || new Date(a.createdAt) > new Date(existing.createdAt)) latest[a.ticker] = a;
        }
        setLatestAnalyses(latest);
      })
      .catch(() => {});
  }, []);

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
      setError(err instanceof Error ? err.message : t("errorUnexpected"));
    } finally {
      setRefreshingEarnings((prev) => ({ ...prev, [ticker]: false }));
    }
  }

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
          return {
            ticker,
            price: data.regularMarketPrice as number,
            currency: data.currency as string,
          };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const priceMap: Record<string, number> = {};
      const currencyMap: Record<string, string> = {};
      for (const r of results) {
        if (r) {
          priceMap[r.ticker] = r.price;
          if (r.currency) currencyMap[r.ticker] = r.currency;
        }
      }
      setPrices(priceMap);
      setCurrencies(currencyMap);
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
        <div className="space-y-3">
          {items.map((item) => (
            <WatchlistCard
              key={item.id}
              item={item}
              currentPrice={prices[item.ticker] ?? null}
              priceCurrency={currencies[item.ticker] ?? null}
              analysis={latestAnalyses[item.ticker] ?? null}
              earnings={earnings[item.ticker] ?? null}
              refreshingEarnings={refreshingEarnings[item.ticker] ?? false}
              onRefreshEarnings={handleRefreshEarnings}
              onDelete={handleDelete}
              onSave={handleSaveItem}
              t={t}
            />
          ))}
          <p className="text-xs text-muted">{t("watchlistRulerHint")}</p>
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
