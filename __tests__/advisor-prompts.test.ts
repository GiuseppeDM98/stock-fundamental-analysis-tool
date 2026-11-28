import { describe, it, expect } from "vitest";
import { buildAdvisorSystemPrompt } from "@/lib/ai/advisor-prompts";
import { buildTickerSummary } from "@/lib/stocks/ticker-summary";
import type { SavedAnalysis } from "@/types/analysis";

// Round, invented figures: buy targets 60/80/100 at MoS 20%, a Skeptic at 44/64/84.
function analysis(ticker: string, overrides: Partial<SavedAnalysis> = {}): SavedAnalysis {
  return {
    id: `id-${ticker}`,
    ticker,
    companyName: `${ticker} Co`,
    reportMd: "",
    mosPercent: 20,
    currency: "USD",
    valuationMethod: "DCF",
    fairValueBear: 60,
    fairValueBase: 80,
    fairValueBull: 100,
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

const summary = (ticker: string, analyses: SavedAnalysis[]) =>
  buildTickerSummary({
    ticker,
    analyses,
    price: 85,
    currency: "USD",
    positions: [],
    positionCurrency: null,
    watchlistItem: { mosPercent: 0.25 },
    earnings: null,
    dividendsReceivedEur: null,
  });

const context = (summaries: ReturnType<typeof summary>[]) => ({
  positions: [],
  summaries,
  livePrices: [],
  currentDate: "March 2, 2026",
  language: "English",
});

/** The lines of the summaries block: what sits between its heading and the reading note. */
function summaryLines(prompt: string): string[] {
  const block = prompt.split("TICKER SUMMARIES (deterministic, from saved analyses):\n")[1].split("\nHow to read a line:")[0];
  return block.split("\n");
}

describe("buildAdvisorSystemPrompt — ticker summaries", () => {
  it("should render one line per ticker, with consensus, verdict, signal and watchlist target", () => {
    const withLens = analysis("AAA", { reviewFairValueBear: 44, reviewFairValueBase: 64, reviewFairValueBull: 84 });
    const older = analysis("AAA", { id: "older", createdAt: "2026-01-01T00:00:00.000Z" });

    const prompt = buildAdvisorSystemPrompt(context([summary("AAA", [withLens, older]), summary("BBB", [analysis("BBB")])]));

    const lines = summaryLines(prompt);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- AAA \[DCF, 2 analyses, /);
    expect(lines[0]).toContain("consensus base 90.00 (1 lens)");
    expect(lines[0]).toContain("verdict WATCH (consensus)");
    expect(lines[0]).toContain("signal ");
    expect(lines[0]).toContain("watchlist target 67.50");
    // No lens ran on BBB: its verdict stands on the analysis alone, and no consensus is named.
    expect(lines[1]).toMatch(/^- BBB \[DCF, 1 analysis, /);
    // 85 between its own buy target (80) and fair value (100).
    expect(lines[1]).toContain("verdict WATCH (analysis)");
    expect(lines[1]).not.toContain("consensus base");
  });

  it("should say there is no saved analysis when there is no summary", () => {
    const prompt = buildAdvisorSystemPrompt(context([]));

    expect(summaryLines(prompt)).toEqual(["  (no saved analyses yet)"]);
  });

  it("should carry no report text and no raw per-analysis history", () => {
    const prompt = buildAdvisorSystemPrompt(context([summary("AAA", [analysis("AAA", { reportMd: "decoy-report-body" })])]));

    expect(prompt).not.toContain("decoy-report-body");
    expect(prompt).not.toContain("PREVIOUSLY SAVED DEEP VALUE ANALYSES");
    expect(prompt).not.toContain("price at analysis");
  });
});
