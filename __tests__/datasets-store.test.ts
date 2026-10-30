// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeExtract, makeFinancialsRow } from "./grounding-test-helpers";
import { pasteSource } from "@/lib/grounding/merge";
import { EMPTY_ROW_SOURCES, emptyRowSources } from "@/types/dataset";

const findFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { financialDataset: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));

import { readAnalysisExtract, readAnalysisGrounding } from "@/lib/datasets/store";

// Invented, round figures.
const DATASET_EXTRACT = makeExtract({
  financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
});
const WARNING = { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (income_statement #1) vs 1100 (other #2)" };
const DATASET_ROW = {
  id: "ds1",
  dataJson: JSON.stringify({
    ...DATASET_EXTRACT,
    datasetMeta: { ticker: "AAA.MI", createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null },
  }),
  blocksJson: "[]",
  warningsJson: JSON.stringify([WARNING]),
  createdAt: new Date("2026-10-27T09:00:00Z"),
};

// An analysis saved before rows carried sources: its groundingJson has none.
const { sources: _s, ...V1_ROW } = makeFinancialsRow({ fiscalYear: 2024, revenue: 900 });
const LEGACY_JSON = JSON.stringify({ blocks: [], extract: { ...makeExtract(), financials: [V1_ROW] } });

beforeEach(() => {
  findFirstMock.mockReset().mockResolvedValue(null);
});

describe("readAnalysisExtract", () => {
  it("reads the analysis's dataset by datasetId, scoped to the user", async () => {
    findFirstMock.mockResolvedValue(DATASET_ROW);
    const extract = await readAnalysisExtract("u1", { datasetId: "ds1", groundingJson: null });
    expect(extract?.financials[0]).toMatchObject({ revenue: 1000, sources: { income: pasteSource("blk-1") } });
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "ds1", userId: "u1" } });
  });

  it("falls back to a legacy groundingJson, validated, with the default sources", async () => {
    const extract = await readAnalysisExtract("u1", { datasetId: null, groundingJson: LEGACY_JSON });
    expect(extract?.financials[0]).toMatchObject({ fiscalYear: 2024, revenue: 900, sources: EMPTY_ROW_SOURCES });
    expect(findFirstMock).not.toHaveBeenCalled();
    // A legacy blob the schema rejects is no dataset, not a shape the gates would crash on.
    expect(await readAnalysisExtract("u1", { datasetId: null, groundingJson: JSON.stringify({ extract: { financials: "x" } }) })).toBeNull();
  });

  it("is null when the analysis has neither", async () => {
    expect(await readAnalysisExtract("u1", { datasetId: null, groundingJson: null })).toBeNull();
  });
});

describe("readAnalysisGrounding", () => {
  it("carries the dataset's stored warnings, and none for a legacy groundingJson", async () => {
    findFirstMock.mockResolvedValue(DATASET_ROW);
    expect((await readAnalysisGrounding("u1", { datasetId: "ds1", groundingJson: null }))?.warnings).toEqual([WARNING]);
    expect((await readAnalysisGrounding("u1", { datasetId: null, groundingJson: LEGACY_JSON }))?.warnings).toEqual([]);
  });
});
