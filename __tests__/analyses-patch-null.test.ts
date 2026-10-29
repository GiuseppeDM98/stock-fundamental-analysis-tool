// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    analysis: {
      findUnique: vi.fn(async () => ({ id: "a1", userId: "u1" })),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { PATCH } from "@/app/api/analyses/[id]/route";

function patch(body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request("http://localhost/api/analyses/a1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "a1" }) },
  ];
}

describe("PATCH /api/analyses/:id — clearing a lens's numbers", () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateMock.mockResolvedValue({ id: "a1" });
  });

  it("should write null when the lens's fair value is sent as null", async () => {
    const res = await PATCH(...patch({ angle: "skeptic", critiqueMd: "x", fairValueBase: null, valuationMethod: null }));
    expect(res.status).toBe(200);
    const data = updateMock.mock.calls[0][0].data;
    expect(data).toHaveProperty("reviewFairValueBase", null);
    expect(data).toHaveProperty("reviewValuationMethod", null);
  });

  it("should leave a column untouched when its field is absent", async () => {
    await PATCH(...patch({ angle: "skeptic", critiqueMd: "x" }));
    const data = updateMock.mock.calls[0][0].data;
    expect(data.reviewFairValueBase).toBeUndefined();
  });

  it("should answer 400 with the Zod message on an invalid body", async () => {
    const res = await PATCH(...patch({ angle: "skeptic", critiqueMd: "" }));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });
});
