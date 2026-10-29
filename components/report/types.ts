// Shared valuation result shape — parsed from the AI's final ```json block (older saved
// reports carry it at the top instead), either live (deep-value-panel), from the sanitized
// Analysis.resultJson column, or reconstructed from a saved Analysis.reportMd.

/**
 * A scenario's declared value bridge. The prompt asks for it in every mode and for every
 * method (2026-10: equity-value methods declare netDebt = minorities = 0, SOTP/NAV/EV-RAB
 * omit the multiple); it stays optional here because reports saved before then have none.
 * `fairValue` on `Scenario` is a MoS-adjusted buy target; `intrinsicPerShare` here is the
 * PRE-MoS value the bridge arithmetic produces — never the same number as `fairValue`
 * unless MoS is 0 (comparing them directly would fail every check:
 * lib/grounding/postcheck.ts grosses `fairValue` up via `grossUpToIntrinsic` before
 * comparing it against this field, precisely because they are NOT interchangeable).
 * `multiple` is absent for DCF/DDM/NAV/SOTP/EV-RAB/Residual Income, where no single
 * multiple applies to the driver.
 */
export type ValuationBridge = {
  driver: string;
  driverValue: number;
  /** The fiscal year driverValue refers to — feeds the horizon_consistent gate (bull/base/
   *  bear must be underwritten to the same year) and the trailing_forward gate (a forward
   *  driverYear isn't directly comparable to a trailing historical distribution). */
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
   *  PostCheck.expectedValue. Optional: absent on older saved reports and on any report
   *  where the model didn't declare one. */
  probability?: number;
  bridge?: ValuationBridge;
};

/** The model's own valuation-lever inputs — feeds the roic_vs_wacc gate. Optional/nullable
 *  throughout: unvalidated LLM output, absent on Quick-mode reports that predate this
 *  field. Every lever is in PERCENTAGE POINTS (8.5 = 8.5%), as the prompt states: the
 *  sanitizer nulls a value outside [-50, 100], which is how a fraction (0.085) or a
 *  basis-point figure (850) shows up. */
export type ValuationAssumptions = {
  wacc: number | null; // percentage points
  roic: number | null; // percentage points, on invested capital — not ROE
  terminalGrowth: number | null; // percentage points
};

/** A second, structurally different valuation method the model is required to produce and
 *  reconcile against the primary one (rigor check 17, "second method mandatory") — feeds
 *  the cross_check gate. */
export type CrossCheck = {
  method: string; // e.g. "DDM" | "EV/RAB" | "SOTP" — different from the primary `method`
  intrinsicPerShare: number; // BASE scenario, pre-MoS
  reconciliation: string; // 1-2 sentences: why the two methods diverge
  /** The cross-check's OWN value bridge — requested in every mode since 2026-10 (only
   *  Grounded before), with `multiple` omitted when the cross-check method has none (e.g.
   *  DDM). Lets lib/grounding/postcheck.ts verify
   *  the cross-check's own arithmetic and same-basis-ness, the same way it does for
   *  bull/base/bear. `intrinsicPerShare` is deliberately NOT
   *  repeated here — it's the field above, shared with the recomputed value. Added after a
   *  live run (Webuild) showed the primary method can have no `multiple` to basis-check at
   *  all (DCF/DDM) while the cross-check is exactly where an unverified basis mismatch
   *  surfaces (the basis_same gate is "unavailable" in that case — this bridge is what
   *  the cross_check_basis gate checks instead). */
  bridge?: Omit<ValuationBridge, "intrinsicPerShare">;
};

export type SensitivityLever = { name: string; values: [number, number, number] };

/** 3×3 grid declared by the model: rows follow leverA.values, columns leverB.values; the
 *  centre cell [1][1] must equal the BASE intrinsic value — the prompt demands it and the
 *  sensitivity_center gate (lib/grounding/postcheck.ts) checks it, plus a monotonic centre
 *  row and column.
 *  The model's own grid, with levers of its choosing — distinct from the Grounded anchors'
 *  grid, which the code computes on historical multiples as a control. */
export type Sensitivity = {
  leverA: SensitivityLever;
  leverB: SensitivityLever;
  intrinsicPerShare: [[number, number, number], [number, number, number], [number, number, number]];
};

export type DividendPathYear = { year: number; bull: number; base: number; bear: number };

/** The model's dividend outlook. null when the company pays no dividend. */
export type DividendPath = {
  policy: string; // one sentence: stated payout policy, or "none stated"
  lastDps: number; // total ORDINARY DPS of the latest COMPLETE fiscal year (interim + final, specials excluded)
  path: [DividendPathYear, DividendPathYear, DividendPathYear]; // next 3 fiscal years, annual totals on the same basis; year = the fiscal year's END year
};

/** The scale of every monetary figure inside the bridges (shares on the same scale). */
export type ValuationUnits = "billions" | "millions" | "thousands" | "units";

export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  units?: ValuationUnits;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
  assumptions?: ValuationAssumptions; // percentage points (8.5 = 8.5%)
  crossCheck?: CrossCheck;
  sensitivity?: Sensitivity;
  /** null = the model declared a non-payer; undefined = not declared (older reports, the
   *  analyst lenses, or a malformed block). */
  dividends?: DividendPath | null;
};

/** Analyst-lens-only fields, layered on top of DeepValueResult — the shape one lens's JSON
 *  block actually carries. Everything else in a lens's block is identical to
 *  DeepValueResult. */
export type AnalystResult = DeepValueResult & {
  /** Skeptic lens only. The price below which the thesis is dead. null ONLY when the lens
   *  explicitly declares it cannot construct one — never a silent omission. Feeds the
   *  kill_price gate. */
  killPrice?: number | null;
  /** Skeptic lens only. Why no kill price could be constructed — set together with a null
   *  `killPrice` when the lens explicitly declines (e.g. a thesis that has no single price
   *  trigger). A null killPrice WITH a non-empty note is an honest "unavailable" for the
   *  kill_price gate; a null WITHOUT one is a silent omission and fails it. */
  killPriceNote?: string;
  /** Blind-first mode only — the machine-readable drift between the lens's blind
   *  (pre-report) commitment and its final (post-report) one. Empty array = no revisions,
   *  not "not applicable". */
  revisions?: { scenario: "bull" | "base" | "bear"; from: number; to: number; reason: string }[];
};
