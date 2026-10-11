import { describe, it, expect } from "vitest";
import { checkValuationBridges, checkKillPrice, type BridgeCheckInput, type BridgeScenario } from "@/lib/grounding/postcheck";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";

// Shared bridge inputs — Eni-shaped: EBITDA 14200, net debt 11500, minorities 3200,
// shares 3150 (all €m except shares in millions — see the UNIT NOTE in types/grounding.ts).
const NET_DEBT = 11500;
const MINORITIES = 3200;
const SHARES = 3150;
const DRIVER_VALUE = 14200;
const LATEST_FY = 2025;

// A 10y EV/EBITDA history. Only the latest year (2025, which overlaps the single
// financials row) carries a reported `enterpriseValue` — enough to make kE verifiable
// (kE=1 exactly, same basis) so the multiple_vs_market/basis_same gates can actually fire
// in these Check A/B-focused tests, without the basis-mismatch complication (that's
// exercised separately in its own describe block below, with the Iren-shaped fixture).
const EV_EBITDA_HISTORY = [2.4, 2.6, 2.9, 3.0, 3.2, 3.5, 3.8, 4.1, 4.6, 5.4];

const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR" }),
  financials: [
    makeFinancialsRow({
      fiscalYear: LATEST_FY,
      ebitda: DRIVER_VALUE,
      netDebt: NET_DEBT,
      minorityInterest: MINORITIES,
      sharesDiluted: SHARES,
    }),
  ],
  multiples: EV_EBITDA_HISTORY.map((evEbitda, i) =>
    makeMultiplesRow({
      fiscalYear: 2016 + i,
      evEbitda,
      ...(2016 + i === LATEST_FY ? { enterpriseValue: evEbitda * DRIVER_VALUE } : {}),
    })
  ),
});

// Same shape as EXTRACT but with no basis-verifying data at all — kE stays null. Used by
// tests that specifically exercise the "unavailable" (unverifiable basis) path.
const UNVERIFIED_EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR" }),
  financials: EXTRACT.financials,
  multiples: EV_EBITDA_HISTORY.map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2016 + i, evEbitda })),
});

function scenarioAt(multiple: number, mosPercent = 0, driverYear = LATEST_FY): BridgeScenario {
  // intrinsicPerShare = (multiple × driverValue − netDebt − minorities) / shares — the
  // model's own bridge arithmetic, self-consistent by construction in these fixtures.
  const intrinsicPerShare = (multiple * DRIVER_VALUE - NET_DEBT - MINORITIES) / SHARES;
  const fairValue = intrinsicPerShare * (1 - mosPercent / 100);
  return {
    fairValue,
    bridge: {
      driver: "Normalized EBITDA",
      driverValue: DRIVER_VALUE,
      driverYear,
      multiple,
      netDebt: NET_DEBT,
      minorities: MINORITIES,
      shares: SHARES,
      intrinsicPerShare,
    },
  };
}

function makeInput(overrides: Partial<BridgeCheckInput> = {}): BridgeCheckInput {
  return {
    method: "EV/EBITDA",
    sector: "Energy",
    currency: "EUR",
    bear: scenarioAt(3.0),
    base: scenarioAt(4.2),
    bull: scenarioAt(5.5),
    ...overrides,
  };
}

describe("checkValuationBridges — Check A/B", () => {
  it("THE ENI CASE: flags priceAnchoringFlag (and the multiple_vs_market gate) when the base multiple coincides with the price-implied one", () => {
    // base multiple 4.2x vs. market-implied 4.18x at price €14.18 — Δ ≈ 0.46%, well under
    // the 3% threshold. This is the exact pathology ANALYTICAL_RIGOR_BLOCK item 10 exists
    // to prevent: a base case that reverse-engineers the price instead of anchoring to
    // history.
    const result = makeInput();
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);
    expect(postCheck).not.toBeNull();

    // marketImplied.impliedOnStatement = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.1808
    expect(postCheck!.marketImplied!.impliedOnStatement).toBeCloseTo(4.180774648, 6);
    expect(postCheck!.priceAnchoringFlag).toBe(true);
    expect(postCheck!.gates.find((g) => g.code === "multiple_vs_market")!.status).toBe("fail");

    const base = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(base.arithmeticOk).toBe(true);
    expect(base.mosOk).toBe(true);
    expect(base.impliedMultiple).toBeCloseTo(4.2, 6);
  });

  it("THE ENI CASE without an Enterprise Value column: still flags anchoring — the comparison runs on the statement basis and needs no kE", () => {
    // UNVERIFIED_EXTRACT has neither enterpriseValue nor evSales ⇒ kE null ⇒ no
    // provider-basis read at all. Statement basis: base (4.2 × 14200) / 14200 = 4.2x vs
    // market (14.18 × 3150 + 14700) / 14200 ≈ 4.1808x ⇒ Δ = 0.0192 / 4.1808 ≈ 0.46% < 3%.
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", UNVERIFIED_EXTRACT);
    expect(postCheck!.basis.kE).toBeNull();
    expect(postCheck!.priceAnchoringFlag).toBe(true);
    const gate = postCheck!.gates.find((g) => g.code === "multiple_vs_market")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toBe("base 4.20x · market 4.18x · Δ 0.5% (statement basis)");
  });

  it("does NOT flag anchoring when the base multiple sits far from the price-implied one", () => {
    const result = makeInput({ bear: scenarioAt(2.0), base: scenarioAt(3.0), bull: scenarioAt(4.0) });
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.priceAnchoringFlag).toBe(false);
    expect(postCheck!.gates.find((g) => g.code === "multiple_vs_market")!.status).toBe("pass");
  });

  it("Check A (arithmeticOk) fails when the declared intrinsicPerShare contradicts the bridge's own inputs", () => {
    const base = scenarioAt(4.2);
    base.bridge!.intrinsicPerShare = 25.0; // model declares a value its own bridge doesn't support
    base.fairValue = 25.0;
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 14.18, "EUR", EXTRACT);
    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.recomputedIntrinsic).toBeCloseTo(14.266666667, 6);
    expect(baseCheck.arithmeticOk).toBe(false);
  });

  it("THE MoS TRAP: applies grossUpToIntrinsic before comparing fairValue against intrinsicPerShare", () => {
    const result = makeInput({ bear: scenarioAt(3.0, 25), base: scenarioAt(4.2, 25), bull: scenarioAt(5.5, 25) });
    const postCheck = checkValuationBridges(result, 25, 14.18, "EUR", EXTRACT);
    const base = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(result.base.fairValue).toBeCloseTo(10.7, 6);
    expect(base.statedIntrinsic).toBeCloseTo(14.266666667, 6);
    expect(base.mosOk).toBe(true);
    expect(base.arithmeticOk).toBe(true);
  });

  it("mosOk fails when the reported fairValue doesn't match the declared intrinsic under the given MoS", () => {
    const base = scenarioAt(4.2, 25);
    base.fairValue = 12.0; // should be ≈10.7 at mos=25% for this intrinsicPerShare
    const postCheck = checkValuationBridges(makeInput({ base, bear: scenarioAt(3.0, 25), bull: scenarioAt(5.5, 25) }), 25, 14.18, "EUR", EXTRACT);
    expect(postCheck!.scenarios.find((s) => s.scenario === "base")!.mosOk).toBe(false);
  });

  it("degrades gracefully for a DCF/DDM scenario with no declared multiple (method-agnostic)", () => {
    const base = scenarioAt(4.2);
    delete base.bridge!.multiple; // DCF/DDM never declares a multiple
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 14.18, "EUR", EXTRACT);
    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.recomputedIntrinsic).toBeNull();
    expect(baseCheck.arithmeticOk).toBeNull();
    expect(baseCheck.impliedMultiple).toBeCloseTo(4.2, 6);
    expect(postCheck!.priceAnchoringFlag).toBe(true);
  });

  it("returns marketImplied: null (and priceAnchoringFlag: false) on a currency mismatch, never a silently wrong number", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 15, "USD", EXTRACT); // extract is EUR
    expect(postCheck!.marketImplied).toBeNull();
    expect(postCheck!.priceAnchoringFlag).toBe(false);
    expect(postCheck!.scenarios).toHaveLength(3);
  });

  it("returns null on garbage input (no historical financials to check the bridge against)", () => {
    expect(checkValuationBridges(makeInput(), 0, 14.18, "EUR", makeExtract())).toBeNull();
  });

  it("degrades a scenario with NO bridge at all to all-null checks, never throws (Scenario.bridge is optional)", () => {
    const base = scenarioAt(4.2);
    delete (base as { bridge?: unknown }).bridge;
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 14.18, "EUR", EXTRACT);
    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.recomputedIntrinsic).toBeNull();
    expect(baseCheck.arithmeticOk).toBeNull();
    expect(baseCheck.mosOk).toBeNull();
    expect(baseCheck.impliedMultiple).toBeNull();
    expect(baseCheck.impliedPercentile).toBeNull();
    expect(baseCheck.statedIntrinsic).toBeCloseTo(14.266666667, 6);
  });
});

describe("gate: basis_same", () => {
  it("unavailable when kE is unverifiable", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", UNVERIFIED_EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "basis_same")!.status).toBe("unavailable");
  });

  it("THE IREN CASE, end-to-end: fails when the model applies the raw provider-basis multiple to statement EBITDA", () => {
    const statementEbitda = 1353;
    const years = [
      { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
      { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
      { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
      { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
    ];
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda, netDebt: 0, minorityInterest: 0, sharesDiluted: 908.8 })),
      multiples: years.map((y) => {
        const ebitdaProvider = y.kE * statementEbitda;
        return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
      }),
    });
    // Base scenario applies the RAW median (7.1x) straight to statement EBITDA — the exact
    // Iren mistake — instead of the same-basis equivalent (≈5.9x).
    const intrinsicPerShare = (7.1 * statementEbitda) / 908.8;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: 7.1, netDebt: 0, minorities: 0, shares: 908.8, intrinsicPerShare },
    };
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 2.95, "EUR", extract);
    const gate = postCheck!.gates.find((g) => g.code === "basis_same")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toContain("kE 0.83");
  });

  it("passes when the model applies the same-basis (adjusted) multiple instead", () => {
    const statementEbitda = 1353;
    const years = [
      { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
      { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
      { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
      { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
    ];
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda, netDebt: 0, minorityInterest: 0, sharesDiluted: 908.8 })),
      multiples: years.map((y) => {
        const ebitdaProvider = y.kE * statementEbitda;
        return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
      }),
    });
    // adjustedEvEbitda.median ≈ 5.893 (see grounding-basis.test.ts)
    const appliedMultiple = 5.893;
    const intrinsicPerShare = (appliedMultiple * statementEbitda) / 908.8;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: appliedMultiple, netDebt: 0, minorities: 0, shares: 908.8, intrinsicPerShare },
    };
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 2.95, "EUR", extract);
    expect(postCheck!.gates.find((g) => g.code === "basis_same")!.status).toBe("pass");
  });

  it("unavailable (never pass) when the base multiple matches NEITHER the raw nor the same-basis median", () => {
    const statementEbitda = 1353;
    const years = [
      { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
      { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
      { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
      { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
      { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
    ];
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda, netDebt: 0, minorityInterest: 0, sharesDiluted: 908.8 })),
      multiples: years.map((y) => makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * y.kE * statementEbitda })),
    });
    // 6.5x vs same-basis median 5.893x: |6.5 − 5.893| / 5.893 ≈ 10.3% > 5%;
    // 6.5x vs raw median 7.1x: |6.5 − 7.1| / 7.1 ≈ 8.5% > 5% ⇒ basis can't be inferred.
    const intrinsicPerShare = (6.5 * statementEbitda) / 908.8;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: 6.5, netDebt: 0, minorities: 0, shares: 908.8, intrinsicPerShare },
    };
    const gate = checkValuationBridges(makeInput({ base }), 0, 2.95, "EUR", extract)!.gates.find((g) => g.code === "basis_same")!;
    expect(gate.status).toBe("unavailable");
    expect(gate.detail).toContain("matches neither median");
  });
});

describe("gate: horizon_consistent", () => {
  it("passes when all three scenarios share the same driverYear", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "horizon_consistent")!.status).toBe("pass");
  });

  it("fails when the bull is underwritten to a different year than base/bear (the seven-years-to-work case)", () => {
    const result = makeInput({ bull: scenarioAt(5.5, 0, 2033), base: scenarioAt(4.2, 0, 2026), bear: scenarioAt(3.0, 0, 2026) });
    const postCheck = checkValuationBridges(result, 0, 14.18, "EUR", EXTRACT);
    const gate = postCheck!.gates.find((g) => g.code === "horizon_consistent")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toBe("bull 2033 · base 2026 · bear 2026");
  });

  it("unavailable when a scenario has no bridge at all", () => {
    const base = scenarioAt(4.2);
    delete (base as { bridge?: unknown }).bridge;
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "horizon_consistent")!.status).toBe("unavailable");
  });
});

describe("gate: bear_breaks_price", () => {
  it("fails when the bear-case intrinsic stays above the current price (a timid Base, not a Bear)", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 1.0, "EUR", EXTRACT); // price way below any scenario
    expect(postCheck!.gates.find((g) => g.code === "bear_breaks_price")!.status).toBe("fail");
  });

  it("passes when the bear-case intrinsic breaks the current price", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 999, "EUR", EXTRACT); // price way above any scenario
    expect(postCheck!.gates.find((g) => g.code === "bear_breaks_price")!.status).toBe("pass");
  });
});

describe("gate: trailing_forward", () => {
  it("passes (trailing) when the base driverYear is at or before the latest reported fiscal year", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT); // driverYear = LATEST_FY
    const gate = postCheck!.gates.find((g) => g.code === "trailing_forward")!;
    expect(gate.status).toBe("pass");
    expect(gate.detail).toContain("driver 2025");
  });

  it("passes (forward, LTM-normalized) and reports the growth wedge when kE is verifiable", () => {
    const statementEbitda = 1000;
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: statementEbitda, revenue: 2000, netDebt: 500, minorityInterest: 200, sharesDiluted: 100 })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 2.0 })], // kE ≈ 0.8
    });
    const driverValue = 1200; // forward driver, 20% above latest FY EBITDA
    const intrinsicPerShare = (5.9 * driverValue - 500 - 200) / 100;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "2026e EBITDA", driverValue, driverYear: 2026, multiple: 5.9, netDebt: 500, minorities: 200, shares: 100, intrinsicPerShare },
    };
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 10, "EUR", extract);
    const gate = postCheck!.gates.find((g) => g.code === "trailing_forward")!;
    expect(gate.status).toBe("pass");
    expect(gate.detail).toContain("driver 2026e");
    expect(gate.detail).toContain("wedge +20%");
    const baseCheck = postCheck!.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.impliedMultipleLtm).not.toBeNull();
    expect(baseCheck.growthWedgePct).toBeCloseTo(0.2, 6);
  });

  it("unavailable (forward driver, basis unverifiable) — never fails, just can't normalize", () => {
    const base = scenarioAt(4.2, 0, 2030); // forward year, but UNVERIFIED_EXTRACT has no evSales/enterpriseValue
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 14.18, "EUR", UNVERIFIED_EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "trailing_forward")!.status).toBe("unavailable");
  });
});

describe("gate: netdebt_trajectory", () => {
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: DRIVER_VALUE, netDebt: 4411.6, freeCashFlow: 152.5, dividendsPerShare: 0.196, sharesDiluted: 908.8 })],
    multiples: EV_EBITDA_HISTORY.map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2016 + i, evEbitda })),
  });
  // expectedNetDebt = 4411.6 − (152.5 − 0.196×908.8) = 4411.6 − (152.5 − 178.12) ≈ 4437.2.
  // NETDEBT_TRAJECTORY_TOLERANCE (5%) allows bridge.netDebt down to ≈4215.4 before the
  // gate fails — Iren's own real net-debt figure (4330, a ≈2.4% shortfall) sits INSIDE
  // that band, so this fixture uses a clearly-failing 4000 to exercise the fail path
  // unambiguously rather than reproducing Iren's exact number (a different gate,
  // basis_same, is what actually caught the Iren report — see its own describe block).

  it("fails when a scenario targeting FY+1 assumes net debt clearly below the FCF-implied trajectory (an unfunded deleveraging assumption)", () => {
    const intrinsicPerShare = (4.2 * DRIVER_VALUE - 4000 - MINORITIES) / SHARES;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "2026e EBITDA", driverValue: DRIVER_VALUE, driverYear: 2026, multiple: 4.2, netDebt: 4000, minorities: MINORITIES, shares: SHARES, intrinsicPerShare },
    };
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 2.95, "EUR", extract);
    const gate = postCheck!.gates.find((g) => g.code === "netdebt_trajectory")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toContain("bridge 4000");
  });

  it("passes when the scenario's net debt is at/above the FCF-implied trajectory", () => {
    const intrinsicPerShare = (4.2 * DRIVER_VALUE - 4500 - MINORITIES) / SHARES;
    const base: BridgeScenario = {
      fairValue: intrinsicPerShare,
      bridge: { driver: "2026e EBITDA", driverValue: DRIVER_VALUE, driverYear: 2026, multiple: 4.2, netDebt: 4500, minorities: MINORITIES, shares: SHARES, intrinsicPerShare },
    };
    const postCheck = checkValuationBridges(makeInput({ base }), 0, 2.95, "EUR", extract);
    expect(postCheck!.gates.find((g) => g.code === "netdebt_trajectory")!.status).toBe("pass");
  });

  it("passes (vacuously) when no scenario targets latestFy+1", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", extract); // all scenarios at driverYear=2025
    expect(postCheck!.gates.find((g) => g.code === "netdebt_trajectory")!.status).toBe("pass");
  });

  it("unavailable (not a vacuous pass) when NO scenario declared a bridge at all", () => {
    // Same FY data as above, so the only thing missing is the model's own bridges.
    const noBridge = (multiple: number): BridgeScenario => ({ fairValue: scenarioAt(multiple).fairValue });
    const postCheck = checkValuationBridges(makeInput({ bear: noBridge(3.0), base: noBridge(4.2), bull: noBridge(5.5) }), 0, 14.18, "EUR", extract);
    const gate = postCheck!.gates.find((g) => g.code === "netdebt_trajectory")!;
    expect(gate.status).toBe("unavailable");
    expect(gate.detail).toBe("no scenario declared a bridge");
  });

  it("unavailable when freeCashFlow or dividendsPerShare are missing", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT); // no fcf/dividends on EXTRACT
    expect(postCheck!.gates.find((g) => g.code === "netdebt_trajectory")!.status).toBe("unavailable");
  });
});

describe("gate: roic_vs_wacc", () => {
  const statementEbitda = 1000;
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: statementEbitda, revenue: 2000 })],
    multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, evSales: 2.0 })], // kE ≈ 0.8, adjustedEvEbitda.median = 4.0
  });

  it("fails when ROIC < WACC and the base multiple is at/above the same-basis median", () => {
    const base = scenarioAt(4.2); // ≥ 4.0 same-basis median
    const postCheck = checkValuationBridges(
      makeInput({ base, assumptions: { roic: 4.5, wacc: 6.5, terminalGrowth: null } }),
      0,
      14.18,
      "EUR",
      extract
    );
    const gate = postCheck!.gates.find((g) => g.code === "roic_vs_wacc")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toBe("roic 4.5% · wacc 6.5% · base 4.20x vs median 4.00x");
  });

  it("passes when ROIC < WACC but the base multiple sits below the same-basis median (a coherent de-rating)", () => {
    const base = scenarioAt(3.5); // < 4.0 same-basis median
    const postCheck = checkValuationBridges(makeInput({ base, assumptions: { roic: 4.5, wacc: 6.5, terminalGrowth: null } }), 0, 14.18, "EUR", extract);
    expect(postCheck!.gates.find((g) => g.code === "roic_vs_wacc")!.status).toBe("pass");
  });

  it("passes when ROIC >= WACC regardless of the multiple", () => {
    const postCheck = checkValuationBridges(makeInput({ assumptions: { roic: 8, wacc: 6.5, terminalGrowth: null } }), 0, 14.18, "EUR", extract);
    expect(postCheck!.gates.find((g) => g.code === "roic_vs_wacc")!.status).toBe("pass");
  });

  it("unavailable when roic/wacc are missing", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", extract);
    expect(postCheck!.gates.find((g) => g.code === "roic_vs_wacc")!.status).toBe("unavailable");
  });
});

describe("gate: probabilities + expectedValue", () => {
  it("passes and computes expectedValue when probabilities sum to ≈1", () => {
    const bear = scenarioAt(3.0);
    const base = scenarioAt(4.2);
    const bull = scenarioAt(5.5);
    bear.probability = 0.25;
    base.probability = 0.5;
    bull.probability = 0.25;
    const postCheck = checkValuationBridges(makeInput({ bear, base, bull }), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "probabilities")!.status).toBe("pass");
    expect(postCheck!.expectedValue).not.toBeNull();
    const expectedIntrinsic = 0.25 * bear.bridge!.intrinsicPerShare + 0.5 * base.bridge!.intrinsicPerShare + 0.25 * bull.bridge!.intrinsicPerShare;
    expect(postCheck!.expectedValue!.intrinsic).toBeCloseTo(expectedIntrinsic, 6);
    expect(postCheck!.expectedValue!.upsidePct).toBeCloseTo((expectedIntrinsic - 14.18) / 14.18, 6);
  });

  it("fails and nulls expectedValue when probabilities don't sum to ≈1", () => {
    const bear = scenarioAt(3.0);
    const base = scenarioAt(4.2);
    const bull = scenarioAt(5.5);
    bear.probability = 0.5;
    base.probability = 0.5;
    bull.probability = 0.5; // sums to 1.5
    const postCheck = checkValuationBridges(makeInput({ bear, base, bull }), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "probabilities")!.status).toBe("fail");
    expect(postCheck!.expectedValue).toBeNull();
  });

  it("unavailable and nulls expectedValue when probabilities are absent", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "probabilities")!.status).toBe("unavailable");
    expect(postCheck!.expectedValue).toBeNull();
  });
});

describe("gate: cross_check", () => {
  it("passes when the cross-check intrinsic is within 25% of the primary base intrinsic", () => {
    const base = scenarioAt(4.2); // intrinsicPerShare ≈ 14.267
    const postCheck = checkValuationBridges(
      makeInput({ base, crossCheck: { method: "DDM", intrinsicPerShare: 13.0, reconciliation: "close enough" } }),
      0,
      14.18,
      "EUR",
      EXTRACT
    );
    expect(postCheck!.gates.find((g) => g.code === "cross_check")!.status).toBe("pass");
  });

  it("fails when the delta exceeds 25% (the RAB/DDM-liquidated-in-a-line case)", () => {
    const base = scenarioAt(4.2); // intrinsicPerShare ≈ 14.267
    const postCheck = checkValuationBridges(
      makeInput({ base, crossCheck: { method: "DDM", intrinsicPerShare: 3.4, reconciliation: "large divergence" } }),
      0,
      14.18,
      "EUR",
      EXTRACT
    );
    const gate = postCheck!.gates.find((g) => g.code === "cross_check")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toContain("delta");
  });

  it("unavailable when no cross-check is declared", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "cross_check")!.status).toBe("unavailable");
  });
});

describe("gate: cross_check_basis", () => {
  // Same Iren-shaped fixture as the basis_same describe block above, but the raw/adjusted
  // multiple is now applied inside the CROSS-CHECK's own bridge instead of the base
  // scenario's — the primary method (a DCF, per the Webuild live test) may have no
  // `bridge.multiple` at all for basis_same to check; this gate is the same signature
  // check, run on the cross-check's bridge instead.
  const statementEbitda = 1353;
  const years = [
    { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
    { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
    { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
    { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
  ];
  const irenExtract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda, netDebt: 0, minorityInterest: 0, sharesDiluted: 908.8 })),
    multiples: years.map((y) => {
      const ebitdaProvider = y.kE * statementEbitda;
      return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
    }),
  });

  it("fails when the cross-check applies the raw provider-basis multiple to statement EBITDA", () => {
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA",
          intrinsicPerShare: (7.1 * statementEbitda) / 908.8,
          reconciliation: "n/a",
          bridge: { driver: "EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: 7.1, netDebt: 0, minorities: 0, shares: 908.8 },
        },
      }),
      0,
      2.95,
      "EUR",
      irenExtract
    );
    const gate = postCheck!.gates.find((g) => g.code === "cross_check_basis")!;
    expect(gate.status).toBe("fail");
    expect(gate.detail).toContain("kE 0.83");
  });

  it("passes when the cross-check applies the same-basis (adjusted) multiple instead", () => {
    const appliedMultiple = 5.893;
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA",
          intrinsicPerShare: (appliedMultiple * statementEbitda) / 908.8,
          reconciliation: "n/a",
          bridge: { driver: "EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: appliedMultiple, netDebt: 0, minorities: 0, shares: 908.8 },
        },
      }),
      0,
      2.95,
      "EUR",
      irenExtract
    );
    expect(postCheck!.gates.find((g) => g.code === "cross_check_basis")!.status).toBe("pass");
  });

  it("passes (not this signature) when the cross-check's multiple comes from peers, matching neither the raw nor adjusted median — the actual Webuild case", () => {
    // Webuild's real cross-check used a 6.2x peer average against neither the 11.84x raw
    // nor the 10.40x same-basis median of Webuild's OWN history — this gate is not the one
    // that catches that divergence (the delta-tolerance `cross_check` gate is).
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA (peers)",
          intrinsicPerShare: (6.2 * statementEbitda) / 908.8,
          reconciliation: "n/a",
          bridge: { driver: "Peer EV/EBITDA", driverValue: statementEbitda, driverYear: 2025, multiple: 6.2, netDebt: 0, minorities: 0, shares: 908.8 },
        },
      }),
      0,
      2.95,
      "EUR",
      irenExtract
    );
    expect(postCheck!.gates.find((g) => g.code === "cross_check_basis")!.status).toBe("pass");
  });

  it("unavailable when no cross-check is declared", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "cross_check_basis")!.status).toBe("unavailable");
  });

  it("unavailable when a cross-check is declared but with no bridge (e.g. DDM, no multiple) — using a basis that ISN'T already same, so the missing-multiple path is actually reached", () => {
    // On EXTRACT (kE≈1, sameBasis true) this gate would trivially "pass" regardless of the
    // multiple (mirrors basis_same's own early-return) — irenExtract (kE 0.83) is needed to
    // exercise the "no multiple to check" degradation instead.
    const postCheck = checkValuationBridges(
      makeInput({ crossCheck: { method: "DDM", intrinsicPerShare: 13.0, reconciliation: "n/a" } }),
      0,
      2.95,
      "EUR",
      irenExtract
    );
    expect(postCheck!.gates.find((g) => g.code === "cross_check_basis")!.status).toBe("unavailable");
  });

  it("unavailable when kE is unverifiable", () => {
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA",
          intrinsicPerShare: 10,
          reconciliation: "n/a",
          bridge: { driver: "EBITDA", driverValue: DRIVER_VALUE, driverYear: LATEST_FY, multiple: 5, netDebt: NET_DEBT, minorities: MINORITIES, shares: SHARES },
        },
      }),
      0,
      14.18,
      "EUR",
      UNVERIFIED_EXTRACT
    );
    expect(postCheck!.gates.find((g) => g.code === "cross_check_basis")!.status).toBe("unavailable");
  });
});

describe("PostCheck.crossCheckBridge — Check A on the cross-check's own bridge", () => {
  it("is null when there's no crossCheck at all", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.crossCheckBridge).toBeNull();
  });

  it("is null when the model declared a crossCheck with no bridge", () => {
    const postCheck = checkValuationBridges(
      makeInput({ crossCheck: { method: "DDM", intrinsicPerShare: 13.0, reconciliation: "n/a" } }),
      0,
      14.18,
      "EUR",
      EXTRACT
    );
    expect(postCheck!.crossCheckBridge).toBeNull();
  });

  it("arithmeticOk passes when the declared intrinsicPerShare matches the bridge's own math (the Webuild cross-check, verified by hand)", () => {
    const multiple = 6.2;
    const driverValue = 1195.4;
    const netDebt = -444; // net cash
    const minorities = 130;
    const shares = 984.15;
    const intrinsicPerShare = (multiple * driverValue - netDebt - minorities) / shares;
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA (peers)",
          intrinsicPerShare,
          reconciliation: "n/a",
          bridge: { driver: "Peer EV/EBITDA 2026e", driverValue, driverYear: 2026, multiple, netDebt, minorities, shares },
        },
      }),
      0,
      2.15,
      "EUR",
      EXTRACT
    );
    expect(postCheck!.crossCheckBridge!.arithmeticOk).toBe(true);
  });

  it("arithmeticOk fails when the declared intrinsicPerShare does NOT match the bridge's own math — a check that runs on NOTHING today", () => {
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "EV/EBITDA (peers)",
          intrinsicPerShare: 7.85,
          reconciliation: "n/a",
          bridge: { driver: "Peer EV/EBITDA 2026e", driverValue: 1195.4, driverYear: 2026, multiple: 2.0, netDebt: 500, minorities: 130, shares: 984.15 },
        },
      }),
      0,
      2.15,
      "EUR",
      EXTRACT
    );
    expect(postCheck!.crossCheckBridge!.arithmeticOk).toBe(false);
  });

  it("arithmeticOk is null (not computable) when the bridge has no multiple (a DDM-style cross-check), but the method-agnostic implied multiple still computes", () => {
    const postCheck = checkValuationBridges(
      makeInput({
        crossCheck: {
          method: "DDM",
          intrinsicPerShare: 4.4,
          reconciliation: "n/a",
          bridge: { driver: "Dividend stream", driverValue: DRIVER_VALUE, driverYear: LATEST_FY, netDebt: NET_DEBT, minorities: MINORITIES, shares: SHARES },
        },
      }),
      0,
      2.15,
      "EUR",
      EXTRACT
    );
    expect(postCheck!.crossCheckBridge!.arithmeticOk).toBeNull();
    expect(postCheck!.crossCheckBridge!.impliedMultiple).not.toBeNull();
  });
});

describe("gate: kill_price (analyst lenses only)", () => {
  it("is absent from PostCheck.gates for a base-report call (no killPrice key at all)", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.some((g) => g.code === "kill_price")).toBe(false);
  });

  it("passes when a numeric kill price is present (even when the caller includes the key)", () => {
    const postCheck = checkValuationBridges(makeInput({ killPrice: 9.5 }), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "kill_price")!.status).toBe("pass");
  });

  it("fails when killPrice is explicitly null", () => {
    const postCheck = checkValuationBridges(makeInput({ killPrice: null }), 0, 14.18, "EUR", EXTRACT);
    expect(postCheck!.gates.find((g) => g.code === "kill_price")!.status).toBe("fail");
  });

  it("checkKillPrice is directly testable standalone", () => {
    expect(checkKillPrice(9.5).status).toBe("pass");
    expect(checkKillPrice(null).status).toBe("fail");
    expect(checkKillPrice(undefined).status).toBe("fail");
  });

  it("unavailable (not fail) when killPrice is null but the lens explained why in killPriceNote", () => {
    const note = "Regulated asset base: no single price level invalidates the thesis";
    const postCheck = checkValuationBridges(makeInput({ killPrice: null, killPriceNote: note }), 0, 14.18, "EUR", EXTRACT);
    const gate = postCheck!.gates.find((g) => g.code === "kill_price")!;
    expect(gate.status).toBe("unavailable");
    expect(gate.detail).toBe(note);
  });

  it("still fails when the note is empty/whitespace — an empty reason is no reason", () => {
    expect(checkKillPrice(null, "   ").status).toBe("fail");
    expect(checkKillPrice(null, "").status).toBe("fail");
  });

  it("a numeric kill price passes regardless of any note, and an over-long note is clipped in the detail", () => {
    expect(checkKillPrice(9.5, "ignored").detail).toBe("9.50");
    const detail = checkKillPrice(null, "x".repeat(500)).detail;
    expect(detail).toHaveLength(200);
    expect(detail.endsWith("…")).toBe(true);
  });
});

describe("PostCheck.basis is always the recomputed BasisReconciliation for the given extract", () => {
  it("threads through kE/kEn/confidence from computeBasisReconciliation", () => {
    const postCheck = checkValuationBridges(makeInput(), 0, 14.18, "EUR", UNVERIFIED_EXTRACT);
    expect(postCheck!.basis.kE).toBeNull();
    expect(postCheck!.basis.confidence).toBe("unavailable");
  });
});

describe("provider-basis reads scale the declared EV bridge by kB", () => {
  // kE = 0.9 (EV_P 4500 / evEbitda 5 = 900 vs EBITDA_S 1000); kB = (4500 − 3700) / (500 + 200)
  // = 800 / 700 ≈ 1.142857 — see grounding-anchors.test.ts for the same fixture.
  const kbExtract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, minorityInterest: 200, sharesDiluted: 100 })],
    multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 5, enterpriseValue: 4500, marketCap: 3700 })],
  });
  const bridgeAt = (driverValue: number, driverYear: number, intrinsicPerShare: number) => ({
    driver: "EBITDA",
    driverValue,
    driverYear,
    netDebt: 500,
    minorities: 200,
    shares: 100,
    intrinsicPerShare,
  });

  it("impliedMultipleProvider = (intrinsic × shares + kB × bridge) / (kE × driver)", () => {
    const base: BridgeScenario = { fairValue: 37, bridge: bridgeAt(1000, 2025, 37) };
    const baseCheck = checkValuationBridges(makeInput({ base }), 0, 30, "EUR", kbExtract)!.scenarios.find((s) => s.scenario === "base")!;
    // statement: (3700 + 700) / 1000 = 4.4 — our own bridge, unscaled
    expect(baseCheck.impliedMultiple).toBeCloseTo(4.4, 9);
    // provider: (3700 + 8/7 × 700) / (0.9 × 1000) = 4500 / 900 = 5.0 (kE-only: 4.4 / 0.9 ≈ 4.8889)
    expect(baseCheck.impliedMultipleProvider).toBeCloseTo(5.0, 9);
  });

  it("the LTM-equivalent read of a forward driver is scaled the same way", () => {
    const base: BridgeScenario = { fairValue: 37, bridge: bridgeAt(1200, 2026, 37) };
    const baseCheck = checkValuationBridges(makeInput({ base }), 0, 30, "EUR", kbExtract)!.scenarios.find((s) => s.scenario === "base")!;
    // forward: (3700 + 800) / (0.9 × 1200) = 4500 / 1080 ≈ 4.166667
    expect(baseCheck.impliedMultipleProvider).toBeCloseTo(4.166667, 5);
    // LTM-equivalent on EBITDA_S 2025 = 1000: 4500 / 900 = 5.0
    expect(baseCheck.impliedMultipleLtm).toBeCloseTo(5.0, 9);
  });

  it("the cross-check's own bridge is scaled the same way", () => {
    const { intrinsicPerShare: _omit, ...ccBridge } = bridgeAt(1000, 2025, 37);
    const postCheck = checkValuationBridges(
      makeInput({ crossCheck: { method: "EV/EBITDA", intrinsicPerShare: 37, reconciliation: "n/a", bridge: ccBridge } }),
      0,
      30,
      "EUR",
      kbExtract
    );
    // (3700 + 800) / 900 = 5.0
    expect(postCheck!.crossCheckBridge!.impliedMultipleProvider).toBeCloseTo(5.0, 9);
  });
});

describe("robustness: malformed model JSON degrades to unavailable, never throws, never passes", () => {
  it("a missing bear/base/bull key does not crash; the dependent gates read unavailable", () => {
    const garbage = { method: "EV/EBITDA", sector: "Energy", currency: "EUR", base: scenarioAt(4.2), bull: scenarioAt(5.5) } as unknown as BridgeCheckInput;
    const postCheck = checkValuationBridges(garbage, 0, 14.18, "EUR", EXTRACT)!;
    expect(postCheck).not.toBeNull();
    const bear = postCheck.scenarios.find((s) => s.scenario === "bear")!;
    expect(bear.statedIntrinsic).toBeNull();
    expect(bear.mosOk).toBeNull();
    const status = (code: string) => postCheck.gates.find((g) => g.code === code)!.status;
    expect(status("bear_breaks_price")).toBe("unavailable");
    expect(status("horizon_consistent")).toBe("unavailable");
    expect(postCheck.expectedValue).toBeNull();
  });

  it("a missing BASE scenario makes the base-dependent gates unavailable, not pass", () => {
    const garbage = { method: "EV/EBITDA", sector: "Energy", currency: "EUR", bear: scenarioAt(3.0), bull: scenarioAt(5.5), crossCheck: { method: "DDM", intrinsicPerShare: 13, reconciliation: "" } } as unknown as BridgeCheckInput;
    const postCheck = checkValuationBridges(garbage, 0, 14.18, "EUR", EXTRACT)!;
    const status = (code: string) => postCheck.gates.find((g) => g.code === code)!.status;
    expect(status("multiple_vs_market")).toBe("unavailable");
    expect(status("cross_check")).toBe("unavailable");
    expect(status("trailing_forward")).toBe("unavailable");
    expect(postCheck.priceAnchoringFlag).toBe(false);
  });

  it("null/string fields in bridges, probabilities, assumptions and crossCheck are dropped, not computed on", () => {
    const base = scenarioAt(4.2) as unknown as Record<string, unknown>;
    (base.bridge as Record<string, unknown>).netDebt = null; // a bridge missing a term can't be recomputed
    const bull = { ...scenarioAt(5.5), probability: "0.25" } as unknown as BridgeScenario;
    const bear = { ...scenarioAt(3.0), probability: null } as unknown as BridgeScenario;
    const garbage = {
      method: "EV/EBITDA",
      sector: "Energy",
      currency: "EUR",
      bull,
      base,
      bear,
      assumptions: { roic: "4.5", wacc: 6.5, terminalGrowth: null },
      crossCheck: { method: "DDM", intrinsicPerShare: "13", reconciliation: "x" },
    } as unknown as BridgeCheckInput;
    const postCheck = checkValuationBridges(garbage, 0, 14.18, "EUR", EXTRACT)!;
    const baseCheck = postCheck.scenarios.find((s) => s.scenario === "base")!;
    expect(baseCheck.arithmeticOk).toBeNull();
    expect(baseCheck.impliedMultiple).toBeNull();
    const status = (code: string) => postCheck.gates.find((g) => g.code === code)!.status;
    expect(status("probabilities")).toBe("unavailable");
    expect(status("roic_vs_wacc")).toBe("unavailable");
    expect(status("cross_check")).toBe("unavailable");
    expect(status("cross_check_basis")).toBe("unavailable");
    expect(status("multiple_vs_market")).toBe("unavailable");
  });

  it("a garbage killPrice (declared but not numeric) still produces the gate, and it fails", () => {
    const postCheck = checkValuationBridges({ ...makeInput(), killPrice: "n/a" } as unknown as BridgeCheckInput, 0, 14.18, "EUR", EXTRACT)!;
    expect(postCheck.gates.find((g) => g.code === "kill_price")!.status).toBe("fail");
  });

  it("returns null (not a throw) when the result isn't an object at all", () => {
    expect(checkValuationBridges(null as unknown as BridgeCheckInput, 0, 14.18, "EUR", EXTRACT)).toBeNull();
    expect(checkValuationBridges("garbage" as unknown as BridgeCheckInput, 0, 14.18, "EUR", EXTRACT)).toBeNull();
  });
});
