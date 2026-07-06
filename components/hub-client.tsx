"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useLanguage } from "@/context/language-context";
import { fetchAnalyses } from "@/lib/analyses";
import { fetchSnapshots } from "@/lib/portfolio";
import { formatCurrency } from "@/lib/format";
import type { Translations } from "@/lib/i18n/translations";
import type { SavedAnalysis } from "@/types/analysis";
import type { SnapshotPoint } from "@/types/portfolio";

const STEP_CARD_CLASS = "card group flex flex-col gap-1 transition hover:border-sky-500/40";

/**
 * Adaptive Hub home (`/`) — frames the value-investing pipeline and routes into it.
 *
 * Renders for everyone with NO login wall: logged-out visitors see the three-stage
 * pipeline, a primary "start with the advisor" CTA, and a quick ticker box. When
 * logged in, a recent-activity strip (last analyses, portfolio P&L, watchlist count)
 * lets the user resume. The deep-dive lives at `/analyze`.
 *
 * @param isAuthed - whether a session exists (resolved server-side, passed as a primitive
 *                   so the session object never crosses into the client bundle)
 */
export default function HubClient({ isAuthed }: { isAuthed: boolean }) {
  const { t } = useLanguage();
  const [ticker, setTicker] = useState("");

  function goAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    // Full navigation (not router.push) so /analyze remounts and reads ?ticker= (Router-Cache gotcha).
    window.location.href = `/analyze?ticker=${encodeURIComponent(symbol)}`;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("appTitle")}</h1>
        <p className="mt-2 text-base text-muted">{t("hubTagline")}</p>
      </header>

      {/* The three-stage pipeline — each card routes into its stage */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/advisor" className={STEP_CARD_CLASS}>
          <StepBody num="1" title={t("hubStepDiscoverTitle")} desc={t("hubStepDiscoverDesc")} />
        </Link>
        <Link href="/analyze" className={STEP_CARD_CLASS}>
          <StepBody num="2" title={t("hubStepDecideTitle")} desc={t("hubStepDecideDesc")} />
        </Link>
        <Link href="/watchlist" className={STEP_CARD_CLASS}>
          <StepBody num="3" title={t("hubStepMonitorTitle")} desc={t("hubStepMonitorDesc")} />
        </Link>
      </div>

      {/* Primary actions: start the pipeline, or jump straight to a ticker */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href="/advisor"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          {t("hubPrimaryCta")}
        </Link>
        <form onSubmit={goAnalyze} className="flex flex-1 items-center gap-2">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder={t("hubTickerPlaceholder")}
            maxLength={12}
            className="w-full rounded-lg border border-slate-700/60 bg-[var(--card)] px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-sky-500/50 focus:ring-2 focus:ring-sky-400/30"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-sky-500/50 hover:text-sky-300"
          >
            {t("analyzeBtn")}
          </button>
        </form>
      </div>

      {isAuthed && <RecentActivity t={t} />}
    </main>
  );
}

function StepBody({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <>
      <span className="text-xs font-semibold text-accent">{num}</span>
      <span className="font-display text-base font-semibold text-slate-100">{title}</span>
      <span className="text-xs leading-relaxed text-muted">{desc}</span>
    </>
  );
}

/**
 * Logged-in recent-activity strip. Reuses existing client helpers (no new endpoints).
 * Each fetch degrades to an empty state on failure — calm, no error surface.
 */
function RecentActivity({ t }: { t: (key: keyof Translations) => string }) {
  const [analyses, setAnalyses] = useState<SavedAnalysis[] | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotPoint[] | null>(null);
  const [watchCount, setWatchCount] = useState<number | null>(null);
  // Fetch once on mount (gated by isAuthed at the call site) — avoids the useSession re-render loop.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    fetchAnalyses().then(setAnalyses).catch(() => setAnalyses([]));
    fetchSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    fetch("/api/watchlist")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setWatchCount(Array.isArray(d.items) ? d.items.length : 0))
      .catch(() => setWatchCount(0));
  }, []);

  const recent = (analyses ?? []).slice(0, 3); // fetchAnalyses returns newest-first
  const last = snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const pnl = last ? last.totalEur - last.costEur : null;
  const pnlPct = last && last.costEur > 0 && pnl != null ? (pnl / last.costEur) * 100 : null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t("hubRecentTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Recent analyses */}
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">{t("hubRecentAnalysesTitle")}</span>
            <Link href="/analyses" className="text-xs text-accent hover:text-sky-300">{t("hubViewAll")}</Link>
          </div>
          {recent.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/analyses/${a.id}`}
                    className="flex items-center justify-between text-xs text-slate-300 transition hover:text-slate-100"
                  >
                    <span className="font-mono">{a.ticker}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">{t("hubRecentEmpty")}</p>
          )}
        </div>

        {/* Portfolio P&L (latest snapshot) */}
        <Link href="/portfolio" className="card transition hover:border-sky-500/40">
          <span className="text-sm font-semibold text-slate-100">{t("hubRecentPortfolioTitle")}</span>
          {pnl != null ? (
            <p className={`mt-2 font-display text-xl font-bold ${pnl >= 0 ? "text-success" : "text-danger"}`}>
              {pnl >= 0 ? "+" : ""}
              {formatCurrency(pnl, "EUR")}
              {pnlPct != null && (
                <span className="ml-1 text-xs">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
              )}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">{t("hubRecentEmpty")}</p>
          )}
        </Link>

        {/* Watchlist count */}
        <Link href="/watchlist" className="card transition hover:border-sky-500/40">
          <span className="text-sm font-semibold text-slate-100">{t("hubRecentWatchlistTitle")}</span>
          <p className="mt-2 font-display text-xl font-bold text-slate-100">
            {watchCount != null ? watchCount : "—"}
            <span className="ml-1 text-xs font-normal text-muted">{t("hubWatchlistTracked")}</span>
          </p>
        </Link>
      </div>
    </section>
  );
}
