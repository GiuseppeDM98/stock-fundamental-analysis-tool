// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const findUniqueMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      update: (...args: unknown[]) => updateMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET, PATCH } from "@/app/api/settings/ai/route";

describe("GET /api/settings/ai — no effort above high reaches the modal (2026-11-20)", () => {
  beforeEach(() => findUniqueMock.mockReset());

  it("returns a stored xhigh as high, so the modal's select has the option and Save is accepted", async () => {
    findUniqueMock.mockResolvedValueOnce({ aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinkingEnabled: true });
    expect(await (await GET()).json()).toEqual({ model: "claude-opus-4-8", effort: "high", thinking: true });
  });

  it("returns a stored max on DeepSeek as high, and a supported level as is", async () => {
    findUniqueMock.mockResolvedValueOnce({ aiModel: "deepseek-v4-pro", aiEffort: "max", aiThinkingEnabled: true });
    expect((await (await GET()).json()).effort).toBe("high");
    findUniqueMock.mockResolvedValueOnce({ aiModel: "claude-opus-4-8", aiEffort: "medium", aiThinkingEnabled: true });
    expect((await (await GET()).json()).effort).toBe("medium");
  });

  it("answers high without a user row", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    expect(await (await GET()).json()).toEqual({ model: "claude-opus-4-8", effort: "high", thinking: true });
  });
});

function patch(body: unknown): Request {
  return new Request("http://localhost/api/settings/ai", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/settings/ai", () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  });

  it("should save a catalog id as sent", async () => {
    const res = await PATCH(patch({ model: "deepseek-flash", effort: "low", thinking: true }));
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data.aiModel).toBe("deepseek-flash");
    expect((await res.json()).model).toBe("deepseek-flash");
  });

  it("should reject the retired Flash id (alias removed 2026-10-29) with a 400", async () => {
    const res = await PATCH(patch({ model: "deepseek-v4-flash", effort: "low", thinking: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown AI model");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should reject an effort above high with a 400, on Claude and on DeepSeek", async () => {
    for (const body of [
      { model: "claude-opus-4-8", effort: "xhigh", thinking: true },
      { model: "deepseek-v4-pro", effort: "max", thinking: true },
    ]) {
      const res = await PATCH(patch(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Effort level not supported by this model");
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("should reject an unknown model with a 400 and the Zod message", async () => {
    const res = await PATCH(patch({ model: "gpt-9", effort: "low", thinking: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown AI model");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
