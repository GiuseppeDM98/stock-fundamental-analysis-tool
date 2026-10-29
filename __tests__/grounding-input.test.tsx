import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GroundingInput } from "@/components/grounding-input";
import type { GroundingExtractResponse } from "@/lib/grounding-client";
import type { BlockExtractResult } from "@/lib/grounding/merge";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
import type { GroundingBlock } from "@/types/grounding";
import { makeExtract, makeFinancialsRow } from "./grounding-test-helpers";

const extractMock = vi.fn();
const createDatasetMock = vi.fn();
vi.mock("@/lib/grounding-client", () => ({ extractGrounding: (...args: unknown[]) => extractMock(...args) }));
vi.mock("@/lib/dataset-client", () => ({ createPasteDataset: (...args: unknown[]) => createDatasetMock(...args) }));

const TICKER = "AAA.MI";
const DRAFT: GroundingBlock[] = [
  { id: "b1", kind: "income_statement", text: "Revenue 1000" },
  { id: "b2", kind: "balance_sheet", text: "garbled" },
  { id: "b3", kind: "cash_flow", text: "CFO 150" },
];
// A block result carries no sources: only the merge writes them.
const { sources: _sources, ...UNSOURCED_ROW } = makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 });
const result = (blockId: string, kind: BlockExtractResult["kind"]): BlockExtractResult => ({ kind, blockId, financials: [UNSOURCED_ROW] });
const R1 = result("b1", "income_statement");
const R2 = result("b2", "balance_sheet");
const R3 = result("b3", "cash_flow");

function response(blockResults: BlockExtractResult[], failedBlockIds: string[]): GroundingExtractResponse {
  const extract = makeExtract({ financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 })] });
  return {
    blockResults,
    failedBlockIds,
    extract,
    basis: computeBasisReconciliation(extract),
    stats: [],
    grid: null,
    marketImplied: null,
    impliedExpectations: null,
    warnings: failedBlockIds.map(() => ({ code: "block_extract_failed" as const, severity: "warn" as const, fiscalYear: null, detail: "balance_sheet #2" })),
  };
}

function renderEditor(props: Partial<Parameters<typeof GroundingInput>[0]> = {}) {
  return render(
    createElement(GroundingInput, { ticker: TICKER, valueId: null, onConfirm: vi.fn(), onInvalidate: vi.fn(), ...props })
  );
}

/** Prepare with block 2 failing, then back to the editor. */
async function prepareWithFailedBlockTwo() {
  extractMock.mockResolvedValueOnce(response([R1, R3], ["b2"]));
  fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
  await screen.findByRole("button", { name: /Retry this block #2/ });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

beforeEach(() => {
  extractMock.mockReset();
  createDatasetMock.mockReset();
  window.localStorage.setItem(`sfa:grounding:${TICKER}`, JSON.stringify(DRAFT));
});

describe("GroundingInput — retry of one block", () => {
  it("sends only the retried block, with its current text, plus the prior results and the block order", async () => {
    renderEditor();
    await prepareWithFailedBlockTwo();

    // The user fixes the paste of block 2, then retries it from the editor.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit block" })[1]);
    fireEvent.change(screen.getByDisplayValue("garbled"), { target: { value: "Total debt 400" } });
    extractMock.mockResolvedValueOnce(response([R1, R2, R3], []));
    fireEvent.click(screen.getByRole("button", { name: "Retry this block" }));

    await waitFor(() => expect(extractMock).toHaveBeenCalledTimes(2));
    const [ticker, blocks, blockOrder, opts] = extractMock.mock.calls[1];
    expect(ticker).toBe(TICKER);
    expect(blocks).toEqual([{ id: "b2", kind: "balance_sheet", text: "Total debt 400" }]);
    expect(blockOrder).toEqual(["b1", "b2", "b3"]);
    expect(opts.priorResults.map((r: BlockExtractResult) => r.blockId)).toEqual(["b1", "b3"]);
    // Every block extracted: no retry left to offer.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Retry this block/ })).not.toBeInTheDocument());
  });

  it("drops a removed block's result from the next retry", async () => {
    renderEditor();
    await prepareWithFailedBlockTwo();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    extractMock.mockResolvedValueOnce(response([R2, R3], []));
    fireEvent.click(screen.getByRole("button", { name: "Retry this block" }));

    await waitFor(() => expect(extractMock).toHaveBeenCalledTimes(2));
    const [, blocks, blockOrder, opts] = extractMock.mock.calls[1];
    expect(blocks.map((b: GroundingBlock) => b.id)).toEqual(["b2"]);
    expect(blockOrder).toEqual(["b2", "b3"]);
    expect(opts.priorResults.map((r: BlockExtractResult) => r.blockId)).toEqual(["b3"]);
  });
});

describe("GroundingInput — saving the dataset", () => {
  it("saves the extracted blocks and hands the new dataset up", async () => {
    const onConfirm = vi.fn();
    renderEditor({ onConfirm });
    extractMock.mockResolvedValueOnce(response([R1, R2, R3], []));
    fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
    createDatasetMock.mockResolvedValueOnce({ id: "ds1" });
    fireEvent.click(await screen.findByRole("button", { name: "Analyze with this data →" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ id: "ds1", extract: expect.objectContaining({ financials: expect.any(Array) }) }));
    const [ticker, payload] = createDatasetMock.mock.calls[0];
    expect(ticker).toBe(TICKER);
    expect(payload.blocks.map((b: GroundingBlock) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("shows a failed save and hands nothing up", async () => {
    const onConfirm = vi.fn();
    renderEditor({ onConfirm });
    extractMock.mockResolvedValueOnce(response([R1, R2, R3], []));
    fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
    createDatasetMock.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(await screen.findByRole("button", { name: "Analyze with this data →" }));

    expect(await screen.findByText("Could not save the dataset: boom")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
