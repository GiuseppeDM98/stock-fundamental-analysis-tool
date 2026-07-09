"use client";

import { useEffect, useState } from "react";

import { useLanguage } from "@/context/language-context";
import { formatEarningsDate } from "@/lib/earnings";
import type { EarningsConfidence } from "@/types/earnings";

/**
 * Next-earnings badge + refresh control, shared across /analyses, the watchlist and the
 * portfolio. The date is fetched on demand by the AI (Sonnet 5 + web search) and persisted;
 * this component renders whatever the caller loaded from the store and exposes the button
 * that triggers a (re)fetch.
 *
 * Three visual states, driven by the props:
 * - never fetched (`fetchedAt` absent) → a single "Find next earnings (AI)" button;
 * - fetched with a date → "Next earnings: <date>" (prefixed "~" when not officially
 *   confirmed) + "updated <fetchedAt>" + a small refresh button + optional amber stale pill;
 * - fetched but no date found → "No date found" + refresh button.
 */
export function EarningsBadge({
  nextEarningsDate,
  confidence,
  fetchedAt,
  stale = false,
  onRefresh,
  refreshing = false,
}: {
  nextEarningsDate: string | null;
  confidence: EarningsConfidence | null;
  fetchedAt?: string | null;
  stale?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t, locale } = useLanguage();

  // Date formatting is locale-dependent (Intl) → guard against an SSR/client hydration
  // mismatch (AGENTS.md › Hydration). The stored data also only arrives after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // State 1 — never fetched for this ticker: offer the initial lookup button.
  if (!fetchedAt) {
    return onRefresh ? (
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="tap inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-60"
      >
        {refreshing ? "…" : "📅"} {t("findEarningsAi")}
      </button>
    ) : null;
  }

  const dateLabel = nextEarningsDate ? formatEarningsDate(nextEarningsDate, locale) : "";
  const updatedLabel = formatEarningsDate(fetchedAt, locale);
  const estimated = confidence !== "confirmed";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted">
      {dateLabel ? (
        <span>
          {t("nextEarnings")}: {estimated ? "~" : ""}
          {dateLabel}
        </span>
      ) : (
        <span className="text-slate-500">{t("noEarningsFound")}</span>
      )}

      {updatedLabel && (
        <span className="text-slate-600">
          · {t("earningsUpdatedAt")} {updatedLabel}
        </span>
      )}

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t("refreshEarnings")}
          className="tap rounded-full border border-slate-700 px-1.5 py-0.5 text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-60"
        >
          {refreshing ? "…" : "🔄"}
        </button>
      )}

      {stale && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
          ⚠ {t("staleSinceEarnings")}
        </span>
      )}
    </span>
  );
}
