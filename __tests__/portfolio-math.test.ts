import { describe, it, expect } from "vitest";
import { realizedPnlNative, holdingDays, estimateCapitalGainsTax, aggregateOpenLots } from "@/lib/portfolio-math";

describe("realizedPnlNative", () => {
  it("returns a positive gain when sold above cost", () => {
    // Bought 100 @ 120, sold @ 195 → (195 − 120) × 100 = 7500
    expect(realizedPnlNative(195, 120, 100)).toBe(7500);
  });

  it("returns a negative loss when sold below cost", () => {
    expect(realizedPnlNative(80, 120, 50)).toBe(-2000);
  });

  it("returns zero at breakeven", () => {
    expect(realizedPnlNative(120, 120, 10)).toBe(0);
  });

  it("scales with a partial share count", () => {
    // Selling half the lot realizes half the P&L
    const full = realizedPnlNative(195, 120, 100);
    const half = realizedPnlNative(195, 120, 50);
    expect(half).toBe(full / 2);
  });

  it("supports fractional shares", () => {
    expect(realizedPnlNative(10, 8, 2.5)).toBeCloseTo(5, 10);
  });
});

describe("holdingDays", () => {
  it("counts whole days between purchase and sale", () => {
    expect(holdingDays("2026-01-01T00:00:00.000Z", "2026-01-11T00:00:00.000Z")).toBe(10);
  });

  it("floors partial days", () => {
    expect(holdingDays("2026-01-01T00:00:00.000Z", "2026-01-02T18:00:00.000Z")).toBe(1);
  });

  it("never returns a negative count when sold before purchase date", () => {
    expect(holdingDays("2026-01-10T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
  });

  it("measures against now when still open (no closedAt)", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(holdingDays(tenDaysAgo, null)).toBe(10);
  });
});

describe("estimateCapitalGainsTax", () => {
  it("returns zero on a loss, regardless of rate", () => {
    expect(estimateCapitalGainsTax(-500, 26)).toBe(0);
  });

  it("returns zero at breakeven", () => {
    expect(estimateCapitalGainsTax(0, 26)).toBe(0);
  });

  it("returns zero when no rate is set", () => {
    expect(estimateCapitalGainsTax(1000, null)).toBe(0);
    expect(estimateCapitalGainsTax(1000, undefined)).toBe(0);
  });

  it("returns zero when the rate is zero or negative", () => {
    expect(estimateCapitalGainsTax(1000, 0)).toBe(0);
    expect(estimateCapitalGainsTax(1000, -5)).toBe(0);
  });

  it("computes tax as pnl * rate/100 on a gain", () => {
    expect(estimateCapitalGainsTax(1000, 26)).toBeCloseTo(260, 10);
  });
});

describe("aggregateOpenLots", () => {
  it("returns null for an empty lot list", () => {
    expect(aggregateOpenLots([])).toBeNull();
  });

  it("returns shares and cost unchanged for a single lot", () => {
    expect(aggregateOpenLots([{ shares: 10, purchasePrice: 100 }])).toEqual({
      totalShares: 10,
      weightedAvgCost: 100,
    });
  });

  it("computes weighted-average cost across multiple DCA lots", () => {
    // 10 @ 100 + 10 @ 200 → 20 shares, (1000+2000)/20 = 150 WAC
    expect(
      aggregateOpenLots([
        { shares: 10, purchasePrice: 100 },
        { shares: 10, purchasePrice: 200 },
      ])
    ).toEqual({ totalShares: 20, weightedAvgCost: 150 });
  });

  it("weights unevenly sized lots correctly", () => {
    // 5 @ 100 + 15 @ 300 → 20 shares, (500+4500)/20 = 250 WAC
    expect(
      aggregateOpenLots([
        { shares: 5, purchasePrice: 100 },
        { shares: 15, purchasePrice: 300 },
      ])
    ).toEqual({ totalShares: 20, weightedAvgCost: 250 });
  });

  it("returns null when total shares is zero (guards division by zero)", () => {
    expect(aggregateOpenLots([{ shares: 0, purchasePrice: 100 }])).toBeNull();
  });

  it("supports fractional shares", () => {
    const r = aggregateOpenLots([{ shares: 2.5, purchasePrice: 40 }]);
    expect(r?.weightedAvgCost).toBeCloseTo(40, 10);
  });
});
