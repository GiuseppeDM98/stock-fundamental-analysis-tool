// The valuation-bridge postcondition — the piece that closes the circle (spec §1, "Il pezzo
// che chiude il cerchio"). The model declares its own EV→equity bridge per scenario in the
// JSON block; this module recomputes the fair value FROM that bridge and compares it against
// what the model claims, then derives a method-agnostic implied multiple and flags when it
// coincides with the price-implied one (the exact pathology ANALYTICAL_RIGOR_BLOCK item 10
// asks the model not to fall into). Pure, no server-only. See
// docs/deep-value-grounding-spec.md §5.4.
import type { GroundedFinancials } from "@/types/grounding";
import type { Scenario, ValuationBridge } from "@/components/report/types";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { computeMarketImplied, percentileOf, type MarketImplied } from "@/lib/grounding/anchors";

// Re-exported for backward compatibility with this module's own tests/callers, which
// import these names from here — the canonical definitions now live on the real,
// extended Deep Value JSON contract (components/report/types.ts), wired in this session
// (spec §5.5/§9 commit 6) rather than the local mirror an earlier session used as a
// placeholder.
export type { ValuationBridge };
export type BridgeScenario = Scenario;

/** The subset of the extended Deep Value JSON contract this postcheck needs. */
export type BridgeCheckInput = {
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
};

export type BridgeCheck = {
  scenario: "bear" | "base" | "bull";
  statedIntrinsic: number; // fairValue grossed up via the app's own mosPercent
  recomputedIntrinsic: number | null; // recomputed from the bridge's OWN multiple; null for DCF/DDM
  arithmeticOk: boolean | null; // Check A: recomputedIntrinsic ≈ intrinsicPerShare, within ±1%
  mosOk: boolean | null; // Check B: statedIntrinsic ≈ intrinsicPerShare, within ±1%
  impliedMultiple: number | null; // method-agnostic: derived from intrinsicPerShare, not `multiple`
  impliedPercentile: number | null;
};

export type PostCheck = {
  scenarios: BridgeCheck[];
  marketImplied: MarketImplied;
  priceAnchoringFlag: boolean;
};

// Check A/B tolerance — the model's own declared numbers being cross-checked against each
// other, not noisy third-party data, so a tight band is appropriate (spec §5.4: "entro ±1%").
const ARITHMETIC_TOLERANCE = 0.01;
const MOS_TOLERANCE = 0.01;
// priceAnchoringFlag threshold — spec §5.1 ("< 0.03"). The Eni v2 case (base 4.2x vs
// market-implied 4.18x, Δ≈0.5%) sits comfortably inside this band.
const ANCHOR_TOLERANCE = 0.03;

function relDiff(value: number, reference: number): number {
  return Math.abs(value - reference) / (Math.abs(reference) || 1);
}

function checkOneScenario(
  scenario: BridgeCheck["scenario"],
  input: BridgeScenario,
  mosPercent: number,
  extract: GroundedFinancials,
): BridgeCheck {
  const { fairValue, bridge } = input;

  // Trap (spec §5.4): fairValue is a MoS-adjusted buy target, never compare it directly
  // against intrinsicPerShare. Gross it up first via the SHARED helper (not reimplemented).
  const statedIntrinsic = grossUpToIntrinsic(fairValue, mosPercent / 100);

  // `bridge` is optional on Scenario (Quick reports, and older saved reports, never had
  // it) — the Grounded prompt instructs the model to always include it, but this is
  // untrusted LLM output, not a validated schema. Degrade every downstream check to null
  // rather than throw when the model didn't declare one for this scenario.
  if (!bridge) {
    return { scenario, statedIntrinsic, recomputedIntrinsic: null, arithmeticOk: null, mosOk: null, impliedMultiple: null, impliedPercentile: null };
  }

  // Check A — the model's own bridge arithmetic. Only computable when it declared a
  // `multiple` (absent for DCF/DDM, per spec §5.5) and shares is non-zero.
  let recomputedIntrinsic: number | null = null;
  let arithmeticOk: boolean | null = null;
  if (bridge.multiple != null && bridge.shares !== 0) {
    recomputedIntrinsic = (bridge.multiple * bridge.driverValue - bridge.netDebt - bridge.minorities) / bridge.shares;
    arithmeticOk = relDiff(recomputedIntrinsic, bridge.intrinsicPerShare) < ARITHMETIC_TOLERANCE;
  }

  // Check B — does the app's own MoS gross-up of the reported fairValue land back on the
  // model's declared intrinsic? Independent of Check A: this catches a wrong MoS
  // application even when the bridge's internal arithmetic (Check A) is fine.
  const mosOk = relDiff(statedIntrinsic, bridge.intrinsicPerShare) < MOS_TOLERANCE;

  // Method-agnostic implied multiple: derived from the model's OWN intrinsicPerShare, not
  // its (possibly absent) declared `multiple` — works identically for DCF/DDM/P-B, since a
  // per-share intrinsic always implies SOME EV/EBITDA once bridged back through the same
  // driver/netDebt/minorities/shares.
  let impliedMultiple: number | null = null;
  let impliedPercentile: number | null = null;
  if (bridge.shares !== 0 && bridge.driverValue !== 0) {
    impliedMultiple = (bridge.intrinsicPerShare * bridge.shares + bridge.netDebt + bridge.minorities) / bridge.driverValue;
    const series = extract.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null);
    if (series.length > 0) {
      impliedPercentile = percentileOf(impliedMultiple, series);
    }
  }

  return { scenario, statedIntrinsic, recomputedIntrinsic, arithmeticOk, mosOk, impliedMultiple, impliedPercentile };
}

/**
 * Recomputes each scenario's fair value from the model's own declared bridge and compares
 * it against what the model reported — then flags when the base case's implied multiple
 * coincides with what the current price already implies (the price-anchoring pathology).
 *
 * Returns null only when there's no historical basis at all to check against
 * (`extract.financials` empty) — otherwise degrades per-field (null-able Check
 * A/percentile) rather than failing outright.
 */
export function checkValuationBridges(
  result: BridgeCheckInput,
  mosPercent: number,
  price: number,
  quoteCurrency: string,
  extract: GroundedFinancials,
): PostCheck | null {
  if (extract.financials.length === 0) return null;

  const scenarios: BridgeCheck[] = (["bear", "base", "bull"] as const).map((s) =>
    checkOneScenario(s, result[s], mosPercent, extract),
  );

  const marketImplied = computeMarketImplied(price, quoteCurrency, extract);
  const baseImplied = scenarios.find((s) => s.scenario === "base")?.impliedMultiple ?? null;

  // No market-implied read (currency mismatch, or missing bridge inputs) → can't confirm
  // anchoring; default to false rather than guessing.
  const priceAnchoringFlag =
    marketImplied != null && baseImplied != null ? relDiff(baseImplied, marketImplied.impliedMultiple) < ANCHOR_TOLERANCE : false;

  return { scenarios, marketImplied, priceAnchoringFlag };
}
