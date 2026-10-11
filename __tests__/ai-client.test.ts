import { describe, it, expect } from "vitest";
import { buildThinkingParam, buildWebSearchTools } from "@/lib/ai/client";
import { AI_MODEL_CATALOG } from "@/types/ai-settings";

describe("buildThinkingParam", () => {
  it("returns adaptive thinking whenever thinking is on, for any model and effort", () => {
    expect(buildThinkingParam(true)).toEqual({ type: "adaptive" });
    expect(buildThinkingParam(true, "claude-sonnet-5-5", "max")).toEqual({ type: "adaptive" });
  });

  it("keeps the explicit disabled config for models that accept it", () => {
    expect(buildThinkingParam(false, "claude-opus-4-8", "high")).toEqual({ type: "disabled" });
    expect(buildThinkingParam(false, "claude-sonnet-5", "low")).toEqual({ type: "disabled" });
  });

  it("uses between_tools on Sonnet 5.5, which rejects disabled with a 400", () => {
    // effort high or below is the only range where the API accepts between_tools
    expect(buildThinkingParam(false, "claude-sonnet-5-5", "high")).toEqual({ type: "between_tools" });
    expect(buildThinkingParam(false, "claude-sonnet-5-5", "low")).toEqual({ type: "between_tools" });
  });

  it("cannot turn thinking off on Sonnet 5.5 at xhigh or max, so it stays adaptive", () => {
    expect(buildThinkingParam(false, "claude-sonnet-5-5", "xhigh")).toEqual({ type: "adaptive" });
    expect(buildThinkingParam(false, "claude-sonnet-5-5", "max")).toEqual({ type: "adaptive" });
  });
});

describe("Sonnet 5.5 catalog entry", () => {
  it("is an Anthropic model with web search and every effort level", () => {
    const info = AI_MODEL_CATALOG["claude-sonnet-5-5"];
    expect(info.provider).toBe("anthropic");
    expect(info.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(buildWebSearchTools("claude-sonnet-5-5")).toEqual([
      { type: "web_search_20260209", name: "web_search" },
    ]);
  });
});
