// Shared valuation result shape — parsed from the AI's leading ```json block,
// either live (deep-value-panel) or reconstructed from a saved Analysis.reportMd.

/**
 * A scenario's declared EV→equity bridge — Grounded mode only (spec
 * §5.5/deep-value-grounding-spec.md). `fairValue` on `Scenario` is a MoS-adjusted buy
 * target; `intrinsicPerShare` here is the PRE-MoS value the bridge arithmetic produces —
 * never the same number as `fairValue` unless MoS is 0 (the §5.4 "MoS trap":
 * lib/grounding/postcheck.ts grosses `fairValue` up via `grossUpToIntrinsic` before
 * comparing it against this field, precisely because they are NOT interchangeable).
 * `multiple` is absent for DCF/DDM, where no single multiple exists.
 */
export type ValuationBridge = {
  driver: string;
  driverValue: number;
  /** The fiscal year driverValue refers to — feeds the horizon_consistent gate (bull/base/
   *  bear must be underwritten to the same year) and the trailing_forward gate (a forward
   *  driverYear isn't directly comparable to a trailing historical distribution). See
   *  docs/deep-value-rigor-v2-spec.md §3/§4. */
  driverYear: number;
  multiple?: number;
  netDebt: number;
  minorities: number;
  shares: number;
  intrinsicPerShare: number;
};

export type Scenario = {
  fairValue: number;
  /** 0..1 — bull+base+bear should sum to ≈1. Feeds the probabilities gate and
   *  PostCheck.expectedValue (docs/deep-value-rigor-v2-spec.md §4). Optional: absent on
   *  older saved reports and on any report where the model didn't declare one. */
  probability?: number;
  bridge?: ValuationBridge;
};

/** The model's own valuation-lever inputs — feeds the roic_vs_wacc gate. Optional/nullable
 *  throughout: unvalidated LLM output, absent on Quick-mode reports that predate this
 *  field. */
export type ValuationAssumptions = {
  wacc: number | null; // %
  roic: number | null; // %, on invested capital — not ROE
  terminalGrowth: number | null; // %
};

/** A second, structurally different valuation method the model is required to produce and
 *  reconcile against the primary one (rigor check 17, "second method mandatory") — feeds
 *  the cross_check gate. */
export type CrossCheck = {
  method: string; // e.g. "DDM" | "EV/RAB" | "SOTP" — different from the primary `method`
  intrinsicPerShare: number; // BASE scenario, pre-MoS
  reconciliation: string; // 1-2 sentences: why the two methods diverge
};

export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
  assumptions?: ValuationAssumptions;
  crossCheck?: CrossCheck;
};

/** Analyst-lens-only fields, layered on top of DeepValueResult — the shape one lens's JSON
 *  block actually carries (docs/deep-value-rigor-v2-spec.md §3). Everything else in a
 *  lens's block is identical to DeepValueResult. */
export type AnalystResult = DeepValueResult & {
  /** Skeptic lens only. The price below which the thesis is dead. null ONLY when the lens
   *  explicitly declares it cannot construct one — never a silent omission. Feeds the
   *  kill_price gate. */
  killPrice?: number | null;
  /** Blind-first mode only (docs/deep-value-rigor-v2-spec.md §6) — the machine-readable
   *  drift between the lens's blind (pre-report) commitment and its final (post-report)
   *  one. Empty array = no revisions, not "not applicable". */
  revisions?: { scenario: "bull" | "base" | "bear"; from: number; to: number; reason: string }[];
};
