import { describe, it, expect } from "vitest";

import { computeBaseVsMarketGap } from "@/lib/grounding-display";
import type { MarketImplied } from "@/lib/grounding/anchors";

function market(impliedOnProvider: number | null): MarketImplied {
  return {
    price: 15,
    driverLabel: "EBITDA",
    driverYear: 2025,
    impliedOnStatement: 5.5,
    impliedOnProvider,
    percentile: 40,
    basisApplied: impliedOnProvider != null,
  };
}

describe("computeBaseVsMarketGap", () => {
  it("returns a positive gap when the base multiple is richer than the market's", () => {
    const gap = computeBaseVsMarketGap({ impliedMultipleProvider: 7.1 }, market(5.5));

    expect(gap).not.toBeNull();
    expect(gap!.baseMultiple).toBe(7.1);
    expect(gap!.marketMultiple).toBe(5.5);
    expect(gap!.gapPct).toBeCloseTo((7.1 - 5.5) / 5.5, 10);
  });

  it("returns a negative gap when the base multiple is below the market's", () => {
    expect(computeBaseVsMarketGap({ impliedMultipleProvider: 4 }, market(5))!.gapPct).toBeCloseTo(-0.2, 10);
  });

  it("returns null when there is no market-implied read", () => {
    expect(computeBaseVsMarketGap({ impliedMultipleProvider: 7.1 }, null)).toBeNull();
  });

  it("returns null when either side is not in provider basis", () => {
    expect(computeBaseVsMarketGap({ impliedMultipleProvider: 7.1 }, market(null))).toBeNull();
    expect(computeBaseVsMarketGap({ impliedMultipleProvider: null }, market(5.5))).toBeNull();
    expect(computeBaseVsMarketGap(undefined, market(5.5))).toBeNull();
  });
});
