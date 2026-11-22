import { describe, it, expect } from "vitest";
import { AI_MODEL_CATALOG, AI_MODEL_IDS, callSiteDefaultEffort, capEffort } from "@/types/ai-settings";

describe("the effort catalog stops at high (2026-11-20)", () => {
  it("offers Claude low/medium/high and DeepSeek low/high, nothing above high", () => {
    for (const model of AI_MODEL_IDS) {
      const { provider, efforts } = AI_MODEL_CATALOG[model];
      expect(efforts).toEqual(provider === "anthropic" ? ["low", "medium", "high"] : ["low", "high"]);
    }
  });
});

describe("callSiteDefaultEffort", () => {
  it("keeps a level the model supports", () => {
    expect(callSiteDefaultEffort("claude-opus-4-8", "medium")).toBe("medium");
    expect(callSiteDefaultEffort("deepseek-flash", "low")).toBe("low");
  });

  it("steps a stored level above high down to high, never up", () => {
    expect(callSiteDefaultEffort("claude-opus-4-8", "xhigh")).toBe("high");
    expect(callSiteDefaultEffort("claude-sonnet-5-5", "max")).toBe("high");
    expect(callSiteDefaultEffort("deepseek-v4-pro", "max")).toBe("high");
    expect(callSiteDefaultEffort("deepseek-flash", "medium")).toBe("low");
  });
});

describe("capEffort", () => {
  it("returns the lower of the run's effort and the phase's ceiling", () => {
    expect(capEffort("high", "medium")).toBe("medium");
    expect(capEffort("low", "medium")).toBe("low");
    expect(capEffort("high", "high")).toBe("high");
  });
});
