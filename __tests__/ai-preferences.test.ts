import { describe, it, expect, vi } from "vitest";

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

import { aiModelIdSchema, resolveAiSettings } from "@/lib/ai/ai-preferences";
import type { AiSettings } from "@/types/ai-settings";

const FALLBACK: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

describe("resolveAiSettings", () => {
  it("uses a full request override without touching the DB", async () => {
    const override: AiSettings = { model: "claude-sonnet-5", effort: "low", thinking: false };
    const result = await resolveAiSettings("user1", override, FALLBACK);
    expect(result).toEqual(override);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored user default when no override is given", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "claude-sonnet-5",
      aiEffort: "medium",
      aiThinkingEnabled: false,
    });
    const result = await resolveAiSettings("user2", undefined, FALLBACK);
    expect(result).toEqual({ model: "claude-sonnet-5", effort: "medium", thinking: false });
  });

  it("falls back to the route default when the user has no row / invalid stored values", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const result = await resolveAiSettings("user3", undefined, FALLBACK);
    expect(result).toEqual(FALLBACK);
  });

  it("clamps an effort level the selected model doesn't support down to the nearest lower one", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "deepseek-v4-pro",
      aiEffort: "xhigh", // not in deepseek's ["low","high","max"] catalog list
      aiThinkingEnabled: true,
    });
    const result = await resolveAiSettings("user4", undefined, FALLBACK);
    expect(result.model).toBe("deepseek-v4-pro");
    // Down, never up: a cheaper fallback, not a pricier one (was "max" until 2026-10).
    expect(result.effort).toBe("high");
  });

  it("a partial override (model only) is merged over the stored default, not treated as complete", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "claude-opus-4-8",
      aiEffort: "high",
      aiThinkingEnabled: true,
    });
    const result = await resolveAiSettings("user5", { model: "deepseek-v4-pro" }, FALLBACK);
    expect(result.model).toBe("deepseek-v4-pro");
    // stored effort "high" is valid for deepseek's catalog (["low","high","max"]) so it survives
    expect(result.effort).toBe("high");
  });

  it("falls back to the route default for a stored id that is no catalog model (the Flash alias was removed 2026-10-29)", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "deepseek-v4-flash",
      aiEffort: "low",
      aiThinkingEnabled: true,
    });
    const result = await resolveAiSettings("user6", undefined, FALLBACK);
    expect(result.model).toBe(FALLBACK.model);
    expect(result.effort).toBe("low");
  });

  it("ignores a per-run override naming an id that is no catalog model", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "deepseek-v4-pro",
      aiEffort: "high",
      aiThinkingEnabled: true,
    });
    const result = await resolveAiSettings("user7", { model: "deepseek-v4-flash" }, FALLBACK);
    expect(result.model).toBe("deepseek-v4-pro");
  });
});

describe("aiModelIdSchema", () => {
  // The one model-id check of every AI route's per-run override and of PATCH /api/settings/ai.
  it("should accept a catalog id unchanged", () => {
    expect(aiModelIdSchema.optional().parse("deepseek-flash")).toBe("deepseek-flash");
    expect(aiModelIdSchema.optional().parse(undefined)).toBeUndefined();
  });

  it("should reject the retired Flash id and an unknown id with the Zod message", () => {
    for (const id of ["deepseek-v4-flash", "gpt-9"]) {
      const parsed = aiModelIdSchema.safeParse(id);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Unknown AI model");
    }
  });
});
