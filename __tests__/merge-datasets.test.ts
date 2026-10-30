import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { mergeDatasets } from "@/lib/datasets/merge-sources";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources, type DataSource, type DatasetMeta, type FinancialDataset } from "@/types/dataset";
import { makeEstimateRow, makeExtract, makeFinancialsRow, makeMeta, makeMultiplesRow } from "./grounding-test-helpers";

// Invented, round figures.
const WEB: DataSource = { kind: "web", url: "https://ir.ornitorinco.example/ar-2025.pdf", title: "Annual report 2025", asOf: "2026-03", blockId: null, verified: true };
const NOW = new Date("2026-10-30T10:00:00Z");

function meta(origin: DatasetMeta["origin"]): DatasetMeta {
  return { ticker: "ORNT", createdAt: "2026-10-29T09:00:00.000Z", origin, pasteDatasetId: null, webDatasetId: null };
}

/** A paste with the FY2025 income statement only (revenue + EBITDA), in millions. */
function paste(overrides: Partial<FinancialDataset> = {}): FinancialDataset {
  return {
    ...makeExtract({
      meta: makeMeta({ reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025" }),
      financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, ebitda: 200, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, pe: 20, source: pasteSource("blk-2") })],
      peers: [{ ticker: "PEER", companyName: "Peer (paste)", multiples: [makeMultiplesRow({ fiscalYear: 2025, pe: 15, source: pasteSource("blk-3") })] }],
    }),
    datasetMeta: meta("paste"),
    ...overrides,
  };
}

/** The web research: income, balance and cash flow for FY2024-2025, in millions. */
function web(overrides: Partial<FinancialDataset> = {}): FinancialDataset {
  const row = (fiscalYear: number, revenue: number) =>
    makeFinancialsRow({
      fiscalYear,
      revenue,
      ebitda: 200,
      eps: 2,
      netDebt: 300,
      sharesDiluted: 50,
      freeCashFlow: 90,
      sources: { ...emptyRowSources(), income: { ...WEB }, balance: { ...WEB }, cashFlow: { ...WEB } },
    });
  return {
    ...makeExtract({
      meta: makeMeta({ reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025" }),
      financials: [row(2024, 950), row(2025, 1080)],
      multiples: [makeMultiplesRow({ fiscalYear: 2024, pe: 19, source: { ...WEB } }), makeMultiplesRow({ fiscalYear: 2025, pe: 21, source: { ...WEB } })],
      estimates: [makeEstimateRow({ fiscalYear: 2026, revenue: 1150, source: { ...WEB } })],
      peers: [
        { ticker: "peer", companyName: "Peer (web)", multiples: [makeMultiplesRow({ fiscalYear: 2024, pe: 14, source: { ...WEB } }), makeMultiplesRow({ fiscalYear: 2025, pe: 16, source: { ...WEB } })] },
        { ticker: "OTHR", companyName: "Other", multiples: [makeMultiplesRow({ fiscalYear: 2025, pe: 12, source: { ...WEB } })] },
      ],
    }),
    datasetMeta: meta("web"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("mergeDatasets", () => {
  it("takes a whole statement from the paste when it has any figure of it", () => {
    const { dataset } = mergeDatasets(paste(), web());
    const fy2025 = dataset.financials.find((r) => r.fiscalYear === 2025)!;
    expect(fy2025.revenue).toBe(1000);
    // The paste had no EPS or shares: the income statement is still the paste's, whole.
    expect(fy2025.eps).toBeNull();
    expect(fy2025.sharesDiluted).toBeNull();
    expect(fy2025.sources.income).toEqual(pasteSource("blk-1"));
    expect(fy2025.sources.mixed).toEqual({ income: false, balance: false, cashFlow: false });
  });

  it("fills a statement or a year the paste lacks from the web, with the web's source", () => {
    const { dataset } = mergeDatasets(paste(), web());
    const fy2025 = dataset.financials.find((r) => r.fiscalYear === 2025)!;
    expect(fy2025.netDebt).toBe(300);
    expect(fy2025.sources.balance).toEqual(WEB);
    expect(fy2025.freeCashFlow).toBe(90);
    expect(fy2025.sources.cashFlow).toEqual(WEB);
    expect(dataset.financials.map((r) => r.fiscalYear)).toEqual([2024, 2025]);
    expect(dataset.financials[0].revenue).toBe(950);
  });

  it("names each web figure dropped from a pasted statement, and a divergence above 1% as a conflict", () => {
    const { warnings } = mergeDatasets(paste(), web());
    expect(warnings).toContainEqual({ code: "value_ignored_secondary", severity: "info", fiscalYear: 2025, detail: "eps FY2025" });
    expect(warnings).toContainEqual({ code: "value_ignored_secondary", severity: "info", fiscalYear: 2025, detail: "sharesDiluted FY2025" });
    expect(warnings).toContainEqual({ code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (paste) vs 1080 (web)" });
    // EBITDA agrees within 1%: no conflict.
    expect(warnings.some((w) => w.detail.startsWith("ebitda:"))).toBe(false);
  });

  it("takes whole multiples and estimate rows from the paste when it has the year, else from the web", () => {
    const { dataset } = mergeDatasets(paste(), web());
    expect(dataset.multiples.map((r) => [r.fiscalYear, r.pe, r.source?.kind])).toEqual([
      [2024, 19, "web"],
      [2025, 20, "paste"],
    ]);
    expect(dataset.estimates.map((r) => r.fiscalYear)).toEqual([2026]);
  });

  it("unions the peers by normalized ticker, the paste winning row by row", () => {
    const { dataset } = mergeDatasets(paste(), web());
    expect(dataset.peers.map((p) => p.ticker).sort()).toEqual(["OTHR", "PEER"]);
    const peer = dataset.peers.find((p) => p.ticker === "PEER")!;
    expect(peer.companyName).toBe("Peer (paste)");
    expect(peer.multiples.map((r) => [r.fiscalYear, r.pe])).toEqual([
      [2024, 14],
      [2025, 15],
    ]);
  });

  it("rescales the web's money and shares to the paste's units, not its per-share values or ratios", () => {
    const thousands = web();
    thousands.meta.units = "thousands";
    thousands.financials = thousands.financials.map((r) => ({ ...r, netDebt: 300000, sharesDiluted: 50000, eps: 2, depreciationAmortization: 70000 }));
    thousands.multiples = [makeMultiplesRow({ fiscalYear: 2024, pe: 19, marketCap: 1200000, source: { ...WEB } })];
    const { dataset } = mergeDatasets(paste(), thousands);
    const fy2025 = dataset.financials.find((r) => r.fiscalYear === 2025)!;
    expect(fy2025.netDebt).toBe(300);
    const fy2024 = dataset.financials.find((r) => r.fiscalYear === 2024)!;
    expect(fy2024.sharesDiluted).toBe(50);
    expect(fy2024.eps).toBe(2);
    expect(fy2024.depreciationAmortization).toBe(70);
    expect(dataset.multiples[0]).toMatchObject({ pe: 19, marketCap: 1200 });
  });

  it("does not merge across currencies: the paste alone, with a warning", () => {
    const eur = web();
    eur.meta.reportingCurrency = "EUR";
    const { dataset, warnings } = mergeDatasets(paste(), eur);
    expect(dataset.financials.map((r) => r.fiscalYear)).toEqual([2025]);
    expect(dataset.financials[0].netDebt).toBeNull();
    expect(warnings).toEqual([{ code: "meta_currency_conflict", severity: "warn", fiscalYear: null, detail: "USD vs EUR" }]);
  });

  it("does not merge when either side's units are unknown", () => {
    const unknown = web();
    unknown.meta.units = null;
    const { dataset, warnings } = mergeDatasets(paste(), unknown);
    expect(dataset.financials).toHaveLength(1);
    expect(warnings).toEqual([{ code: "meta_units_conflict", severity: "warn", fiscalYear: null, detail: "millions vs unknown" }]);
  });

  it("marks the result merged with both ids, and never writes into its inputs", () => {
    const p = paste();
    const before = JSON.stringify(p);
    const { dataset } = mergeDatasets(p, web(), { pasteDatasetId: "ds-paste", webDatasetId: "ds-web" });
    expect(dataset.datasetMeta).toEqual({ ticker: "ORNT", createdAt: NOW.toISOString(), origin: "merged", pasteDatasetId: "ds-paste", webDatasetId: "ds-web" });
    dataset.financials[1].sources.income!.verified = false;
    expect(JSON.stringify(p)).toBe(before);
  });
});
