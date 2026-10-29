import { describe, it, expect } from "vitest";
import { callSiteDefaultEffort, deepValueDefaultEffort } from "@/types/ai-settings";

describe("callSiteDefaultEffort", () => {
  it("keeps a level the model supports", () => {
    expect(callSiteDefaultEffort("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(callSiteDefaultEffort("deepseek-v4-pro", "max")).toBe("max");
    expect(callSiteDefaultEffort("deepseek-flash", "low")).toBe("low");
  });

  it("steps down to the nearest supported level, never up", () => {
    expect(callSiteDefaultEffort("deepseek-v4-pro", "xhigh")).toBe("high");
    expect(callSiteDefaultEffort("deepseek-flash", "medium")).toBe("low");
  });
});

describe("deepValueDefaultEffort", () => {
  it("raises a global default below xhigh to xhigh", () => {
    expect(deepValueDefaultEffort("claude-opus-4-8", "high")).toBe("xhigh");
    expect(deepValueDefaultEffort("claude-sonnet-5-5", "low")).toBe("xhigh");
  });

  it("keeps a global max", () => {
    expect(deepValueDefaultEffort("claude-opus-4-8", "max")).toBe("max");
    expect(deepValueDefaultEffort("deepseek-v4-pro", "max")).toBe("max");
  });

  it("lands on high for DeepSeek, which has no xhigh", () => {
    expect(deepValueDefaultEffort("deepseek-v4-pro", "high")).toBe("high");
  });
});
