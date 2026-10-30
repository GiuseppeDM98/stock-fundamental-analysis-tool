import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DatasetSection } from "@/components/dataset-section";
import { pasteSource } from "@/lib/grounding/merge";
import { DATASET_REUSE_MAX_AGE_DAYS, emptyRowSources, type StoredDataset } from "@/types/dataset";
import type { GroundingBlock } from "@/types/grounding";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const fetchLatestMock = vi.fn();
vi.mock("@/lib/dataset-client", () => ({
  fetchLatestDataset: (...args: unknown[]) => fetchLatestMock(...args),
  createPasteDataset: vi.fn(),
}));
vi.mock("@/lib/grounding-client", () => ({ extractGrounding: vi.fn() }));

// Invented, round figures.
const BLOCKS: GroundingBlock[] = [{ id: "blk-1", kind: "income_statement", text: "Revenue 1000" }];
function stored(ticker: string): StoredDataset {
  return {
    id: `ds-${ticker}`,
    dataset: {
      ...makeExtract({
        meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
        financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
      }),
      datasetMeta: { ticker, createdAt: "2026-10-27T09:00:00.000Z", origin: "paste", pasteDatasetId: null, webDatasetId: null },
    },
    blocks: BLOCKS,
    warnings: [],
    createdAt: "2026-10-27T09:00:00.000Z",
  };
}

const QUOTE = { price: 11, currency: "EUR" };

function renderSection(ticker: string, onChange = vi.fn()) {
  const view = render(createElement(DatasetSection, { ticker, quote: QUOTE, value: null, onChange }));
  return { ...view, onChange, rerenderTicker: (next: string) => view.rerender(createElement(DatasetSection, { ticker: next, quote: QUOTE, value: null, onChange })) };
}

beforeEach(() => {
  fetchLatestMock.mockReset();
  window.localStorage.clear();
});

describe("DatasetSection", () => {
  it("opens on a recent dataset, with its tables and both actions, and uses it on a click", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    const { onChange } = renderSection("AAA.MI");

    expect(await screen.findByText(/Dataset from/)).toBeInTheDocument();
    expect(fetchLatestMock).toHaveBeenCalledWith("AAA.MI", DATASET_REUSE_MAX_AGE_DAYS, expect.any(AbortSignal));
    expect(screen.getByText(/\(paste\)/)).toBeInTheDocument();
    expect(screen.getByTestId("dataset-table-income")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use this dataset" }));
    expect(onChange).toHaveBeenLastCalledWith({ id: "ds-AAA.MI", extract: stored("AAA.MI").dataset });
  });

  it("shows no reuse view when the ticker changed while the lookup ran", async () => {
    let resolveFirst!: (value: StoredDataset) => void;
    fetchLatestMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve))).mockResolvedValueOnce(null);
    const { rerenderTicker } = renderSection("AAA.MI");

    rerenderTicker("BBB.MI");
    await act(async () => resolveFirst(stored("AAA.MI")));

    await waitFor(() => expect(fetchLatestMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Dataset from/)).not.toBeInTheDocument();
    expect(fetchLatestMock.mock.calls[0][2].aborted).toBe(true);
  });

  it("keeps an unsaved draft on Refresh data, and says so", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", JSON.stringify([{ id: "draft-1", kind: "balance_sheet", text: "Total debt 400" }]));
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    expect(screen.getByText("Your unsaved draft was kept")).toBeInTheDocument();
    expect(screen.getByText(/Balance sheet ·/)).toBeInTheDocument();
  });

  it("seeds the editor with the dataset's blocks on Refresh data when there is no draft", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    expect(screen.queryByText("Your unsaved draft was kept")).not.toBeInTheDocument();
    expect(screen.getByText(/Income statement ·/)).toBeInTheDocument();
  });

  it("says a failed lookup once, then offers the editor", async () => {
    fetchLatestMock.mockRejectedValue(new Error("network"));
    renderSection("AAA.MI");
    fireEvent.click(screen.getAllByRole("button")[0]); // open the section
    expect(await screen.findByText("Could not check for a recent dataset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare data" })).toBeInTheDocument();
  });
});
