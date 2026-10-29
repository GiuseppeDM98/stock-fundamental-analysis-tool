// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDeepValueJson, stripJsonBlock } from "@/lib/report/parse-deep-value-json";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
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

import { POST } from "@/app/api/ai/deep-value/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/deep-value", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The model "streams" these chunks, then stops with `stopReason`. */
function streams(chunks: string[], stopReason = "end_turn") {
  runStreamMock.mockImplementation(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
    for (const chunk of chunks) onText(chunk);
    return { stopReason, hitIterationCap: false, servedBy: null, text: chunks.join(""), messages: [] };
  });
}

const sentEffort = () => (runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort;

describe("POST /api/ai/deep-value — streaming gate", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
  });

  it("drops the research chatter before the report marker, and the marker itself", async () => {
    streams(["Let me search the filings. ", "chatter<!--rep", "ort-->## 1. X"]);
    const res = await POST(post({ ticker: "AAA" }));
    expect(await res.text()).toBe("## 1. X");
  });

  it("flushes the buffer when the marker never arrives, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prose = "## 1. Overview\nprose straight away";
    streams([prose]);
    const res = await POST(post({ ticker: "AAA" }));
    expect(await res.text()).toBe(prose);
    expect(warn).toHaveBeenCalledWith("[deep-value] report marker never arrived; flushed", prose.length);
    warn.mockRestore();
  });

  it("closes a JSON fence cut by max_tokens, so the block parses to null and the note stays visible", async () => {
    streams(['<!--report-->## 1. X\n\n```json\n{"method":"DC'], "max_tokens");
    const body = await (await POST(post({ ticker: "AAA" }))).text();
    expect(body).toContain('```json\n{"method":"DC\n```\n');
    expect(body).toContain("Analysis truncated: length limit reached.");
    expect(parseDeepValueJson(body)).toBeNull();
    const shown = stripJsonBlock(body);
    expect(shown).not.toContain("```json");
    expect(shown).toContain("Analysis truncated");
  });

  it("adds no fence on max_tokens when the cut falls in the prose", async () => {
    streams(["<!--report-->## 1. X cut mid-"], "max_tokens");
    const body = await (await POST(post({ ticker: "AAA" }))).text();
    expect(body).not.toContain("```");
    expect(body).toContain("Analysis truncated");
  });
});

describe("POST /api/ai/deep-value — effort and resolved settings", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    streams(["<!--report-->## 1. X"]);
    userFindUnique.mockReset();
  });

  it("starts at xhigh when the global default is high and the run names no effort", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    const res = await POST(post({ ticker: "AAA" }));
    await res.text();
    expect(sentEffort()).toBe("xhigh");
    expect(JSON.parse(res.headers.get("X-AI-Settings")!)).toEqual({ model: "claude-opus-4-8", effort: "xhigh", thinking: true });
  });

  it("keeps a global max", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "max", aiThinkingEnabled: true });
    await (await POST(post({ ticker: "AAA" }))).text();
    expect(sentEffort()).toBe("max");
  });

  it("lands on high for DeepSeek, which has no xhigh", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    const res = await POST(post({ ticker: "AAA", model: "deepseek-v4-pro" }));
    await res.text();
    expect(sentEffort()).toBe("high");
    expect(JSON.parse(res.headers.get("X-AI-Settings")!).effort).toBe("high");
  });

  it("respects an effort the run names explicitly", async () => {
    const res = await POST(post({ ticker: "AAA", model: "claude-opus-4-8", effort: "medium", thinking: false }));
    await res.text();
    expect(sentEffort()).toBe("medium");
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(JSON.parse(res.headers.get("X-AI-Settings")!)).toEqual({ model: "claude-opus-4-8", effort: "medium", thinking: false });
  });
});
