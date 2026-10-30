// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const runStreamMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: vi.fn(async () => { throw new Error("no quotes in tests"); }) }));
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  // The real constructor throws without an API key.
  getAiClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/tool-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-loop")>()),
  runStreamWithToolLoop: (...args: unknown[]) => runStreamMock(...args),
}));

import { POST } from "@/app/api/ai/grounding/extract/route";

const META = { reportingCurrency: "EUR", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" };
const row = (fiscalYear: number) => ({
  fiscalYear,
  revenue: 1000,
  ebitda: 200,
  ebit: 150,
  netIncome: 100,
  eps: 1,
  sharesDiluted: 100,
  dividendsPerShare: 0.5,
});

/** Answers each block with plain JSON (no fence), as the structured-output format returns it.
 *  A block whose pasted text contains "OLD" gets a fiscal year the schema rejects; one with
 *  "REV=<n>" reports that revenue. */
function answerWithJson() {
  runStreamMock.mockImplementation(async (_client, params, onTextDelta: (t: string) => void) => {
    const userText = JSON.stringify(params.messages);
    const year = userText.includes("OLD") ? 1800 : 2025;
    const revenue = Number(/REV=(\d+)/.exec(userText)?.[1] ?? 1000);
    onTextDelta(JSON.stringify({ meta: META, rows: [{ ...row(year), revenue }] }));
    return { stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: "" };
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/grounding/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const block = (id: string, text: string) => ({ id, kind: "income_statement", text });

/** A first Prepare: every block, in the order given. */
const prepare = (blocks: ReturnType<typeof block>[]) => post({ ticker: "FNCT.MI", blocks, blockOrder: blocks.map((b) => b.id) });

describe("POST /api/ai/grounding/extract — structured output", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    answerWithJson();
  });

  it("should send the block kind's JSON schema as the output format, at medium effort", async () => {
    await POST(prepare([block("b1", "Revenue 1000")]));
    const params = runStreamMock.mock.calls[0][1];
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.effort).toBe("medium");
  });

  it("should extract a block answered with plain JSON, without a fence", async () => {
    const res = await POST(prepare([block("b1", "Revenue 1000")]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extract.financials.map((f: { fiscalYear: number }) => f.fiscalYear)).toEqual([2025]);
  });

  it("should fail only the block whose year the schema rejects", async () => {
    const res = await POST(prepare([block("b1", "Revenue 1000"), block("b2", "OLD table")]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings.map((w: { code: string }) => w.code)).toContain("block_extract_failed");
    expect(json.extract.financials.map((f: { fiscalYear: number }) => f.fiscalYear)).toEqual([2025]);
  });

  it("should write each row's source from its block id", async () => {
    const json = await (await POST(prepare([block("b1", "Revenue 1000")]))).json();
    expect(json.blockResults.map((r: { blockId: string }) => r.blockId)).toEqual(["b1"]);
    expect(json.extract.financials[0].sources.income).toMatchObject({ kind: "paste", blockId: "b1", verified: true });
  });

  it("should answer 400 with the Zod message on an invalid body", async () => {
    const res = await POST(post({ ticker: "", blocks: [] }));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });
});

describe("POST /api/ai/grounding/extract — retry of one block", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    answerWithJson();
  });

  // Two blocks that disagree on the same field: the merge keeps the first one in the
  // editor's order, so the order the results arrive in must not change the extract.
  const first = block("b1", "Revenue REV=1000");
  const second = block("b2", "Revenue REV=1200");

  it("should merge the prior results with the retried block in the editor's order, as a full Prepare would", async () => {
    const full = await (await POST(prepare([first, second]))).json();
    expect(full.extract.financials[0].revenue).toBe(1000);

    // The retry sends the FIRST block, with the second one's result as prior.
    const priorSecond = full.blockResults.find((r: { blockId: string }) => r.blockId === "b2");
    const res = await POST(post({ ticker: "FNCT.MI", blocks: [first], blockOrder: ["b1", "b2"], priorResults: [priorSecond] }));
    expect(res.status).toBe(200);
    const retried = await res.json();
    expect(retried.blockResults.map((r: { blockId: string }) => r.blockId)).toEqual(["b1", "b2"]);
    expect(retried.extract).toEqual(full.extract);
    expect(retried.warnings).toEqual(full.warnings);
    expect(retried.failedBlockIds).toEqual([]);
    expect(runStreamMock).toHaveBeenCalledTimes(3); // two for the Prepare, one for the retry
  });

  it("should answer 200 with the prior results when the retried block fails again", async () => {
    const full = await (await POST(prepare([first, block("b2", "OLD table")]))).json();
    const res = await POST(post({ ticker: "FNCT.MI", blocks: [block("b2", "OLD table again")], blockOrder: ["b1", "b2"], priorResults: full.blockResults }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failedBlockIds).toEqual(["b2"]);
    expect(json.extract.financials[0].revenue).toBe(1000);
    expect(json.warnings).toContainEqual({ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "income_statement #2" });
  });

  it("should name block 2 of 3 as failed on the first call, then fold its retry into the same extract", async () => {
    const third = block("b3", "Revenue REV=1000");
    const firstRun = await (await POST(prepare([first, block("b2", "OLD table"), third]))).json();
    expect(firstRun.failedBlockIds).toEqual(["b2"]);
    expect(firstRun.blockResults.map((r: { blockId: string }) => r.blockId)).toEqual(["b1", "b3"]);
    expect(firstRun.warnings).toContainEqual({ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "income_statement #2" });

    // The user fixes the paste and retries only that block.
    const fixed = block("b2", "Revenue REV=1200");
    const retry = await (await POST(post({ ticker: "FNCT.MI", blocks: [fixed], blockOrder: ["b1", "b2", "b3"], priorResults: firstRun.blockResults }))).json();
    const full = await (await POST(prepare([first, fixed, third]))).json();
    expect(retry.blockResults.map((r: { blockId: string }) => r.blockId)).toEqual(["b1", "b2", "b3"]);
    expect(retry.extract).toEqual(full.extract);
  });

  it("should drop a prior result whose block is no longer in the editor", async () => {
    const full = await (await POST(prepare([first, second]))).json();
    const json = await (await POST(post({ ticker: "FNCT.MI", blocks: [first], blockOrder: ["b1"], priorResults: full.blockResults }))).json();
    expect(json.blockResults.map((r: { blockId: string }) => r.blockId)).toEqual(["b1"]);
    expect(json.warnings.map((w: { code: string }) => w.code)).not.toContain("value_conflict");
  });

  it("should answer 502 only when neither the prior results nor this run extracted anything", async () => {
    expect((await POST(prepare([block("b1", "OLD table")]))).status).toBe(502);
  });
});
