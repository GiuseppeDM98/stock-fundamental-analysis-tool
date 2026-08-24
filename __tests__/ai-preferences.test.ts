import { describe, it, expect, vi } from "vitest";

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

import { resolveAiSettings } from "@/lib/ai/ai-preferences";
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

  it("clamps an effort level the selected model doesn't support down to the model's max", async () => {
    findUniqueMock.mockResolvedValueOnce({
      aiModel: "deepseek-v4-pro",
      aiEffort: "xhigh", // not in deepseek's ["low","high","max"] catalog list
      aiThinkingEnabled: true,
    });
    const result = await resolveAiSettings("user4", undefined, FALLBACK);
    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.effort).toBe("max");
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
});
