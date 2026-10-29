// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ANALYST_PHASE_MARKERS, parseDeepValueJson, stripJsonBlock } from "@/lib/report/parse-deep-value-json";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

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

  it("applies an effort named without a model to the stored model", async () => {
    streams(["<!--critique-->Critique"]);
    await (await POST(post({ ticker: "AAA", reportMd: "## 1. X", effort: "low" }))).text();
    expect((runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort).toBe("low");
  });
});

// Pasted data on the saved row makes the lens run blind-first: turn 1 commits from the data
// alone (never forwarded as streamed), turn 2 critiques behind the same marker gate.
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, sharesDiluted: 100 })],
});
const BLIND = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":11},"base":{"fairValue":9},"bear":{"fairValue":7}}\n```';

/** Turn 1 returns `turn1Text` without streaming it; turn 2 streams `chunks`. */
function blindFirstStreams(turn1Text: string, chunks: string[], stopReason = "end_turn") {
  runStreamMock
    .mockImplementationOnce(async () => ({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: turn1Text, messages: [] }))
    .mockImplementationOnce(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
      for (const chunk of chunks) onText(chunk);
      return { stopReason, hitIterationCap: false, servedBy: null, text: chunks.join(""), messages: [] };
    });
}

describe("POST /api/ai/deep-value/verify — blind-first review", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    analysisFindFirst.mockReset().mockResolvedValue({
      groundingJson: JSON.stringify({ blocks: [], extract: EXTRACT }),
      mosPercent: 20,
      reportMd: "## 1. X",
    });
  });

  it("drops the turn-2 chatter before the critique marker and keeps the final JSON", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["Let me re-read the filings. chatter", "<!--critique-->Critique\n", FINAL]);
    const body = await (await POST(post({ ticker: "AAA", reportMd: "## 1. X", analysisId: "an1" }))).text();
    expect(runStreamMock).toHaveBeenCalledTimes(2);
    const turn2 = body.split(ANALYST_PHASE_MARKERS.reconcile)[1];
    expect(turn2.startsWith("Critique\n")).toBe(true);
    expect(body).not.toContain("chatter");
    expect(body).toContain("```json-blind\n");
    expect(parseDeepValueJson(body)?.base?.fairValue).toBe(10);
  });

  it("keeps the degraded-Phase-1 note visible when turn 2 is cut inside its fence", async () => {
    blindFirstStreams("prose, no fence", ['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const body = await (await POST(post({ ticker: "AAA", reportMd: "## 1. X", analysisId: "an1" }))).text();
    expect(parseDeepValueJson(body)).toBeNull();
    const shown = stripJsonBlock(body);
    expect(shown).toContain("Phase 1 (the blind valuation");
    expect(shown).toContain("Review truncated");
  });
});
