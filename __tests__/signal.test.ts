import { describe, it, expect } from "vitest";
import { getSignalStrength } from "@/lib/report/signal";

describe("getSignalStrength", () => {
  it("flags 'low' when the base fair value sits on the price inside a wide cone (the Eni case)", () => {
    // Base ≈ price (0.5% edge) while bull↔bear spans ~90% of base → verdict is noise.
    const strength = getSignalStrength(20.75, { bear: 10.54, base: 20.85, bull: 29.37 });

    expect(strength).toBe("low");
  });

  it("returns 'clear' when the edge comfortably exceeds the scenario dispersion", () => {
    // 100% upside (base 20 vs price 10) against a narrow ±20% cone.
    const strength = getSignalStrength(10, { bear: 16, base: 20, bull: 24 });

    expect(strength).toBe("clear");
  });

  it("returns 'moderate' for a real but modest edge relative to the cone", () => {
    // ~11% edge (base 20 vs price 18) against a 60%-of-base cone → ratio ~0.19.
    const strength = getSignalStrength(18, { bear: 14, base: 20, bull: 26 });

    expect(strength).toBe("moderate");
  });

  it("returns 'clear' when the cone is degenerate (bull ≤ bear), a point estimate", () => {
    const strength = getSignalStrength(15, { bear: 20, base: 20, bull: 20 });

    expect(strength).toBe("clear");
  });

  it("does not cry wolf on non-comparable inputs (non-positive price or base)", () => {
    expect(getSignalStrength(0, { bear: 10, base: 20, bull: 30 })).toBe("clear");
    expect(getSignalStrength(20, { bear: 0, base: 0, bull: 0 })).toBe("clear");
  });
});
