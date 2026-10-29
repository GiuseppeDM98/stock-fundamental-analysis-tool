import { describe, it, expect } from "vitest";
import { AI_MODEL_CATALOG, AI_MODEL_IDS, normalizeAiModelId } from "@/types/ai-settings";

describe("normalizeAiModelId", () => {
  it("should no longer resolve the retired DeepSeek Flash id (alias removed 2026-10-29)", () => {
    expect(normalizeAiModelId("deepseek-v4-flash")).toBeNull();
  });

  it("should return a catalog id unchanged", () => {
    expect(normalizeAiModelId("deepseek-flash")).toBe("deepseek-flash");
  });

  it("should return null for an id that is no model at all", () => {
    expect(normalizeAiModelId("gpt-9")).toBeNull();
  });
});

describe("AI model catalog", () => {
  it("should no longer list the retired id and should name the successor", () => {
    expect(AI_MODEL_IDS as readonly string[]).not.toContain("deepseek-v4-flash");
    expect(AI_MODEL_CATALOG["deepseek-flash"].label).toBe("DeepSeek V4.1 Flash");
  });
});
