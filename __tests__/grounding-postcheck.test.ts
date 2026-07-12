import { describe, it, expect } from "vitest";
import { checkValuationBridges, type BridgeCheckInput, type BridgeScenario } from "@/lib/grounding/postcheck";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";

// Shared bridge inputs — Eni-shaped: EBITDA 14200, net debt 11500, minorities 3200,
// shares 3150 (all €m except shares in millions — see the UNIT NOTE in types/grounding.ts).
const NET_DEBT = 11500;
const MINORITIES = 3200;
const SHARES = 3150;
const DRIVER_VALUE = 14200;

// A 10y EV/EBITDA history — the exact series illustrated in the spec's preview mockup
// (§5.3): min 2.4x / p75 4.6x / max 5.4x.
const EV_EBITDA_HISTORY = [2.4, 2.6, 2.9, 3.0, 3.2, 3.5, 3.8, 4.1, 4.6, 5.4];

const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR" }),
  financials: [
    makeFinancialsRow({
      fiscalYear: 2025,
      ebitda: DRIVER_VALUE,
      netDebt: NET_DEBT,
      minorityInterest: MINORITIES,
      sharesDiluted: SHARES,
    }),
  ],
  multiples: EV_EBITDA_HISTORY.map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2016 + i, evEbitda })),
});

function scenarioAt(multiple: number, mosPercent = 0): BridgeScenario {
  // intrinsicPerShare = (multiple × driverValue − netDebt − minorities) / shares — the
  // model's own bridge arithmetic, self-consistent by construction in these fixtures.
  const intrinsicPerShare = (multiple * DRIVER_VALUE - NET_DEBT - MINORITIES) / SHARES;
  const fairValue = intrinsicPerShare * (1 - mosPercent / 100);
  return {
    fairValue,
    bridge: {
      driver: "Normalized EBITDA 2026e",
      driverValue: DRIVER_VALUE,
      multiple,
      netDebt: NET_DEBT,
      minorities: MINORITIES,
      shares: SHARES,
      intrinsicPerShare,
    },
  };
}

describe("checkValuationBridges", () => {
  it("THE ENI CASE: flags priceAnchoringFlag when the base multiple coincides with the price-implied one", () => {
    // base multiple 4.2x vs. market-implied 4.18x at price €14.18 — Δ ≈ 0.46%, well under
    // the 3% threshold. This is the exact pathology ANALYTICAL_RIGOR_BLOCK item 10 exists
    // to prevent: a base case that reverse-engineers the price instead of anchoring to
    // history.
    const result: BridgeCheckInput = {
      bear: scenarioAt(3.0),
      base: scenarioAt(4.2),
      bull: scenarioAt(5.5),
    };

    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);
    expect(postCheck).not.toBeNull();

    // marketImplied = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.1808
    expect(postCheck!.marketImplied!.impliedMultiple).toBeCloseTo(4.180774648, 6);
    expect(postCheck!.priceAnchoringFlag).toBe(true);

    const base = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    // Check A: recomputed from the bridge's own multiple reproduces intrinsicPerShare
    // exactly by construction here → arithmeticOk true.
    expect(base.arithmeticOk).toBe(true);
    // Check B: mos=0 → statedIntrinsic === fairValue === intrinsicPerShare → mosOk true.
    expect(base.mosOk).toBe(true);
    // impliedMultiple is derived from intrinsicPerShare, not the declared `multiple` —
    // here they coincide by construction (both come from the same 4.2x).
    expect(base.impliedMultiple).toBeCloseTo(4.2, 6);
    // percentile of 4.2 in EV_EBITDA_HISTORY: bracket [4.1,4.6] → h=7+0.2=7.2, p=7.2/9*100=80
    expect(base.impliedPercentile).toBeCloseTo(80, 6);
  });

  it("does NOT flag anchoring when the base multiple sits far from the price-implied one", () => {
    // base multiple 3.0x vs. market-implied 4.18x → Δ ≈ 28.2%, comfortably over 3%.
    const result: BridgeCheckInput = {
      bear: scenarioAt(2.0),
      base: scenarioAt(3.0),
      bull: scenarioAt(4.0),
    };
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.priceAnchoringFlag).toBe(false);
  });

  it("Check A (arithmeticOk) fails when the declared intrinsicPerShare contradicts the bridge's own inputs", () => {
    const base = scenarioAt(4.2);
    base.bridge.intrinsicPerShare = 25.0; // model declares a value its own bridge doesn't support
    base.fairValue = 25.0; // consistent with the (wrong) declared intrinsic, mos=0

    const result: BridgeCheckInput = { bear: scenarioAt(3.0), base, bull: scenarioAt(5.5) };
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);

    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    // recomputed = 14.2667 vs declared 25.0 → |14.2667-25|/25 ≈ 42.9% ≫ 1%
    expect(baseCheck.recomputedIntrinsic).toBeCloseTo(14.266666667, 6);
    expect(baseCheck.arithmeticOk).toBe(false);
  });

  it("§5.4 THE MoS TRAP: applies grossUpToIntrinsic before comparing fairValue against intrinsicPerShare", () => {
    // mosPercent 25% — fairValue is the buy target (intrinsic × 0.75), NOT the intrinsic
    // itself. A naive direct comparison of fairValue vs intrinsicPerShare would fail this
    // check on every well-formed report.
    const result: BridgeCheckInput = {
      bear: scenarioAt(3.0, 25),
      base: scenarioAt(4.2, 25),
      bull: scenarioAt(5.5, 25),
    };
    const postCheck = checkValuationBridges(result, 25, 14.18, "EUR", EXTRACT);

    const base = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    // fairValue = 14.2667 × 0.75 = 10.7 (the stored buy target)
    expect(result.base.fairValue).toBeCloseTo(10.7, 6);
    // statedIntrinsic = grossUpToIntrinsic(10.7, 0.25) = 10.7 / 0.75 = 14.2667 ≈ intrinsicPerShare
    expect(base.statedIntrinsic).toBeCloseTo(14.266666667, 6);
    expect(base.mosOk).toBe(true);
    expect(base.arithmeticOk).toBe(true);
  });

  it("mosOk fails when the reported fairValue doesn't match the declared intrinsic under the given MoS", () => {
    const base = scenarioAt(4.2, 25);
    base.fairValue = 12.0; // should be ≈10.7 at mos=25% for this intrinsicPerShare
    const result: BridgeCheckInput = { bear: scenarioAt(3.0, 25), base, bull: scenarioAt(5.5, 25) };
    const postCheck = checkValuationBridges(result, 25, 14.18, "EUR", EXTRACT);
    expect(postCheck!.scenarios.find((s) => s.scenario === "base")!.mosOk).toBe(false);
  });

  it("degrades gracefully for a DCF/DDM scenario with no declared multiple (method-agnostic)", () => {
    const base = scenarioAt(4.2);
    delete base.bridge.multiple; // DCF/DDM never declares a multiple (spec §5.5)
    const result: BridgeCheckInput = { bear: scenarioAt(3.0), base, bull: scenarioAt(5.5) };
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);

    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.recomputedIntrinsic).toBeNull();
    expect(baseCheck.arithmeticOk).toBeNull();
    // impliedMultiple is still derivable from intrinsicPerShare alone — method-agnostic.
    expect(baseCheck.impliedMultiple).toBeCloseTo(4.2, 6);
    // priceAnchoringFlag still works off impliedMultiple, unaffected by the missing `multiple`.
    expect(postCheck!.priceAnchoringFlag).toBe(true);
  });

  it("returns marketImplied: null (and priceAnchoringFlag: false) on a currency mismatch, never a silently wrong number", () => {
    const result: BridgeCheckInput = { bear: scenarioAt(3.0), base: scenarioAt(4.2), bull: scenarioAt(5.5) };
    const postCheck = checkValuationBridges(result, 0, 15, "USD", EXTRACT); // extract is EUR
    expect(postCheck!.marketImplied).toBeNull();
    expect(postCheck!.priceAnchoringFlag).toBe(false);
    // The bridge checks themselves are independent of price/currency and still run.
    expect(postCheck!.scenarios).toHaveLength(3);
  });

  it("returns null on garbage input (no historical financials to check the bridge against)", () => {
    const result: BridgeCheckInput = { bear: scenarioAt(3.0), base: scenarioAt(4.2), bull: scenarioAt(5.5) };
    expect(checkValuationBridges(result, 0, 14.18, "EUR", makeExtract())).toBeNull();
  });
});
