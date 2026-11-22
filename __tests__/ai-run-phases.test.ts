import { describe, it, expect } from "vitest";
import { DEEP_VALUE_PHASES, isDeepValuePhase, nextDeepValuePhase } from "@/types/ai-run";

describe("Deep Value phases", () => {
  it("runs the web update, the valuation and the two report halves, in that order", () => {
    expect(DEEP_VALUE_PHASES).toEqual(["update", "valuation", "report1", "report2"]);
    expect(nextDeepValuePhase("update")).toBe("valuation");
    expect(nextDeepValuePhase("valuation")).toBe("report1");
    expect(nextDeepValuePhase("report1")).toBe("report2");
    expect(nextDeepValuePhase("report2")).toBeNull();
  });

  it("tells a Deep Value phase from a lens phase and from anything else", () => {
    expect(isDeepValuePhase("valuation")).toBe(true);
    expect(isDeepValuePhase("blind")).toBe(false);
    expect(isDeepValuePhase(null)).toBe(false);
    expect(isDeepValuePhase(undefined)).toBe(false);
  });
});
