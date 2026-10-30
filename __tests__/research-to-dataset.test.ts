import { describe, it, expect } from "vitest";

import { normalizeUrl, researchToDataset } from "@/lib/ai/research-to-dataset";
import { preprocessResearchOutput, researchOutputSchema, type ResearchOutput } from "@/lib/ai/research-schema";

// Invented, round figures on an invented company.
const AR = "https://ir.ornitorinco.example/annual-report-2025.pdf";
const PR = "https://ir.ornitorinco.example/results/fy2024";
const MULT = "https://data.example/ORNT/multiples";

function financials(fiscalYear: number, revenue: number, ids = { income: "ar", balance: "ar", cashFlow: "ar" }) {
  return { fiscalYear, revenue, ebitda: revenue / 5, netIncome: revenue / 10, netDebt: 300, freeCashFlow: 90, sourceIds: ids };
}

function output(overrides: Record<string, unknown> = {}): ResearchOutput {
  return researchOutputSchema.parse(
    preprocessResearchOutput({
      meta: { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: "Adjusted EBITDA." },
      sources: [
        { id: "ar", url: AR, title: "Annual report 2025", asOf: "2026-03", kind: "annual_report" },
        { id: "pr", url: PR, title: "FY2024 results", asOf: "2025-03", kind: "press_release" },
        { id: "mult", url: MULT, title: "ORNT multiples", asOf: "2026-09", kind: "data_provider" },
      ],
      financials: [financials(2025, 1080), financials(2024, 1000, { income: "pr", balance: "pr", cashFlow: "pr" }), financials(2023, 950)],
      multiples: [
        { fiscalYear: 2025, evEbitda: 10.5, pe: 21, sourceId: "mult" },
        { fiscalYear: 2024, evEbitda: 10, pe: 20, sourceId: "mult" },
      ],
      estimates: [{ fiscalYear: 2026, revenue: 1150, ebitda: 255, sourceId: "ar" }],
      peers: [{ ticker: " peer.mi ", companyName: "Peer SpA", multiples: [{ fiscalYear: 2025, evEbitda: 9, sourceId: "mult" }] }],
      ...overrides,
    })
  );
}

const SEEN = new Set([normalizeUrl(AR), normalizeUrl(PR)]);

describe("normalizeUrl", () => {
  it("keeps origin and path, drops query, fragment and trailing slash, lowercases the host", () => {
    expect(normalizeUrl("https://IR.Example.COM/Results/FY2025/?utm_source=x#top")).toBe("https://ir.example.com/Results/FY2025");
    expect(normalizeUrl("https://ir.example.com/")).toBe("https://ir.example.com");
  });
});

describe("researchToDataset", () => {
  it("marks a cited source the run never opened unverified, with a warning naming its URL, and keeps the row", () => {
    const { extract, unverified, warnings } = researchToDataset(output(), SEEN);
    expect(extract.multiples[1].source).toEqual({ kind: "web", url: MULT, title: "ORNT multiples", asOf: "2026-09", blockId: null, verified: false });
    expect(extract.multiples[1].evEbitda).toBe(10.5);
    expect(extract.financials[2].sources.income).toMatchObject({ url: AR, verified: true });
    expect(extract.financials[1].sources.balance).toMatchObject({ url: PR, verified: true });
    expect(unverified).toEqual([MULT]);
    expect(warnings.filter((w) => w.code === "source_unverified")).toEqual([{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: MULT }]);
  });

  it("leaves a source no row cites out of the unverified list, opened or not", () => {
    const spare = { id: "spare", url: "https://data.example/ORNT/spare", title: "Spare", asOf: null, kind: "other" };
    const parsed = output();
    const { unverified, warnings } = researchToDataset(output({ sources: [...parsed.sources, spare] }), SEEN);
    expect(unverified).toEqual([MULT]);
    expect(warnings.some((w) => w.detail === spare.url)).toBe(false);
  });

  it("gives a row citing an unknown id a null source and a warning", () => {
    const { extract, warnings } = researchToDataset(output({ estimates: [{ fiscalYear: 2026, revenue: 1150, sourceId: "ghost" }] }), SEEN);
    expect(extract.estimates[0].source).toBeNull();
    expect(warnings).toContainEqual({ code: "source_unknown_id", severity: "warn", fiscalYear: 2026, detail: "ghost" });
  });

  it("warns once for an unknown id a financials row cites on all three statements", () => {
    const { extract, warnings } = researchToDataset(output({ financials: [financials(2025, 1080, { income: "ghost", balance: "ghost", cashFlow: "ghost" })] }), SEEN);
    expect(extract.financials[0].sources.cashFlow).toBeNull();
    expect(warnings.filter((w) => w.code === "source_unknown_id")).toEqual([{ code: "source_unknown_id", severity: "warn", fiscalYear: 2025, detail: "ghost" }]);
  });

  it("keeps meta's currency and units in the extract and leaves the notes out of it", () => {
    const { extract } = researchToDataset(output(), SEEN);
    expect(extract.meta).toEqual({ reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" });
    expect(extract.meta).not.toHaveProperty("notes");
  });

  it("sorts every series by ascending fiscal year, whatever order the model wrote", () => {
    const { extract } = researchToDataset(output(), SEEN);
    expect(extract.financials.map((r) => r.fiscalYear)).toEqual([2023, 2024, 2025]);
    expect(extract.multiples.map((r) => r.fiscalYear)).toEqual([2024, 2025]);
    // The last element is the most recent year: what the anchors and gates read.
    expect(extract.financials.at(-1)?.revenue).toBe(1080);
  });

  it("fuses two rows of the same year field by field, with a conflict above 1%", () => {
    const { extract, warnings } = researchToDataset(
      output({ financials: [financials(2025, 1080), { fiscalYear: 2025, revenue: 1200, cfo: 180, sourceIds: { income: "ar", balance: null, cashFlow: "pr" } }] }),
      SEEN
    );
    expect(extract.financials).toHaveLength(1);
    expect(extract.financials[0].revenue).toBe(1080);
    expect(extract.financials[0].cfo).toBe(180);
    // The cash flow statement got a field from another page: the chip says +1.
    expect(extract.financials[0].sources.mixed.cashFlow).toBe(true);
    expect(warnings).toContainEqual({ code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1080 (web) vs 1200 (web)" });
  });

  it("drops a source with a relative URL in the preprocess, so its rows read as an unknown id instead of failing", () => {
    const parsed = output({
      sources: [{ id: "ar", url: "/investors/annual-report-2025.pdf", title: "AR", asOf: null, kind: "annual_report" }, { id: "pr", url: PR, title: "PR", asOf: null, kind: "press_release" }],
      multiples: [],
      estimates: [],
      peers: [],
    });
    const { extract, warnings } = researchToDataset(parsed, SEEN);
    expect(extract.financials[0].sources.income).toBeNull();
    expect(warnings.filter((w) => w.code === "source_unknown_id").length).toBeGreaterThan(0);
  });

  it("normalizes the peers' tickers", () => {
    const { extract } = researchToDataset(output(), SEEN);
    expect(extract.peers.map((p) => p.ticker)).toEqual(["PEER.MI"]);
  });

  it("computes a missing EBITDA as EBIT + D&A, names the years, and marks the income statement +1 when D&A comes from another page", () => {
    const { extract, warnings } = researchToDataset(
      output({
        financials: [
          { fiscalYear: 2025, revenue: 1080, ebit: 165, depreciationAmortization: -75.5, sourceIds: { income: "ar", balance: "ar", cashFlow: "pr" } },
          { fiscalYear: 2024, revenue: 1000, ebit: 150, depreciationAmortization: 70, sourceIds: { income: "ar", balance: "ar", cashFlow: "ar" } },
          // A published EBITDA is kept as published; without D&A nothing is computed.
          { fiscalYear: 2023, revenue: 950, ebitda: 210, ebit: 140, depreciationAmortization: 65, sourceIds: { income: "ar", balance: null, cashFlow: "ar" } },
          { fiscalYear: 2022, revenue: 900, ebit: 130, sourceIds: { income: "ar", balance: null, cashFlow: null } },
        ],
      }),
      SEEN
    );
    expect(extract.financials.map((r) => [r.fiscalYear, r.ebitda])).toEqual([
      [2022, null],
      [2023, 210],
      [2024, 220],
      [2025, 240.5],
    ]);
    expect(warnings).toContainEqual({ code: "ebitda_derived", severity: "info", fiscalYear: null, detail: "2024, 2025" });
    // The D&A the page printed as a cost line is stored as the positive amount the type holds.
    expect(extract.financials[3].depreciationAmortization).toBe(75.5);
    expect(extract.financials[3].sources.mixed.income).toBe(true);
    expect(extract.financials[2].sources.mixed.income).toBe(false);
  });
});

