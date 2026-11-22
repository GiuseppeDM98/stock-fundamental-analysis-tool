import { describe, it, expect } from "vitest";

import { combineResearchParts, nextResearchPart, researchPartsSummary, type ResearchPartRecords } from "@/lib/ai/research-parts";
import { normalizeUrl } from "@/lib/ai/research-to-dataset";
import type { EstimatesPartOutput, MarketPartOutput, StatementsPartOutput } from "@/lib/ai/research-schema";

// Invented, round figures on an invented company. Two parts call two different pages "pr25":
// each row must keep the page its own part meant.
const STATEMENTS_PAGE = "https://ir.ornitorinco.example/results/fy2025";
const MULTIPLES_PAGE = "https://data.ornitorinco.example/multiples";
const ESTIMATES_PAGE = "https://consensus.ornitorinco.example/ornt";
const UNOPENED = "https://unopened.ornitorinco.example/page";

const source = (id: string, url: string) => ({ id, url, title: id, asOf: "2026", kind: "press_release" as const });

const STATEMENTS: StatementsPartOutput = {
  meta: { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: "Adjusted EBITDA." },
  sources: [source("pr25", STATEMENTS_PAGE), source("u", UNOPENED)],
  financials: [
    {
      fiscalYear: 2025,
      revenue: 1000,
      ebitda: 200,
      ebit: 150,
      netIncome: 100,
      eps: 2,
      sharesDiluted: 50,
      dividendsPerShare: null,
      totalEquity: 600,
      minorityInterest: null,
      totalDebt: null,
      cashAndEquivalents: null,
      netDebt: 300,
      cfo: null,
      capex: null,
      depreciationAmortization: null,
      freeCashFlow: 90,
      sourceIds: { income: "pr25", balance: "pr25", cashFlow: "u" },
    },
  ],
};

const MARKET: MarketPartOutput = {
  notes: "FY2021 not published.",
  // The statements' page, opened by the statements part only, is cited here under another id.
  sources: [source("pr25", MULTIPLES_PAGE), source("ir", STATEMENTS_PAGE), source("u", UNOPENED)],
  multiples: [
    { fiscalYear: 2025, evEbitda: 10, evSales: null, pe: 20, pb: null, fcfYield: null, dividendYield: null, marketCap: null, enterpriseValue: null, sourceId: "pr25" },
    { fiscalYear: 2024, evEbitda: 9, evSales: null, pe: 18, pb: null, fcfYield: null, dividendYield: null, marketCap: null, enterpriseValue: null, sourceId: "ir" },
    { fiscalYear: 2023, evEbitda: 8, evSales: null, pe: 16, pb: null, fcfYield: null, dividendYield: null, marketCap: null, enterpriseValue: null, sourceId: "u" },
  ],
  peers: [],
};

const ESTIMATES: EstimatesPartOutput = {
  notes: "No consensus for FY2027.",
  sources: [source("pr25", ESTIMATES_PAGE)],
  estimates: [{ fiscalYear: 2026, revenue: 1100, ebitda: 220, ebit: null, netIncome: null, eps: null, sourceId: "pr25" }],
};

const done = <T>(output: T, seenUrls: string[], searches: number, fetches: number, durationMs = 1000, servedBy: string | null = null) => ({
  status: "done" as const,
  output,
  seenUrls: seenUrls.map(normalizeUrl),
  searches,
  fetches,
  durationMs,
  servedBy,
});

const RECORDS: ResearchPartRecords = {
  statements: done(STATEMENTS, [STATEMENTS_PAGE], 3, 2, 60000),
  market: done(MARKET, [MULTIPLES_PAGE], 4, 1, 40000),
  estimates: done(ESTIMATES, [ESTIMATES_PAGE], 2, 0, 20000),
};

describe("nextResearchPart", () => {
  it("is the first part without a record, and null once all three have one", () => {
    expect(nextResearchPart({ statements: null, market: null, estimates: null })).toBe("statements");
    expect(nextResearchPart({ ...RECORDS, market: null, estimates: null })).toBe("market");
    expect(nextResearchPart({ ...RECORDS, market: { status: "skipped" }, estimates: null })).toBe("estimates");
    expect(nextResearchPart(RECORDS)).toBeNull();
  });
});

describe("combineResearchParts", () => {
  it("resolves each part against its own sources: two pages both called pr25 keep their rows apart", () => {
    const { extract } = combineResearchParts(RECORDS);
    expect(extract.financials[0].sources.income?.url).toBe(STATEMENTS_PAGE);
    expect(extract.multiples.find((m) => m.fiscalYear === 2025)?.source?.url).toBe(MULTIPLES_PAGE);
    expect(extract.estimates[0].source?.url).toBe(ESTIMATES_PAGE);
    expect(extract.meta).toEqual({ reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" });
  });

  it("verifies a source against the URLs any part opened", () => {
    const { extract } = combineResearchParts(RECORDS);
    // Opened by the statements part only, cited by the multiples part.
    expect(extract.multiples.find((m) => m.fiscalYear === 2024)?.source).toMatchObject({ url: STATEMENTS_PAGE, verified: true });
  });

  it("warns once about an unopened URL two parts both cite", () => {
    const { warnings, unverified } = combineResearchParts(RECORDS);
    expect(warnings.filter((w) => w.code === "source_unverified")).toEqual([{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: UNOPENED }]);
    expect(unverified).toEqual([UNOPENED]);
  });

  it("leaves a skipped part's sections empty and names it", () => {
    const combined = combineResearchParts({ ...RECORDS, estimates: { status: "skipped" } });
    expect(combined.extract.estimates).toEqual([]);
    expect(combined.extract.multiples).toHaveLength(3);
    expect(combined.skipped).toEqual(["estimates"]);
  });

  it("throws without the statements", () => {
    expect(() => combineResearchParts({ statements: null, market: RECORDS.market, estimates: null })).toThrow();
  });
});

describe("researchPartsSummary", () => {
  it("sums the parts, one line each, and joins their notes", () => {
    const summary = researchPartsSummary(RECORDS);
    expect(summary).toMatchObject({ searches: 9, fetches: 3, durationMs: 120000, servedBy: null });
    expect(summary.notes).toBe("Adjusted EBITDA. · FY2021 not published. · No consensus for FY2027.");
    expect(summary.parts.map((p) => `${p.part}:${p.status}:${p.searches}`)).toEqual(["statements:done:3", "market:done:4", "estimates:done:2"]);
  });

  it("counts a skipped part as nothing run, and names the model of the fallback when a part had one", () => {
    const summary = researchPartsSummary({ ...RECORDS, market: done(MARKET, [], 4, 1, 40000, "claude-sonnet-5"), estimates: { status: "skipped" } });
    expect(summary.parts[2]).toEqual({ part: "estimates", status: "skipped", searches: 0, fetches: 0, durationMs: 0 });
    expect(summary).toMatchObject({ searches: 7, fetches: 3, servedBy: "claude-sonnet-5" });
    expect(summary.notes).toBe("Adjusted EBITDA. · FY2021 not published.");
  });
});
