import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DatasetSection } from "@/components/dataset-section";
import { pasteSource } from "@/lib/grounding/merge";
import { DATASET_REUSE_MAX_AGE_DAYS, emptyRowSources, type DatasetOrigin, type MergedDatasetResponse, type ResearchResponse, type StoredDataset } from "@/types/dataset";
import type { GroundingBlock } from "@/types/grounding";
import type { GroundingExtractResponse } from "@/lib/grounding-client";
import { makeBasis, makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

const fetchLatestMock = vi.fn();
const researchMock = vi.fn();
const mergeMock = vi.fn();
const createPasteMock = vi.fn();
const extractMock = vi.fn();
vi.mock("@/lib/dataset-client", () => ({
  fetchLatestDataset: (...args: unknown[]) => fetchLatestMock(...args),
  researchDataset: (...args: unknown[]) => researchMock(...args),
  createMergedDataset: (...args: unknown[]) => mergeMock(...args),
  createPasteDataset: (...args: unknown[]) => createPasteMock(...args),
}));
vi.mock("@/lib/grounding-client", () => ({ extractGrounding: (...args: unknown[]) => extractMock(...args) }));

// Invented, round figures.
const BLOCKS: GroundingBlock[] = [{ id: "blk-1", kind: "income_statement", text: "Revenue 1000" }];
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } })],
});

function datasetOf(ticker: string, origin: DatasetOrigin, ids: { paste: string | null; web: string | null } = { paste: null, web: null }) {
  return { ...EXTRACT, datasetMeta: { ticker, createdAt: "2026-10-27T09:00:00.000Z", origin, pasteDatasetId: ids.paste, webDatasetId: ids.web } };
}

function stored(ticker: string, origin: DatasetOrigin = "paste"): StoredDataset {
  const merged = origin === "merged";
  return {
    id: merged ? "ds-merged" : `ds-${ticker}`,
    dataset: datasetOf(ticker, origin, merged ? { paste: "ds-paste-old", web: "ds-web-old" } : undefined),
    blocks: origin === "web" ? [] : BLOCKS,
    warnings: [],
    research: null,
    createdAt: "2026-10-27T09:00:00.000Z",
  };
}

const RESEARCH_META = {
  model: "claude-sonnet-5-5",
  servedBy: null,
  effort: "high",
  searches: 10,
  fetches: 5,
  durationMs: 60_000,
  unverifiedSources: ["https://data.example/AAA/multiples"],
  notes: null,
} as const;

function webBundle(ticker: string): ResearchResponse {
  return {
    datasetId: "ds-web",
    dataset: datasetOf(ticker, "web"),
    basis: makeBasis(),
    stats: [],
    grid: null,
    marketImplied: null,
    impliedExpectations: null,
    warnings: [],
    research: { ...RESEARCH_META, unverifiedSources: [...RESEARCH_META.unverifiedSources] },
  };
}

function mergedBundle(ticker: string, pasteId: string, webId: string): MergedDatasetResponse {
  return { ...webBundle(ticker), datasetId: "ds-merged-new", dataset: datasetOf(ticker, "merged", { paste: pasteId, web: webId }), research: null };
}

const QUOTE = { price: 11, currency: "EUR" };

function renderSection(ticker: string, onChange = vi.fn()) {
  const view = render(createElement(DatasetSection, { ticker, quote: QUOTE, value: null, onChange }));
  return { ...view, onChange, rerenderTicker: (next: string) => view.rerender(createElement(DatasetSection, { ticker: next, quote: QUOTE, value: null, onChange })) };
}

beforeEach(() => {
  fetchLatestMock.mockReset();
  researchMock.mockReset();
  mergeMock.mockReset();
  createPasteMock.mockReset();
  extractMock.mockReset();
  window.localStorage.clear();
});

describe("DatasetSection — reuse of a recent dataset", () => {
  it("opens on a recent dataset, with its tables and actions, and uses it on a click", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    const { onChange } = renderSection("AAA.MI");

    expect(await screen.findByText(/Dataset from/)).toBeInTheDocument();
    expect(fetchLatestMock).toHaveBeenCalledWith("AAA.MI", DATASET_REUSE_MAX_AGE_DAYS, expect.any(AbortSignal));
    expect(screen.getByText(/\(paste\)/)).toBeInTheDocument();
    expect(screen.getByTestId("dataset-table-income")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit the pasted data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use this dataset" }));
    expect(onChange).toHaveBeenLastCalledWith({ id: "ds-AAA.MI", extract: stored("AAA.MI").dataset });
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("labels a reused web dataset and offers to add a paste instead of editing one", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "web"));
    renderSection("AAA.MI");

    expect(await screen.findByText(/\(web\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit the pasted data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pasted data" })).toBeInTheDocument();
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

  it("keeps an unsaved draft on Edit the pasted data, and says so", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", JSON.stringify([{ id: "draft-1", kind: "balance_sheet", text: "Total debt 400" }]));
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Edit the pasted data" }));
    expect(screen.getByText("Your unsaved draft was kept")).toBeInTheDocument();
    expect(screen.getByText(/Balance sheet ·/)).toBeInTheDocument();
  });

  it("seeds the editor with the dataset's blocks on Edit the pasted data when there is no draft", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Edit the pasted data" }));
    expect(screen.queryByText("Your unsaved draft was kept")).not.toBeInTheDocument();
    expect(screen.getByText(/Income statement ·/)).toBeInTheDocument();
  });

  it("Refresh data on a merged dataset researches again and merges the new web dataset with its paste", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "merged"));
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    expect(researchMock).toHaveBeenCalledWith("AAA.MI");
    expect(mergeMock).toHaveBeenCalledWith("AAA.MI", "ds-paste-old", "ds-web");
  });
});

describe("DatasetSection — web research", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("with no recent dataset opens on the research and the paste, and starts nothing by itself", async () => {
    fetchLatestMock.mockResolvedValue(null);
    renderSection("AAA.MI");

    expect(await screen.findByRole("button", { name: "Search the web for the data" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add pasted data" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prepare data" })).not.toBeInTheDocument();
    expect(researchMock).not.toHaveBeenCalled();
  });

  it("counts the seconds while the research runs", async () => {
    // Only the interval and the clock are faked: the promise plumbing stays real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockReturnValue(new Promise(() => {}));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(screen.getByText("Researching primary sources… 0 s")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByText("Researching primary sources… 3 s")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search the web for the data" })).not.toBeInTheDocument();
  });

  it("says why the research failed and offers a retry and the paste", async () => {
    fetchLatestMock.mockResolvedValue(null);
    // What lib/dataset-client throws on the route's 503 when the provider key is missing.
    researchMock.mockRejectedValueOnce(new Error("research requires the Anthropic API key")).mockResolvedValueOnce(webBundle("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(await screen.findByText("Research failed — research requires the Anthropic API key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pasted data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry the research" }));
    expect(await screen.findByText(/\(web\)/)).toBeInTheDocument();
    expect(researchMock).toHaveBeenCalledTimes(2);
  });

  it("previews the web dataset with the sources it never opened, and confirms it", async () => {
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    const { onChange } = renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(await screen.findByText(/\(web\)/)).toBeInTheDocument();
    expect(screen.getByTestId("dataset-unverified-sources")).toHaveTextContent("https://data.example/AAA/multiples");
    // A web preview has no paste editor to go back to.
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analyze with this data →" }));
    expect(onChange).toHaveBeenLastCalledWith({ id: "ds-web", extract: webBundle("AAA.MI").dataset });
  });

  it("ignores a research that answers after the ticker changed", async () => {
    let resolveResearch!: (value: ResearchResponse) => void;
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockReturnValue(new Promise((resolve) => (resolveResearch = resolve)));
    const { rerenderTicker } = renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    rerenderTicker("BBB.MI");
    await act(async () => resolveResearch(webBundle("AAA.MI")));

    expect(await screen.findByRole("button", { name: "Search the web for the data" })).toBeInTheDocument();
    expect(screen.queryByText(/\(web\)/)).not.toBeInTheDocument();
  });

  it("merges a paste confirmed with a web dataset on screen, and previews the merge", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", JSON.stringify([{ id: "draft-1", kind: "balance_sheet", text: "Total debt 400" }]));
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    const extracted: GroundingExtractResponse = {
      blockResults: [{ kind: "balance_sheet", blockId: "draft-1" }],
      failedBlockIds: [],
      extract: EXTRACT,
      basis: makeBasis(),
      stats: [],
      grid: null,
      marketImplied: null,
      impliedExpectations: null,
      warnings: [],
    };
    extractMock.mockResolvedValue(extracted);
    createPasteMock.mockResolvedValue({ id: "ds-paste-new" });
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    const { onChange } = renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add pasted data" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Analyze with this data →" }));

    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    expect(mergeMock).toHaveBeenCalledWith("AAA.MI", "ds-paste-new", "ds-web");
    // The paste alone was never the dataset: the merge is, once confirmed.
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: "ds-paste-new" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze with this data →" }));
    expect(onChange).toHaveBeenLastCalledWith({ id: "ds-merged-new", extract: mergedBundle("AAA.MI", "ds-paste-new", "ds-web").dataset });
  });

  it("uses a paste alone when no web dataset is on screen", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", JSON.stringify([{ id: "draft-1", kind: "balance_sheet", text: "Total debt 400" }]));
    fetchLatestMock.mockResolvedValue(null);
    extractMock.mockResolvedValue({
      blockResults: [{ kind: "balance_sheet", blockId: "draft-1" }],
      failedBlockIds: [],
      extract: EXTRACT,
      basis: makeBasis(),
      stats: [],
      grid: null,
      marketImplied: null,
      impliedExpectations: null,
      warnings: [],
    } satisfies GroundingExtractResponse);
    createPasteMock.mockResolvedValue({ id: "ds-paste-new" });
    const { onChange } = renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Add pasted data" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Analyze with this data →" }));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ id: "ds-paste-new", extract: EXTRACT }));
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("says a failed lookup once, then offers the research and the paste", async () => {
    fetchLatestMock.mockRejectedValue(new Error("network"));
    renderSection("AAA.MI");
    expect(await screen.findByText("Could not check for a recent dataset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add pasted data" }));
    expect(screen.getByRole("button", { name: "Prepare data" })).toBeInTheDocument();
  });
});
