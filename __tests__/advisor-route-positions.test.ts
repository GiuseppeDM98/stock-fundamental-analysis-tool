// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const positionFindMany = vi.fn();
const analysisFindMany = vi.fn();
const runStreamMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    position: { findMany: (...args: unknown[]) => positionFindMany(...args) },
    analysis: { findMany: (...args: unknown[]) => analysisFindMany(...args) },
    user: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: vi.fn(async () => { throw new Error("no quotes in tests"); }) }));
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  // The real constructor throws without an API key.
  getAiClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/ai-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/ai-preferences")>()),
  resolveAiSettings: vi.fn(async () => ({ model: "claude-sonnet-5-5", effort: "high", thinking: true })),
}));
vi.mock("@/lib/ai/tool-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-loop")>()),
  runStreamWithToolLoop: (...args: unknown[]) => runStreamMock(...args),
}));

import { POST } from "@/app/api/ai/advisor/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/advisor — portfolio context", () => {
  beforeEach(() => {
    positionFindMany.mockReset().mockResolvedValue([]);
    analysisFindMany.mockReset().mockResolvedValue([]);
    runStreamMock.mockReset().mockResolvedValue({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: "" });
  });

  it("should read only open lots (a sold lot is not a holding)", async () => {
    const res = await POST(post({ messages: [{ role: "user", content: "x" }] }));
    await res.text();
    expect(positionFindMany.mock.calls[0][0].where).toEqual({ userId: "u1", closedAt: null });
  });

  it("should answer 400 with the Zod message on an invalid body", async () => {
    const res = await POST(post({ messages: [] }));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(positionFindMany).not.toHaveBeenCalled();
  });
});
