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
 *  A block whose pasted text contains "OLD" gets a fiscal year the schema rejects. */
function answerWithJson() {
  runStreamMock.mockImplementation(async (_client, params, onTextDelta: (t: string) => void) => {
    const userText = JSON.stringify(params.messages);
    const year = userText.includes("OLD") ? 1800 : 2025;
    onTextDelta(JSON.stringify({ meta: META, rows: [row(year)] }));
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

describe("POST /api/ai/grounding/extract — structured output", () => {
  beforeEach(() => {
    runStreamMock.mockReset();
    answerWithJson();
  });

  it("should send the block kind's JSON schema as the output format, at medium effort", async () => {
    await POST(post({ ticker: "FNCT.MI", blocks: [block("b1", "Revenue 1000")] }));
    const params = runStreamMock.mock.calls[0][1];
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.effort).toBe("medium");
  });

  it("should extract a block answered with plain JSON, without a fence", async () => {
    const res = await POST(post({ ticker: "FNCT.MI", blocks: [block("b1", "Revenue 1000")] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extract.financials.map((f: { fiscalYear: number }) => f.fiscalYear)).toEqual([2025]);
  });

  it("should fail only the block whose year the schema rejects", async () => {
    const res = await POST(post({ ticker: "FNCT.MI", blocks: [block("b1", "Revenue 1000"), block("b2", "OLD table")] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings.map((w: { code: string }) => w.code)).toContain("block_extract_failed");
    expect(json.extract.financials.map((f: { fiscalYear: number }) => f.fiscalYear)).toEqual([2025]);
  });

  it("should answer 400 with the Zod message on an invalid body", async () => {
    const res = await POST(post({ ticker: "", blocks: [] }));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });
});
