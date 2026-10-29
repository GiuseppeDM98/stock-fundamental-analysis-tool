// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDeepValueJson } from "@/lib/report/parse-deep-value-json";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const analysisFindFirst = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    analysis: { findFirst: (...args: unknown[]) => analysisFindFirst(...args) },
  },
}));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: vi.fn(async () => ({ regularMarketPrice: 10, currency: "EUR" })) }));
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  // The real constructor throws without an API key.
  getAiClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tool-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-loop")>()),
  runStreamWithToolLoop: (...args: unknown[]) => runStreamMock(...args),
}));

import { POST } from "@/app/api/ai/deep-value/verify/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/deep-value/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function streams(chunks: string[], stopReason = "end_turn") {
  runStreamMock.mockImplementation(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
    for (const chunk of chunks) onText(chunk);
    return { stopReason, hitIterationCap: false, servedBy: null, text: chunks.join(""), messages: [] };
  });
}

const FINAL = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":12},"base":{"fairValue":10},"bear":{"fairValue":8}}\n```';

describe("POST /api/ai/deep-value/verify — single-phase review", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    // A saved analysis without pasted data: the lens runs single-phase.
    analysisFindFirst.mockReset().mockResolvedValue({ groundingJson: null, mosPercent: 20, reportMd: "## 1. X" });
  });

  it("drops the chatter before the critique marker and keeps the closing JSON", async () => {
    streams(["Let me check the filings. chatter", "<!--critique-->Critique\n", FINAL]);
    const res = await POST(post({ ticker: "AAA", reportMd: "## 1. X", analysisId: "an1" }));
    const body = await res.text();
    expect(body).not.toContain("chatter");
    expect(body.startsWith("Critique\n")).toBe(true);
    expect(parseDeepValueJson(body)?.base?.fairValue).toBe(10);
    expect(analysisFindFirst).toHaveBeenCalledOnce();
  });

  it("closes a JSON fence cut by max_tokens", async () => {
    streams(['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const body = await (await POST(post({ ticker: "AAA", reportMd: "## 1. X" }))).text();
    expect(body).toContain('{"method":"DC\n```\n');
    expect(body).toContain("Review truncated");
    expect(parseDeepValueJson(body)).toBeNull();
  });

  it("starts at xhigh with no effort named, and reports the resolved settings", async () => {
    streams(["<!--critique-->Critique"]);
    const res = await POST(post({ ticker: "AAA", reportMd: "## 1. X" }));
    await res.text();
    expect((runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort).toBe("xhigh");
    expect(JSON.parse(res.headers.get("X-AI-Settings")!)).toEqual({ model: "claude-opus-4-8", effort: "xhigh", thinking: true });
  });

  it("accepts a report longer than 60,000 characters", async () => {
    streams(["<!--critique-->Critique"]);
    const res = await POST(post({ ticker: "AAA", reportMd: "x".repeat(100_000) }));
    expect(res.status).toBe(200);
    await res.text();
  });
});
