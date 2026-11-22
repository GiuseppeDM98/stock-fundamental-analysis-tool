// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const datasetCreate = vi.fn();
const datasetFindFirst = vi.fn();
const getQuoteMock = vi.fn();
const session = { user: { id: "u1" } };

// ResearchRun in memory: the route reads back what it wrote, across requests, so a mock that
// answers by its `where` is the only honest stand-in (a canned answer would ignore userId).
type RunRow = Record<string, unknown> & { id: string; userId: string; createdAt: Date };
let runRows: RunRow[] = [];
let runSeq = 0;
function matches(row: RunRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) =>
    key === "createdAt" ? (row.createdAt as Date) < (value as { lt: Date }).lt : row[key] === value
  );
}
const researchRun = {
  deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const before = runRows.length;
    runRows = runRows.filter((row) => !matches(row, where));
    return { count: before - runRows.length };
  }),
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `run${++runSeq}`, createdAt: new Date(), statementsJson: null, marketJson: null, estimatesJson: null, ...data } as unknown as RunRow;
    runRows.push(row);
    return { id: row.id };
  }),
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const row = runRows.find((r) => matches(r, where));
    return row ? { ...row } : null;
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const hit = runRows.filter((row) => matches(row, where));
    for (const row of hit) Object.assign(row, data);
    return { count: hit.length };
  }),
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    financialDataset: {
      create: (...args: unknown[]) => datasetCreate(...args),
      findFirst: (...args: unknown[]) => datasetFindFirst(...args),
    },
    // A getter: the factory is hoisted above the in-memory store it hands out.
    get researchRun() {
      return researchRun;
    },
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

import { GET, POST } from "@/app/api/ai/research/route";

// Invented, round figures on an invented company.
const AR = "https://ir.ornitorinco.example/annual-report-2025.pdf";
const PR = "https://ir.ornitorinco.example/results/fy2025";
const MULT = "https://data.example/ORNT/multiples";

const STATEMENTS = {
  meta: { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: "Adjusted EBITDA." },
  sources: [
    { id: "ar", url: AR, title: "Annual report 2025", asOf: "2026-03", kind: "annual_report" },
    { id: "pr", url: PR, title: "FY2025 results", asOf: "2026-02", kind: "press_release" },
  ],
  financials: [2025, 2024, 2023].map((fiscalYear, i) => ({
    fiscalYear,
    revenue: 1000 - 50 * i,
    ebitda: 200,
    netIncome: 100,
    eps: 2,
    sharesDiluted: 50,
    netDebt: 300,
    minorityInterest: 0,
    freeCashFlow: 90,
    sourceIds: { income: "ar", balance: "ar", cashFlow: "pr" },
  })),
};
const MARKET = {
  notes: "FY2021 not published.",
  sources: [{ id: "mult", url: MULT, title: "ORNT multiples", asOf: "2026-09", kind: "data_provider" }],
  multiples: [{ fiscalYear: 2025, evEbitda: 10, pe: 20, sourceId: "mult" }],
  peers: [],
};
const ESTIMATES = {
  notes: "No consensus for FY2027.",
  // The id the statements gave the results page: resolved against this part's own list.
  sources: [{ id: "ar", url: PR, title: "FY2025 results", asOf: "2026-02", kind: "press_release" }],
  estimates: [{ fiscalYear: 2026, revenue: 1100, sourceId: "ar" }],
};

const answer = (output: unknown) => `Research log.\n\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;

/** The statements' transcript: AR fetched, PR in a search result, MULT's fetch failed. */
const STATEMENTS_TRANSCRIPT: Anthropic.MessageParam[] = [
  { role: "user", content: "Research …" },
  {
    role: "assistant",
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "ornitorinco results" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: PR, title: "Results", encrypted_content: "e" }] },
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: AR } },
      {
        type: "web_fetch_tool_result",
        tool_use_id: "f1",
        content: { type: "web_fetch_result", url: AR, content: { type: "document", source: { type: "text", media_type: "text/plain", data: "…" } } },
      },
      { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: MULT } },
      { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
    ],
  } as Anthropic.MessageParam,
];
const NOTHING_OPENED: Anthropic.MessageParam[] = [{ role: "user", content: "Research …" }];

type RunOverrides = Partial<{ stopReason: string; hitIterationCap: boolean; servedBy: string | null; messages: Anthropic.MessageParam[] }>;
function runsOnce(text: string, overrides: RunOverrides = {}) {
  runStreamMock.mockResolvedValueOnce({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text, messages: NOTHING_OPENED, ...overrides });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const get = (runId: string) => new Request(`http://localhost/api/ai/research?runId=${runId}`);

const callOf = (n: number) => {
  const [, params, , maxIterations, options] = runStreamMock.mock.calls[n];
  return { params: params as Record<string, unknown> & { tools: Record<string, unknown>[]; system: string; messages: { content: string }[] }, maxIterations, options };
};

/** Starts a run and answers its statements. */
async function started(overrides: RunOverrides = { messages: STATEMENTS_TRANSCRIPT }) {
  runsOnce(answer(STATEMENTS), overrides);
  const res = await POST(post({ ticker: " ornt " }));
  return { res, json: await res.json() };
}

async function continued(runId: string, part: string, output?: unknown, overrides: RunOverrides = {}) {
  if (output !== undefined) runsOnce(answer(output), overrides);
  const res = await POST(post({ runId, part }));
  return { res, json: await res.json() };
}

beforeEach(() => {
  runStreamMock.mockReset();
  runRows = [];
  runSeq = 0;
  for (const fn of Object.values(researchRun)) fn.mockClear();
  session.user.id = "u1";
  userFindUnique.mockReset().mockResolvedValue({ aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinkingEnabled: true });
  getQuoteMock.mockReset().mockResolvedValue({ ticker: "ORNT", shortName: "Ornitorinco Industries", exchange: "NasdaqGS", currency: "USD", regularMarketPrice: 150 });
  // The route reads back what it stored: the mock store answers with the row just created.
  datasetCreate.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    datasetFindFirst.mockResolvedValue({ id: "ds-web", ...data });
    return { id: "ds-web" };
  });
  datasetFindFirst.mockReset().mockResolvedValue(null);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("DEEPSEEK_API_KEY", "ds-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai/research — the start runs the statements", () => {
  it("creates the run, runs the statements with their caps and answers the next part, without saving a dataset", async () => {
    const { res, json } = await started();
    expect(res.status).toBe(200);
    expect(json).toEqual({ runId: "run1", part: "statements", next: "market" });
    expect(datasetCreate).not.toHaveBeenCalled();
    expect(runRows[0]).toMatchObject({ userId: "u1", ticker: "ORNT", companyName: "Ornitorinco Industries", model: "claude-sonnet-5-5" });
    expect(JSON.parse(runRows[0].statementsJson as string)).toMatchObject({ status: "done", searches: 1, fetches: 2, seenUrls: expect.arrayContaining([AR, PR]) });

    const { params, maxIterations, options } = callOf(0);
    expect(maxIterations).toBe(16);
    expect(options).toEqual({ fetchBudget: 5 });
    expect(params).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 32000, thinking: { type: "adaptive" }, output_config: { effort: "high" }, cache_control: { type: "ephemeral" } });
    expect(params).not.toHaveProperty("temperature");
    expect(params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 10, allowed_callers: ["direct"] },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 40000, allowed_callers: ["direct"] },
    ]);
    expect(params.system).toContain("10 searches and 5 fetches in this step");
    // Position-blind: the prompt names the trading currency, never the price.
    expect(params.messages[0].content).toContain("Ornitorinco Industries (ORNT, listed on NasdaqGS; the share trades in USD)");
    expect(params.messages[0].content).not.toContain("150");
  });

  it("answers 502 'no financial data found' with the run, apart from a malformed block", async () => {
    runsOnce(answer({ ...STATEMENTS, financials: [{ fiscalYear: 2025, revenue: null, sourceIds: { income: null, balance: null, cashFlow: null } }] }));
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No financial data found", runId: "run1", part: "statements" });
    runsOnce("log\n```json\n{\"meta\": {\"reportingCurrency\": \n```");
    const malformed = await POST(post({ ticker: "ORNT" }));
    expect((await malformed.json()).error).toBe("Research returned an invalid dataset");
    expect(datasetCreate).not.toHaveBeenCalled();
  });

  it("answers and logs an error the model call throws, with the run and the part", async () => {
    // A stream that ends on an error event throws inside the loop: the page shows it, the log too.
    runStreamMock.mockRejectedValueOnce(new Error("prompt is too long"));
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "prompt is too long", runId: "run1", part: "statements" });
    expect(console.warn).toHaveBeenCalledWith("[research] ORNT statements error 400: prompt is too long");
  });

  it("answers 502 to an answer whose every source entry the preprocess drops", async () => {
    runsOnce(answer({ ...STATEMENTS, sources: STATEMENTS.sources.map((s) => ({ ...s, url: `/investors/${s.id}` })) }));
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Research returned an invalid dataset");
  });

  it("answers 502 with the run when the loop ran out of rounds or the answer was truncated, refused or stopped on a tool call", async () => {
    const cases: [RunOverrides, string][] = [
      [{ hitIterationCap: true }, "Research ran out of research rounds"],
      [{ stopReason: "max_tokens" }, "Research truncated: the length limit was reached"],
      [{ stopReason: "refusal" }, "Research refused by the model"],
      [{ stopReason: "tool_use" }, "Research stopped on a tool call: run it again"],
    ];
    for (const [overrides, error] of cases) {
      runsOnce(answer(STATEMENTS), overrides);
      const res = await POST(post({ ticker: "ORNT" }));
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error, runId: expect.any(String), part: "statements" });
    }
    expect(runRows.every((row) => row.statementsJson === null)).toBe(true);
  });

  it("answers 503 to a quote rate limit, 400 to an unknown ticker and 503 without the key, before any model call or run", async () => {
    getQuoteMock.mockRejectedValueOnce(new Error("Yahoo Finance rate limit reached"));
    expect((await POST(post({ ticker: "ORNT" }))).status).toBe(503);
    getQuoteMock.mockRejectedValueOnce(new Error("Ticker not found or unavailable on Yahoo Finance."));
    expect((await POST(post({ ticker: "ZZZZ" }))).status).toBe(400);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("research requires the Anthropic API key");
    expect(runStreamMock).not.toHaveBeenCalled();
    expect(runRows).toEqual([]);
  });

  it("refuses a body that mixes a start and a part, and a skip of the statements", async () => {
    expect((await POST(post({ ticker: "ORNT", runId: "run1", part: "market" }))).status).toBe(400);
    await started();
    // A run whose statements failed still expects them: they cannot be skipped.
    runRows[0].statementsJson = null;
    const skip = await POST(post({ runId: "run1", part: "statements", skip: true }));
    expect(skip.status).toBe(400);
    expect(await skip.json()).toMatchObject({ runId: "run1", part: "statements" });
    expect(runRows[0].statementsJson).toBeNull();
    expect(runStreamMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ai/research — the next parts", () => {
  it("runs the market part at high with thinking on, its own caps and the statements' declarations", async () => {
    await started();
    const { json } = await continued("run1", "market", MARKET);
    expect(json).toEqual({ runId: "run1", part: "market", next: "estimates" });
    const { params, maxIterations, options } = callOf(1);
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(maxIterations).toBe(12);
    expect(options).toEqual({ fetchBudget: 2 });
    expect(params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 9, allowed_callers: ["direct"] },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 40000, allowed_callers: ["direct"] },
    ]);
    expect(params.messages[0].content).toContain("report in USD, in millions, fiscal year end December, latest period FY2025, fiscal years 2023, 2024, 2025");
    expect(params.messages[0].content).not.toContain("150");
  });

  it("takes a market part that found nothing as done, with its note", async () => {
    await started();
    const { res, json } = await continued("run1", "market", { notes: "No provider publishes ORNT multiples.", sources: [], multiples: [], peers: [] });
    expect(res.status).toBe(200);
    expect(json.next).toBe("estimates");
    expect(JSON.parse(runRows[0].marketJson as string)).toMatchObject({ status: "done", output: { notes: "No provider publishes ORNT multiples.", multiples: [] } });
  });

  it("answers 409 with the expected part to a part out of order, without the model", async () => {
    await started();
    const res = await POST(post({ runId: "run1", part: "estimates" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "part out of order", runId: "run1", part: "estimates", next: "market" });
    expect(runStreamMock).toHaveBeenCalledTimes(1);
  });

  it("closes the run on the last part: saves the dataset with three parts, answers the result and deletes the run", async () => {
    await started();
    await continued("run1", "market", MARKET);
    const { res, json } = await continued("run1", "estimates", ESTIMATES);
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ runId: "run1", part: "estimates", next: null });
    expect(runRows).toEqual([]);

    // The estimates run under their own caps, the smallest of the three.
    const estimates = callOf(2);
    expect(estimates.maxIterations).toBe(8);
    expect(estimates.options).toEqual({ fetchBudget: 1 });
    expect(estimates.params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_callers: ["direct"] },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, max_content_tokens: 40000, allowed_callers: ["direct"] },
    ]);

    const { data } = datasetCreate.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "u1", ticker: "ORNT", origin: "web", currency: "USD", units: "millions", blocksJson: null });
    const research = JSON.parse(data.researchJson);
    expect(research).toMatchObject({
      model: "claude-sonnet-5-5",
      servedBy: null,
      effort: "high",
      searches: 1,
      fetches: 2,
      unverifiedSources: [MULT],
      notes: "Adjusted EBITDA. · FY2021 not published. · No consensus for FY2027.",
    });
    expect(research.parts.map((p: { part: string; status: string }) => `${p.part}:${p.status}`)).toEqual(["statements:done", "market:done", "estimates:done"]);
    expect(JSON.parse(data.warningsJson)).toEqual([{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: MULT }]);

    const result = json.result;
    expect(result.datasetId).toBe("ds-web");
    expect(result.dataset.financials.map((r: { fiscalYear: number }) => r.fiscalYear)).toEqual([2023, 2024, 2025]);
    expect(result.dataset.financials[2].sources.income).toMatchObject({ url: AR, verified: true });
    expect(result.dataset.multiples[0].source).toMatchObject({ url: MULT, verified: false });
    // The estimates' "ar" is their own list's results page, opened by the statements part.
    expect(result.dataset.estimates[0].source).toMatchObject({ url: PR, verified: true });
    expect(result.marketImplied).not.toBeNull();
  });

  it("closes without the market-implied read when the quote fails at the close", async () => {
    await started();
    await continued("run1", "market", MARKET);
    getQuoteMock.mockRejectedValueOnce(new Error("Yahoo Finance rate limit reached"));
    const { res, json } = await continued("run1", "estimates", ESTIMATES);
    expect(res.status).toBe(200);
    expect(json.result.marketImplied).toBeNull();
  });

  it("repeats only the close, with no model, after a close that failed once the third record was written", async () => {
    await started();
    await continued("run1", "market", MARKET);
    datasetCreate.mockRejectedValueOnce(new Error("database is locked"));
    const failed = await continued("run1", "estimates", ESTIMATES);
    expect(failed.res.status).toBe(400);
    expect(failed.json).toMatchObject({ error: "database is locked", runId: "run1", part: "estimates" });
    expect(console.warn).toHaveBeenCalledWith("[research] ORNT estimates error 400: database is locked");
    expect(runStreamMock).toHaveBeenCalledTimes(3);

    const again = await continued("run1", "estimates");
    expect(again.res.status).toBe(200);
    expect(again.json.result.datasetId).toBe("ds-web");
    expect(runStreamMock).toHaveBeenCalledTimes(3);
  });

  it("records a skipped estimates part without the model, and the dataset says the section was skipped", async () => {
    await started();
    await continued("run1", "market", MARKET);
    const res = await POST(post({ runId: "run1", part: "estimates", skip: true }));
    expect(res.status).toBe(200);
    expect(runStreamMock).toHaveBeenCalledTimes(2);
    const { data } = datasetCreate.mock.calls[0][0];
    expect(JSON.parse(data.warningsJson)).toContainEqual({ code: "research_part_skipped", severity: "info", fiscalYear: null, detail: "estimates" });
    expect(JSON.parse(data.researchJson).parts[2]).toEqual({ part: "estimates", status: "skipped", searches: 0, fetches: 0, durationMs: 0 });
    expect(JSON.parse(data.dataJson).estimates).toEqual([]);
  });

  it("answers the part's 502 with the run and the part", async () => {
    await started();
    runsOnce("no json here");
    const res = await POST(post({ runId: "run1", part: "market" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Research returned an invalid dataset", runId: "run1", part: "market" });
    expect(runRows[0].marketJson).toBeNull();
  });

  it("answers 404 when the run is gone by the time the part is written", async () => {
    await started();
    runStreamMock.mockImplementationOnce(async () => {
      runRows = [];
      return { stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: answer(MARKET), messages: NOTHING_OPENED };
    });
    const res = await POST(post({ runId: "run1", part: "market" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "research run not found", runId: "run1", part: "market" });
  });

  it("keeps the model that answered through the refusal fallback", async () => {
    await started({ messages: STATEMENTS_TRANSCRIPT, servedBy: "claude-sonnet-5" });
    await continued("run1", "market", MARKET);
    const { json } = await continued("run1", "estimates", ESTIMATES);
    expect(json.result.research).toMatchObject({ model: "claude-sonnet-5-5", servedBy: "claude-sonnet-5" });
  });
});

describe("/api/ai/research — a run is its user's", () => {
  it("serves the run to its user and answers 404 to another, without the model or a write, on POST and GET", async () => {
    await started();
    const own = await GET(get("run1"));
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ runId: "run1", next: "market" });

    session.user.id = "u2";
    const foreignPost = await POST(post({ runId: "run1", part: "market" }));
    expect(foreignPost.status).toBe(404);
    expect((await GET(get("run1"))).status).toBe(404);
    expect(runStreamMock).toHaveBeenCalledTimes(1);
    expect(researchRun.updateMany).toHaveBeenCalledTimes(1);
    expect(runRows[0].marketJson).toBeNull();

    session.user.id = "u1";
    expect((await continued("run1", "market", MARKET)).res.status).toBe(200);
  });

  it("reads the expected part with GET, null once the run has all three", async () => {
    await started();
    await continued("run1", "market", MARKET);
    runRows[0].estimatesJson = JSON.stringify({ status: "skipped" });
    expect(await (await GET(get("run1"))).json()).toEqual({ runId: "run1", next: null });
  });
});

describe("/api/ai/research — DeepSeek", () => {
  /** The client-executed tools leave tool_use / tool_result pairs: AR read by web_fetch, PR as
   *  a URL line of a search result. */
  const DEEPSEEK_TRANSCRIPT = [
    { role: "user", content: "Research …" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "web_search", input: { query: "ornitorinco results" } },
        { type: "tool_use", id: "t2", name: "web_fetch", input: { url: AR } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: `1. Results (2026-02-20)\n${PR}\nFY2025 revenue 1,000.` },
        { type: "tool_result", tool_use_id: "t2", content: "# Annual report 2025\n\n| Revenue | 1,000 |" },
      ],
    },
  ] as Anthropic.MessageParam[];

  it("runs the requested DeepSeek model with the two client tools, the part's fetch budget, and no cache_control", async () => {
    runsOnce(answer(STATEMENTS), { messages: DEEPSEEK_TRANSCRIPT });
    const res = await POST(post({ ticker: "ORNT", aiSettings: { model: "deepseek-v4-pro" } }));
    expect(res.status).toBe(200);
    await continued("run1", "market", MARKET);
    await continued("run1", "estimates", ESTIMATES);
    const first = callOf(0);
    expect(first.params.model).toBe("deepseek-v4-pro");
    expect(first.params.output_config).toEqual({ effort: "high" });
    expect(first.params).not.toHaveProperty("cache_control");
    // On DeepSeek no tool caps the searches: the part's rounds bound them, its fetchBudget the fetches.
    expect(first.maxIterations).toBe(16);
    expect(first.options).toEqual({ fetchBudget: 5 });
    expect(callOf(2).maxIterations).toBe(8);
    expect(callOf(2).options).toEqual({ fetchBudget: 1 });
    expect(first.params.tools.map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    for (const tool of first.params.tools) expect(tool).not.toHaveProperty("type");
    // The run keeps its model: the next part is DeepSeek too, with its own fetch budget.
    expect(callOf(1).params.model).toBe("deepseek-v4-pro");
    expect(callOf(1).maxIterations).toBe(12);
    expect(callOf(1).options).toEqual({ fetchBudget: 2 });
    const research = JSON.parse(datasetCreate.mock.calls[0][0].data.researchJson);
    expect(research.parts[0]).toMatchObject({ part: "statements", searches: 1, fetches: 1 });
  });

  it("answers 503 without the DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const res = await POST(post({ ticker: "ORNT", aiSettings: { model: "deepseek-v4-pro" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("research requires the DeepSeek API key");
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});
