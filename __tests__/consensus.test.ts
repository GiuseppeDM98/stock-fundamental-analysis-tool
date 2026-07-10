import { describe, it, expect } from "vitest";
import {
  meanTriple,
  baseTriple,
  analystTriple,
  presentAnalysts,
  consensusTriple,
} from "@/lib/report/consensus";
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

describe("meanTriple", () => {
  it("averages per scenario", () => {
    expect(
      meanTriple([
        { bear: 10, base: 20, bull: 30 },
        { bear: 20, base: 40, bull: 60 },
      ]),
    ).toEqual({ bear: 15, base: 30, bull: 45 });
  });
});

describe("baseTriple", () => {
  it("returns null when the base fair values are incomplete", () => {
    expect(baseTriple(makeAnalysis({ fairValueBase: 100 }))).toBeNull();
  });

  it("reads the full base triple", () => {
    const a = makeAnalysis({ fairValueBear: 80, fairValueBase: 100, fairValueBull: 120 });
    expect(baseTriple(a)).toEqual({ bear: 80, base: 100, bull: 120 });
  });
});

describe("analystTriple", () => {
  it("returns null when a lens has incomplete fair values", () => {
    const a = makeAnalysis({ reviewFairValueBase: 90 }); // missing bear/bull
    expect(analystTriple(a, "skeptic")).toBeNull();
  });

  it("reads a lens's full triple and leaves others null", () => {
    const a = makeAnalysis({
      reviewFairValueBear: 70,
      reviewFairValueBase: 90,
      reviewFairValueBull: 110,
    });
    expect(analystTriple(a, "skeptic")).toEqual({ bear: 70, base: 90, bull: 110 });
    expect(analystTriple(a, "optimist")).toBeNull();
    expect(analystTriple(a, "quality")).toBeNull();
  });
});

describe("presentAnalysts", () => {
  it("lists only lenses with a full triple, in display order", () => {
    const a = makeAnalysis({
      reviewFairValueBear: 70,
      reviewFairValueBase: 90,
      reviewFairValueBull: 110,
      qualityFairValueBear: 60,
      qualityFairValueBase: 80,
      qualityFairValueBull: 100,
    });
    expect(presentAnalysts(a).map((x) => x.angle)).toEqual(["skeptic", "quality"]);
  });
});

describe("consensusTriple", () => {
  it("returns null when no analyst has run (consensus would equal the base)", () => {
    const a = makeAnalysis({ fairValueBear: 80, fairValueBase: 100, fairValueBull: 120 });
    expect(consensusTriple(a)).toBeNull();
  });

  it("returns null when the base fair values are absent", () => {
    const a = makeAnalysis({
      reviewFairValueBear: 70,
      reviewFairValueBase: 90,
      reviewFairValueBull: 110,
    });
    expect(consensusTriple(a)).toBeNull();
  });

  it("averages the base analysis with every analyst that has run", () => {
    const a = makeAnalysis({
      fairValueBear: 80,
      fairValueBase: 100,
      fairValueBull: 120,
      reviewFairValueBear: 70,
      reviewFairValueBase: 90,
      reviewFairValueBull: 110,
      optimistFairValueBear: 120,
      optimistFairValueBase: 140,
      optimistFairValueBull: 160,
    });
    // bear (80+70+120)/3=90, base (100+90+140)/3=110, bull (120+110+160)/3=130
    expect(consensusTriple(a)).toEqual({ bear: 90, base: 110, bull: 130 });
  });
});
