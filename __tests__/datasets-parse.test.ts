import { describe, it, expect } from "vitest";
import { parseStoredDataset } from "@/lib/datasets/parse";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources, type DatasetMeta } from "@/types/dataset";
import { makeExtract, makeFinancialsRow } from "./grounding-test-helpers";

// Invented, round figures.
const META: DatasetMeta = { ticker: "AAA.MI", createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null };
const DATASET = {
  ...makeExtract({
    financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
  }),
  datasetMeta: META,
};
const BLOCKS = [{ id: "blk-1", kind: "income_statement", text: "Revenue 1000" }];
const WARNINGS = [{ code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (income_statement #1) vs 1100 (other #2)" }];

function row(overrides: Partial<{ dataJson: string; blocksJson: string | null; warningsJson: string | null; researchJson: string | null }> = {}) {
  return {
    id: "ds1",
    dataJson: JSON.stringify(DATASET),
    blocksJson: JSON.stringify(BLOCKS),
    warningsJson: JSON.stringify(WARNINGS),
    createdAt: new Date("2026-10-27T09:00:00Z"),
    ...overrides,
  };
}

describe("parseStoredDataset", () => {
  it("reads a valid row into a StoredDataset", () => {
    expect(parseStoredDataset(row())).toEqual({
      id: "ds1",
      dataset: DATASET,
      blocks: BLOCKS,
      warnings: WARNINGS,
      research: null,
      createdAt: "2026-10-27T09:00:00.000Z",
    });
  });

  it("reads a web dataset's null blocks and a null warnings column as empty lists", () => {
    const parsed = parseStoredDataset(row({ blocksJson: null, warningsJson: null }));
    expect(parsed?.blocks).toEqual([]);
    expect(parsed?.warnings).toEqual([]);
  });

  it("reads a corrupt dataJson, a dataset without datasetMeta or a malformed blocks column as null", () => {
    expect(parseStoredDataset(row({ dataJson: "{not json" }))).toBeNull();
    const { datasetMeta: _m, ...withoutMeta } = DATASET;
    expect(parseStoredDataset(row({ dataJson: JSON.stringify(withoutMeta) }))).toBeNull();
    expect(parseStoredDataset(row({ blocksJson: JSON.stringify([{ id: "x" }]) }))).toBeNull();
  });
});

describe("parseStoredDataset — a web dataset", () => {
  const RESEARCH = { model: "claude-sonnet-5-5", effort: "high", searches: 7, fetches: 3, durationMs: 95000, unverifiedSources: ["https://data.example/m"], notes: null };
  const webRow = (researchJson: string | null) =>
    row({
      dataJson: JSON.stringify({ ...DATASET, datasetMeta: { ...META, origin: "web" } }),
      blocksJson: null,
      warningsJson: JSON.stringify([{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: "https://data.example/m" }]),
      researchJson,
    });

  it("reads a row whose warnings carry the research codes, warnings and research included", () => {
    const parsed = parseStoredDataset(webRow(JSON.stringify(RESEARCH)));
    expect(parsed?.warnings.map((w) => w.code)).toEqual(["source_unverified"]);
    expect(parsed?.research).toEqual(RESEARCH);
  });

  it("keeps the row with research null when researchJson is missing or malformed", () => {
    expect(parseStoredDataset(webRow(null))?.research).toBeNull();
    expect(parseStoredDataset(webRow("{not json"))?.research).toBeNull();
    const malformed = parseStoredDataset(webRow(JSON.stringify({ ...RESEARCH, model: "gpt-9" })));
    expect(malformed).not.toBeNull();
    expect(malformed?.research).toBeNull();
  });
});

describe("parseStoredDataset — a dataset saved before D&A existed", () => {
  it("reads a financials row without the depreciationAmortization key as null", () => {
    const old = JSON.parse(JSON.stringify(DATASET));
    delete old.financials[0].depreciationAmortization;
    expect(parseStoredDataset(row({ dataJson: JSON.stringify(old) }))?.dataset.financials[0].depreciationAmortization).toBeNull();
  });
});
