import { describe, it, expect } from "vitest";
import {
  latestAnalysisWithValues,
  verdictBasis,
  watchlistBuyTarget,
  comparablePrice,
  currencyMismatch,
  getExitSignal,
  digestPriceRead,
} from "@/lib/report/latest-analysis";
import type { SavedAnalysis } from "@/types/analysis";

function makeAnalysis(overrides: Partial<SavedAnalysis>): SavedAnalysis {
  return {
    id: "id",
    ticker: "TEST",
    companyName: "Test Co",
    reportMd: "",
    mosPercent: 0,
    priceAtAnalysis: null,
    fairValueBull: null,
    fairValueBase: null,
    fairValueBear: null,
    valuationMethod: null,
    reviewMd: null,
    reviewFairValueBull: null,
    reviewFairValueBase: null,
    reviewFairValueBear: null,
    reviewValuationMethod: null,
    optimistCritiqueMd: null,
    optimistFairValueBull: null,
    optimistFairValueBase: null,
    optimistFairValueBear: null,
    optimistValuationMethod: null,
    qualityCritiqueMd: null,
    qualityFairValueBull: null,
    qualityFairValueBase: null,
    qualityFairValueBear: null,
    qualityValuationMethod: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const VALUED = { fairValueBear: 60, fairValueBase: 80, fairValueBull: 100 };

describe("latestAnalysisWithValues", () => {
  it("should skip a newest save without fair values and return the older one with values", () => {
    const newest = makeAnalysis({ id: "new", createdAt: "2026-03-01T00:00:00.000Z" });
    const older = makeAnalysis({ id: "old", ...VALUED });
    expect(latestAnalysisWithValues([newest, older])?.id).toBe("old");
  });

  it("should return null when no save carries a full triple", () => {
    expect(latestAnalysisWithValues([makeAnalysis({ fairValueBase: 80 })])).toBeNull();
  });
});

describe("verdictBasis", () => {
  it("should use the consensus when an analyst lens ran", () => {
    // Base 80 + skeptic 60 → consensus base 70; MoS 30% → intrinsic 100.
    const a = makeAnalysis({
      ...VALUED,
      mosPercent: 30,
      reviewFairValueBear: 40,
      reviewFairValueBase: 60,
      reviewFairValueBull: 80,
    });
    const basis = verdictBasis(a)!;
    expect(basis.source).toBe("consensus");
    expect(basis.buyTargetBase).toBe(70);
    expect(basis.intrinsicBase).toBeCloseTo(100, 10);
  });

  it("should fall back to the analysis's own base without lenses", () => {
    const basis = verdictBasis(makeAnalysis({ ...VALUED, mosPercent: 20 }))!;
    expect(basis.source).toBe("analysis");
    expect(basis.buyTargetBase).toBe(80);
    expect(basis.intrinsicBase).toBeCloseTo(100, 10);
  });

  it("should be null without a base fair value", () => {
    expect(verdictBasis(makeAnalysis({}))).toBeNull();
  });
});

describe("watchlistBuyTarget", () => {
  it("should re-discount the verdict basis's intrinsic with the item's MoS", () => {
    const a = makeAnalysis({
      ...VALUED,
      mosPercent: 30,
      reviewFairValueBear: 40,
      reviewFairValueBase: 60,
      reviewFairValueBull: 80,
    });
    const intrinsicBase = verdictBasis(a)!.intrinsicBase;
    expect(watchlistBuyTarget(a, 0.3)).toBeCloseTo(intrinsicBase * 0.7, 10);
    expect(watchlistBuyTarget(a, 0.3)).toBeCloseTo(70, 10);
  });

  it("should use the item's MoS, not the analysis's, when the two differ", () => {
    // Analysis MoS 30%, consensus base (80+60)/2 = 70 → intrinsic 100; an item at 20% buys at 80.
    // Returning the analysis's own buy target (70) or discounting it twice (56) both miss it.
    const a = makeAnalysis({
      ...VALUED,
      mosPercent: 30,
      reviewFairValueBear: 40,
      reviewFairValueBase: 60,
      reviewFairValueBull: 80,
    });
    expect(watchlistBuyTarget(a, 0.2)).toBeCloseTo(80, 10);
  });

  it("should be null without a base fair value", () => {
    expect(watchlistBuyTarget(makeAnalysis({}), 0.2)).toBeNull();
  });
});

// An LSE quote in pence against values in pounds is the case every one of these guards:
// 350 (GBp) is 3.50 (GBP), and a comparison without the currency is off by 100.
describe("comparablePrice / currencyMismatch", () => {
  it("passes a price only in the analysis's own currency", () => {
    const a = makeAnalysis({ ...VALUED, currency: "GBP" });
    expect(comparablePrice(350, "GBp", a)).toBeNull();
    expect(currencyMismatch(350, "GBp", a)).toBe(true);
    expect(comparablePrice(3.5, "GBP", a)).toBe(3.5);
    expect(currencyMismatch(3.5, "GBP", a)).toBe(false);
  });

  it("an unknown currency on either side is no comparison; no price is no mismatch", () => {
    expect(comparablePrice(10, "EUR", makeAnalysis({ ...VALUED }))).toBeNull();
    expect(comparablePrice(10, null, makeAnalysis({ ...VALUED, currency: "EUR" }))).toBeNull();
    expect(currencyMismatch(null, "EUR", makeAnalysis({ ...VALUED, currency: "USD" }))).toBe(false);
  });
});

describe("getExitSignal", () => {
  // MoS 0: the intrinsic base is the stored base, 80.
  it("fires at the intrinsic base on a quote in the analysis's currency", () => {
    const analyses = [makeAnalysis({ ...VALUED, currency: "EUR" })];
    expect(getExitSignal(80, "EUR", analyses)).toEqual({ triggered: true, fairValueBase: 80, currencyMismatch: false });
    expect(getExitSignal(79, "EUR", analyses).triggered).toBe(false);
  });

  it("never fires on a quote in another currency, and says why", () => {
    expect(getExitSignal(8000, "GBp", [makeAnalysis({ ...VALUED, currency: "GBP" })])).toEqual({
      triggered: false,
      fairValueBase: null,
      currencyMismatch: true,
    });
  });
});

describe("digestPriceRead", () => {
  // MoS 0 and an item MoS of 0.25: buy target 80 × 0.75 = 60.
  it("reads under or over the item's buy target on a comparable quote", () => {
    const a = makeAnalysis({ ...VALUED, currency: "EUR" });
    expect(digestPriceRead(50, "EUR", a, 0.25)).toEqual({ upside: 0.2, status: "under", currencyMismatch: false });
    expect(digestPriceRead(75, "EUR", a, 0.25)).toMatchObject({ status: "over", currencyMismatch: false });
  });

  it("reads unknown on a quote in another currency, and flags it", () => {
    expect(digestPriceRead(5000, "GBp", makeAnalysis({ ...VALUED, currency: "GBP" }), 0.25)).toEqual({
      upside: null,
      status: "unknown",
      currencyMismatch: true,
    });
  });
});
