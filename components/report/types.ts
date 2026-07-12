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
  multiple?: number;
  netDebt: number;
  minorities: number;
  shares: number;
  intrinsicPerShare: number;
};

export type Scenario = { fairValue: number; bridge?: ValuationBridge };

export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
};
