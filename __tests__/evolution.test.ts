import { describe, it, expect } from "vitest";
import { computeEvolution } from "@/lib/report/evolution";
import type { SavedAnalysis } from "@/types/analysis";

// Minimal SavedAnalysis fixture — only the fields computeEvolution reads matter;
// the rest are filled with inert defaults.
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
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeEvolution", () => {
  it("returns null when the current analysis has no base fair value", () => {
    const prev = makeAnalysis({ fairValueBase: 100 });
    const curr = makeAnalysis({ fairValueBase: null });

    expect(computeEvolution(prev, curr)).toBeNull();
  });

  it("computes the base delta on the intrinsic scale, grossing up each MoS", () => {
    // prev: MoS 0 → intrinsic 100. curr: MoS 20% on a 96 buy target → intrinsic 120.
    const prev = makeAnalysis({ mosPercent: 0, fairValueBase: 100 });
    const curr = makeAnalysis({ mosPercent: 20, fairValueBase: 96 });

    const evo = computeEvolution(prev, curr);

    expect(evo).not.toBeNull();
    expect(evo!.base.prev).toBeCloseTo(100);
    expect(evo!.base.curr).toBeCloseTo(120);
    expect(evo!.base.pctDelta).toBeCloseTo(0.2);
    expect(evo!.prevDate).toBe(prev.createdAt);
  });

  it("includes reviewer and consensus only when both analyses carry reviewer values", () => {
    const prev = makeAnalysis({ fairValueBase: 100, reviewFairValueBase: 90 });
    const curr = makeAnalysis({ fairValueBase: 120, reviewFairValueBase: 110 });

    const evo = computeEvolution(prev, curr);

    expect(evo!.reviewer).toBeDefined();
    expect(evo!.reviewer!.prev).toBeCloseTo(90);
    expect(evo!.reviewer!.curr).toBeCloseTo(110);
    // Consensus = mean of analysis + reviewer per side: prev 95 → curr 115.
    expect(evo!.consensus!.prev).toBeCloseTo(95);
    expect(evo!.consensus!.curr).toBeCloseTo(115);
  });

  it("omits reviewer and consensus when one side lacks reviewer values", () => {
    const prev = makeAnalysis({ fairValueBase: 100, reviewFairValueBase: null });
    const curr = makeAnalysis({ fairValueBase: 120, reviewFairValueBase: 110 });

    const evo = computeEvolution(prev, curr);

    expect(evo!.base).toBeDefined();
    expect(evo!.reviewer).toBeUndefined();
    expect(evo!.consensus).toBeUndefined();
  });
});
