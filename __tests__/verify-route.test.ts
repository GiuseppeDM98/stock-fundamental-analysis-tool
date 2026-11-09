// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ANALYST_PHASE_MARKERS, parseDeepValueJson, stripJsonBlock } from "@/lib/report/parse-deep-value-json";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const analysisFindFirst = vi.fn();
const datasetFindFirst = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    analysis: { findFirst: (...args: unknown[]) => analysisFindFirst(...args) },
    financialDataset: { findFirst: (...args: unknown[]) => datasetFindFirst(...args) },
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
import { getQuote } from "@/lib/yahoo-client";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/deep-value/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A lens on the saved analysis an1 of ticker AAA. */
const review = (body: Record<string, unknown> = {}) => post({ ticker: "AAA", reportMd: "## 1. X", analysisId: "an1", ...body });

const FINAL = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":12},"base":{"fairValue":10},"bear":{"fairValue":8}}\n```';

// The saved base result the gates run on (the result column, read before the fence).
const BASE_RESULT_JSON = JSON.stringify({ method: "EV/EBITDA", sector: "S", currency: "EUR", bull: { fairValue: 12 }, base: { fairValue: 10 }, bear: { fairValue: 8 } });

/** The user message of the n-th model call. */
const userPromptOf = (call: number) =>
  (runStreamMock.mock.calls[call][1] as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
const systemPromptOf = (call: number) => (runStreamMock.mock.calls[call][1] as { system: string }).system;

// Invented, round figures.
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, sharesDiluted: 100 })],
});
const BLIND = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":11},"base":{"fairValue":9},"bear":{"fairValue":7}}\n```';
const WARNING = { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "ebitda: 1000 (income_statement #1) vs 1100 (other #2)" };

const DATASET_ROW = {
  id: "ds1",
  dataJson: JSON.stringify({
    ...EXTRACT,
    datasetMeta: { ticker: "AAA", createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null },
  }),
  blocksJson: JSON.stringify([{ id: "blk-1", kind: "income_statement", text: "RAW PASTE never shown to a lens" }]),
  warningsJson: JSON.stringify([WARNING]),
  createdAt: new Date("2026-10-27T09:00:00Z"),
};

/** A saved analysis on dataset ds1, with its base result and the price it was saved at. */
const analysisRow = (overrides: Record<string, unknown> = {}) => ({
  datasetId: "ds1",
  groundingJson: null,
  mosPercent: 20,
  reportMd: "## 1. X",
  priceAtAnalysis: 9,
  resultJson: BASE_RESULT_JSON,
  createdAt: new Date("2026-10-01T09:00:00Z"),
  ...overrides,
});

/** Turn 1 returns `turn1Text` without streaming it; turn 2 streams `chunks`. */
function blindFirstStreams(turn1Text: string, chunks: string[], stopReason = "end_turn") {
  runStreamMock
    .mockImplementationOnce(async () => ({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: turn1Text, messages: [] }))
    .mockImplementationOnce(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
      for (const chunk of chunks) onText(chunk);
      return { stopReason, hitIterationCap: false, servedBy: null, text: chunks.join(""), messages: [] };
    });
}

beforeEach(() => {
  runStreamMock.mockReset();
  userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
  analysisFindFirst.mockReset().mockResolvedValue(analysisRow());
  datasetFindFirst.mockReset().mockResolvedValue(DATASET_ROW);
});

describe("POST /api/ai/deep-value/verify — a lens needs an analysis with a dataset", () => {
  it("answers 400 without an analysisId", async () => {
    const res = await POST(post({ ticker: "AAA", reportMd: "## 1. X" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("analysisId is required");
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 404 for an analysis that is not the user's", async () => {
    analysisFindFirst.mockResolvedValue(null);
    const res = await POST(review());
    expect(res.status).toBe(404);
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 400 for an analysis with neither a dataset nor a legacy extract, and calls no model", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ datasetId: null, groundingJson: null }));
    const res = await POST(review());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("analysis has no dataset: re-run it with one");
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 400 when the analysis's dataset cannot be read", async () => {
    datasetFindFirst.mockResolvedValue(null);
    const res = await POST(review());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dataset could not be read/);
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/deep-value/verify — blind-first on the analysis's dataset", () => {
  it("reads the extract from the dataset, without the raw blocks, with its stored warnings", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique\n", FINAL]);
    await (await POST(review())).text();

    expect(analysisFindFirst).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ datasetId: true }) }));
    expect(datasetFindFirst).toHaveBeenCalledWith({ where: { id: "ds1", userId: "u1" } });
    const prompt = userPromptOf(0);
    expect(prompt).toContain("STRUCTURED EXTRACT");
    expect(prompt).toContain(WARNING.detail);
    expect(prompt).not.toContain("RAW PASTE");
  });

  it("runs two turns under the two-phase system prompt: blind on the data, then the report", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique\n", FINAL]);
    await (await POST(review())).text();

    expect(runStreamMock).toHaveBeenCalledTimes(2);
    expect(systemPromptOf(0)).toContain("**PHASE 1 — this message has NO report.**");
    expect(systemPromptOf(1)).toBe(systemPromptOf(0));
    expect(userPromptOf(0)).not.toContain("--- REPORT UNDER REVIEW ---");
    expect(userPromptOf(1)).toContain("--- REPORT UNDER REVIEW ---");
  });

  it("also runs blind-first on an older analysis whose extract lives in groundingJson", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ datasetId: null, groundingJson: JSON.stringify({ blocks: [], extract: EXTRACT }) }));
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique\n", FINAL]);
    await (await POST(review())).text();
    expect(runStreamMock).toHaveBeenCalledTimes(2);
    expect(datasetFindFirst).not.toHaveBeenCalled();
  });

  it("drops the turn-2 chatter before the critique marker and keeps the final JSON", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["Let me re-read the filings. chatter", "<!--critique-->Critique\n", FINAL]);
    const body = await (await POST(review())).text();
    const turn2 = body.split(ANALYST_PHASE_MARKERS.reconcile)[1];
    expect(turn2.startsWith("Critique\n")).toBe(true);
    expect(body).not.toContain("chatter");
    expect(body).toContain("```json-blind\n");
    expect(parseDeepValueJson(body)?.base?.fairValue).toBe(10);
  });

  it("closes a JSON fence cut by max_tokens", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const body = await (await POST(review())).text();
    expect(body).toContain('{"method":"DC\n```\n');
    expect(body).toContain("Review truncated");
    expect(parseDeepValueJson(body)).toBeNull();
  });

  it("a degraded Phase 1 still gives turn 2 the base report's gates", async () => {
    blindFirstStreams("prose, no fence", ["<!--critique-->Critique\n", FINAL]);
    await (await POST(review())).text();
    expect(userPromptOf(1)).toContain("--- DETERMINISTIC GATES ON THE BASE REPORT");
  });

  it("keeps the degraded-Phase-1 note visible when turn 2 is cut inside its fence", async () => {
    blindFirstStreams("prose, no fence", ['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const body = await (await POST(review())).text();
    expect(parseDeepValueJson(body)).toBeNull();
    const shown = stripJsonBlock(body);
    expect(shown).toContain("Phase 1 (the blind valuation");
    expect(shown).toContain("Review truncated");
  });
});

describe("POST /api/ai/deep-value/verify — effort, row and gates", () => {
  it("starts at xhigh with no effort named, and reports the resolved settings", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    const res = await POST(review());
    await res.text();
    expect((runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort).toBe("xhigh");
    expect(JSON.parse(res.headers.get("X-AI-Settings")!)).toEqual({ model: "claude-opus-4-8", effort: "xhigh", thinking: true });
  });

  it("accepts a report longer than 60,000 characters", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    const res = await POST(review({ reportMd: "x".repeat(100_000) }));
    expect(res.status).toBe(200);
    await res.text();
  });

  it("applies an effort named without a model to the stored model", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    await (await POST(review({ effort: "low" }))).text();
    expect((runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort).toBe("low");
  });

  it("selects the price at analysis, the result column and the save date with the row", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    await (await POST(review())).text();
    expect(analysisFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ priceAtAnalysis: true, resultJson: true, createdAt: true }) })
    );
  });

  it("puts the deterministic gates on the base report into the reconcile prompt", async () => {
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    await (await POST(review())).text();

    const prompt = userPromptOf(1);
    expect(prompt).toContain("--- DETERMINISTIC GATES ON THE BASE REPORT");
    expect(prompt).not.toContain("NOT the current price");
  });

  it("when the quote fails, checks the gates against the price at analysis and says it is NOT the current price", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new Error("429 Too Many Requests"));
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    await (await POST(review())).text();

    const prompt = userPromptOf(1);
    expect(prompt).toContain(
      "Gates computed against the price at analysis (9.00 EUR, saved 2026-10-01) — the live quote was unavailable; this is NOT the current price."
    );
    expect(prompt).toContain("--- DETERMINISTIC GATES ON THE BASE REPORT");
  });

  it("a live quote without a currency is compared with nothing: the price gates read currency mismatch", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ regularMarketPrice: 10 } as Awaited<ReturnType<typeof getQuote>>);
    blindFirstStreams(`${BLIND}\nrationale`, ["<!--critique-->Critique"]);
    await (await POST(review())).text();

    const prompt = userPromptOf(1);
    expect(prompt).toContain("— bear_breaks_price: currency mismatch");
    expect(prompt).not.toContain("NOT the current price");
  });
});
