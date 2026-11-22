// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { parseDeepValueJson } from "@/lib/report/parse-deep-value-json";
import type { AiRunEvent } from "@/types/ai-run";
import type { DeepValuePhase } from "@/types/ai-run";
import type { StoredDataset } from "@/types/dataset";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const runStreamMock = vi.fn();
const store = {
  finishUpdatePhase: vi.fn(),
  finishValuationPhase: vi.fn(),
  finishReportPart: vi.fn(),
  failAnalysisRun: vi.fn(),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
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
  finishUpdatePhase: (...args: unknown[]) => store.finishUpdatePhase(...args),
  finishValuationPhase: (...args: unknown[]) => store.finishValuationPhase(...args),
  finishReportPart: (...args: unknown[]) => store.finishReportPart(...args),
  failAnalysisRun: (...args: unknown[]) => store.failAnalysisRun(...args),
}));

import { runReportPart, runUpdatePhase, runValuationPhase, type PhaseContext } from "@/lib/ai/deep-value-phases";

const FULL_JSON = {
  method: "DCF",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 30 },
  base: { fairValue: 20 },
  bear: { fairValue: 10 },
};

const extract = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 })],
});
const STORED = {
  id: "ds1",
  dataset: { ...extract, datasetMeta: { ticker: "AAA", createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null } },
  blocks: [],
  warnings: [],
  research: null,
  createdAt: "2026-10-27T09:00:00.000Z",
} as unknown as StoredDataset;

function ctx(phase: DeepValuePhase, overrides: Record<string, unknown> = {}): PhaseContext {
  return {
    claimed: {
      id: "an1",
      userId: "u1",
      runStartedAt: new Date("2026-11-20T10:00:00.000Z"),
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
      reportMd: phase === "report2" ? "## 1. X\nFirst half." : "",
      ...overrides,
    },
    stored: STORED,
    grounding: buildGroundingPromptContext([], extract, 10, "EUR", [], null),
    language: "English",
    currentDate: "November 20, 2026",
    currentPrice: 10,
    currency: "EUR",
    aiSettings: { model: "claude-opus-4-8", effort: "high", thinking: true },
  };
}

/** A channel that keeps what it was sent. */
function channel() {
  const sent: AiRunEvent[] = [];
  return { sent, ch: { send: (e: AiRunEvent) => sent.push(e), close: () => {} } as never };
}
const textOf = (sent: AiRunEvent[]) => sent.map((e) => (e.type === "text" ? e.text : "")).join("");

/** The model "streams" these chunks, then stops with `stopReason`. */
function streams(chunks: string[], stopReason = "end_turn", hitIterationCap = false) {
  runStreamMock.mockImplementation(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
    for (const chunk of chunks) onText(chunk);
    return { stopReason, hitIterationCap, servedBy: null, text: chunks.join(""), messages: [] };
  });
}

type SentParams = { messages: Array<{ role: string; content: string }> };

beforeEach(() => {
  runStreamMock.mockReset();
  store.finishUpdatePhase.mockReset().mockResolvedValue(1);
  store.finishValuationPhase.mockReset().mockResolvedValue(1);
  store.finishReportPart.mockReset().mockResolvedValue(1);
  store.failAnalysisRun.mockReset().mockResolvedValue(1);
});

describe("runUpdatePhase", () => {
  it("saves and streams only the notes after the marker", async () => {
    streams(["Searching the filings. ", "<!--notes-->## Results\n", "- Revenue 1000."]);
    const { sent, ch } = channel();
    await runUpdatePhase(ctx("update"), ch);
    expect(textOf(sent)).toBe("## Results\n- Revenue 1000.");
    expect(store.finishUpdatePhase).toHaveBeenCalledWith(expect.objectContaining({ id: "an1" }), "## Results\n- Revenue 1000.");
    expect(sent.at(-1)).toEqual({ type: "done", analysisId: "an1" });
  });

  it("at the round cap, appends the partial-update note and still succeeds", async () => {
    streams(["<!--notes-->## Results"], "tool_use", true);
    const { sent, ch } = channel();
    await runUpdatePhase(ctx("update"), ch);
    const notes = store.finishUpdatePhase.mock.calls[0][1] as string;
    expect(notes.startsWith("## Results")).toBe(true);
    expect(notes).toContain("Partial update");
    expect(store.failAnalysisRun).not.toHaveBeenCalled();
    expect(sent.at(-1)).toMatchObject({ type: "done" });
  });
});

describe("runValuationPhase", () => {
  it("streams nothing and saves the memo without its fence", async () => {
    streams(["Rationale of the method.\n\n```json\n" + JSON.stringify(FULL_JSON) + "\n```"]);
    const { sent, ch } = channel();
    await runValuationPhase(ctx("valuation"), ch);
    expect(sent.filter((e) => e.type === "text")).toEqual([]);
    const written = store.finishValuationPhase.mock.calls[0][1] as { result: typeof FULL_JSON; memo: string };
    expect(written.memo).toBe("Rationale of the method.");
    expect(written.result.base.fairValue).toBe(20);
    expect(sent.at(-1)).toMatchObject({ type: "done" });
  });

  it("hands a 5000-character memo to the store, which keeps 4000, and logs the cut", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    streams(["m".repeat(5000) + "\n\n```json\n" + JSON.stringify(FULL_JSON) + "\n```"]);
    await runValuationPhase(ctx("valuation"), channel().ch);
    expect(warn).toHaveBeenCalledWith("[deep-value] memo truncated", 5000);
    expect(store.finishValuationPhase).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("succeeds with an empty memo: the numbers are the contract", async () => {
    streams(["```json\n" + JSON.stringify(FULL_JSON) + "\n```"]);
    const { sent, ch } = channel();
    await runValuationPhase(ctx("valuation"), ch);
    expect(store.finishValuationPhase.mock.calls[0][1].memo).toBe("");
    expect(sent.at(-1)).toMatchObject({ type: "done" });
  });

  it("fails, not retryable and without a model call, on a row with no web notes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sent, ch } = channel();
    await runValuationPhase(ctx("valuation", { updateNotesMd: null }), ch);
    expect(runStreamMock).not.toHaveBeenCalled();
    expect(store.failAnalysisRun).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toMatchObject({ type: "error", retryable: false });
    warn.mockRestore();
  });
});

describe("runReportPart", () => {
  it("fails, not retryable and without a model call, on report1 with no result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sent, ch } = channel();
    await runReportPart(ctx("report1", { resultJson: null }), ch);
    expect(runStreamMock).not.toHaveBeenCalled();
    expect(sent.at(-1)).toMatchObject({ type: "error", retryable: false });
    warn.mockRestore();
  });

  it("report2 sends three messages: report1's first message byte for byte, then the first half after the marker", async () => {
    streams(["<!--report-->## 1. X"]);
    await runReportPart(ctx("report1"), channel().ch);
    streams(["<!--report-->## 6. Y"]);
    await runReportPart(ctx("report2"), channel().ch);
    const first = (runStreamMock.mock.calls[0][1] as SentParams).messages;
    const second = (runStreamMock.mock.calls[1][1] as SentParams).messages;
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(3);
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[0].content).toBe(first[0].content);
    expect(second[1].content.startsWith("<!--report-->")).toBe(true);
    expect(second[1].content).toContain("First half.");
  });

  it("report1 saves its half and does not end the run", async () => {
    streams(["<!--report-->## 1. X"]);
    await runReportPart(ctx("report1"), channel().ch);
    expect(store.finishReportPart).toHaveBeenCalledWith(expect.anything(), { reportMd: "## 1. X", last: false });
  });

  it("report2's last fence is the row's valuation, even when the stream carries a JSON of its own", async () => {
    const stray = { ...FULL_JSON, bull: { fairValue: 99 } };
    streams(["<!--report-->## 6. Y\n\n```json\n" + JSON.stringify(stray) + "\n```"]);
    await runReportPart(ctx("report2"), channel().ch);
    const { reportMd, last } = store.finishReportPart.mock.calls[0][1] as { reportMd: string; last: boolean };
    expect(last).toBe(true);
    expect(reportMd.startsWith("## 1. X\nFirst half.\n\n## 6. Y")).toBe(true);
    expect(parseDeepValueJson(reportMd)?.bull?.fairValue).toBe(30);
  });
});
