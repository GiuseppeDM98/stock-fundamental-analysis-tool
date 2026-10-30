// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDeepValueJson, stripJsonBlock } from "@/lib/report/parse-deep-value-json";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources } from "@/types/dataset";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const datasetFindFirst = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
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

  it("applies an effort named without a model to the stored model", async () => {
    userFindUnique.mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    const res = await POST(post({ ticker: "AAA", effort: "low" }));
    await res.text();
    expect(sentEffort()).toBe("low");
    expect(JSON.parse(res.headers.get("X-AI-Settings")!)).toEqual({ model: "claude-opus-4-8", effort: "low", thinking: true });
  });
});

describe("POST /api/ai/deep-value — grounded on a stored dataset", () => {
  // Invented, round figures.
  const STORED_WARNING = { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (income_statement #1) vs 1100 (other #2)" };
  const datasetRow = (ticker: string) => ({
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
  });

  beforeEach(() => {
    runStreamMock.mockReset();
    datasetFindFirst.mockReset();
    userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
    streams(["<!--report-->## 1. X"]);
  });

  it("reads the user's dataset and puts its blocks and stored warnings in the prompt", async () => {
    datasetFindFirst.mockResolvedValue(datasetRow("AAA.MI"));
    const res = await POST(post({ ticker: "aaa.mi", datasetId: "ds1" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(datasetFindFirst).toHaveBeenCalledWith({ where: { id: "ds1", userId: "u1" } });
    const prompt = JSON.stringify(runStreamMock.mock.calls[0][1]);
    expect(prompt).toContain("Pasted revenue line 1000");
    expect(prompt).toContain(STORED_WARNING.detail);
    // The provenance is for the UI: the prompt gets the numbers.
    expect(prompt).not.toContain("blockId");
  });

  it("answers 400 for a dataset of another ticker, or one that is not the user's", async () => {
    datasetFindFirst.mockResolvedValue(datasetRow("BBB.MI"));
    const mismatch = await POST(post({ ticker: "AAA.MI", datasetId: "ds1" }));
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toBe("dataset ticker mismatch");

    datasetFindFirst.mockResolvedValue(null);
    const missing = await POST(post({ ticker: "AAA.MI", datasetId: "ds-foreign" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("dataset not found");
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});
