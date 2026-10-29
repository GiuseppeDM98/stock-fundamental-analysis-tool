// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      update: (...args: unknown[]) => updateMock(...args),
      findUnique: vi.fn(),
    },
  },
}));

import { PATCH } from "@/app/api/settings/ai/route";

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

  it("should save the retired Flash id as its successor", async () => {
    const res = await PATCH(patch({ model: "deepseek-v4-flash", effort: "low", thinking: true }));
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data.aiModel).toBe("deepseek-flash");
    expect((await res.json()).model).toBe("deepseek-flash");
  });

  it("should reject an unknown model with a 400 and the Zod message", async () => {
    const res = await PATCH(patch({ model: "gpt-9", effort: "low", thinking: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown AI model");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
