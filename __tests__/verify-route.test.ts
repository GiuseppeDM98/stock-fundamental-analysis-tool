// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDeepValueJson } from "@/lib/report/parse-deep-value-json";
import { parseSseEvent } from "@/lib/sse-reader";
import type { AiRunEvent } from "@/types/ai-run";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const analysisFindFirst = vi.fn();
const datasetFindFirst = vi.fn();
const saveLensBlind = vi.fn();
const saveLensFinal = vi.fn();

vi.mock("server-only", () => ({}));
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
// The row is read for real (through db.analysis.findFirst); only the writes are spied.
vi.mock("@/lib/analyses-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analyses-store")>()),
  saveLensBlind: (...args: unknown[]) => saveLensBlind(...args),
  saveLensFinal: (...args: unknown[]) => saveLensFinal(...args),
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

/** One phase of a lens on the saved analysis an1 of ticker AAA. */
const blindPhase = (body: Record<string, unknown> = {}) => post({ ticker: "AAA", analysisId: "an1", phase: "blind", ...body });
const reconcilePhase = (body: Record<string, unknown> = {}) => post({ ticker: "AAA", analysisId: "an1", phase: "reconcile", ...body });

/** Every event of an SSE response, in order. */
async function events(res: Response): Promise<AiRunEvent[]> {
  return (await res.text())
    .split("\n\n")
    .map((chunk) => parseSseEvent<AiRunEvent>(chunk))
    .filter((e): e is AiRunEvent => e != null);
}
const textOf = (evs: AiRunEvent[]) => evs.map((e) => (e.type === "text" ? e.text : "")).join("");

const FINAL = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":12},"base":{"fairValue":10},"bear":{"fairValue":8}}\n```';

// The saved base result the gates run on (the result column, read before the fence).
const BASE_RESULT_JSON = JSON.stringify({ method: "EV/EBITDA", sector: "S", currency: "EUR", bull: { fairValue: 12 }, base: { fairValue: 10 }, bear: { fairValue: 8 } });

type ModelParams = { system: string; messages: Array<{ role: string; content: string }>; output_config: { effort: string } };
const paramsOf = (call: number) => runStreamMock.mock.calls[call][1] as ModelParams;
/** The last user message of the n-th model call. */
const userPromptOf = (call: number) => paramsOf(call).messages.at(-1)!.content;

// Invented, round figures.
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, sharesDiluted: 100 })],
});
const BLIND_OBJECT = { method: "DCF", sector: "S", currency: "EUR", bull: { fairValue: 11 }, base: { fairValue: 9 }, bear: { fairValue: 7 } };
const BLIND = "```json\n" + JSON.stringify(BLIND_OBJECT) + "\n```";
// The commitment as the blind phase persists it.
const BLIND_COLUMN = JSON.stringify({ ...BLIND_OBJECT, rationale: "Net debt dominates." });
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

/** A finished analysis on dataset ds1, with its base result and the price it was saved at. */
const analysisRow = (overrides: Record<string, unknown> = {}) => ({
  runStatus: "done",
  ticker: "AAA",
  reportLanguage: "English",
  datasetId: "ds1",
  groundingJson: null,
  mosPercent: 20,
  reportMd: "## 1. Saved report",
  priceAtAnalysis: 9,
  priceCurrency: "EUR",
  resultJson: BASE_RESULT_JSON,
  createdAt: new Date("2026-10-01T09:00:00Z"),
  reviewBlindJson: BLIND_COLUMN,
  ...overrides,
});

/** The model returns `text` without streaming it (Phase 1). */
function blindTurn(text: string, stopReason = "end_turn") {
  runStreamMock.mockImplementationOnce(async () => ({ stopReason, hitIterationCap: false, servedBy: null, text, messages: [] }));
}
/** The model streams `chunks` (Phase 2). */
function reconcileTurn(chunks: string[], stopReason = "end_turn") {
  runStreamMock.mockImplementationOnce(async (_client: unknown, _params: unknown, onText: (t: string) => void) => {
    for (const chunk of chunks) onText(chunk);
    return { stopReason, hitIterationCap: false, servedBy: null, text: chunks.join(""), messages: [] };
  });
}

beforeEach(() => {
  runStreamMock.mockReset();
  userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "high", aiThinkingEnabled: true });
  analysisFindFirst.mockReset().mockResolvedValue(analysisRow());
  datasetFindFirst.mockReset().mockResolvedValue(DATASET_ROW);
  saveLensBlind.mockReset().mockResolvedValue(1);
  saveLensFinal.mockReset().mockResolvedValue(1);
  // A queued quote a phase never asked for must not leak into the next test.
  vi.mocked(getQuote).mockReset().mockResolvedValue({ regularMarketPrice: 10, currency: "EUR" } as Awaited<ReturnType<typeof getQuote>>);
});

describe("POST /api/ai/deep-value/verify — a lens needs a finished analysis with a dataset", () => {
  it("answers 400 without an analysisId, or without a phase", async () => {
    const noId = await POST(post({ ticker: "AAA", phase: "blind" }));
    expect(noId.status).toBe(400);
    expect((await noId.json()).error).toBe("analysisId is required");
    const noPhase = await POST(post({ ticker: "AAA", analysisId: "an1" }));
    expect(noPhase.status).toBe(400);
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 404 for an analysis that is not the user's", async () => {
    analysisFindFirst.mockResolvedValue(null);
    const res = await POST(blindPhase());
    expect(res.status).toBe(404);
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 409 on a row still running or failed: there is no report to review", async () => {
    for (const runStatus of ["running", "failed"]) {
      analysisFindFirst.mockResolvedValue(analysisRow({ runStatus }));
      const res = await POST(blindPhase());
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "analysis run not finished" });
    }
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 400 for an analysis with neither a dataset nor a legacy extract, and calls no model", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ datasetId: null, groundingJson: null }));
    const res = await POST(blindPhase());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("analysis has no dataset: re-run it with one");
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 400 when the analysis's dataset cannot be read", async () => {
    datasetFindFirst.mockResolvedValue(null);
    const res = await POST(blindPhase());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dataset could not be read/);
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/deep-value/verify — phase blind", () => {
  it("reads the extract from the dataset, without the raw blocks, with its stored warnings", async () => {
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    expect(datasetFindFirst).toHaveBeenCalledWith({ where: { id: "ds1", userId: "u1" } });
    const prompt = userPromptOf(0);
    expect(prompt).toContain("STRUCTURED EXTRACT");
    expect(prompt).toContain(WARNING.detail);
    expect(prompt).not.toContain("RAW PASTE");
    expect(prompt).not.toContain("--- REPORT UNDER REVIEW ---");
    expect(paramsOf(0).system).toContain("**PHASE 1 — this message has NO report.**");
  });

  it("gives the lens the research notes of a web dataset, as the report had them", async () => {
    const research = { model: "claude-sonnet-5-5", servedBy: null, effort: "high", searches: 4, fetches: 2, durationMs: 1000, unverifiedSources: [], notes: "EBITDA is the company's adjusted figure" };
    datasetFindFirst.mockResolvedValue({ ...DATASET_ROW, researchJson: JSON.stringify(research) });
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    expect(userPromptOf(0)).toContain("Research notes: EBITDA is the company's adjusted figure");
  });

  it("streams nothing but the stage, persists the commitment with its rationale, and sends it in done", async () => {
    blindTurn(`Searching first.\n${BLIND}\n\nNet debt dominates.`);
    const evs = await events(await POST(blindPhase()));
    expect(runStreamMock).toHaveBeenCalledTimes(1);
    expect(evs[0]).toEqual({ type: "stage", stage: "blind" });
    expect(textOf(evs)).toBe("");
    expect(saveLensBlind).toHaveBeenCalledWith("an1", "u1", "skeptic", expect.objectContaining({ rationale: "Net debt dominates.", base: expect.objectContaining({ fairValue: 9 }) }));
    const done = evs.at(-1);
    expect(done).toMatchObject({ type: "done", degraded: false });
    expect(done?.type === "done" && done.blind?.base.fairValue).toBe(9);
  });

  it("a Phase 1 without a usable commitment, or a refused one, clears the blind column and says degraded", async () => {
    blindTurn("prose, no fence");
    expect((await events(await POST(blindPhase()))).at(-1)).toEqual({ type: "done", blind: null, degraded: true });
    blindTurn(`${BLIND}\nrationale`, "refusal");
    await events(await POST(blindPhase()));
    expect(saveLensBlind.mock.calls.map((c) => c[3])).toEqual([null, null]);
  });

  it("ends with an error, not done, when the row was deleted during the phase", async () => {
    blindTurn(`${BLIND}\nrationale`);
    saveLensBlind.mockResolvedValue(0);
    expect((await events(await POST(blindPhase()))).at(-1)).toEqual({ type: "error", error: "This analysis was deleted.", retryable: false });
  });

  it("answers an error event with a product sentence when the model call throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runStreamMock.mockRejectedValueOnce(new Error("socket hang up req_abc123"));
    const last = (await events(await POST(blindPhase()))).at(-1);
    expect(last).toMatchObject({ type: "error", retryable: true });
    expect(JSON.stringify(last)).not.toContain("req_abc123");
    expect(saveLensBlind).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("POST /api/ai/deep-value/verify — phase reconcile", () => {
  it("sends three messages: the same blind message, the commitment as an assistant turn, the reconcile prompt", async () => {
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase()));

    const { messages, system } = paramsOf(1);
    expect(system).toBe(paramsOf(0).system);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toBe(paramsOf(0).messages[0].content);
    expect(messages[1].content).toContain('"fairValue": 9');
    expect(messages[1].content).toContain("Net debt dominates.");
    expect(messages[1].content).not.toContain('"rationale"');
    expect(messages[2].content).toContain("--- REPORT UNDER REVIEW ---");
    // The report is the row's own, never one the client sent.
    expect(messages[2].content).toContain("## 1. Saved report");
  });

  it("works on the quote Phase 1 stored, not a new one: a price that moved keeps the prefix identical", async () => {
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    const saved = saveLensBlind.mock.calls[0][3];
    expect(saved.phase1Quote).toEqual({ price: 10, currency: "EUR" });

    // The market moved between the two requests; the row now holds what Phase 1 wrote.
    analysisFindFirst.mockResolvedValue(analysisRow({ reviewBlindJson: JSON.stringify(saved) }));
    vi.mocked(getQuote).mockClear().mockResolvedValueOnce({ regularMarketPrice: 11, currency: "EUR" } as Awaited<ReturnType<typeof getQuote>>);
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase()));

    expect(getQuote).not.toHaveBeenCalled();
    expect(paramsOf(1).system).toBe(paramsOf(0).system);
    expect(paramsOf(1).messages[0].content).toBe(paramsOf(0).messages[0].content);
    expect(paramsOf(1).messages[1].content).not.toContain("phase1Quote");
  });

  it("a Phase 1 with no quote stores null, and Phase 2 then runs without a price too", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new Error("429 Too Many Requests"));
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    const saved = saveLensBlind.mock.calls[0][3];
    expect(saved.phase1Quote).toBeNull();

    analysisFindFirst.mockResolvedValue(analysisRow({ reviewBlindJson: JSON.stringify(saved) }));
    vi.mocked(getQuote).mockClear();
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase()));
    expect(getQuote).not.toHaveBeenCalled();
    expect(paramsOf(1).system).toBe(paramsOf(0).system);
  });

  it("a commitment stored without a quote (an older row) reads the live one", async () => {
    vi.mocked(getQuote).mockClear();
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase()));
    expect(getQuote).toHaveBeenCalledTimes(1);
  });

  it("ignores a reportMd in the body", async () => {
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase({ reportMd: "## CLIENT COPY" })));
    expect(JSON.stringify(paramsOf(0).messages)).not.toContain("CLIENT COPY");
  });

  it("reads the blind column of the lens it runs (through ANALYST_COLUMNS)", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ reviewBlindJson: null, optimistBlindJson: BLIND_COLUMN }));
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    await events(await POST(reconcilePhase({ angle: "optimist" })));
    expect(analysisFindFirst.mock.calls[0][0].select).toMatchObject({ optimistBlindJson: true });
    expect(paramsOf(0).messages).toHaveLength(3);
  });

  it("drops the chatter before the critique marker, and writes the critique without its JSON and the parsed result", async () => {
    reconcileTurn(["Let me re-read the filings. chatter", "<!--critique-->Critique\n", FINAL]);
    const evs = await events(await POST(reconcilePhase()));
    expect(textOf(evs).startsWith("Critique\n")).toBe(true);
    expect(textOf(evs)).not.toContain("chatter");
    expect(parseDeepValueJson(textOf(evs))?.base?.fairValue).toBe(10);
    const [id, userId, angle, written] = saveLensFinal.mock.calls[0];
    expect([id, userId, angle]).toEqual(["an1", "u1", "skeptic"]);
    expect(written.critiqueMd).toBe("Critique\n");
    expect(written.result.base.fairValue).toBe(10);
    expect(evs.at(-1)).toEqual({ type: "done" });
  });

  it("closes a JSON fence cut by max_tokens, notes it, and writes no result", async () => {
    reconcileTurn(['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const text = textOf(await events(await POST(reconcilePhase())));
    expect(text).toContain('{"method":"DC\n```\n');
    expect(text).toContain("Review truncated");
    const written = saveLensFinal.mock.calls[0][3];
    expect(written.result).toBeNull();
    expect(written.critiqueMd).toContain("Review truncated");
  });

  it("without a commitment on the row it is one single-phase review, with the gates and the note", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ reviewBlindJson: null }));
    reconcileTurn(['<!--critique-->Critique\n```json\n{"method":"DC'], "max_tokens");
    const evs = await events(await POST(reconcilePhase()));
    const { messages } = paramsOf(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("--- REPORT UNDER REVIEW ---");
    expect(messages[0].content).toContain("STRUCTURED EXTRACT");
    expect(messages[0].content).toContain("--- DETERMINISTIC GATES ON THE BASE REPORT");
    const critique = saveLensFinal.mock.calls[0][3].critiqueMd as string;
    expect(critique).toContain("Phase 1 (the blind valuation");
    expect(critique).toContain("Review truncated");
    expect(evs.at(-1)).toEqual({ type: "done" });
  });

  it("ends with an error when the row was deleted during the phase", async () => {
    reconcileTurn(["<!--critique-->Critique\n", FINAL]);
    saveLensFinal.mockResolvedValue(0);
    expect((await events(await POST(reconcilePhase()))).at(-1)).toMatchObject({ type: "error", retryable: false });
  });
});

describe("POST /api/ai/deep-value/verify — effort, row and gates", () => {
  it("starts at xhigh with no effort named, without the retired X-AI-Settings header", async () => {
    blindTurn(`${BLIND}\nrationale`);
    const res = await POST(blindPhase());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("X-AI-Settings")).toBeNull();
    await res.text();
    expect(paramsOf(0).output_config.effort).toBe("xhigh");
  });

  it("applies an effort named without a model to the stored model", async () => {
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase({ effort: "low" })));
    expect(paramsOf(0).output_config.effort).toBe("low");
  });

  it("logs one [ai-run] line per phase", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    expect(info).toHaveBeenCalledWith("[ai-run]", "verify", "skeptic", "blind", expect.stringMatching(/^\d+ms$/), "claude-opus-4-8", "xhigh", "end_turn");
    info.mockRestore();
  });

  it("selects the status, the price at analysis with its currency, the result column and the save date", async () => {
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    expect(analysisFindFirst.mock.calls[0][0].select).toMatchObject({ runStatus: true, priceAtAnalysis: true, priceCurrency: true, resultJson: true, createdAt: true, reviewBlindJson: true });
  });

  it("puts the deterministic gates on the base report into the reconcile prompt", async () => {
    reconcileTurn(["<!--critique-->Critique"]);
    await events(await POST(reconcilePhase()));
    const prompt = userPromptOf(0);
    expect(prompt).toContain("--- DETERMINISTIC GATES ON THE BASE REPORT");
    expect(prompt).not.toContain("NOT the current price");
  });

  it("when the quote fails, checks the gates against the price at analysis in its own currency and says it is NOT the current price", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new Error("429 Too Many Requests"));
    reconcileTurn(["<!--critique-->Critique"]);
    await events(await POST(reconcilePhase()));
    expect(userPromptOf(0)).toContain(
      "Gates computed against the price at analysis (9.00 EUR, saved 2026-10-01) — the live quote was unavailable; this is NOT the current price."
    );
  });

  it("a price at analysis without its currency is compared with nothing: the price gates read currency mismatch", async () => {
    vi.mocked(getQuote).mockRejectedValueOnce(new Error("429 Too Many Requests"));
    analysisFindFirst.mockResolvedValue(analysisRow({ priceCurrency: null }));
    reconcileTurn(["<!--critique-->Critique"]);
    await events(await POST(reconcilePhase()));
    expect(userPromptOf(0)).toContain("— bear_breaks_price: currency mismatch");
  });

  it("a live quote without a currency is compared with nothing: the price gates read currency mismatch", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({ regularMarketPrice: 10 } as Awaited<ReturnType<typeof getQuote>>);
    reconcileTurn(["<!--critique-->Critique"]);
    await events(await POST(reconcilePhase()));
    const prompt = userPromptOf(0);
    expect(prompt).toContain("— bear_breaks_price: currency mismatch");
    expect(prompt).not.toContain("NOT the current price");
  });

  it("also runs on an older analysis whose extract lives in groundingJson", async () => {
    analysisFindFirst.mockResolvedValue(analysisRow({ datasetId: null, groundingJson: JSON.stringify({ blocks: [], extract: EXTRACT }) }));
    blindTurn(`${BLIND}\nrationale`);
    await events(await POST(blindPhase()));
    expect(runStreamMock).toHaveBeenCalledTimes(1);
    expect(datasetFindFirst).not.toHaveBeenCalled();
  });
});
