// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources } from "@/types/dataset";
import { parseSseEvent } from "@/lib/sse-reader";
import type { AiRunEvent } from "@/types/ai-run";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const datasetFindFirst = vi.fn();
const getQuoteMock = vi.fn();
const store = {
  startAnalysisRun: vi.fn(),
  claimRunPhase: vi.fn(),
  setRunPrice: vi.fn(),
  finishUpdatePhase: vi.fn(),
  finishValuationPhase: vi.fn(),
  finishReportPart: vi.fn(),
  failAnalysisRun: vi.fn(),
};
const order: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    financialDataset: { findFirst: (...args: unknown[]) => datasetFindFirst(...args) },
  },
}));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: (...args: unknown[]) => getQuoteMock(...args) }));
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  // The real constructor throws without an API key.
  getAiClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tool-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-loop")>()),
  runStreamWithToolLoop: (...args: unknown[]) => runStreamMock(...args),
}));
vi.mock("@/lib/analyses-store", () => ({
  VALUATION_MEMO_MAX_CHARS: 4000,
  startAnalysisRun: (...args: unknown[]) => store.startAnalysisRun(...args),
  claimRunPhase: (...args: unknown[]) => store.claimRunPhase(...args),
  setRunPrice: (...args: unknown[]) => store.setRunPrice(...args),
  finishUpdatePhase: (...args: unknown[]) => store.finishUpdatePhase(...args),
  finishValuationPhase: (...args: unknown[]) => store.finishValuationPhase(...args),
  finishReportPart: (...args: unknown[]) => store.finishReportPart(...args),
  failAnalysisRun: (...args: unknown[]) => store.failAnalysisRun(...args),
}));

import { POST } from "@/app/api/ai/deep-value/route";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";
import type { DeepValuePhase } from "@/types/ai-run";

const STARTED = new Date("2026-11-20T10:00:00.000Z");
const HANDLE = { id: "an1", userId: "u1", runStartedAt: STARTED };

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/deep-value", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Every event of an SSE response, in order. */
async function events(res: Response): Promise<AiRunEvent[]> {
  const raw = await res.text();
  return raw
    .split("\n\n")
    .map((chunk) => parseSseEvent<AiRunEvent>(chunk))
    .filter((e): e is AiRunEvent => e != null);
}

const textOf = (evs: AiRunEvent[]) => evs.map((e) => (e.type === "text" ? e.text : "")).join("");

/** The model "streams" these chunks, then stops with `stopReason`. */
function streams(chunks: string[], stopReason = "end_turn", hitIterationCap = false) {
  runStreamMock.mockImplementation(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
    order.push("loop");
    for (const chunk of chunks) onText(chunk);
    return { stopReason, hitIterationCap, servedBy: null, text: chunks.join(""), messages: [] };
  });
}

type SentParams = {
  model: string;
  max_tokens: number;
  output_config: { effort: string };
  tools?: unknown[];
  cache_control?: unknown;
  system: string;
  messages: Array<{ role: string; content: string }>;
};
const sent = (call = 0) => runStreamMock.mock.calls[call][1] as SentParams;

// Every run is built on a stored dataset (invented, round figures).
const STORED_WARNING = { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (income_statement #1) vs 1100 (other #2)" };
function datasetRow(ticker: string, extra: { researchJson?: string } = {}) {
  return {
    id: "ds1",
    dataJson: JSON.stringify({
      ...makeExtract({
        meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
        financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
      }),
      datasetMeta: { ticker, createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null },
    }),
    blocksJson: JSON.stringify([{ id: "blk-1", kind: "income_statement", text: "Pasted revenue line 1000" }]),
    warningsJson: JSON.stringify([STORED_WARNING]),
    createdAt: new Date("2026-10-27T09:00:00Z"),
    ...extra,
  };
}

/** A run on the user's dataset of ticker AAA. */
const run = (body: Record<string, unknown> = {}) => post({ ticker: "AAA", datasetId: "ds1", ...body });

const FULL_JSON = {
  method: "DCF",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 30 },
  base: { fairValue: 20 },
  bear: { fairValue: 10 },
};
const VALUATION_TEXT = "Rationale.\n\n```json\n" + JSON.stringify(FULL_JSON) + "\n```";

/** A row the claim hands back at `phase`, with what the earlier phases wrote. */
function claimed(phase: DeepValuePhase, overrides: Record<string, unknown> = {}) {
  return {
    ...HANDLE,
    ticker: "AAA",
    companyName: "Aaa SpA",
    datasetId: "ds1",
    mosPercent: 25,
    reportLanguage: "English",
    aiModel: "claude-opus-4-8",
    aiEffort: "high",
    aiThinking: true,
    phase,
    restarted: false,
    createdAt: new Date("2026-11-20T09:50:00.000Z"),
    priceAtAnalysis: 10,
    priceCurrency: "EUR",
    updateNotesMd: "## Results\n- Revenue 1000.",
    resultJson: JSON.stringify(FULL_JSON),
    valuationMemo: "Memo.",
    reportMd: phase === "report2" ? "## 1. X" : "",
    ...overrides,
  };
}

beforeEach(() => {
  order.length = 0;
  runStreamMock.mockReset();
  getQuoteMock.mockReset().mockImplementation(async () => {
    order.push("quote");
    return { regularMarketPrice: 10, currency: "EUR", shortName: "Aaa SpA" };
  });
  datasetFindFirst.mockReset().mockResolvedValue(datasetRow("AAA"));
  userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
  store.startAnalysisRun.mockReset().mockImplementation(async () => {
    order.push("start");
    return HANDLE;
  });
  store.claimRunPhase.mockReset();
  store.setRunPrice.mockReset().mockResolvedValue(1);
  store.finishUpdatePhase.mockReset().mockResolvedValue(1);
  store.finishValuationPhase.mockReset().mockResolvedValue(1);
  store.finishReportPart.mockReset().mockResolvedValue(1);
  store.failAnalysisRun.mockReset().mockResolvedValue(1);
});

describe("POST /api/ai/deep-value — a new run", () => {
  it("creates the row before the model is called and names it, at update, in the FIRST event", async () => {
    streams(["<!--notes-->## Results"]);
    const evs = await events(await POST(run()));
    expect(order).toEqual(["quote", "start", "loop"]);
    expect(evs[0]).toEqual({ type: "stage", stage: "update", analysisId: "an1", runStartedAt: STARTED.toISOString() });
    expect(store.startAnalysisRun).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ ticker: "AAA", companyName: "Aaa SpA", datasetId: "ds1", mosPercent: 0, reportLanguage: "English", priceAtAnalysis: 10, priceCurrency: "EUR" })
    );
    expect(store.finishUpdatePhase).toHaveBeenCalledWith(expect.objectContaining({ id: "an1" }), "## Results");
    expect(evs.at(-1)).toEqual({ type: "done", analysisId: "an1" });
  });

  it("streams only the notes after the marker", async () => {
    streams(["Let me search. ", "chatter<!--no", "tes-->## Results"]);
    expect(textOf(await events(await POST(run())))).toBe("## Results");
  });

  it("answers 400 without a datasetId, and creates no row", async () => {
    const res = await POST(post({ ticker: "AAA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("datasetId is required");
    expect(store.startAnalysisRun).not.toHaveBeenCalled();
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a dataset of another ticker, or another user's, BEFORE creating a row", async () => {
    datasetFindFirst.mockResolvedValue(datasetRow("BBB.MI"));
    const mismatch = await POST(post({ ticker: "AAA.MI", datasetId: "ds1" }));
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toBe("dataset ticker mismatch");
    datasetFindFirst.mockResolvedValue(null);
    const missing = await POST(post({ ticker: "AAA.MI", datasetId: "ds-foreign" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("dataset not found");
    expect(store.startAnalysisRun).not.toHaveBeenCalled();
  });

  it("records the user's default on the row, a stored max stepped down to high", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "max", aiThinkingEnabled: true });
    streams(["<!--notes-->x"]);
    await events(await POST(run()));
    expect(store.startAnalysisRun.mock.calls[0][1]).toMatchObject({ aiModel: "claude-opus-4-8", aiEffort: "high" });
  });
});

describe("POST /api/ai/deep-value — each phase's call", () => {
  it("update: Sonnet 5.5 at high, one web search tool capped at 8 direct uses, 10 rounds", async () => {
    getQuoteMock.mockResolvedValue({ regularMarketPrice: 123.45, currency: "EUR", shortName: "Aaa SpA" });
    streams(["<!--notes-->x"]);
    await events(await POST(run()));
    const params = sent();
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config.effort).toBe("high");
    expect(params.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_callers: ["direct"] }]);
    expect(runStreamMock.mock.calls[0][3]).toBe(10);
    expect(params.cache_control).toBeUndefined();
    // The update never sees the price.
    expect(params.messages[0].content).not.toContain("123.45");
    expect(params.system).not.toContain("123.45");
  });

  it("valuation: the row's model and effort, no tools, 32000 tokens, one round, no cache", async () => {
    store.claimRunPhase.mockResolvedValue(claimed("valuation", { aiEffort: "medium" }));
    streams([VALUATION_TEXT]);
    const evs = await events(await POST(post({ analysisId: "an1", phase: "valuation" })));
    expect(store.claimRunPhase).toHaveBeenCalledWith("u1", "an1", "valuation");
    const params = sent();
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.output_config.effort).toBe("medium");
    expect(params.tools).toBeUndefined();
    expect(params.max_tokens).toBe(32000);
    expect(params.cache_control).toBeUndefined();
    expect(runStreamMock.mock.calls[0][3]).toBe(1);
    expect(evs[0]).toMatchObject({ type: "stage", stage: "valuation" });
    expect(store.finishValuationPhase).toHaveBeenCalledTimes(1);
  });

  it.each(["report1", "report2"] as const)("%s: the row's model, no tools, 16000 tokens, one round, the prompt cache", async (phase) => {
    store.claimRunPhase.mockResolvedValue(claimed(phase));
    streams(["<!--report-->## 6. Y"]);
    await events(await POST(post({ analysisId: "an1", phase })));
    const params = sent();
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.output_config.effort).toBe("high");
    expect(params.tools).toBeUndefined();
    expect(params.max_tokens).toBe(16000);
    expect(params.cache_control).toEqual({ type: "ephemeral" });
    expect(runStreamMock.mock.calls[0][3]).toBe(1);
    expect(store.finishReportPart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ last: phase === "report2" }));
  });

  it("valuation without a full triple: a retryable error, the row failed, nothing finished", async () => {
    store.claimRunPhase.mockResolvedValue(claimed("valuation"));
    streams(['Rationale.\n\n```json\n{"method":"DCF","bull":{"fairValue":30}}\n```']);
    const evs = await events(await POST(post({ analysisId: "an1", phase: "valuation" })));
    expect(store.finishValuationPhase).not.toHaveBeenCalled();
    expect(store.failAnalysisRun).toHaveBeenCalledWith(expect.objectContaining({ id: "an1" }), expect.stringContaining("bull/base/bear"));
    // failAnalysisRun writes only the status and the error: the phase stays at valuation.
    expect(store.failAnalysisRun.mock.calls[0]).toHaveLength(2);
    expect(evs.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  it("logs one [ai-run] line with the phase, its own model and effort, and the outcome", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    streams(["<!--notes-->x"]);
    await events(await POST(run()));
    expect(info).toHaveBeenCalledWith("[ai-run]", "deep-value", "update", expect.stringMatching(/^\d+ms$/), "claude-sonnet-5-5", "high", "end_turn");
    info.mockRestore();
  });

  it("marks the row failed when the loop throws, with a product sentence and never the SDK's text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runStreamMock.mockRejectedValue(new Error("socket hang up req_abc123"));
    const evs = await events(await POST(run()));
    const message = store.failAnalysisRun.mock.calls[0][1] as string;
    expect(message).not.toContain("req_abc123");
    expect(evs.at(-1)).toEqual({ type: "error", error: message, retryable: true });
    expect(error).toHaveBeenCalledWith("[ai-run] deep-value update failed", expect.any(Error));
    error.mockRestore();
  });
});

describe("POST /api/ai/deep-value — a Retry and the quote", () => {
  it("a Retry within the hour at report1 takes no new quote", async () => {
    store.claimRunPhase.mockResolvedValue(claimed("report1"));
    streams(["<!--report-->## 1. X"]);
    const evs = await events(await POST(post({ analysisId: "an1" })));
    expect(store.claimRunPhase).toHaveBeenCalledWith("u1", "an1", null);
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(store.setRunPrice).not.toHaveBeenCalled();
    expect(evs[0]).toMatchObject({ type: "stage", stage: "report1", analysisId: "an1" });
  });

  it("a Retry past the hour (restart at update, quote cleared) takes a new quote and writes it", async () => {
    store.claimRunPhase.mockImplementation(async () => {
      order.push("claim");
      return claimed("update", { restarted: true, priceAtAnalysis: null, priceCurrency: null, updateNotesMd: null, resultJson: null });
    });
    streams(["<!--notes-->x"]);
    await events(await POST(post({ analysisId: "an1" })));
    expect(order).toEqual(["claim", "quote", "loop"]);
    expect(store.setRunPrice).toHaveBeenCalledWith(expect.objectContaining({ id: "an1" }), 10, "EUR");
  });

  it("a resume from update on a row without a price takes a quote", async () => {
    store.claimRunPhase.mockResolvedValue(claimed("update", { priceAtAnalysis: null, priceCurrency: null, updateNotesMd: null }));
    streams(["<!--notes-->x"]);
    await events(await POST(post({ analysisId: "an1" })));
    expect(getQuoteMock).toHaveBeenCalledTimes(1);
    expect(store.setRunPrice).toHaveBeenCalledWith(expect.anything(), 10, "EUR");
  });

  it("answers 409 as JSON when the row cannot be claimed, before any quote", async () => {
    store.claimRunPhase.mockRejectedValue(new AnalysisRunConflict("phase out of order"));
    const res = await POST(post({ analysisId: "an1", phase: "report1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "phase out of order" });
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a row that is not the user's", async () => {
    store.claimRunPhase.mockRejectedValue(new AnalysisRunNotFound());
    const res = await POST(post({ analysisId: "foreign" }));
    expect(res.status).toBe(404);
    expect(getQuoteMock).not.toHaveBeenCalled();
  });

  it("answers 409 and fails the row when its dataset is gone", async () => {
    store.claimRunPhase.mockResolvedValue(claimed("valuation"));
    datasetFindFirst.mockResolvedValue(null);
    const res = await POST(post({ analysisId: "an1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "dataset no longer available" });
    expect(store.failAnalysisRun).toHaveBeenCalledWith(expect.objectContaining({ id: "an1" }), expect.stringContaining("dataset"));
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("rejects a continuation that carries anything but the id and the phase", async () => {
    const res = await POST(post({ analysisId: "an1", phase: "blind" }));
    expect(res.status).toBe(400);
    expect(store.claimRunPhase).not.toHaveBeenCalled();
  });
});
