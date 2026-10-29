import { describe, it, expect } from "vitest";
import { latestAnalysisWithValues, verdictBasis, watchlistBuyTarget } from "@/lib/report/latest-analysis";
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

  it("should be null without a base fair value", () => {
    expect(watchlistBuyTarget(makeAnalysis({}), 0.2)).toBeNull();
  });
});
