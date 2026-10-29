// The valuation-bridge postcondition. Deterministic anchors alone don't stop the model from
// anchoring to the price, so its OUTPUT is verified too: the model declares its own EV→equity
// bridge per scenario in the JSON block; this module recomputes the fair value FROM that
// bridge and compares it against what the model claims (Check A/B — they caught a real 2%
// deviation on a live run), then runs deterministic gates that test the assumptions, not
// just the arithmetic: basis same-ness, horizon consistency, bear validity, trailing/forward
// normalization, net-debt trajectory, returns vs cost of capital, scenario probabilities
// (+ expected value), and a mandatory second-method cross-check. Pure, no server-only.
//
// Every analysis gets these gates, with or without a pasted dataset (2026-10): the gates
// that read only the model's own JSON and the price (scenario order, method family, the
// sensitivity centre, Check A/B, …) run everywhere; the ones that need the dataset read
// "unavailable — no dataset" without one. The pasted history is a history of EV/EBITDA, so
// the gates that read its medians or the market-implied multiple, and the implied
// multiples themselves, apply only to an EV bridge on EBITDA (isEvOnEbitda); on any other
// bridge they read unavailable (2026-10-29).
//
// Design invariant: "the model declares, the code verifies."
// A gate that cannot verify its condition returns "unavailable", never "pass" — an
// unverifiable gate that silently passed would be worse than no gate at all. A price and a
// value in different currencies are never compared either (sameCurrency): that gate reads
// "unavailable — currency mismatch".
import type { GroundedFinancials, FiscalYearFinancials } from "@/types/grounding";
import type { Scenario, ValuationBridge, AnalystResult } from "@/components/report/types";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { sanitizeDeepValueResult, type ParsedAnalystResult } from "@/lib/report/parse-deep-value-json";
import { computeMarketImplied, percentileOf, type MarketImplied } from "@/lib/grounding/anchors";
import { computeBasisReconciliation, bridgeToProviderMultiple, type BasisReconciliation } from "@/lib/grounding/basis";
import { sameCurrency } from "@/lib/grounding/currency";

// Re-exported because this module's tests/callers import these names from here — the
// canonical definitions live on the Deep Value JSON contract (components/report/types.ts).
export type { ValuationBridge };
export type BridgeScenario = Scenario;

/** The full valuation JSON contract (units, sensitivity and dividends included), plus the
 *  analyst-only killPrice (+ its optional killPriceNote) — present (even as null) only when
 *  the caller is checking an analyst lens's result, never a base report's. Its PRESENCE as
 *  an object key (not its value) is what gates whether the kill_price entry appears in
 *  PostCheck.gates at all.
 *
 *  Every caller narrows its result with hasFullTriple first (a stored blob is sanitized on
 *  read); checkValuationBridges still re-sanitizes on entry, so a value that slipped past
 *  the type is checked as "not declared", never computed on. */
export type BridgeCheckInput = AnalystResult;

export type BridgeCheck = {
  scenario: "bear" | "base" | "bull";
  statedIntrinsic: number | null; // fairValue grossed up via the app's own mosPercent; null when the model declared no valid scenario
  recomputedIntrinsic: number | null; // recomputed from the bridge's OWN multiple; null for DCF/DDM
  arithmeticOk: boolean | null; // Check A: recomputedIntrinsic ≈ intrinsicPerShare, within ±1%
  mosOk: boolean | null; // Check B: statedIntrinsic ≈ intrinsicPerShare, within ±1%
  impliedMultiple: number | null; // EV/EBITDA on the STATEMENT basis, derived from intrinsicPerShare, not `multiple`; null unless the bridge is an EV bridge on EBITDA
  /** The same bridge re-expressed in PROVIDER basis via bridgeToProviderMultiple (bridge
   *  × kB, EBITDA × kE) — the ONLY figure from this type that may be passed to
   *  percentileOf. null when kE is unverifiable. */
  impliedMultipleProvider: number | null;
  /** percentileOf(impliedMultipleProvider, raw historical series) — same-basis by
   *  construction; ranking the cross-basis `impliedMultiple` instead is the exact bug the
   *  Iren report exposed. */
  impliedPercentile: number | null;
  /** Set only when this scenario's driverYear is FORWARD (> latestFy.fiscalYear) — the
   *  bridge value re-expressed on the LAST REPORTED fiscal year's EBITDA, so a
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
  | "kill_price" // analyst lenses only
  // 2026-10: contract-only gates — they need no dataset, so every analysis gets them.
  | "scenario_order"
  | "method_distinct"
  | "sensitivity_center"
  | "dividend_coverage"
  | "units_match"
  | "sections_present"; // from the Markdown, via checkReportStructure — never in checkValuationBridges' array

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
  /** true when the base scenario's implied multiple sits within ANCHOR_TOLERANCE of the
   *  price-implied one. Compared on the STATEMENT basis (both reads built from our own
   *  bridge and EBITDA_S), so it doesn't need kE: a paste without EV/Revenue or Enterprise
   *  Value columns would otherwise make the most important anchoring check unavailable. */
  priceAnchoringFlag: boolean;
  gates: Gate[];
  basis: BasisReconciliation;
  /** Probability-weighted read across scenarios. null whenever probabilities are missing
   *  or don't sum to ≈1 — display only, never fed back into any stored column: it adds the
   *  missing expected value without changing the per-scenario buy targets the app reads. */
  expectedValue: { intrinsic: number; buyTarget: number; upsidePct: number } | null;
  /** The cross-check's OWN bridge, recomputed the same way scenario bridges are (Check A +
   *  implied multiple/percentile) — null when the model declared no crossCheck.bridge.
   *  Added after a live
   *  run (Webuild) showed the primary method can have no `multiple` for basis_same to check
   *  at all (DCF), while the cross-check is exactly where an unverified basis mismatch
   *  surfaced instead — see the cross_check_basis gate below. */
  crossCheckBridge: CrossCheckBridgeCheck | null;
};

/** What computeBasisReconciliation would return with nothing to reconcile — used when the
 *  analysis has no dataset so every basis-dependent gate reads "unavailable", never "pass". */
export const EMPTY_BASIS: BasisReconciliation = {
  years: [],
  kE: null,
  kEn: 0,
  kESpread: null,
  confidence: "unavailable",
  sameBasis: null,
  kB: null,
  evBridgeConfidence: "assumed",
  evBridgeSameBasis: null,
  adjustedEvEbitda: null,
};

// Gate-detail keywords: English, never translated (same contract as Gate.detail).
const NO_DATASET = "no dataset";
const CURRENCY_MISMATCH = "currency mismatch";
const NOT_EV_EBITDA = "not an EV/EBITDA bridge";
const EQUITY_BRIDGE = "equity bridge · net debt 0";
const UNKNOWN_METHOD = "unknown method family";

export type CrossCheckBridgeCheck = {
  recomputedIntrinsic: number | null; // from the cross-check's own multiple × driverValue − netDebt − minorities / shares
  arithmeticOk: boolean | null; // recomputedIntrinsic ≈ crossCheck.intrinsicPerShare, within ±1% — Check A, never run on the cross-check before this
  impliedMultiple: number | null; // EV/EBITDA, statement basis, derived from crossCheck.intrinsicPerShare; null unless the cross-check is an EV bridge on EBITDA
  impliedMultipleProvider: number | null; // same-basis (provider) via bridgeToProviderMultiple — the only figure percentile-able
  impliedPercentile: number | null; // percentileOf(impliedMultipleProvider, raw historical series)
};

// Check A/B tolerance — the model's own declared numbers being cross-checked against each
// other, not noisy third-party data, so a tight ±1% band is appropriate.
const ARITHMETIC_TOLERANCE = 0.01;
const MOS_TOLERANCE = 0.01;
// priceAnchoringFlag / multiple_vs_market threshold. A real Eni run anchored to the price
// (base 4.2x vs market-implied 4.18x, Δ≈0.5%) sits comfortably inside this band.
const ANCHOR_TOLERANCE = 0.03;
// basis_same: how close the model's declared base multiple must sit to a candidate median
// (adjusted or raw) to count as "applied that one".
const BASIS_SAME_MULTIPLE_TOLERANCE = 0.05;
// netdebt_trajectory: how far bridge.netDebt may undershoot the FCF-implied trajectory
// before it's flagged as an unfunded deleveraging assumption.
const NETDEBT_TRAJECTORY_TOLERANCE = 0.05;
// probabilities: how close bull+base+bear must sum to 1.
const PROBABILITIES_SUM_TOLERANCE = 0.02;
// cross_check: max delta between the primary and cross-check intrinsic values before the
// model must be seen as having failed to reconcile them.
const CROSS_CHECK_DELTA_TOLERANCE = 0.25;
// dividend_coverage: how many of the latest reported FCF years the dividend is weighed
// against — the same window as reconcile.ts's dividend_not_covered warning.
const DIVIDEND_FCF_LOOKBACK_YEARS = 3;

function relDiff(value: number, reference: number): number {
  return Math.abs(value - reference) / (Math.abs(reference) || 1);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The model's three scenarios after sanitization — any of them may be missing when the
 *  JSON block didn't carry a valid one (no `fairValue`, wrong type). */
type ScenarioSet = { bull: Scenario | undefined; base: Scenario | undefined; bear: Scenario | undefined };

/** Everything a gate may read from the pasted dataset. Without one: EMPTY_BASIS, no latest
 *  fiscal year and an empty EV/EBITDA series, so the provider-basis reads and percentiles
 *  come back null while Check A/B and the statement-basis implied multiple still compute. */
type DatasetContext = {
  dataset: GroundedFinancials | null;
  basis: BasisReconciliation;
  latestFy: FiscalYearFinancials | undefined;
  series: number[];
};

/** The one criterion for "this analysis has a dataset", shared with ValuationChecksCard: an
 *  extract with no financial rows has nothing to reconcile, so it reads exactly like none. */
export function datasetOrNull(extract: GroundedFinancials | null | undefined): GroundedFinancials | null {
  return extract && extract.financials.length > 0 ? extract : null;
}

function buildDatasetContext(extract: GroundedFinancials | null): DatasetContext {
  const dataset = datasetOrNull(extract);
  if (!dataset) return { dataset: null, basis: EMPTY_BASIS, latestFy: undefined, series: [] };
  return {
    dataset,
    basis: computeBasisReconciliation(dataset),
    latestFy: dataset.financials[dataset.financials.length - 1],
    series: dataset.multiples.map((m) => m.evEbitda).filter((v): v is number => v != null),
  };
}

function unavailableNoDataset(code: GateCode): Gate {
  return { code, status: "unavailable", detail: NO_DATASET };
}

// The method families of METHOD_LIST (deep-value-prompts.ts), each anchored at the start of
// the declared method and closed by a word boundary: "EV/EBITDA (peers)" and "P/E fwd"
// belong to their family, "Peer EV/EBITDA" to none. A prefix match on the squashed string
// once read "Peer EV/EBITDA" as P/E, and method_distinct passed it against an EV/EBITDA
// primary (2026-10-29).
const METHOD_FAMILIES = [
  ["evebitda", /^ev\s*[/\-_.]?\s*ebitda\b/],
  ["evrab", /^ev\s*[/\-_.]?\s*rab\b/],
  ["residualincome", /^residual[\s\-_]*income\b/],
  ["dcf", /^dcf\b/],
  ["ddm", /^ddm\b/],
  ["sotp", /^sotp\b/],
  ["nav", /^nav\b/],
  ["pe", /^p\s*[/\-_.]?\s*e\b/],
  ["pb", /^p\s*[/\-_.]?\s*b\b/],
] as const;

type MethodFamily = (typeof METHOD_FAMILIES)[number][0];

/** The family a declared method belongs to, or null when it names none of METHOD_FAMILIES. */
function methodFamily(method: string): MethodFamily | null {
  const normalized = method.trim().toLowerCase();
  return METHOD_FAMILIES.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

/** true when the bridge subtracts net debt from an enterprise value; false for the
 *  equity-value methods (P/E, P/B, Residual Income, DDM, DCF on FCFE), whose driver is
 *  already equity and whose net debt is 0 by the bridge rule (deep-value-prompts.ts,
 *  BRIDGE_RULE); null when the method names no known family. */
function isEvBridge(method: string): boolean | null {
  const family = methodFamily(method);
  if (family == null) return null;
  if (family === "pe" || family === "pb" || family === "residualincome" || family === "ddm") return false;
  return !(family === "dcf" && /\bfcfe\b/i.test(method));
}

/** An EV bridge on EBITDA: the one bridge whose (equity + net debt + minorities) / driver
 *  is an EV/EBITDA, the multiple the pasted history, the basis reconciliation and the
 *  market-implied read are all built on. An EV/EBITDA method by definition, or a DCF on
 *  FCFF whose driver label names EBITDA. Never an equity-value method (equity / EBITDA is no
 *  EV multiple, and a DPS per share turned it into a meaningless number on a DDM), nor
 *  SOTP, NAV or EV/RAB (their driver is a value already summed). */
function isEvOnEbitda(method: string, bridge: { driver: string } | undefined): boolean {
  if (!bridge || isEvBridge(method) !== true) return false;
  const family = methodFamily(method);
  return family === "evebitda" || (family === "dcf" && /\bebitda\b/i.test(bridge.driver));
}

function checkOneScenario(
  scenario: BridgeCheck["scenario"],
  input: BridgeScenario | undefined,
  mosPercent: number,
  { basis, latestFy, series }: DatasetContext,
  onEbitda: boolean
): BridgeCheck {
  // MoS trap: fairValue is a MoS-adjusted buy target, never compare it directly
  // against intrinsicPerShare. Gross it up first via the SHARED helper (not reimplemented).
  const statedIntrinsic = input ? grossUpToIntrinsic(input.fairValue, mosPercent / 100) : null;
  const bridge = input?.bridge;

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
  // rather than throw when the model didn't declare one for this scenario (or declared no
  // valid scenario at all — then there's nothing to check the bridge against either).
  if (!bridge || statedIntrinsic == null) return empty;

  // Check A — the model's own bridge arithmetic. Only computable when it declared a
  // `multiple` (absent for DCF/DDM) and shares is non-zero.
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

  // The implied EV/EBITDA, derived from the model's OWN intrinsicPerShare rather than its
  // (possibly absent) declared `multiple`, so a DCF on EBITDA gets one too. Only an EV
  // bridge on EBITDA has one (isEvOnEbitda); until 2026-10-29 it was computed on every
  // bridge, and a P/E or a DDM got a number that was no EV/EBITDA at all. STATEMENT basis —
  // never percentiled directly.
  if (!onEbitda) return { ...empty, recomputedIntrinsic, arithmeticOk, mosOk };
  let impliedMultiple: number | null = null;
  let impliedMultipleProvider: number | null = null;
  let impliedPercentile: number | null = null;
  const equityValue = bridge.intrinsicPerShare * bridge.shares;
  const evBridge = bridge.netDebt + bridge.minorities;
  if (bridge.shares !== 0 && bridge.driverValue !== 0) {
    impliedMultiple = (equityValue + evBridge) / bridge.driverValue;
    impliedMultipleProvider = bridgeToProviderMultiple(equityValue, evBridge, bridge.driverValue, basis);
    if (impliedMultipleProvider != null && series.length > 0) {
      impliedPercentile = percentileOf(impliedMultipleProvider, series);
    }
  }

  // Trailing/forward normalization — only when this scenario's driver is FORWARD relative to the last
  // reported fiscal year: re-express the bridge value on the trailing EBITDA so it becomes
  // comparable to the (trailing) historical distribution, and report the size of the gap.
  let impliedMultipleLtm: number | null = null;
  let impliedPercentileLtm: number | null = null;
  let growthWedgePct: number | null = null;
  if (latestFy?.ebitda != null && latestFy.ebitda !== 0 && bridge.driverYear > latestFy.fiscalYear && bridge.shares !== 0) {
    impliedMultipleLtm = bridgeToProviderMultiple(equityValue, evBridge, latestFy.ebitda, basis);
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

function checkBasisSame({ dataset, basis }: DatasetContext, base: Scenario | undefined, baseOffEbitda: boolean): Gate {
  if (!dataset) return unavailableNoDataset("basis_same");
  if (baseOffEbitda) return { code: "basis_same", status: "unavailable", detail: NOT_EV_EBITDA };
  if (basis.kE == null || basis.adjustedEvEbitda == null) {
    return { code: "basis_same", status: "unavailable", detail: "kE unavailable" };
  }
  const adjMedian = basis.adjustedEvEbitda.median;
  const rawMedian = adjMedian / basis.kE;
  const baseMultiple = base?.bridge?.multiple;
  const detail = `kE ${basis.kE.toFixed(2)} · base multiple ${baseMultiple != null ? `${baseMultiple.toFixed(2)}x` : "n/a"} · same-basis median ${adjMedian.toFixed(2)}x · raw median ${rawMedian.toFixed(2)}x`;

  if (basis.sameBasis) return { code: "basis_same", status: "pass", detail };
  if (baseMultiple == null) return { code: "basis_same", status: "unavailable", detail };

  const closeToAdjusted = relDiff(baseMultiple, adjMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  const closeToRaw = relDiff(baseMultiple, rawMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  // closeToRaw (and not adjusted) is the exact Iren signature: the raw provider-basis
  // multiple applied straight to a statement-basis driver → fail. Close to the adjusted
  // median is positive evidence the haircut was applied → pass. Close to NEITHER (a p25/
  // p75 pick, a peer multiple, a re-rating thesis) proves nothing about which basis the
  // multiple was taken on, so the gate can't verify it → unavailable, never a pass.
  if (closeToAdjusted) return { code: "basis_same", status: "pass", detail };
  if (closeToRaw) return { code: "basis_same", status: "fail", detail };
  return { code: "basis_same", status: "unavailable", detail: `${detail} · matches neither median` };
}

function checkHorizonConsistent({ bull, base, bear }: ScenarioSet): Gate {
  const years = { bull: bull?.bridge?.driverYear, base: base?.bridge?.driverYear, bear: bear?.bridge?.driverYear };
  const detail = `bull ${years.bull ?? "n/a"} · base ${years.base ?? "n/a"} · bear ${years.bear ?? "n/a"}`;
  if (years.bull == null || years.base == null || years.bear == null) {
    return { code: "horizon_consistent", status: "unavailable", detail };
  }
  const status: Gate["status"] = years.bull === years.base && years.base === years.bear ? "pass" : "fail";
  return { code: "horizon_consistent", status, detail };
}

function checkBearBreaksPrice(bearStatedIntrinsic: number | null, price: number, priceComparable: boolean): Gate {
  if (!priceComparable) return { code: "bear_breaks_price", status: "unavailable", detail: CURRENCY_MISMATCH };
  if (bearStatedIntrinsic == null || !isFiniteNumber(price)) {
    return { code: "bear_breaks_price", status: "unavailable", detail: "bear scenario or price unavailable" };
  }
  const status: Gate["status"] = bearStatedIntrinsic < price ? "pass" : "fail";
  return { code: "bear_breaks_price", status, detail: `bear ${bearStatedIntrinsic.toFixed(2)} · price ${price.toFixed(2)}` };
}

function checkTrailingForward(baseCheck: BridgeCheck, base: Scenario | undefined, { dataset, latestFy }: DatasetContext, baseOffEbitda: boolean): Gate {
  if (!dataset) return unavailableNoDataset("trailing_forward");
  // The wedge and the LTM-equivalent are measured against the dataset's EBITDA.
  if (baseOffEbitda) return { code: "trailing_forward", status: "unavailable", detail: NOT_EV_EBITDA };
  const driverYear = base?.bridge?.driverYear;
  if (driverYear == null || !latestFy) {
    return { code: "trailing_forward", status: "unavailable", detail: "driverYear or latest FY unavailable" };
  }
  const isTrailing = driverYear <= latestFy.fiscalYear;
  // This gate informs rather than blocks: it never fails, only passes (trailing, or
  // LTM-equivalent available) or reports unavailable — it exposes the wedge, not a verdict.
  const status: Gate["status"] = isTrailing || baseCheck.impliedPercentileLtm != null ? "pass" : "unavailable";
  const wedge = baseCheck.growthWedgePct != null ? `${baseCheck.growthWedgePct >= 0 ? "+" : ""}${(baseCheck.growthWedgePct * 100).toFixed(0)}%` : "n/a";
  const fwd = baseCheck.impliedMultipleProvider != null ? `${baseCheck.impliedMultipleProvider.toFixed(2)}x (fwd)` : "n/a";
  const ltm =
    baseCheck.impliedMultipleLtm != null
      ? ` / ${baseCheck.impliedMultipleLtm.toFixed(2)}x (LTM-equiv${baseCheck.impliedPercentileLtm != null ? `, p${baseCheck.impliedPercentileLtm.toFixed(0)}` : ""})`
      : "";
  return { code: "trailing_forward", status, detail: `driver ${driverYear}${isTrailing ? "" : "e"} · wedge ${wedge} · implied ${fwd}${ltm}` };
}

function checkNetDebtTrajectory(scenarios: ScenarioSet, { dataset, latestFy }: DatasetContext, method: string): Gate {
  if (!dataset) return unavailableNoDataset("netdebt_trajectory");
  const { bull, base, bear } = scenarios;
  // No bridge anywhere ⇒ there is no declared net debt to test; that is "can't verify".
  if (!bull?.bridge && !base?.bridge && !bear?.bridge) {
    return { code: "netdebt_trajectory", status: "unavailable", detail: "no scenario declared a bridge" };
  }
  // An equity bridge declares net debt 0 by rule: tested against the FCF trajectory, it
  // read as an unfunded deleveraging on every P/E and DDM until 2026-10-29.
  const evBridge = isEvBridge(method);
  if (evBridge !== true) {
    return { code: "netdebt_trajectory", status: "unavailable", detail: evBridge === false ? EQUITY_BRIDGE : UNKNOWN_METHOD };
  }
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
  ] as const).filter(([, s]) => s?.bridge?.driverYear === targetYear);

  // Bridges that all point at other years leave nothing to test either: unavailable, never
  // the vacuous pass this once returned. A driver beyond FY+1 (a long-horizon DCF) is named,
  // because there the one-year FCF trajectory says nothing about the declared net debt.
  if (applicable.length === 0) {
    const beyond = [bull, base, bear].some((s) => (s?.bridge?.driverYear ?? 0) > targetYear);
    const detail = beyond ? `no scenario targets FY${targetYear} · long-horizon driver` : `no scenario targets FY${targetYear}`;
    return { code: "netdebt_trajectory", status: "unavailable", detail };
  }

  const threshold = expectedNetDebt * (1 - NETDEBT_TRAJECTORY_TOLERANCE);
  const failing = applicable.some(([, s]) => (s!.bridge as ValuationBridge).netDebt < threshold);
  const sampleNetDebt = (applicable[0][1]!.bridge as ValuationBridge).netDebt;
  const detail = `bridge ${sampleNetDebt.toFixed(0)} · expected ≥ ${threshold.toFixed(0)} · latest FY ${latestFy.netDebt.toFixed(1)}`;
  return { code: "netdebt_trajectory", status: failing ? "fail" : "pass", detail };
}

function checkRoicVsWacc(result: ParsedAnalystResult, base: Scenario | undefined, { dataset, basis }: DatasetContext, baseOffEbitda: boolean): Gate {
  if (!dataset) return unavailableNoDataset("roic_vs_wacc");
  // The base multiple is weighed against the EV/EBITDA median: a P/E against it read as a
  // premium valuation on any company earning below its cost of capital.
  if (baseOffEbitda) return { code: "roic_vs_wacc", status: "unavailable", detail: NOT_EV_EBITDA };
  const roic = result.assumptions?.roic;
  const wacc = result.assumptions?.wacc;
  if (!isFiniteNumber(roic) || !isFiniteNumber(wacc)) {
    return { code: "roic_vs_wacc", status: "unavailable", detail: "roic or wacc missing" };
  }
  const baseMultiple = base?.bridge?.multiple;
  const sameBasisMedian = basis.adjustedEvEbitda?.median;
  const detail = `roic ${roic.toFixed(1)}% · wacc ${wacc.toFixed(1)}% · base ${baseMultiple != null ? `${baseMultiple.toFixed(2)}x` : "n/a"} vs median ${sameBasisMedian != null ? `${sameBasisMedian.toFixed(2)}x` : "n/a"}`;
  if (baseMultiple == null || sameBasisMedian == null) {
    return { code: "roic_vs_wacc", status: "unavailable", detail };
  }
  const status: Gate["status"] = roic < wacc && baseMultiple >= sameBasisMedian ? "fail" : "pass";
  return { code: "roic_vs_wacc", status, detail };
}

function checkProbabilities({ bull, base, bear }: ScenarioSet): Gate {
  const pBull = bull?.probability;
  const pBase = base?.probability;
  const pBear = bear?.probability;
  const fmt = (p: number | undefined) => (isFiniteNumber(p) ? p.toFixed(2) : "n/a");
  const detail = `bull ${fmt(pBull)} · base ${fmt(pBase)} · bear ${fmt(pBear)}`;
  if (!isFiniteNumber(pBull) || !isFiniteNumber(pBase) || !isFiniteNumber(pBear)) {
    return { code: "probabilities", status: "unavailable", detail };
  }
  const status: Gate["status"] = Math.abs(pBull + pBase + pBear - 1) < PROBABILITIES_SUM_TOLERANCE ? "pass" : "fail";
  return { code: "probabilities", status, detail };
}

function checkCrossCheck(result: ParsedAnalystResult, baseIntrinsic: number | null): Gate {
  if (!result.crossCheck) {
    return { code: "cross_check", status: "unavailable", detail: "no cross-check declared" };
  }
  if (baseIntrinsic == null) {
    return { code: "cross_check", status: "unavailable", detail: "base scenario unavailable" };
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
  result: ParsedAnalystResult,
  series: number[],
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
  if (isEvOnEbitda(crossCheck.method, bridge) && bridge.shares !== 0 && bridge.driverValue !== 0) {
    const equityValue = intrinsicPerShare * bridge.shares;
    const evBridge = bridge.netDebt + bridge.minorities;
    impliedMultiple = (equityValue + evBridge) / bridge.driverValue;
    impliedMultipleProvider = bridgeToProviderMultiple(equityValue, evBridge, bridge.driverValue, basis);
    if (impliedMultipleProvider != null && series.length > 0) {
      impliedPercentile = percentileOf(impliedMultipleProvider, series);
    }
  }

  return { recomputedIntrinsic, arithmeticOk, impliedMultiple, impliedMultipleProvider, impliedPercentile };
}

/** Same signature-matching logic as checkBasisSame (the "raw table multiple applied to a
 *  same-basis driver" pattern), but reading the CROSS-CHECK's own declared multiple instead
 *  of the base scenario's. Defense-in-depth for an Iren-style error occurring in the
 *  cross-check rather than the primary bridge. A multiple close to NEITHER median (the
 *  Webuild case: a peer average) proves nothing about its basis, so it reads unavailable,
 *  exactly as in checkBasisSame — it passed until 2026-10. */
function checkCrossCheckBasis(result: ParsedAnalystResult, { dataset, basis }: DatasetContext): Gate {
  if (!dataset) return unavailableNoDataset("cross_check_basis");
  if (!result.crossCheck) {
    return { code: "cross_check_basis", status: "unavailable", detail: "no cross-check declared" };
  }
  if (result.crossCheck.bridge && !isEvOnEbitda(result.crossCheck.method, result.crossCheck.bridge)) {
    return { code: "cross_check_basis", status: "unavailable", detail: NOT_EV_EBITDA };
  }
  if (basis.kE == null || basis.adjustedEvEbitda == null) {
    return { code: "cross_check_basis", status: "unavailable", detail: "kE unavailable" };
  }
  const adjMedian = basis.adjustedEvEbitda.median;
  const rawMedian = adjMedian / basis.kE;
  const declaredMultiple = result.crossCheck.bridge?.multiple;
  const detail = `kE ${basis.kE.toFixed(2)} · cross-check multiple ${declaredMultiple != null ? `${declaredMultiple.toFixed(2)}x` : "n/a"} · same-basis median ${adjMedian.toFixed(2)}x · raw median ${rawMedian.toFixed(2)}x`;

  if (basis.sameBasis) return { code: "cross_check_basis", status: "pass", detail };
  if (declaredMultiple == null) return { code: "cross_check_basis", status: "unavailable", detail };

  const closeToAdjusted = relDiff(declaredMultiple, adjMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  const closeToRaw = relDiff(declaredMultiple, rawMedian) < BASIS_SAME_MULTIPLE_TOLERANCE;
  if (closeToAdjusted) return { code: "cross_check_basis", status: "pass", detail };
  if (closeToRaw) return { code: "cross_check_basis", status: "fail", detail };
  return { code: "cross_check_basis", status: "unavailable", detail: `${detail} · matches neither median` };
}

// A kill-price note is model prose shown inside a one-line gate detail — bounded so a
// rambling explanation can't swamp the gate dashboard.
const KILL_PRICE_NOTE_MAX_CHARS = 200;

/** Analyst lenses only. pass: a numeric kill price was declared. unavailable: none, but
 *  the lens explained why (`killPriceNote`) — the Skeptic contract allows an explicit
 *  "cannot construct one", which is an honest answer, not an omission. fail: null/absent
 *  with no explanation. Exported standalone since it operates on the lens's own fields,
 *  not on the bull/base/bear scenario set this module otherwise checks. */
export function checkKillPrice(killPrice: number | null | undefined, killPriceNote?: string | null): Gate {
  if (isFiniteNumber(killPrice)) {
    return { code: "kill_price", status: "pass", detail: killPrice.toFixed(2) };
  }
  const note = typeof killPriceNote === "string" ? killPriceNote.trim() : "";
  if (note) {
    const clipped = note.length > KILL_PRICE_NOTE_MAX_CHARS ? `${note.slice(0, KILL_PRICE_NOTE_MAX_CHARS - 1)}…` : note;
    return { code: "kill_price", status: "unavailable", detail: clipped };
  }
  return { code: "kill_price", status: "fail", detail: "not declared" };
}

// ─── Contract-only gates (2026-10) ────────────────────────────────────────────────
// They read nothing but the model's own JSON (and, for the dividend and units checks, the
// dataset when there is one), so they run on every analysis.

/** bear < base < bull, strictly, on the INTRINSIC scale (fairValue grossed up by
 *  checkOneScenario, never the raw MoS-adjusted fairValue). */
function checkScenarioOrder(scenarios: BridgeCheck[]): Gate {
  const intrinsicOf = (s: BridgeCheck["scenario"]) => scenarios.find((x) => x.scenario === s)?.statedIntrinsic ?? null;
  const bear = intrinsicOf("bear");
  const base = intrinsicOf("base");
  const bull = intrinsicOf("bull");
  if (bear == null || base == null || bull == null) {
    return { code: "scenario_order", status: "unavailable", detail: "scenario missing" };
  }
  const isOrdered = bear < base && base < bull;
  return {
    code: "scenario_order",
    status: isOrdered ? "pass" : "fail",
    detail: `bear ${bear.toFixed(2)} · base ${base.toFixed(2)} · bull ${bull.toFixed(2)}`,
  };
}

/** The mandatory second method must be structurally different: same family → fail. */
function checkMethodDistinct(result: ParsedAnalystResult): Gate {
  if (!result.crossCheck) return { code: "method_distinct", status: "unavailable", detail: "no cross-check declared" };
  const primary = methodFamily(result.method);
  const second = methodFamily(result.crossCheck.method);
  const detail = `${result.method} vs ${result.crossCheck.method}`;
  if (!primary || !second) return { code: "method_distinct", status: "unavailable", detail: `${detail} · ${UNKNOWN_METHOD}` };
  return { code: "method_distinct", status: primary === second ? "fail" : "pass", detail };
}

function isMonotonic(values: number[]): boolean {
  const isRising = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const isFalling = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return isRising || isFalling;
}

/** The 3×3 grid's centre must be the base intrinsic value (both PRE-MoS), and the central
 *  row and column must move one way: a grid that is not monotonic was not recomputed. */
function checkSensitivityCenter(result: ParsedAnalystResult, base: Scenario | undefined): Gate {
  const sensitivity = result.sensitivity;
  const baseIntrinsic = base?.bridge?.intrinsicPerShare;
  if (!sensitivity || baseIntrinsic == null) {
    return { code: "sensitivity_center", status: "unavailable", detail: "sensitivity or base bridge missing" };
  }
  const grid = sensitivity.intrinsicPerShare;
  const centre = grid[1][1];
  const detail = `centre ${centre.toFixed(2)} · base ${baseIntrinsic.toFixed(2)}`;
  if (relDiff(centre, baseIntrinsic) >= ARITHMETIC_TOLERANCE) return { code: "sensitivity_center", status: "fail", detail };
  if (!isMonotonic(grid[1]) || !isMonotonic(grid.map((row) => row[1]))) {
    return { code: "sensitivity_center", status: "fail", detail: `${detail} · non-monotonic` };
  }
  return { code: "sensitivity_center", status: "pass", detail };
}

/** The first year of the BASE dividend path, times the latest diluted share count, against
 *  the mean of the last three REPORTED free cash flows (years without FCF are skipped before
 *  the window is taken, as in reconcile.ts's dividend_not_covered). A non-payer passes
 *  before anything else: paying nothing needs no data to be covered. */
function checkDividendCoverage(result: ParsedAnalystResult, dataset: GroundedFinancials | null): Gate {
  if (result.dividends === null) return { code: "dividend_coverage", status: "pass", detail: "no dividend" };
  if (!dataset) return unavailableNoDataset("dividend_coverage");
  if (!sameCurrency(dataset.meta.reportingCurrency, result.currency)) {
    return { code: "dividend_coverage", status: "unavailable", detail: CURRENCY_MISMATCH };
  }
  const path = result.dividends?.path;
  const latest = dataset.financials[dataset.financials.length - 1];
  const fcfs = dataset.financials
    .map((f) => f.freeCashFlow)
    .filter((v): v is number => v != null)
    .slice(-DIVIDEND_FCF_LOOKBACK_YEARS);
  if (!path || !latest?.sharesDiluted || fcfs.length === 0) {
    return { code: "dividend_coverage", status: "unavailable", detail: "dividend path, FCF or shares missing" };
  }
  const meanFcf = fcfs.reduce((sum, v) => sum + v, 0) / fcfs.length;
  if (meanFcf <= 0) return { code: "dividend_coverage", status: "fail", detail: `mean FCF ${meanFcf.toFixed(0)} ≤ 0` };
  const total = path[0].base * latest.sharesDiluted;
  const ratio = total / meanFcf;
  return {
    code: "dividend_coverage",
    status: ratio <= 1 ? "pass" : "fail",
    detail: `DPS ${path[0].base.toFixed(2)} × shares ${latest.sharesDiluted.toFixed(0)} = ${total.toFixed(0)} · mean FCF(${fcfs.length}y) ${meanFcf.toFixed(0)} · ratio ${ratio.toFixed(2)}`,
  };
}

/** The scale the bridges were written in must be the dataset's: a bridge in millions on a
 *  paste in thousands is off by a factor of a thousand everywhere. */
function checkUnitsMatch(result: ParsedAnalystResult, dataset: GroundedFinancials | null): Gate {
  if (!dataset) return unavailableNoDataset("units_match");
  if (!result.units || !dataset.meta.units) return { code: "units_match", status: "unavailable", detail: "units undeclared" };
  return { code: "units_match", status: result.units === dataset.meta.units ? "pass" : "fail", detail: `${result.units} vs ${dataset.meta.units}` };
}

/**
 * The ten numbered sections the prompt mandates, independent of the report language: only
 * the number is checked, followed by ".", a fullwidth "．" or ")". Separate from
 * checkValuationBridges because it reads the Markdown, not the JSON; a fenced JSON block in
 * the text does not disturb it (the match is per line), but callers pass the stripped body.
 * @returns the sections_present gate; its detail lists the missing numbers.
 */
export function checkReportStructure(reportMd: string): Gate {
  const missing: number[] = [];
  for (let n = 1; n <= 10; n++) {
    if (!new RegExp(`^##\\s*${n}[.．)]`, "m").test(reportMd)) missing.push(n);
  }
  return missing.length === 0
    ? { code: "sections_present", status: "pass", detail: "10/10" }
    : { code: "sections_present", status: "fail", detail: `missing ${missing.join(",")}` };
}

function computeExpectedValue(
  scenarios: BridgeCheck[],
  { bull, base, bear }: ScenarioSet,
  mosPercent: number,
  price: number
): PostCheck["expectedValue"] {
  const pBull = bull?.probability;
  const pBase = base?.probability;
  const pBear = bear?.probability;
  if (!isFiniteNumber(pBull) || !isFiniteNumber(pBase) || !isFiniteNumber(pBear)) return null;
  if (Math.abs(pBull + pBase + pBear - 1) >= PROBABILITIES_SUM_TOLERANCE) return null;
  if (!isFiniteNumber(price) || price <= 0) return null;

  const intrinsicOf = (name: BridgeCheck["scenario"]) => scenarios.find((s) => s.scenario === name)?.statedIntrinsic ?? null;
  const iBull = intrinsicOf("bull");
  const iBase = intrinsicOf("base");
  const iBear = intrinsicOf("bear");
  if (iBull == null || iBase == null || iBear == null) return null;
  const expectedIntrinsic = pBull * iBull + pBase * iBase + pBear * iBear;
  const expectedBuyTarget = expectedIntrinsic * (1 - mosPercent / 100);
  const upsidePct = (expectedIntrinsic - price) / price;
  return { intrinsic: expectedIntrinsic, buyTarget: expectedBuyTarget, upsidePct };
}

/**
 * multiple_vs_market and priceAnchoringFlag — one comparison, computed once, on the
 * STATEMENT basis: both multiples are our own bridge over EBITDA_S, so the anchoring read
 * needs no kE at all. (Converting both to provider basis would only rescale them by the
 * same kE, plus a kB term that blurs rather than sharpens a "did the model copy the
 * price?" comparison.) No market-implied read (no dataset, currency mismatch, missing
 * bridge inputs, a base bridge not on EBITDA) → can't confirm anchoring; false/unavailable.
 */
function checkMultipleVsMarket(
  baseCheck: BridgeCheck,
  marketImplied: MarketImplied,
  hasDataset: boolean,
  baseOffEbitda: boolean
): { gate: Gate; priceAnchoringFlag: boolean } {
  if (!hasDataset) return { gate: unavailableNoDataset("multiple_vs_market"), priceAnchoringFlag: false };
  if (baseOffEbitda) return { gate: { code: "multiple_vs_market", status: "unavailable", detail: NOT_EV_EBITDA }, priceAnchoringFlag: false };
  if (baseCheck.impliedMultiple == null || marketImplied == null) {
    const missing = baseCheck.impliedMultiple == null ? "base implied multiple" : "market-implied multiple";
    return { gate: { code: "multiple_vs_market", status: "unavailable", detail: `${missing} unavailable` }, priceAnchoringFlag: false };
  }
  const diff = relDiff(baseCheck.impliedMultiple, marketImplied.impliedOnStatement);
  const priceAnchoringFlag = diff < ANCHOR_TOLERANCE;
  const detail = `base ${baseCheck.impliedMultiple.toFixed(2)}x · market ${marketImplied.impliedOnStatement.toFixed(2)}x · Δ ${(diff * 100).toFixed(1)}% (statement basis)`;
  return { gate: { code: "multiple_vs_market", status: priceAnchoringFlag ? "fail" : "pass", detail }, priceAnchoringFlag };
}

type GateInputs = {
  result: ParsedAnalystResult;
  scenarioSet: ScenarioSet;
  scenarios: BridgeCheck[];
  ctx: DatasetContext;
  price: number;
  /** sameCurrency(result.currency, quoteCurrency): false ⇒ every price gate is unavailable. */
  isPriceComparable: boolean;
  multipleVsMarket: Gate;
  /** A base bridge was declared and it is not an EV bridge on EBITDA (isEvOnEbitda). */
  baseOffEbitda: boolean;
};

/** The gate array, in its fixed display order: the original ten, the contract-only ones,
 *  then kill_price when the caller is checking a lens. sections_present is never here (it
 *  needs the Markdown): ValuationChecksCard appends it from checkReportStructure. */
function buildGates({ result, scenarioSet, scenarios, ctx, price, isPriceComparable, multipleVsMarket, baseOffEbitda }: GateInputs): Gate[] {
  const baseCheck = scenarios.find((s) => s.scenario === "base")!;
  const bearCheck = scenarios.find((s) => s.scenario === "bear")!;
  const gates: Gate[] = [
    checkBasisSame(ctx, scenarioSet.base, baseOffEbitda),
    checkHorizonConsistent(scenarioSet),
    checkBearBreaksPrice(bearCheck.statedIntrinsic, price, isPriceComparable),
    multipleVsMarket,
    checkTrailingForward(baseCheck, scenarioSet.base, ctx, baseOffEbitda),
    checkNetDebtTrajectory(scenarioSet, ctx, result.method),
    checkRoicVsWacc(result, scenarioSet.base, ctx, baseOffEbitda),
    checkProbabilities(scenarioSet),
    checkCrossCheck(result, baseCheck.statedIntrinsic),
    checkCrossCheckBasis(result, ctx),
    checkScenarioOrder(scenarios),
    checkMethodDistinct(result),
    checkSensitivityCenter(result, scenarioSet.base),
    checkDividendCoverage(result, ctx.dataset),
    checkUnitsMatch(result, ctx.dataset),
  ];
  // kill_price only applies to analyst lenses — its presence in `gates` is gated on the
  // caller having included the `killPrice` key at all (even as null), not on its value,
  // so a base-report call (no such key) never gets a spurious kill_price entry. The
  // sanitizer preserves that key's presence exactly for this reason.
  if ("killPrice" in result) gates.push(checkKillPrice(result.killPrice, result.killPriceNote));
  return gates;
}

/**
 * Recomputes each scenario's fair value from the model's own declared bridge and compares
 * it against what the model reported, then runs every deterministic gate (basis
 * same-ness, horizon consistency, bear validity, trailing/forward normalization, net-debt
 * trajectory, returns vs cost of capital, probabilities + expected value, cross-check,
 * scenario order, method family, sensitivity centre, dividend coverage, units) — the layer
 * that turns "the model declares" into "the code verifies".
 *
 * @param extract the pasted dataset, or null: without one (or with no financial rows) the
 *   dataset gates read "unavailable — no dataset", basis is EMPTY_BASIS, marketImplied null.
 * @param quoteCurrency the price's currency; a price gate whose result currency differs
 *   reads "unavailable — currency mismatch" and expectedValue is null.
 * @returns null only when `result` isn't an object. Never throws on malformed model output:
 *   `result` is re-sanitized on entry (sanitizeDeepValueResult), so a null/string/missing
 *   field reaches every gate as "not declared", never as a wrong-typed number.
 */
export function checkValuationBridges(
  rawResult: BridgeCheckInput,
  mosPercent: number,
  price: number,
  quoteCurrency: string,
  extract: GroundedFinancials | null
): PostCheck | null {
  const result = sanitizeDeepValueResult(rawResult);
  if (!result) return null;
  const ctx = buildDatasetContext(extract);
  // After sanitization each scenario may be missing (ParsedAnalystResult says so).
  const scenarioSet: ScenarioSet = { bull: result.bull, base: result.base, bear: result.bear };
  const scenarios: BridgeCheck[] = (["bear", "base", "bull"] as const).map((s) =>
    checkOneScenario(s, scenarioSet[s], mosPercent, ctx, isEvOnEbitda(result.method, scenarioSet[s]?.bridge))
  );
  // A base bridge that is not on EBITDA: the gates built on the EV/EBITDA medians and on
  // the market-implied multiple have nothing to compare it with. No base bridge at all is
  // left to each gate's own "missing" reading.
  const baseOffEbitda = scenarioSet.base?.bridge != null && !isEvOnEbitda(result.method, scenarioSet.base.bridge);

  const hasMarketRead = ctx.dataset != null && isFiniteNumber(price) && price > 0 && sameCurrency(ctx.dataset.meta.reportingCurrency, quoteCurrency);
  const marketImplied = hasMarketRead ? computeMarketImplied(price, quoteCurrency, ctx.dataset!, ctx.basis) : null;
  const anchoring = checkMultipleVsMarket(scenarios.find((s) => s.scenario === "base")!, marketImplied, ctx.dataset != null, baseOffEbitda);
  const isPriceComparable = sameCurrency(result.currency, quoteCurrency);

  return {
    scenarios,
    marketImplied,
    priceAnchoringFlag: anchoring.priceAnchoringFlag,
    gates: buildGates({ result, scenarioSet, scenarios, ctx, price, isPriceComparable, multipleVsMarket: anchoring.gate, baseOffEbitda }),
    basis: ctx.basis,
    expectedValue: isPriceComparable ? computeExpectedValue(scenarios, scenarioSet, mosPercent, price) : null,
    crossCheckBridge: checkCrossCheckBridge(result, ctx.series, ctx.basis),
  };
}
