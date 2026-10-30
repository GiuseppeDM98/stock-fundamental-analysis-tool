// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

const runStreamMock = vi.fn();
const userFindUnique = vi.fn();
const datasetCreate = vi.fn();
const datasetFindFirst = vi.fn();
const getQuoteMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    financialDataset: {
      create: (...args: unknown[]) => datasetCreate(...args),
      findFirst: (...args: unknown[]) => datasetFindFirst(...args),
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

import { POST } from "@/app/api/ai/research/route";
import { DEEP_RESEARCH_MAX_TOOL_ITERATIONS } from "@/lib/ai/tool-loop";

// Invented, round figures on an invented company.
const AR = "https://ir.ornitorinco.example/annual-report-2025.pdf";
const PR = "https://ir.ornitorinco.example/results/fy2025";
const MULT = "https://data.example/ORNT/multiples";

const OUTPUT = {
  meta: { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: "Adjusted EBITDA." },
  sources: [
    { id: "ar", url: AR, title: "Annual report 2025", asOf: "2026-03", kind: "annual_report" },
    { id: "pr", url: PR, title: "FY2025 results", asOf: "2026-02", kind: "press_release" },
    { id: "mult", url: MULT, title: "ORNT multiples", asOf: "2026-09", kind: "data_provider" },
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
  multiples: [{ fiscalYear: 2025, evEbitda: 10, pe: 20, sourceId: "mult" }],
  estimates: [],
  peers: [],
};

const answer = (output: unknown = OUTPUT) => `Research log: fetched the annual report.\n\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;

/** The transcript the native tools leave: AR fetched, PR in a search result, MULT never
 *  opened; an error block that adds nothing. */
const CLAUDE_TRANSCRIPT: Anthropic.MessageParam[] = [
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

function runs(text: string, overrides: Partial<{ stopReason: string; hitIterationCap: boolean; messages: Anthropic.MessageParam[] }> = {}) {
  runStreamMock.mockResolvedValue({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text, messages: CLAUDE_TRANSCRIPT, ...overrides });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const sent = () => runStreamMock.mock.calls[0][1] as Record<string, unknown> & { tools: Record<string, unknown>[] };

beforeEach(() => {
  runStreamMock.mockReset();
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai/research — Claude", () => {
  it("saves a web dataset with its ResearchMeta, the cited URL never opened unverified", async () => {
    runs(answer());
    const res = await POST(post({ ticker: " ornt " }));
    expect(res.status).toBe(200);
    const json = await res.json();

    const { data } = datasetCreate.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "u1", ticker: "ORNT", origin: "web", currency: "USD", units: "millions", blocksJson: null });
    expect(JSON.parse(data.researchJson)).toEqual({
      model: "claude-sonnet-5-5",
      effort: "high",
      searches: 1,
      fetches: 2,
      durationMs: expect.any(Number),
      unverifiedSources: [MULT],
      notes: "Adjusted EBITDA.",
    });
    expect(JSON.parse(data.warningsJson)).toEqual([{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: MULT }]);

    expect(json.datasetId).toBe("ds-web");
    expect(json.research.model).toBe("claude-sonnet-5-5");
    expect(json.dataset.datasetMeta).toMatchObject({ ticker: "ORNT", origin: "web" });
    expect(json.dataset.financials.map((r: { fiscalYear: number }) => r.fiscalYear)).toEqual([2023, 2024, 2025]);
    const latest = json.dataset.financials[2];
    expect(latest.sources.income).toMatchObject({ kind: "web", url: AR, verified: true });
    expect(latest.sources.cashFlow).toMatchObject({ url: PR, verified: true });
    expect(json.dataset.multiples[0].source).toMatchObject({ url: MULT, verified: false });
    expect(json.warnings.map((w: { code: string }) => w.code)).toContain("source_unverified");
    expect(json.basis).toBeDefined();
    expect(json).toHaveProperty("marketImplied");
  });

  it("runs Sonnet 5.5 at high with the native tools, the cache, the deep-research cap and a fetch budget of 8", async () => {
    runs(answer());
    await POST(post({ ticker: "ORNT" }));
    const [, params, , maxIterations, options] = runStreamMock.mock.calls[0];
    expect(maxIterations).toBe(DEEP_RESEARCH_MAX_TOOL_ITERATIONS);
    expect(options).toEqual({ fetchBudget: 8 });
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      cache_control: { type: "ephemeral" },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("tool_choice");
    expect(sent().tools.map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    // Position-blind: the prompt names the trading currency, never the price.
    const userPrompt = (params as { messages: { content: string }[] }).messages[0].content;
    expect(userPrompt).toContain("Ornitorinco Industries (ORNT, listed on NasdaqGS; the share trades in USD)");
    expect(userPrompt).not.toContain("150");
  });

  it("answers 502 to a malformed JSON block, without saving", async () => {
    runs("log\n```json\n{\"meta\": {\"reportingCurrency\": \n```");
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Research returned an invalid dataset");
    expect(datasetCreate).not.toHaveBeenCalled();
  });

  it("answers 502 'no financial data found' to an answer with no financial figure, apart from a malformed one", async () => {
    runs(answer({ ...OUTPUT, financials: [{ fiscalYear: 2025, revenue: null, sourceIds: { income: null, balance: null, cashFlow: null } }] }));
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("No financial data found");
    expect(datasetCreate).not.toHaveBeenCalled();
  });

  it("answers 502 when the loop ran out of rounds or the answer was truncated or refused", async () => {
    runs(answer(), { hitIterationCap: true });
    expect((await (await POST(post({ ticker: "ORNT" }))).json()).error).toContain("ran out of research rounds");
    runs(answer(), { stopReason: "max_tokens" });
    const truncated = await POST(post({ ticker: "ORNT" }));
    expect(truncated.status).toBe(502);
    expect((await truncated.json()).error).toContain("truncated");
    runs("", { stopReason: "refusal" });
    expect((await (await POST(post({ ticker: "ORNT" }))).json()).error).toContain("refused");
    // A turn that ends on a tool call the loop cannot answer is a failure to retry.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    runs("log only", { stopReason: "tool_use" });
    const stopped = await POST(post({ ticker: "ORNT" }));
    expect(stopped.status).toBe(502);
    expect((await stopped.json()).error).toBe("Research stopped on a tool call: run it again");
    expect(datasetCreate).not.toHaveBeenCalled();
  });

  it("answers 503 to a quote rate limit and 400 to an unknown ticker, before any model call", async () => {
    getQuoteMock.mockRejectedValueOnce(new Error("Yahoo Finance rate limit reached"));
    expect((await POST(post({ ticker: "ORNT" }))).status).toBe(503);
    getQuoteMock.mockRejectedValueOnce(new Error("Ticker not found or unavailable on Yahoo Finance."));
    expect((await POST(post({ ticker: "ZZZZ" }))).status).toBe(400);
    expect(runStreamMock).not.toHaveBeenCalled();
  });

  it("answers 503 without the Anthropic key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(post({ ticker: "ORNT" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("research requires the Anthropic API key");
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/research — DeepSeek", () => {
  /** The client-executed tools leave tool_use / tool_result pairs: AR read by web_fetch, PR
   *  as a URL line of a search result, MULT's fetch failed. */
  const DEEPSEEK_TRANSCRIPT = [
    { role: "user", content: "Research …" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "web_search", input: { query: "ornitorinco results" } },
        { type: "tool_use", id: "t2", name: "web_fetch", input: { url: AR } },
        { type: "tool_use", id: "t3", name: "web_fetch", input: { url: MULT } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: `1. Results (2026-02-20)\n${PR}\nFY2025 revenue 1,000.` },
        { type: "tool_result", tool_use_id: "t2", content: "# Annual report 2025\n\n| Revenue | 1,000 |" },
        { type: "tool_result", tool_use_id: "t3", content: "FETCH FAILED (HTTP 403): rejected by the site's policy." },
      ],
    },
  ] as Anthropic.MessageParam[];

  it("runs the requested DeepSeek model with the two client tools, no cache_control, and verifies the sources from the tool results", async () => {
    runs(answer(), { messages: DEEPSEEK_TRANSCRIPT });
    const res = await POST(post({ ticker: "ORNT", aiSettings: { model: "deepseek-v4-pro" } }));
    expect(res.status).toBe(200);
    const json = await res.json();

    const [, params, , , options] = runStreamMock.mock.calls[0];
    expect(params.model).toBe("deepseek-v4-pro");
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params).not.toHaveProperty("cache_control");
    expect(options).toEqual({ fetchBudget: 8 });
    const tools = sent().tools;
    expect(tools.map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    for (const tool of tools) expect(tool).not.toHaveProperty("type");

    expect(json.research).toMatchObject({ model: "deepseek-v4-pro", effort: "high", searches: 1, fetches: 2, unverifiedSources: [MULT] });
    const latest = json.dataset.financials[2];
    expect(latest.sources.income).toMatchObject({ url: AR, verified: true });
    expect(latest.sources.cashFlow).toMatchObject({ url: PR, verified: true });
    expect(json.dataset.multiples[0].source).toMatchObject({ url: MULT, verified: false });
  });

  it("answers 503 without the DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const res = await POST(post({ ticker: "ORNT", aiSettings: { model: "deepseek-v4-pro" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("research requires the DeepSeek API key");
    expect(runStreamMock).not.toHaveBeenCalled();
  });
});
