// Shared valuation math for Deep Value reports.
//
// Stored Deep Value fair values (`fairValue{Bear,Base,Bull}`, and the reviewer's
// `reviewFairValue*`) are MoS-adjusted **buy targets** — intrinsic × (1 − mos). The
// intrinsic value is never stored; it is reconstructed on the fly. This one formula was
// copy-pasted across the analyses list, the watchlist (client + server digest), the recap
// table, the fair-value cards and the advisor prompts; centralize it here.

/**
 * Reconstructs the intrinsic fair value from a stored MoS-adjusted buy target.
 *
 * @param buyTarget   The stored value (= intrinsic × (1 − mos)).
 * @param mosFraction Margin of safety as a fraction in [0, 1) — e.g. 0.2 for 20%.
 * @returns           The intrinsic fair value (unchanged when mos is 0).
 */
export function grossUpToIntrinsic(buyTarget: number, mosFraction: number): number {
  return mosFraction > 0 ? buyTarget / (1 - mosFraction) : buyTarget;
}

/**
 * A bear/base/bull valuation triple (buy-target scale unless stated otherwise). Lives here
 * — the pure valuation module — so both server code (watchlist digest) and the client ruler
 * can share it without importing types from a "use client" component.
 */
export type Triple = { bear: number; base: number; bull: number };
