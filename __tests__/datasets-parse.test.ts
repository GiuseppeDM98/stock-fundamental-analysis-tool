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

function row(overrides: Partial<{ dataJson: string; blocksJson: string | null; warningsJson: string | null }> = {}) {
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
