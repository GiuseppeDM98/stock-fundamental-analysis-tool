// The valuation-bridge postcondition — the piece that closes the circle (spec §1, "Il pezzo
// che chiude il cerchio"). The model declares its own EV→equity bridge per scenario in the
// JSON block; this module recomputes the fair value FROM that bridge and compares it against
// what the model claims (Check A/B, unchanged since v1 — they already caught a real 2%
// deviation on a live run), then runs the deterministic rigor gates added in v2: basis
// same-ness, horizon consistency, bear validity, trailing/forward normalization, net-debt
// trajectory, returns vs cost of capital, scenario probabilities (+ expected value), and a
// mandatory second-method cross-check. Pure, no server-only. See
// docs/deep-value-grounding-spec.md §5.4 and docs/deep-value-rigor-v2-spec.md §4.
//
// Design invariant carried over from v1 (spec §0): "the model declares, the code verifies."
// A gate that cannot verify its condition returns "unavailable", never "pass" — an
// unverifiable gate that silently passed would be worse than no gate at all.
import type { GroundedFinancials, FiscalYearFinancials } from "@/types/grounding";
import type { Scenario, ValuationBridge, DeepValueResult } from "@/components/report/types";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { computeMarketImplied, percentileOf, type MarketImplied } from "@/lib/grounding/anchors";
import { computeBasisReconciliation, toProviderBasis, type BasisReconciliation } from "@/lib/grounding/basis";

// Re-exported for backward compatibility with this module's own tests/callers, which
// import these names from here — the canonical definitions now live on the real,
// extended Deep Value JSON contract (components/report/types.ts), wired in this session
// (spec §5.5/§9 commit 6) rather than the local mirror an earlier session used as a
// placeholder.
export type { ValuationBridge };
export type BridgeScenario = Scenario;

/** The full Deep Value JSON contract this postcheck needs, plus the analyst-only
 *  killPrice — present (even as null) only when the caller is checking an analyst lens's
 *  result, never a base report's. Its PRESENCE as an object key (not its value) is what
 *  gates whether the kill_price entry appears in PostCheck.gates at all. */
export type BridgeCheckInput = DeepValueResult & { killPrice?: number | null };

export type BridgeCheck = {
  scenario: "bear" | "base" | "bull";
  statedIntrinsic: number; // fairValue grossed up via the app's own mosPercent
  recomputedIntrinsic: number | null; // recomputed from the bridge's OWN multiple; null for DCF/DDM
  arithmeticOk: boolean | null; // Check A: recomputedIntrinsic ≈ intrinsicPerShare, within ±1%
  mosOk: boolean | null; // Check B: statedIntrinsic ≈ intrinsicPerShare, within ±1%
  impliedMultiple: number | null; // method-agnostic, STATEMENT basis: derived from intrinsicPerShare, not `multiple`
  /** impliedMultiple re-expressed in PROVIDER basis via toProviderBasis — the ONLY figure
   *  from this type that may be passed to percentileOf. null when kE is unverifiable. */
  impliedMultipleProvider: number | null;
  /** percentileOf(impliedMultipleProvider, raw historical series) — same-basis by
   *  construction now (v1 computed this on the cross-basis `impliedMultiple` — the exact
   *  bug the Iren report exposed). */
  impliedPercentile: number | null;
  /** Set only when this scenario's driverYear is FORWARD (> latestFy.fiscalYear) — the
   *  bridge value re-expressed on the LAST REPORTED fiscal year's EBITDA (Regola 3), so a
   *  forward-driver multiple becomes comparable to the TRAILING historical distribution. */
  impliedMultipleLtm: number | null;
  impliedPercentileLtm: number | null;
  /** driverValue / EBITDA_S(latestFy) − 1 — the size of the forward/trailing gap this
   *  scenario's driver represents, regardless of whether the LTM normalization above was
   *  possible. null when driverYear is trailing (no wedge to report) or inputs are missing. */
  growthWedgePct: number | null;
};

export type GateCode =
  | "basis_same"
  | "horizon_consistent"
  | "bear_breaks_price"
  | "multiple_vs_market"
  | "trailing_forward"
  | "netdebt_trajectory"
  | "roic_vs_wacc"
  | "probabilities"
  | "cross_check"
  | "cross_check_basis" // the cross-check's OWN same-basis check — see CrossCheckBridgeCheck
  | "kill_price"; // analyst lenses only

export type Gate = {
  code: GateCode;
  status: "pass" | "fail" | "unavailable";
  // SOLELY numbers/years, same contract as ReconciliationWarning.detail — t() has no
  // interpolation, translatable prose lives in the UI layer, never here.
  detail: string;
};

export type PostCheck = {
  scenarios: BridgeCheck[];
  marketImplied: MarketImplied;
  priceAnchoringFlag: boolean; // unchanged semantics, now computed same-basis
  gates: Gate[];
  basis: BasisReconciliation;
  /** Probability-weighted read across scenarios. null whenever probabilities are missing
   *  or don't sum to ≈1 — display only, never fed back into any stored column (spec §4:
   *  "il buco vero non era la MoS, era l'assenza di un valore atteso"). */
  expectedValue: { intrinsic: number; buyTarget: number; upsidePct: number } | null;
  /** The cross-check's OWN bridge, recomputed the same way scenario bridges are (Check A +
   *  implied multiple/percentile) — null when the model declared no crossCheck.bridge
   *  (Quick mode, or a Grounded cross-check with no multiple, e.g. DDM). Added after a live
   *  run (Webuild) showed the primary method can have no `multiple` for basis_same to check
   *  at all (DCF), while the cross-check is exactly where an unverified basis mismatch
   *  surfaced instead — see the cross_check_basis gate below. */
  crossCheckBridge: CrossCheckBridgeCheck | null;
};

export type CrossCheckBridgeCheck = {
  recomputedIntrinsic: number | null; // from the cross-check's own multiple × driverValue − netDebt − minorities / shares
  arithmeticOk: boolean | null; // recomputedIntrinsic ≈ crossCheck.intrinsicPerShare, within ±1% — Check A, never run on the cross-check before this
  impliedMultiple: number | null; // method-agnostic, statement basis, derived from crossCheck.intrinsicPerShare
  impliedMultipleProvider: number | null; // same-basis (provider) via toProviderBasis — the only figure percentile-able
  impliedPercentile: number | null; // percentileOf(impliedMultipleProvider, raw historical series)
};

// Check A/B tolerance — the model's own declared numbers being cross-checked against each
// other, not noisy third-party data, so a tight band is appropriate (spec §5.4: "entro ±1%").
const ARITHMETIC_TOLERANCE = 0.01;
const MOS_TOLERANCE = 0.01;
// priceAnchoringFlag / multiple_vs_market threshold — spec §5.1 ("< 0.03"). The Eni v2 case
// (base 4.2x vs market-implied 4.18x, Δ≈0.5%) sits comfortably inside this band.
const ANCHOR_TOLERANCE = 0.03;
// basis_same: how close the model's declared base multiple must sit to a candidate median
// (adjusted or raw) to count as "applied that one" — docs/deep-value-rigor-v2-spec.md §4.
const BASIS_SAME_MULTIPLE_TOLERANCE = 0.05;
// netdebt_trajectory: how far bridge.netDebt may undershoot the FCF-implied trajectory
// before it's flagged as an unfunded deleveraging assumption — spec §4.
const NETDEBT_TRAJECTORY_TOLERANCE = 0.05;
// probabilities: how close bull+base+bear must sum to 1 — spec §4.
const PROBABILITIES_SUM_TOLERANCE = 0.02;
// cross_check: max delta between the primary and cross-check intrinsic values before the
// model must be seen as having failed to reconcile them — spec §4.
const CROSS_CHECK_DELTA_TOLERANCE = 0.25;

function relDiff(value: number, reference: number): number {
  return Math.abs(value - reference) / (Math.abs(reference) || 1);
}

function checkOneScenario(
  scenario: BridgeCheck["scenario"],
  input: BridgeScenario,
  mosPercent: number,
  extract: GroundedFinancials,
  basis: BasisReconciliation,
  latestFy: FiscalYearFinancials | undefined
): BridgeCheck {
  const { fairValue, bridge } = input;

  // Trap (spec §5.4): fairValue is a MoS-adjusted buy target, never compare it directly
  // against intrinsicPerShare. Gross it up first via the SHARED helper (not reimplemented).
  const statedIntrinsic = grossUpToIntrinsic(fairValue, mosPercent / 100);

  const empty = {
    scenario,
    statedIntrinsic,
    recomputedIntrinsic: null,
    arithmeticOk: null,
    mosOk: null,
    impliedMultiple: null,
    impliedMultipleProvider: null,
    impliedPercentile: null,
    impliedMultipleLtm: null,
    impliedPercentileLtm: null,
    growthWedgePct: null,
  };

  // `bridge` is optional on Scenario (Quick reports, and older saved reports, never had
  // it) — the Grounded prompt instructs the model to always include it, but this is
  // untrusted LLM output, not a validated schema. Degrade every downstream check to null
  // rather than throw when the model didn't declare one for this scenario.
  if (!bridge) return empty;

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
  // driver/netDebt/minorities/shares. STATEMENT basis — never percentiled directly.
  let impliedMultiple: number | null = null;
  let impliedMultipleProvider: number | null = null;
  let impliedPercentile: number | null = null;
  const series = extract.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null);
  if (bridge.shares !== 0 && bridge.driverValue !== 0) {
    impliedMultiple = (bridge.intrinsicPerShare * bridge.shares + bridge.netDebt + bridge.minorities) / bridge.driverValue;
    impliedMultipleProvider = toProviderBasis(impliedMultiple, basis);
    if (impliedMultipleProvider != null && series.length > 0) {
      impliedPercentile = percentileOf(impliedMultipleProvider, series);
    }
  }

  // Regola 3 (spec §1) — only when this scenario's driver is FORWARD relative to the last
  // reported fiscal year: re-express the bridge value on the trailing EBITDA so it becomes
  // comparable to the (trailing) historical distribution, and report the size of the gap.
  let impliedMultipleLtm: number | null = null;
  let impliedPercentileLtm: number | null = null;
  let growthWedgePct: number | null = null;
  if (latestFy?.ebitda != null && latestFy.ebitda !== 0 && bridge.driverYear > latestFy.fiscalYear && bridge.shares !== 0) {
    const mLtmStatement = (bridge.intrinsicPerShare * bridge.shares + bridge.netDebt + bridge.minorities) / latestFy.ebitda;
    impliedMultipleLtm = toProviderBasis(mLtmStatement, basis);
    if (impliedMultipleLtm != null && series.length > 0) {
      impliedPercentileLtm = percentileOf(impliedMultipleLtm, series);
    }
    growthWedgePct = bridge.driverValue / latestFy.ebitda - 1;
  }

  return {
    scenario,
    statedIntrinsic,
    recomputedIntrinsic,
    arithmeticOk,
    mosOk,
    impliedMultiple,
    impliedMultipleProvider,
    impliedPercentile,
    impliedMultipleLtm,
    impliedPercentileLtm,
    growthWedgePct,
  };
}

function checkBasisSame(basis: BasisReconciliation, base: Scenario): Gate {
  if (basis.kE == null) {
    return { code: "basis_same", status: "unavailable", detail: "kE unavailable" };
  }
  const adjMedian = basis.adjustedEvEbitda!.median;
  const rawMedian = adjMedian / basis.kE;
  const baseMultiple = base.bridge?.multiple;
  const detail = `kE ${basis.kE.toFixed(2)} · base multiple ${baseMultiple != null ? `${baseMultiple.toFixed(2)}x` : "n/a"} · same-basis median ${adjMedian.toFixed(2)}x · raw median ${rawMedian.toFixed(2)}x`;

  if (basis.sameBasis) return { code: "basis_same", status: "pass", detail };
  if (baseMultiple == null) return { code: "basis_same", status: "unavailable", detail };

  const closeToAdjusted = relDiff(baseMultiple, adjMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  const closeToRaw = relDiff(baseMultiple, rawMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  // closeToRaw (and not adjusted) is the exact Iren signature: the raw provider-basis
  // multiple applied straight to a statement-basis driver. Anything else (a defensible
  // deviation the model justified, e.g. p25/p75 instead of median) is not evidence of
  // THIS specific defect, so it doesn't fail a gate built to catch it.
  const status: Gate["status"] = closeToRaw && !closeToAdjusted ? "fail" : "pass";
  return { code: "basis_same", status, detail };
}

function checkHorizonConsistent(bull: Scenario, base: Scenario, bear: Scenario): Gate {
  const years = { bull: bull.bridge?.driverYear, base: base.bridge?.driverYear, bear: bear.bridge?.driverYear };
  const detail = `bull ${years.bull ?? "n/a"} · base ${years.base ?? "n/a"} · bear ${years.bear ?? "n/a"}`;
  if (years.bull == null || years.base == null || years.bear == null) {
    return { code: "horizon_consistent", status: "unavailable", detail };
  }
  const status: Gate["status"] = years.bull === years.base && years.base === years.bear ? "pass" : "fail";
  return { code: "horizon_consistent", status, detail };
}

function checkBearBreaksPrice(bearStatedIntrinsic: number, price: number): Gate {
  const status: Gate["status"] = bearStatedIntrinsic < price ? "pass" : "fail";
  return { code: "bear_breaks_price", status, detail: `bear ${bearStatedIntrinsic.toFixed(2)} · price ${price.toFixed(2)}` };
}

function checkTrailingForward(baseCheck: BridgeCheck, base: Scenario, latestFy: FiscalYearFinancials | undefined): Gate {
  const driverYear = base.bridge?.driverYear;
  if (driverYear == null || !latestFy) {
    return { code: "trailing_forward", status: "unavailable", detail: "driverYear or latest FY unavailable" };
  }
  const isTrailing = driverYear <= latestFy.fiscalYear;
  // "fail mai" (spec §4) — this gate informs rather than bocks: it never fails, only
  // passes (normalizable, trailing or LTM-equivalent available) or reports unavailable.
  const status: Gate["status"] = isTrailing || baseCheck.impliedPercentileLtm != null ? "pass" : "unavailable";
  const wedge = baseCheck.growthWedgePct != null ? `${baseCheck.growthWedgePct >= 0 ? "+" : ""}${(baseCheck.growthWedgePct * 100).toFixed(0)}%` : "n/a";
  const fwd = baseCheck.impliedMultipleProvider != null ? `${baseCheck.impliedMultipleProvider.toFixed(2)}x (fwd)` : "n/a";
  const ltm =
    baseCheck.impliedMultipleLtm != null
      ? ` / ${baseCheck.impliedMultipleLtm.toFixed(2)}x (LTM-equiv${baseCheck.impliedPercentileLtm != null ? `, p${baseCheck.impliedPercentileLtm.toFixed(0)}` : ""})`
      : "";
  return { code: "trailing_forward", status, detail: `driver ${driverYear}${isTrailing ? "" : "e"} · wedge ${wedge} · implied ${fwd}${ltm}` };
}

function checkNetDebtTrajectory(bull: Scenario, base: Scenario, bear: Scenario, latestFy: FiscalYearFinancials | undefined): Gate {
  if (!latestFy || latestFy.freeCashFlow == null || latestFy.dividendsPerShare == null || latestFy.netDebt == null || latestFy.sharesDiluted == null) {
    return { code: "netdebt_trajectory", status: "unavailable", detail: "freeCashFlow, dividendsPerShare, netDebt or sharesDiluted missing" };
  }
  const dividendTotal = latestFy.dividendsPerShare * latestFy.sharesDiluted;
  const expectedNetDebt = latestFy.netDebt - (latestFy.freeCashFlow - dividendTotal);
  const targetYear = latestFy.fiscalYear + 1;
  const applicable = ([
    ["bull", bull],
    ["base", base],
    ["bear", bear],
  ] as const).filter(([, s]) => s.bridge?.driverYear === targetYear);

  if (applicable.length === 0) {
    return { code: "netdebt_trajectory", status: "pass", detail: `no scenario targets FY${targetYear}` };
  }

  const threshold = expectedNetDebt * (1 - NETDEBT_TRAJECTORY_TOLERANCE);
  const failing = applicable.some(([, s]) => (s.bridge as ValuationBridge).netDebt < threshold);
  const sampleNetDebt = (applicable[0][1].bridge as ValuationBridge).netDebt;
  const detail = `bridge ${sampleNetDebt.toFixed(0)} · expected ≥ ${threshold.toFixed(0)} · latest FY ${latestFy.netDebt.toFixed(1)}`;
  return { code: "netdebt_trajectory", status: failing ? "fail" : "pass", detail };
}

function checkRoicVsWacc(result: BridgeCheckInput, basis: BasisReconciliation): Gate {
  const roic = result.assumptions?.roic;
  const wacc = result.assumptions?.wacc;
  if (roic == null || wacc == null) {
    return { code: "roic_vs_wacc", status: "unavailable", detail: "roic or wacc missing" };
  }
  const baseMultiple = result.base.bridge?.multiple;
  const sameBasisMedian = basis.adjustedEvEbitda?.median;
  const detail = `roic ${roic.toFixed(1)}% · wacc ${wacc.toFixed(1)}% · base ${baseMultiple != null ? `${baseMultiple.toFixed(2)}x` : "n/a"} vs median ${sameBasisMedian != null ? `${sameBasisMedian.toFixed(2)}x` : "n/a"}`;
  if (baseMultiple == null || sameBasisMedian == null) {
    return { code: "roic_vs_wacc", status: "unavailable", detail };
  }
  const status: Gate["status"] = roic < wacc && baseMultiple >= sameBasisMedian ? "fail" : "pass";
  return { code: "roic_vs_wacc", status, detail };
}

function checkProbabilities(bull: Scenario, base: Scenario, bear: Scenario): Gate {
  const { probability: pBull } = bull;
  const { probability: pBase } = base;
  const { probability: pBear } = bear;
  const detail = `bull ${pBull?.toFixed(2) ?? "n/a"} · base ${pBase?.toFixed(2) ?? "n/a"} · bear ${pBear?.toFixed(2) ?? "n/a"}`;
  if (pBull == null || pBase == null || pBear == null) {
    return { code: "probabilities", status: "unavailable", detail };
  }
  const status: Gate["status"] = Math.abs(pBull + pBase + pBear - 1) < PROBABILITIES_SUM_TOLERANCE ? "pass" : "fail";
  return { code: "probabilities", status, detail };
}

function checkCrossCheck(result: BridgeCheckInput, baseIntrinsic: number): Gate {
  if (!result.crossCheck) {
    return { code: "cross_check", status: "unavailable", detail: "no cross-check declared" };
  }
  const delta = (result.crossCheck.intrinsicPerShare - baseIntrinsic) / (Math.abs(baseIntrinsic) || 1);
  const status: Gate["status"] = Math.abs(delta) <= CROSS_CHECK_DELTA_TOLERANCE ? "pass" : "fail";
  const detail = `${result.method} ${baseIntrinsic.toFixed(2)} · ${result.crossCheck.method} ${result.crossCheck.intrinsicPerShare.toFixed(2)} · delta ${(delta * 100).toFixed(0)}%`;
  return { code: "cross_check", status, detail };
}

/** Check A + implied multiple/percentile on the cross-check's OWN bridge — mirrors
 *  checkOneScenario's arithmetic, but crossCheck.intrinsicPerShare is already intrinsic-scale
 *  (no fairValue/MoS gross-up applies, unlike a bull/base/bear Scenario). null when the
 *  model declared no crossCheck.bridge at all. */
function checkCrossCheckBridge(
  result: BridgeCheckInput,
  extract: GroundedFinancials,
  basis: BasisReconciliation
): CrossCheckBridgeCheck | null {
  const crossCheck = result.crossCheck;
  if (!crossCheck?.bridge) return null;
  const { bridge, intrinsicPerShare } = crossCheck;

  let recomputedIntrinsic: number | null = null;
  let arithmeticOk: boolean | null = null;
  if (bridge.multiple != null && bridge.shares !== 0) {
    recomputedIntrinsic = (bridge.multiple * bridge.driverValue - bridge.netDebt - bridge.minorities) / bridge.shares;
    arithmeticOk = relDiff(recomputedIntrinsic, intrinsicPerShare) < ARITHMETIC_TOLERANCE;
  }

  let impliedMultiple: number | null = null;
  let impliedMultipleProvider: number | null = null;
  let impliedPercentile: number | null = null;
  const series = extract.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null);
  if (bridge.shares !== 0 && bridge.driverValue !== 0) {
    impliedMultiple = (intrinsicPerShare * bridge.shares + bridge.netDebt + bridge.minorities) / bridge.driverValue;
    impliedMultipleProvider = toProviderBasis(impliedMultiple, basis);
    if (impliedMultipleProvider != null && series.length > 0) {
      impliedPercentile = percentileOf(impliedMultipleProvider, series);
    }
  }

  return { recomputedIntrinsic, arithmeticOk, impliedMultiple, impliedMultipleProvider, impliedPercentile };
}

/** Same signature-matching logic as checkBasisSame (the "raw table multiple applied to a
 *  same-basis driver" pattern), but reading the CROSS-CHECK's own declared multiple instead
 *  of the base scenario's. Defense-in-depth for an Iren-style error occurring in the
 *  cross-check rather than the primary bridge — NOT what caught the Webuild case (there the
 *  cross-check's multiple came from PEERS, not from Webuild's own historical distribution,
 *  so it doesn't match this specific signature; the existing cross_check delta gate is what
 *  caught that). */
function checkCrossCheckBasis(result: BridgeCheckInput, basis: BasisReconciliation): Gate {
  if (!result.crossCheck) {
    return { code: "cross_check_basis", status: "unavailable", detail: "no cross-check declared" };
  }
  if (basis.kE == null) {
    return { code: "cross_check_basis", status: "unavailable", detail: "kE unavailable" };
  }
  const adjMedian = basis.adjustedEvEbitda!.median;
  const rawMedian = adjMedian / basis.kE;
  const declaredMultiple = result.crossCheck.bridge?.multiple;
  const detail = `kE ${basis.kE.toFixed(2)} · cross-check multiple ${declaredMultiple != null ? `${declaredMultiple.toFixed(2)}x` : "n/a"} · same-basis median ${adjMedian.toFixed(2)}x · raw median ${rawMedian.toFixed(2)}x`;

  if (basis.sameBasis) return { code: "cross_check_basis", status: "pass", detail };
  if (declaredMultiple == null) return { code: "cross_check_basis", status: "unavailable", detail };

  const closeToRaw = relDiff(declaredMultiple, rawMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  const closeToAdjusted = relDiff(declaredMultiple, adjMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  const status: Gate["status"] = closeToRaw && !closeToAdjusted ? "fail" : "pass";
  return { code: "cross_check_basis", status, detail };
}

/** Analyst lenses only — pass if a numeric kill price was declared, fail if null/absent.
 *  Exported standalone since it operates on the lens's own `killPrice` field, not on the
 *  bull/base/bear scenario set this module otherwise checks. */
export function checkKillPrice(killPrice: number | null | undefined): Gate {
  const status: Gate["status"] = killPrice != null ? "pass" : "fail";
  return { code: "kill_price", status, detail: killPrice != null ? killPrice.toFixed(2) : "not declared" };
}

function computeExpectedValue(
  scenarios: BridgeCheck[],
  bull: Scenario,
  base: Scenario,
  bear: Scenario,
  mosPercent: number,
  price: number
): PostCheck["expectedValue"] {
  const pBull = bull.probability;
  const pBase = base.probability;
  const pBear = bear.probability;
  if (pBull == null || pBase == null || pBear == null) return null;
  if (Math.abs(pBull + pBase + pBear - 1) >= PROBABILITIES_SUM_TOLERANCE) return null;

  const intrinsicOf = (name: BridgeCheck["scenario"]) => scenarios.find((s) => s.scenario === name)!.statedIntrinsic;
  const expectedIntrinsic = pBull * intrinsicOf("bull") + pBase * intrinsicOf("base") + pBear * intrinsicOf("bear");
  const expectedBuyTarget = expectedIntrinsic * (1 - mosPercent / 100);
  const upsidePct = (expectedIntrinsic - price) / price;
  return { intrinsic: expectedIntrinsic, buyTarget: expectedBuyTarget, upsidePct };
}

/**
 * Recomputes each scenario's fair value from the model's own declared bridge and compares
 * it against what the model reported, then runs every deterministic rigor gate (basis
 * same-ness, horizon consistency, bear validity, trailing/forward normalization, net-debt
 * trajectory, returns vs cost of capital, probabilities + expected value, cross-check) —
 * the layer that turns "the model declares" into "the code verifies" (spec §0).
 *
 * Returns null only when there's no historical basis at all to check against
 * (`extract.financials` empty) — otherwise degrades per-field/per-gate (null-able Check
 * A/percentile, "unavailable" gates) rather than failing outright.
 */
export function checkValuationBridges(
  result: BridgeCheckInput,
  mosPercent: number,
  price: number,
  quoteCurrency: string,
  extract: GroundedFinancials
): PostCheck | null {
  if (extract.financials.length === 0) return null;

  const basis = computeBasisReconciliation(extract);
  const latestFy = extract.financials[extract.financials.length - 1];

  const scenarios: BridgeCheck[] = (["bear", "base", "bull"] as const).map((s) =>
    checkOneScenario(s, result[s], mosPercent, extract, basis, latestFy)
  );
  const baseCheck = scenarios.find((s) => s.scenario === "base")!;
  const bearCheck = scenarios.find((s) => s.scenario === "bear")!;

  const marketImplied = computeMarketImplied(price, quoteCurrency, extract, basis);

  // multiple_vs_market / priceAnchoringFlag — same underlying comparison, computed once.
  // No market-implied read (currency mismatch, or missing bridge inputs) → can't confirm
  // anchoring; default to false/unavailable rather than guessing.
  let priceAnchoringFlag = false;
  let multipleVsMarketGate: Gate;
  if (baseCheck.impliedMultipleProvider == null || marketImplied?.impliedOnProvider == null) {
    multipleVsMarketGate = { code: "multiple_vs_market", status: "unavailable", detail: "provider-basis multiple unavailable" };
  } else {
    const diff = relDiff(baseCheck.impliedMultipleProvider, marketImplied.impliedOnProvider);
    priceAnchoringFlag = diff < ANCHOR_TOLERANCE;
    multipleVsMarketGate = {
      code: "multiple_vs_market",
      status: priceAnchoringFlag ? "fail" : "pass",
      detail: `base ${baseCheck.impliedMultipleProvider.toFixed(2)}x · market ${marketImplied.impliedOnProvider.toFixed(2)}x · Δ ${(diff * 100).toFixed(1)}%`,
    };
  }

  const crossCheckBridge = checkCrossCheckBridge(result, extract, basis);

  const gates: Gate[] = [
    checkBasisSame(basis, result.base),
    checkHorizonConsistent(result.bull, result.base, result.bear),
    checkBearBreaksPrice(bearCheck.statedIntrinsic, price),
    multipleVsMarketGate,
    checkTrailingForward(baseCheck, result.base, latestFy),
    checkNetDebtTrajectory(result.bull, result.base, result.bear, latestFy),
    checkRoicVsWacc(result, basis),
    checkProbabilities(result.bull, result.base, result.bear),
    checkCrossCheck(result, baseCheck.statedIntrinsic),
    checkCrossCheckBasis(result, basis),
  ];
  // kill_price only applies to analyst lenses — its presence in `gates` is gated on the
  // caller having included the `killPrice` key at all (even as null), not on its value,
  // so a base-report call (no such key) never gets a spurious kill_price entry.
  if ("killPrice" in result) {
    gates.push(checkKillPrice(result.killPrice));
  }

  const expectedValue = computeExpectedValue(scenarios, result.bull, result.base, result.bear, mosPercent, price);

  return { scenarios, marketImplied, priceAnchoringFlag, gates, basis, expectedValue, crossCheckBridge };
}
