// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ANALYSIS_SUMMARY_SELECT } from "@/lib/analyses-select";

const positionFindMany = vi.fn();
const analysisFindMany = vi.fn();
const watchlistFindMany = vi.fn();
const earningsFindMany = vi.fn();
const getQuoteMock = vi.fn();
const runStreamMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    position: { findMany: (...args: unknown[]) => positionFindMany(...args) },
    analysis: { findMany: (...args: unknown[]) => analysisFindMany(...args) },
    watchlistItem: { findMany: (...args: unknown[]) => watchlistFindMany(...args) },
    earningsEstimate: { findMany: (...args: unknown[]) => earningsFindMany(...args) },
    user: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: (...args: unknown[]) => getQuoteMock(...args) }));
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  // The real constructor throws without an API key.
  getAiClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/ai-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/ai-preferences")>()),
  resolveAiSettings: vi.fn(async () => ({ model: "claude-sonnet-5-5", effort: "high", thinking: true })),
}));
vi.mock("@/lib/ai/tool-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-loop")>()),
  runStreamWithToolLoop: (...args: unknown[]) => runStreamMock(...args),
}));

import { POST } from "@/app/api/ai/advisor/route";

// Round, invented figures: buy targets 60/80/100 at MoS 20% (fair values 75/100/125).
const row = (ticker: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${ticker}`,
  ticker,
  companyName: `${ticker} Co`,
  mosPercent: 20,
  currency: "USD",
  valuationMethod: "DCF",
  fairValueBear: 60,
  fairValueBase: 80,
  fairValueBull: 100,
  runStatus: "done",
  runStartedAt: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  ...overrides,
});
const lot = (ticker: string) => ({ ticker, companyName: `${ticker} Co`, shares: 10, purchasePrice: 50, currency: "USD", purchasedAt: new Date("2026-01-01T00:00:00.000Z") });
const quote = (ticker: string, price: number) => ({ ticker, regularMarketPrice: price, currency: "USD", regularMarketChangePercent: 0 });

/** Runs a portfolio-mode request and returns the system prompt the model was given. */
async function systemPromptOf(body: Record<string, unknown> = {}): Promise<string> {
  const res = await POST(
    new Request("http://localhost/api/ai/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }], ...body }),
    })
  );
  await res.text();
  return runStreamMock.mock.calls.at(-1)![1].system as string;
}

const summaryLines = (prompt: string) =>
  prompt.split("TICKER SUMMARIES (deterministic, from saved analyses):\n")[1].split("\nHow to read a line:")[0].split("\n");

describe("POST /api/ai/advisor — per-ticker summaries", () => {
  beforeEach(() => {
    positionFindMany.mockReset().mockResolvedValue([lot("HELD")]);
    analysisFindMany.mockReset().mockResolvedValue([row("HELD"), row("SEEN")]);
    watchlistFindMany.mockReset().mockResolvedValue([]);
    earningsFindMany.mockReset().mockResolvedValue([]);
    getQuoteMock.mockReset().mockImplementation(async (ticker: string) => quote(ticker, 85));
    runStreamMock.mockReset().mockResolvedValue({ stopReason: "end_turn", hitIterationCap: false, servedBy: null, text: "" });
  });

  it("should quote a held ticker and an analysed-only one, and give both a verdict", async () => {
    const lines = summaryLines(await systemPromptOf());

    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith("- "))).toBe(true);
    expect(getQuoteMock.mock.calls.map((c) => c[0]).sort()).toEqual(["HELD", "SEEN"]);
    expect(lines.find((l) => l.startsWith("- HELD ["))).toContain("verdict WATCH (analysis)");
    expect(lines.find((l) => l.startsWith("- HELD ["))).toContain("held 10 sh @ 50.00 (+70.0%)");
    expect(lines.find((l) => l.startsWith("- SEEN ["))).toContain("verdict WATCH (analysis)");
  });

  it("should weigh a ticker on the quote asked for it, even when Yahoo answers with another symbol", async () => {
    getQuoteMock.mockImplementation(async (ticker: string) => quote(`${ticker}.X`, 85));

    const prompt = await systemPromptOf();
    const held = summaryLines(prompt).find((l) => l.startsWith("- HELD ["))!;

    expect(held).toContain("price 85.00 USD");
    expect(held).toContain("verdict WATCH (analysis)");
    expect(prompt).not.toContain("HELD.X");
  });

  it("should leave the verdict out for a ticker whose quote failed, and keep the other", async () => {
    getQuoteMock.mockImplementation(async (ticker: string) => {
      if (ticker === "SEEN") throw new Error("Yahoo Finance rate limit reached.");
      return quote(ticker, 85);
    });

    const lines = summaryLines(await systemPromptOf());

    expect(lines.find((l) => l.startsWith("- SEEN ["))).not.toContain("verdict");
    expect(lines.find((l) => l.startsWith("- HELD ["))).toContain("verdict");
  });

  it("should read finished analyses without the text blobs, and watchlist and earnings in one query each", async () => {
    watchlistFindMany.mockResolvedValue([{ ticker: "SEEN", mosPercent: 0.25 }]);
    earningsFindMany.mockResolvedValue([
      { ticker: "SEEN", nextEarningsDate: new Date("2099-01-15T00:00:00.000Z"), confidence: "confirmed", fetchedAt: new Date("2026-03-02T00:00:00.000Z") },
    ]);

    const lines = summaryLines(await systemPromptOf());

    expect(analysisFindMany.mock.calls[0][0].where).toEqual({ userId: "u1", runStatus: "done" });
    expect(analysisFindMany.mock.calls[0][0].select).toBe(ANALYSIS_SUMMARY_SELECT);
    expect(watchlistFindMany).toHaveBeenCalledTimes(1);
    expect(watchlistFindMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(earningsFindMany).toHaveBeenCalledTimes(1);
    expect(earningsFindMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    const seen = lines.find((l) => l.startsWith("- SEEN ["))!;
    // Fair value 100 discounted by the item's own 25%.
    expect(seen).toContain("watchlist target 75.00");
    expect(seen).toContain("next earnings 2099-01-15 (confirmed)");
  });

  it("should give a held ticker with no analysis a «no valuation» line, and still quote it", async () => {
    analysisFindMany.mockResolvedValue([row("SEEN")]);

    const lines = summaryLines(await systemPromptOf());

    expect(lines).toContain("- HELD [no valuation, 0 analyses] · held 10 sh @ 50.00 (+70.0%)");
    expect(getQuoteMock.mock.calls.map((c) => c[0]).sort()).toEqual(["HELD", "SEEN"]);
  });

  it("should not quote a ticker whose only analysis has no values", async () => {
    analysisFindMany.mockResolvedValue([row("BLANK", { fairValueBear: null, fairValueBase: null, fairValueBull: null })]);
    positionFindMany.mockResolvedValue([]);

    const lines = summaryLines(await systemPromptOf());

    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(lines).toEqual(["- BLANK [no valuation, 1 analysis]"]);
  });

  it("should read nothing from the database in discovery mode", async () => {
    await systemPromptOf({ mode: "discovery" });

    expect(positionFindMany).not.toHaveBeenCalled();
    expect(analysisFindMany).not.toHaveBeenCalled();
    expect(watchlistFindMany).not.toHaveBeenCalled();
    expect(earningsFindMany).not.toHaveBeenCalled();
    expect(getQuoteMock).not.toHaveBeenCalled();
  });
});
