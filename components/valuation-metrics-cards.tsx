"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import {
  computeValuationMetrics,
  TrendDirection,
  ValuationMetric,
} from "@/lib/valuation/valuation-metrics";

type Props = {
  quote: QuoteResponse;
  fundamentals: FundamentalsResponse;
};

/**
 * Displays the year-over-year trend of an earnings or FCF figure.
 *
 * "Up" means the underlying fundamental improved (earnings/FCF grew),
 * which is favorable even though it reduces the "years" payback number.
 * Colors follow the same emerald/rose convention used in FairValueCard.
 */
function TrendBadge({ direction }: { direction: TrendDirection }) {
  if (direction === "up") {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-emerald-400">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <path d="M5 15l7-7 7 7" />
        </svg>
        Migliorato
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-rose-400">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <path d="M19 9l-7 7-7-7" />
        </svg>
        Peggiorato
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-slate-400">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <path d="M4 12h16" />
      </svg>
      Stabile
    </span>
  );
}

/**
 * Info modal rendered via a portal directly into document.body.
 *
 * Using a portal (instead of absolute positioning inside the card) avoids
 * the card's overflow:hidden or stacking context clipping the popover.
 * The modal is centered on screen and dismissible by clicking the backdrop.
 */
function InfoModal({
  metric,
  onClose,
}: {
  metric: ValuationMetric;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Modal panel — bg-[var(--card)] is the solid #121a2b card color, fully opaque */}
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-700/60 bg-[var(--card)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="text-base font-bold text-white">{metric.label}</p>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-white hover:bg-white/10 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Cos&apos;è?</p>
        <p className="text-sm text-white leading-relaxed">{metric.info.description}</p>

        <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Come si legge?</p>
        <p className="text-sm text-white leading-relaxed">{metric.info.howToRead}</p>
      </div>
    </div>,
    document.body
  );
}

/**
 * Grid of 4 payback/yield cards placed above the historical charts.
 *
 * Each card expresses how many years of earnings or FCF it would take to
 * "buy back" the current market cap — a more intuitive framing of P/E and P/FCF
 * for non-finance readers. FCF Yield and Earnings Yield are the inverse view.
 *
 * The "?" button on each card opens an educational modal explaining
 * the metric and how to interpret its value.
 */
export function ValuationMetricsCards({ quote, fundamentals }: Props) {
  const metrics = computeValuationMetrics(quote, fundamentals);
  // Tracks which card's info modal is open (by label), null = all closed
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const openMetric = metrics.find((m) => m.label === openInfo) ?? null;

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="card">
            {/* Header row: label + info button */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                {metric.label}
              </p>
              <button
                onClick={() => setOpenInfo(metric.label)}
                aria-label={`Informazioni su ${metric.label}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-muted hover:text-white hover:bg-white/10 transition-colors"
              >
                ?
              </button>
            </div>

            {/* Main value + trend badge */}
            <div className="mt-3 flex items-end justify-between gap-2">
              <p className="font-display text-2xl font-bold">{metric.value}</p>
              {metric.trend !== null && <TrendBadge direction={metric.trend} />}
            </div>

            {/* N/A explanation (e.g. "Richiede FCF positivo") */}
            {metric.tooltip && (
              <p className="mt-1 text-xs text-muted">{metric.tooltip}</p>
            )}
          </div>
        ))}
      </div>

      {/* Portal modal — rendered outside the card DOM tree to avoid clipping */}
      {openMetric && (
        <InfoModal metric={openMetric} onClose={() => setOpenInfo(null)} />
      )}
    </>
  );
}
