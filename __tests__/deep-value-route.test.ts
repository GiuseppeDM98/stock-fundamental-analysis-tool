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
  resumeAnalysisRun: vi.fn(),
  setRunPrice: vi.fn(),
  finishAnalysisRun: vi.fn(),
  failAnalysisRun: vi.fn(),
};
const order: string[] = [];

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
  startAnalysisRun: (...args: unknown[]) => store.startAnalysisRun(...args),
  resumeAnalysisRun: (...args: unknown[]) => store.resumeAnalysisRun(...args),
  setRunPrice: (...args: unknown[]) => store.setRunPrice(...args),
  finishAnalysisRun: (...args: unknown[]) => store.finishAnalysisRun(...args),
  failAnalysisRun: (...args: unknown[]) => store.failAnalysisRun(...args),
}));

import { POST } from "@/app/api/ai/deep-value/route";
import { GROUNDED_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";

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

const sentEffort = () => (runStreamMock.mock.calls[0][1] as { output_config: { effort: string } }).output_config.effort;

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
const REPORT_WITH_JSON = "<!--report-->## 1. X\n\n```json\n" + JSON.stringify(FULL_JSON) + "\n```";

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
  store.resumeAnalysisRun.mockReset();
  store.setRunPrice.mockReset().mockResolvedValue(1);
  store.finishAnalysisRun.mockReset().mockResolvedValue(1);
  store.failAnalysisRun.mockReset().mockResolvedValue(1);
});

describe("POST /api/ai/deep-value — streaming gate", () => {
  it("drops the research chatter before the report marker, and the marker itself", async () => {
    streams(["Let me search the filings. ", "chatter<!--rep", "ort-->## 1. X"]);
    expect(textOf(await events(await POST(run())))).toBe("## 1. X");
  });

  it("flushes the buffer when the marker never arrives, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prose = "## 1. Overview\nprose straight away";
    streams([prose]);
    expect(textOf(await events(await POST(run())))).toBe(prose);
    expect(warn).toHaveBeenCalledWith("[deep-value] report marker never arrived; flushed", prose.length);
    warn.mockRestore();
  });

  it("answers Server-Sent Events, without the retired X-AI-Settings header", async () => {
    streams(["<!--report-->## 1. X"]);
    const res = await POST(run());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("X-AI-Settings")).toBeNull();
    await res.text();
  });
});

describe("POST /api/ai/deep-value — the row written by the server", () => {
  it("creates the row before the model is called, and names it in the FIRST event", async () => {
    streams(["<!--report-->## 1. X"]);
    const evs = await events(await POST(run()));
    expect(order).toEqual(["quote", "start", "loop"]);
    expect(evs[0]).toEqual({ type: "stage", stage: "valuation", analysisId: "an1", runStartedAt: STARTED.toISOString() });
    expect(store.startAnalysisRun).toHaveBeenCalledWith("u1", expect.objectContaining({
      ticker: "AAA",
      companyName: "Aaa SpA",
      datasetId: "ds1",
      mosPercent: 0,
      reportLanguage: "English",
      priceAtAnalysis: 10,
      priceCurrency: "EUR",
    }));
  });

  it("writes the forwarded report and its parsed result, then sends done", async () => {
    streams(["chatter", REPORT_WITH_JSON]);
    const evs = await events(await POST(run()));
    expect(store.finishAnalysisRun).toHaveBeenCalledTimes(1);
    const [handle, written] = store.finishAnalysisRun.mock.calls[0];
    expect(handle).toBe(HANDLE);
    expect(written.reportMd).toBe(REPORT_WITH_JSON.replace("<!--report-->", ""));
    expect(written.result.base.fairValue).toBe(20);
    expect(evs.at(-1)).toEqual({ type: "done", analysisId: "an1" });
    expect(store.failAnalysisRun).not.toHaveBeenCalled();
  });

  it("marks a max_tokens cut failed and retryable, and never finishes it", async () => {
    streams(['<!--report-->## 1. X\n\n```json\n{"method":"DC'], "max_tokens");
    const evs = await events(await POST(run()));
    expect(store.finishAnalysisRun).not.toHaveBeenCalled();
    expect(store.failAnalysisRun).toHaveBeenCalledWith(HANDLE, expect.stringContaining("length limit"));
    expect(evs.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  it("marks a refusal failed, not retryable", async () => {
    streams(["<!--report-->## 1. Partial"], "refusal");
    const evs = await events(await POST(run()));
    expect(store.failAnalysisRun).toHaveBeenCalledWith(HANDLE, expect.stringContaining("declined"));
    expect(evs.at(-1)).toMatchObject({ type: "error", retryable: false });
  });

  it("marks an empty answer failed, retryable", async () => {
    streams([""]);
    const evs = await events(await POST(run()));
    expect(store.failAnalysisRun).toHaveBeenCalledWith(HANDLE, expect.stringContaining("no report"));
    expect(evs.at(-1)).toMatchObject({ type: "error", retryable: true });
  });

  it("keeps a report that ran out of search rounds, with the note in it", async () => {
    streams(["<!--report-->## 1. X"], "tool_use", true);
    await events(await POST(run()));
    expect(store.finishAnalysisRun.mock.calls[0][1].reportMd).toContain("too many web search rounds");
  });

  it("marks the row failed when the loop throws, with a product sentence and never the SDK's text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runStreamMock.mockRejectedValue(new Error("socket hang up req_abc123"));
    const evs = await events(await POST(run()));
    expect(store.failAnalysisRun).toHaveBeenCalledTimes(1);
    const message = store.failAnalysisRun.mock.calls[0][1] as string;
    expect(message).not.toContain("req_abc123");
    expect(evs.at(-1)).toEqual({ type: "error", error: message, retryable: true });
    expect(error).toHaveBeenCalledWith("[ai-run] deep-value valuation failed", expect.any(Error));
    error.mockRestore();
  });

  it("ends quietly when the row was deleted during the run (finish touched no row)", async () => {
    streams([REPORT_WITH_JSON]);
    store.finishAnalysisRun.mockResolvedValue(0);
    const evs = await events(await POST(run()));
    expect(evs.at(-1)).toEqual({ type: "error", error: "This analysis was deleted.", retryable: false });
    expect(evs.some((e) => e.type === "done")).toBe(false);
  });

  it("logs one [ai-run] line with the route, the phase, the model, the effort and the outcome", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    streams(["<!--report-->## 1. X"]);
    await events(await POST(run()));
    expect(info).toHaveBeenCalledWith("[ai-run]", "deep-value", "valuation", expect.stringMatching(/^\d+ms$/), "claude-opus-4-8", "xhigh", "end_turn");
    info.mockRestore();
  });
});

describe("POST /api/ai/deep-value — retry from the row", () => {
  const ROW = {
    ...HANDLE,
    ticker: "AAA",
    companyName: "Aaa SpA",
    datasetId: "ds1",
    mosPercent: 25,
    reportLanguage: "Italiano",
    aiModel: "claude-opus-4-8",
    aiEffort: "xhigh",
    aiThinking: true,
  };

  it("reads the row BEFORE the quote, accepts a body with only analysisId, and re-runs with the row's inputs", async () => {
    store.resumeAnalysisRun.mockImplementation(async () => {
      order.push("resume");
      return ROW;
    });
    streams(["<!--report-->## 1. X"]);
    const evs = await events(await POST(post({ analysisId: "an1" })));
    expect(order).toEqual(["resume", "quote", "loop"]);
    expect(store.resumeAnalysisRun).toHaveBeenCalledWith("u1", "an1");
    expect(store.startAnalysisRun).not.toHaveBeenCalled();
    expect(store.setRunPrice).toHaveBeenCalledWith(HANDLE, 10, "EUR");
    expect(evs[0]).toMatchObject({ type: "stage", analysisId: "an1" });
    const params = runStreamMock.mock.calls[0][1] as { output_config: { effort: string }; system: string };
    expect(params.output_config.effort).toBe("xhigh");
    expect(params.system).toContain("Italiano");
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("answers 409 as JSON when the row cannot be retried, before any quote", async () => {
    store.resumeAnalysisRun.mockRejectedValue(new AnalysisRunConflict("run still in progress"));
    const res = await POST(post({ analysisId: "an1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run still in progress" });
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a row that is not the user's", async () => {
    store.resumeAnalysisRun.mockRejectedValue(new AnalysisRunNotFound());
    const res = await POST(post({ analysisId: "foreign" }));
    expect(res.status).toBe(404);
    expect(getQuoteMock).not.toHaveBeenCalled();
  });

  it("answers 409 and fails the row when its dataset is gone", async () => {
    store.resumeAnalysisRun.mockResolvedValue(ROW);
    datasetFindFirst.mockResolvedValue(null);
    const res = await POST(post({ analysisId: "an1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "dataset no longer available" });
    expect(store.failAnalysisRun).toHaveBeenCalledWith(HANDLE, expect.stringContaining("dataset"));
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/deep-value — effort and resolved settings", () => {
  beforeEach(() => streams(["<!--report-->## 1. X"]));

  it("starts at xhigh when the global default is high and the run names no effort, and records it on the row", async () => {
    await events(await POST(run()));
    expect(sentEffort()).toBe("xhigh");
    expect(store.startAnalysisRun).toHaveBeenCalledWith("u1", expect.objectContaining({ aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinking: true }));
  });

  it("keeps a global max", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "max", aiThinkingEnabled: true });
    await events(await POST(run()));
    expect(sentEffort()).toBe("max");
  });

  it("lands on high for DeepSeek, which has no xhigh", async () => {
    await events(await POST(run({ model: "deepseek-v4-pro" })));
    expect(sentEffort()).toBe("high");
    expect(store.startAnalysisRun.mock.calls[0][1].aiEffort).toBe("high");
  });

  it("respects an effort the run names explicitly", async () => {
    await events(await POST(run({ model: "claude-opus-4-8", effort: "medium", thinking: false })));
    expect(sentEffort()).toBe("medium");
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(store.startAnalysisRun).toHaveBeenCalledWith("u1", expect.objectContaining({ aiModel: "claude-opus-4-8", aiEffort: "medium", aiThinking: false }));
  });

  it("applies an effort named without a model to the stored model", async () => {
    await events(await POST(run({ effort: "low" })));
    expect(sentEffort()).toBe("low");
  });
});

describe("POST /api/ai/deep-value — built on a stored dataset", () => {
  beforeEach(() => streams(["<!--report-->## 1. X"]));

  it("reads the user's dataset and puts its blocks and stored warnings in the prompt", async () => {
    datasetFindFirst.mockResolvedValue(datasetRow("AAA.MI"));
    const res = await POST(post({ ticker: "aaa.mi", datasetId: "ds1" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(datasetFindFirst).toHaveBeenCalledWith({ where: { id: "ds1", userId: "u1" } });
    const prompt = JSON.stringify(runStreamMock.mock.calls[0][1]);
    expect(prompt).toContain("Pasted revenue line 1000");
    expect(prompt).toContain(STORED_WARNING.detail);
    // The provenance reaches the prompt as one line per row, not as JSON keys.
    expect(prompt).not.toContain("blockId");
    expect(prompt).toContain("FY2025 — income: paste");
  });

  it("answers 400 without a datasetId, and creates no row", async () => {
    const res = await POST(post({ ticker: "AAA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("datasetId is required");
    expect(datasetFindFirst).not.toHaveBeenCalled();
    expect(store.startAnalysisRun).not.toHaveBeenCalled();
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("caps the tool loop at the rescoped research cap", async () => {
    await events(await POST(run()));
    expect(runStreamMock.mock.calls[0][3]).toBe(GROUNDED_MAX_TOOL_ITERATIONS);
  });

  it("gives a DeepSeek run the same dataset context as a Claude run", async () => {
    await events(await POST(run({ model: "claude-opus-4-8" })));
    await events(await POST(run({ model: "deepseek-v4-pro" })));
    const userPrompt = (call: number) => (runStreamMock.mock.calls[call][1] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(userPrompt(1)).toBe(userPrompt(0));
    expect(userPrompt(1)).toContain("Pasted revenue line 1000");
  });

  it("puts a web dataset's research notes at the head of the extract", async () => {
    const research = { model: "claude-sonnet-5-5", servedBy: null, effort: "high", searches: 4, fetches: 2, durationMs: 1000, unverifiedSources: [], notes: "EBITDA as reported." };
    datasetFindFirst.mockResolvedValue(datasetRow("AAA", { researchJson: JSON.stringify(research) }));
    await events(await POST(run()));
    expect(JSON.stringify(runStreamMock.mock.calls[0][1])).toContain("Research notes: EBITDA as reported.");
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
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});
