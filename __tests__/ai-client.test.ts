import { describe, it, expect } from "vitest";
import { buildEffortConfig, buildResearchTools, buildThinkingParam, buildWebSearchTools, usesServerSideFallback } from "@/lib/ai/client";
import { AI_MODEL_CATALOG } from "@/types/ai-settings";

describe("buildThinkingParam", () => {
  it("returns adaptive thinking whenever thinking is on, for any model", () => {
    expect(buildThinkingParam(true)).toEqual({ type: "adaptive" });
    expect(buildThinkingParam(true, "claude-sonnet-5-5")).toEqual({ type: "adaptive" });
  });

  it("keeps the explicit disabled config for models that accept it", () => {
    expect(buildThinkingParam(false, "claude-opus-4-8")).toEqual({ type: "disabled" });
    expect(buildThinkingParam(false, "claude-sonnet-5")).toEqual({ type: "disabled" });
  });

  it("uses between_tools on Sonnet 5.5, which rejects disabled with a 400", () => {
    // The API accepts between_tools only at effort high or below: since 2026-11-20 every request.
    expect(buildThinkingParam(false, "claude-sonnet-5-5")).toEqual({ type: "between_tools" });
  });
});

describe("Sonnet 5.5 catalog entry", () => {
  it("is an Anthropic model with web search and the efforts up to high", () => {
    const info = AI_MODEL_CATALOG["claude-sonnet-5-5"];
    expect(info.provider).toBe("anthropic");
    expect(info.efforts).toEqual(["low", "medium", "high"]);
    expect(buildWebSearchTools("claude-sonnet-5-5")).toEqual([
      { type: "web_search_20260209", name: "web_search" },
    ]);
  });
});

describe("buildWebSearchTools with a search cap", () => {
  it("makes the cap real on Claude: max_uses with direct calls only, so a pause_turn resume does not re-arm it", () => {
    expect(buildWebSearchTools("claude-opus-4-8", { maxUses: 5 })).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_callers: ["direct"] },
    ]);
  });

  it("sends neither field without the option", () => {
    const [tool] = buildWebSearchTools("claude-opus-4-8") as unknown as Record<string, unknown>[];
    expect(tool).not.toHaveProperty("max_uses");
    expect(tool).not.toHaveProperty("allowed_callers");
  });

  it("gives DeepSeek its client tool whatever the cap: only the loop's rounds bound it", () => {
    expect(buildWebSearchTools("deepseek-v4-pro", { maxUses: 5 })).toEqual(buildWebSearchTools("deepseek-v4-pro"));
  });
});

describe("DeepSeek web search tool", () => {
  it("is the single client-executed web_search function, with the query length cap in its description", () => {
    const tools = buildWebSearchTools("deepseek-v4-pro") as unknown as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("web_search");
    expect(tools[0]).not.toHaveProperty("type");
    expect(String(tools[0].description)).toContain("128");
  });
});

describe("buildEffortConfig", () => {
  it("passes the effort level through as typed", () => {
    expect(buildEffortConfig("high")).toEqual({ effort: "high" });
    expect(buildEffortConfig("low")).toEqual({ effort: "low" });
  });
});

describe("usesServerSideFallback", () => {
  it("opts in Sonnet 5.5 only: no other catalog model, and never DeepSeek", () => {
    expect(usesServerSideFallback("claude-sonnet-5-5")).toBe(true);
    for (const model of ["claude-opus-4-8", "claude-sonnet-5", "deepseek-v4-pro", "deepseek-flash"]) {
      expect(usesServerSideFallback(model)).toBe(false);
    }
  });
});

describe("buildResearchTools", () => {
  it("gives Claude the native tools with the part's caps, both called directly, and no code execution", () => {
    // Called directly, max_uses counts the whole turn; from code execution it restarted at
    // every pause_turn resume (16 fetches under a cap of 8).
    expect(buildResearchTools("claude-sonnet-5-5", { searches: 10, fetches: 5 })).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 10, allowed_callers: ["direct"] },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 40000, allowed_callers: ["direct"] },
    ]);
  });

  it("gives DeepSeek the two client-executed tools, named web_search and web_fetch, with no server type", () => {
    const tools = buildResearchTools("deepseek-v4-pro", { searches: 10, fetches: 5 }) as unknown as Record<string, unknown>[];
    expect(tools.map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    for (const tool of tools) expect(tool).not.toHaveProperty("type");
    // One definition for the three parts: the number lives in each part's system prompt.
    expect(String(tools[1].description)).toContain("the system prompt says how many");
  });
});
