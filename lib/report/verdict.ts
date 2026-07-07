// Where the live price sits relative to the (MoS-adjusted) buy target and the intrinsic
// base fair value — the one thing a valuation card exists to answer. Shared by the saved
// analyses list and the watchlist.

export type Verdict = "buy" | "watch" | "over";

/**
 * Classifies the current price against a valuation.
 *
 * @param price         Live market price.
 * @param buyTargetBase The MoS-adjusted base buy target (cheap-enough threshold).
 * @param intrinsicBase The intrinsic base fair value.
 * @returns "buy" (≤ buy target), "watch" (buy target→FV), or "over" (≥ FV).
 */
export function getVerdict(price: number, buyTargetBase: number, intrinsicBase: number): Verdict {
  if (price <= buyTargetBase) return "buy";
  if (price <= intrinsicBase) return "watch";
  return "over";
}

// Static class maps — Tailwind purges runtime-assembled class strings, so the full literal
// must appear here (never `bg-${...}`). See AGENTS "dynamic classes" rule.
export const VERDICT_BADGE: Record<Verdict, string> = {
  buy: "bg-emerald-500/15 text-emerald-300",
  watch: "bg-amber-500/15 text-amber-300",
  over: "bg-slate-700/60 text-slate-300",
};
export const VERDICT_TEXT: Record<Verdict, string> = {
  buy: "text-emerald-300",
  watch: "text-amber-300",
  over: "text-slate-400",
};
