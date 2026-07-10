"use client";

// Shared valuation visualization for Deep Value reports: one bear→bull axis carrying the
// price, buy/watch/rich zones, analysis + reviewer fair-value marks and the consensus, plus
// a compact figures table behind it. Extracted from the saved-analyses card so the watchlist
// reuses the exact same surface. Callers pass fully-resolved numeric values (already grossed
// up / projected to the selected level) — this module is presentation only.

import { Fragment, type ReactNode } from "react";
import type { Triple } from "@/lib/report/valuation";

// Re-exported for existing consumers that import Triple from this module.
export type { Triple };

// Tick color per analyst lens, keyed by angle. Static strings (not `bg-${key}`) so Tailwind's
// purge step keeps them in the production bundle. Skeptic keeps the original slate tick; the
// two newer lenses get distinct hues that don't collide with the emerald/amber zones, the
// white price dot, or the sky consensus diamond.
const ANALYST_TICK_BG: Record<string, string> = {
  skeptic: "bg-slate-400",
  optimist: "bg-fuchsia-400",
  quality: "bg-indigo-300",
};

// Returns a value in [0, 1] representing where `value` falls in [min, max], clamped.
export function axisFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// Currency-aware when `currency` is passed; otherwise a plain 2-decimal number (the saved
// analyses card renders on the intrinsic scale without a currency symbol).
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

// ─── Valuation ruler ─────────────────────────────────────────────────────────

/**
 * The card's hero: one bear→bull axis (intrinsic scale). Three zones encode the decision —
 * emerald = buy (≤ buy target), amber = watch (buy target→FV), neutral = rich (≥ FV) — so the
 * price dot's zone matches the verdict badge. When analysts have run, one colored tick per
 * lens marks its FV and a sky diamond marks the consensus (mean of the base + every analyst),
 * making the panel's disagreement legible spatially. `compact` renders the thin collapsed
 * variant (zones + price only, no ticks/labels).
 */
export function ValuationRuler({
  min,
  max,
  price,
  buyTargetEdge,
  fvEdge,
  markers,
  priceLabel,
  currency,
  compact = false,
}: {
  min: number;
  max: number;
  price?: number;
  // Zone edges (fixed on the intrinsic axis, independent of the level toggle):
  // buy zone runs to buyTargetEdge, watch zone from there to fvEdge.
  buyTargetEdge: number;
  fvEdge: number;
  // Marks + their current values (already projected to the selected level). Absent in the
  // compact variant and when the analysis carries no fair values.
  markers?: {
    analysisLabel: string;
    analysis: number;
    // One entry per analyst lens that has a value, keyed by angle (drives the tick color).
    analysts?: { key: string; label: string; value: number }[];
    consensusLabel: string;
    consensus?: number;
  };
  priceLabel: string;
  currency?: string;
  compact?: boolean;
}) {
  const pct = (v: number) => axisFraction(v, min, max) * 100;
  const buyPct = pct(buyTargetEdge);
  const fvPct = pct(fvEdge);
  const pricePct = price != null ? pct(price) : null;

  const zones = (
    <>
      {/* Buy zone (cheap enough, incl. margin of safety) */}
      <div className="absolute inset-y-0 left-0 bg-emerald-500/25" style={{ width: `${buyPct}%` }} />
      {/* Watch zone (between buy target and fair value) — only when MoS opens a gap */}
      {fvPct > buyPct + 0.5 && (
        <div
          className="absolute inset-y-0 bg-amber-500/20"
          style={{ left: `${buyPct}%`, width: `${fvPct - buyPct}%` }}
        />
      )}
    </>
  );

  if (compact) {
    return (
      <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-700/40">
        {zones}
        {pricePct != null && (
          <div
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900 bg-white"
            style={{ left: `${pricePct}%` }}
          />
        )}
      </div>
    );
  }

  // Values live in a legend row (labelling the marks in place would collide when
  // FV/reviewer/consensus sit close together); each legend key re-decodes a mark by glyph,
  // and the whole set updates when the level toggle flips FV ↔ buy target.
  const priceGlyph = <span className="inline-block h-2 w-2 rounded-full border border-slate-900 bg-white" />;
  const analysisGlyph = <span className="inline-block h-3 w-0.5 bg-slate-100" />;
  const consensusGlyph = <span className="inline-block h-2 w-2 rotate-45 bg-sky-400" />;
  const analystGlyph = (key: string) => (
    <span className={`inline-block h-3 w-0.5 ${ANALYST_TICK_BG[key] ?? "bg-slate-400"}`} />
  );

  const legend: { key: string; glyph: ReactNode; label: string; value: number }[] = [];
  if (price != null) legend.push({ key: "p", glyph: priceGlyph, label: priceLabel, value: price });
  if (markers) {
    legend.push({ key: "a", glyph: analysisGlyph, label: markers.analysisLabel, value: markers.analysis });
    for (const an of markers.analysts ?? [])
      legend.push({ key: `an-${an.key}`, glyph: analystGlyph(an.key), label: an.label, value: an.value });
    if (markers.consensus != null)
      legend.push({ key: "c", glyph: consensusGlyph, label: markers.consensusLabel, value: markers.consensus });
  }

  return (
    <div>
      {/* Zoned track */}
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-700/40">{zones}</div>

      {/* Tick layer overlaid on the track (negative margin) so the tall ticks aren't clipped
          by the track's overflow-hidden. */}
      <div className="relative -mt-2.5 h-2.5">
        {markers && (
          <>
            <div
              className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-slate-100"
              style={{ left: `${pct(markers.analysis)}%` }}
            />
            {(markers.analysts ?? []).map((an) => (
              <div
                key={an.key}
                className={`absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 ${ANALYST_TICK_BG[an.key] ?? "bg-slate-400"}`}
                style={{ left: `${pct(an.value)}%` }}
              />
            ))}
            {markers.consensus != null && (
              <div
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-slate-900 bg-sky-400"
                style={{ left: `${pct(markers.consensus)}%` }}
              />
            )}
          </>
        )}
        {pricePct != null && (
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white shadow"
            style={{ left: `${pricePct}%` }}
          />
        )}
      </div>

      {/* Endpoints — neutral axis scale (intrinsic bear→bull). */}
      <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-slate-500">
        <span>{formatPrice(min, currency)}</span>
        <span>{formatPrice(max, currency)}</span>
      </div>

      {/* Legend with values — decodes each mark and updates with the level toggle. */}
      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          {legend.map((item) => (
            <span key={item.key} className="flex items-center gap-1">
              {item.glyph}
              <span className="text-slate-500">{item.label}</span>
              <span className="font-semibold text-slate-200 tabular-nums">{formatPrice(item.value, currency)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Comparison table ────────────────────────────────────────────────────────

/**
 * Compact figures behind the ruler: rows Bull/Base/Bear, columns Analysis / <each analyst> /
 * Consensus. Analyst + Consensus columns appear only when those opinions exist. The `level`
 * (intrinsic value vs MoS-adjusted buy target) is controlled by the parent so the ruler and
 * the table stay in sync. Inputs are the buy-target triples; intrinsic is reconstructed as
 * target / (1 - mos).
 */
export function ComparisonTable({
  analysis,
  analysts,
  consensus,
  mos,
  level,
  labels,
  currency,
}: {
  analysis: Triple;
  // One column per analyst lens that has run, keyed by angle.
  analysts?: { key: string; label: string; triple: Triple }[];
  consensus?: Triple;
  mos: number;
  level: "intrinsic" | "buyTarget";
  labels: {
    analysis: string;
    consensus: string;
    bear: string;
    base: string;
    bull: string;
  };
  currency?: string;
}) {
  const project = (t: Triple): Triple =>
    level === "intrinsic" && mos > 0
      ? { bear: t.bear / (1 - mos), base: t.base / (1 - mos), bull: t.bull / (1 - mos) }
      : t;

  const cols: { key: string; label: string; triple: Triple; emphasize?: boolean }[] = [
    { key: "a", label: labels.analysis, triple: project(analysis) },
    ...(analysts ?? []).map((an) => ({ key: `an-${an.key}`, label: an.label, triple: project(an.triple) })),
    ...(consensus ? [{ key: "c", label: labels.consensus, triple: project(consensus), emphasize: true }] : []),
  ];

  const rows: { key: keyof Triple; label: string; tone: string; emphasize?: boolean }[] = [
    { key: "bull", label: labels.bull, tone: "text-emerald-400" },
    { key: "base", label: labels.base, tone: "text-slate-200", emphasize: true },
    { key: "bear", label: labels.bear, tone: "text-rose-400" },
  ];

  const gridCols = `minmax(2.5rem, auto) repeat(${cols.length}, minmax(0, 1fr))`;

  return (
    <div className="mt-3">
      <div
        className="grid items-center gap-x-2 text-xs tabular-nums"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span />
        {cols.map((c) => (
          <span
            key={c.key}
            className={`px-1 py-1 text-right text-[10px] font-semibold uppercase tracking-wide ${
              c.emphasize ? "text-sky-300" : "text-slate-500"
            }`}
          >
            {c.label}
          </span>
        ))}

        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className={`py-1 text-[11px] font-medium ${r.tone}`}>{r.label}</span>
            {cols.map((c) => {
              const color = c.emphasize ? "text-slate-100" : r.emphasize ? "text-slate-200" : "text-slate-400";
              const weight = r.emphasize || c.emphasize ? "font-semibold" : "";
              return (
                <span key={c.key} className={`px-1 py-1 text-right ${color} ${weight}`}>
                  {formatPrice(c.triple[r.key], currency)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
