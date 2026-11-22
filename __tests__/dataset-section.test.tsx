import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DatasetSection } from "@/components/dataset-section";
import { pasteSource } from "@/lib/grounding/merge";
import { DATASET_REUSE_MAX_AGE_DAYS, emptyRowSources, type DatasetOrigin, type MergedDatasetResponse, type ResearchResponse, type StoredDataset } from "@/types/dataset";
import type { GroundingBlock } from "@/types/grounding";
import type { GroundingExtractResponse } from "@/lib/grounding-client";
import { makeBasis, makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";
import { ResearchPartError } from "@/lib/dataset-client";

const fetchLatestMock = vi.fn();
// The whole research as one answer (a run whose start closed it): what these tests are about
// is what the section does with the dataset. The chain of parts has its own cases below and
// in use-research-run.test.tsx.
const researchMock = vi.fn();
const continueMock = vi.fn();
const readStateMock = vi.fn();
const mergeMock = vi.fn();
const createPasteMock = vi.fn();
const extractMock = vi.fn();
vi.mock("@/lib/dataset-client", async (importOriginal) => ({
  // The real ResearchPartError: the hook tells a lost answer by its class.
  ...(await importOriginal<typeof import("@/lib/dataset-client")>()),
  fetchLatestDataset: (...args: unknown[]) => fetchLatestMock(...args),
  startResearch: async (...args: unknown[]) => {
    const answer = await researchMock(...args);
    // A step (it names the next part) passes as is; a bare dataset is a run closed at once.
    return answer && "next" in answer ? answer : { runId: "run1", part: "statements", next: null, result: answer };
  },
  continueResearch: (...args: unknown[]) => continueMock(...args),
  readResearchState: (...args: unknown[]) => readStateMock(...args),
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

const DRAFT = JSON.stringify([{ id: "draft-1", kind: "balance_sheet", text: "Total debt 400" }]);

/** The extraction of the draft above. */
function extracted(basis = makeBasis()): GroundingExtractResponse {
  return { blockResults: [{ kind: "balance_sheet", blockId: "draft-1" }], failedBlockIds: [], extract: EXTRACT, basis, stats: [], grid: null, marketImplied: null, impliedExpectations: null, warnings: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Opens the paste editor with `open`, prepares the draft and confirms it. */
async function confirmDraft(open: string) {
  fireEvent.click(await screen.findByRole("button", { name: open }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
  fireEvent.click(await screen.findByRole("button", { name: "Analyze with this data →" }));
}

// The EV-columns hint of the paste editor's preview (kE unverifiable).
const PASTE_HINT = /Include the EV\/Revenue, Market Cap and Enterprise Value columns/;

function renderSection(ticker: string, onChange = vi.fn()) {
  const view = render(createElement(DatasetSection, { ticker, quote: QUOTE, value: null, onChange }));
  return { ...view, onChange, rerenderTicker: (next: string) => view.rerender(createElement(DatasetSection, { ticker: next, quote: QUOTE, value: null, onChange })) };
}

beforeEach(() => {
  fetchLatestMock.mockReset();
  researchMock.mockReset();
  continueMock.mockReset();
  readStateMock.mockReset();
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

  it("Refresh data on a reused paste researches and merges the new web dataset with that paste", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    expect(mergeMock).toHaveBeenCalledWith("AAA.MI", "ds-AAA.MI", "ds-web");
  });

  it("Refresh data on a reused web dataset researches again, with nothing to merge", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "web"));
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    expect(await screen.findByRole("button", { name: "Analyze with this data →" })).toBeInTheDocument();
    expect(researchMock).toHaveBeenCalledWith("AAA.MI");
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("merges a paste confirmed on a reused web dataset with it", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", DRAFT);
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "web"));
    extractMock.mockResolvedValue(extracted());
    createPasteMock.mockResolvedValue({ id: "ds-paste-new" });
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    renderSection("AAA.MI");

    await confirmDraft("Add pasted data");
    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    expect(mergeMock).toHaveBeenCalledWith("AAA.MI", "ds-paste-new", "ds-AAA.MI");
  });

  it("drops the dataset confirmed before as soon as a paste starts merging with it", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", DRAFT);
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "web"));
    extractMock.mockResolvedValue(extracted());
    createPasteMock.mockResolvedValue({ id: "ds-paste-new" });
    mergeMock.mockReturnValue(new Promise(() => {}));
    const { onChange } = renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Use this dataset" }));
    expect(onChange).toHaveBeenLastCalledWith({ id: "ds-AAA.MI", extract: stored("AAA.MI", "web").dataset });
    await confirmDraft("Add pasted data");

    await waitFor(() => expect(mergeMock).toHaveBeenCalled());
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the paste's confirm disabled until the merge answers, so a second click saves nothing", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", DRAFT);
    fetchLatestMock.mockResolvedValue(stored("AAA.MI", "web"));
    extractMock.mockResolvedValue(extracted());
    createPasteMock.mockResolvedValue({ id: "ds-paste-new" });
    const merge = deferred<MergedDatasetResponse>();
    mergeMock.mockReturnValue(merge.promise);
    renderSection("AAA.MI");

    await confirmDraft("Add pasted data");
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(1));
    const confirm = screen.getByRole("button", { name: "Analyze with this data →" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(createPasteMock).toHaveBeenCalledTimes(1);

    await act(async () => merge.resolve(mergedBundle("AAA.MI", "ds-paste-new", "ds-AAA.MI")));
    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it("Edit the pasted data on the merge of a reused paste opens on that paste's blocks", async () => {
    fetchLatestMock.mockResolvedValue(stored("AAA.MI"));
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Refresh data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit the pasted data" }));
    expect(screen.getByText(/Income statement ·/)).toBeInTheDocument();
    expect(screen.queryByText("Your unsaved draft was kept")).not.toBeInTheDocument();
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

  it("shows the three parts while the research runs, the running one with its seconds and each with its usual minutes", async () => {
    // Only the interval and the clock are faked: the promise plumbing stays real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockReturnValue(new Promise(() => {}));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    const rows = within(screen.getByTestId("research-parts")).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["running", "waiting", "waiting"]);
    expect(rows[0]).toHaveTextContent("Statements0 s · usually ~3 min");
    expect(rows[1]).toHaveTextContent("Multiples and peersusually ~2 min");
    expect(rows[2]).toHaveTextContent("Estimatesusually ~1 min");
    act(() => vi.advanceTimersByTime(3_000));
    expect(rows[0]).toHaveTextContent("3 s · usually ~3 min");
    expect(screen.queryByRole("button", { name: "Search the web for the data" })).not.toBeInTheDocument();
  });

  it("says why the research failed and offers a retry and the paste", async () => {
    fetchLatestMock.mockResolvedValue(null);
    // What lib/dataset-client throws on the route's 503 when the provider key is missing.
    researchMock.mockRejectedValueOnce(new Error("research requires the Anthropic API key")).mockResolvedValueOnce(webBundle("AAA.MI"));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(await screen.findByText("Statements failed: research requires the Anthropic API key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pasted data" })).toBeInTheDocument();
    // The statements are the dataset: they cannot be skipped.
    expect(screen.queryByRole("button", { name: "Continue without" })).not.toBeInTheDocument();

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

describe("DatasetSection — the research in three parts", () => {
  const marketFailed = () => new ResearchPartError("Research returned an invalid dataset", { status: 502, runId: "run1", part: "market", lost: false });

  it("offers Retry and Continue without when the multiples fail; Continue without skips them and the run goes on", async () => {
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue({ runId: "run1", part: "statements", next: "market" });
    continueMock
      .mockRejectedValueOnce(marketFailed())
      .mockResolvedValueOnce({ runId: "run1", part: "market", next: "estimates" })
      .mockResolvedValueOnce({ runId: "run1", part: "estimates", next: null, result: webBundle("AAA.MI") });
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(await screen.findByText("Multiples and peers failed: Research returned an invalid dataset")).toBeInTheDocument();
    expect(continueMock).toHaveBeenLastCalledWith("run1", "market");
    const rows = within(screen.getByTestId("research-parts")).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["done", "failed", "waiting"]);
    expect(screen.getByRole("button", { name: "Retry the research" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue without" }));
    expect(await screen.findByText(/(web)/)).toBeInTheDocument();
    expect(continueMock.mock.calls).toEqual([
      ["run1", "market"],
      ["run1", "market", true],
      ["run1", "estimates"],
    ]);
  });

  it("Retry on failed multiples asks the multiples again, not the statements", async () => {
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue({ runId: "run1", part: "statements", next: "market" });
    continueMock.mockRejectedValueOnce(marketFailed()).mockReturnValueOnce(new Promise(() => {}));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry the research" }));
    await waitFor(() => expect(continueMock).toHaveBeenCalledTimes(2));
    expect(continueMock).toHaveBeenLastCalledWith("run1", "market");
    expect(researchMock).toHaveBeenCalledTimes(1);
  });
});

describe("DatasetSection — the moves on a preview", () => {
  it("a web preview offers Refresh data and Add pasted data, without the paste editor's EV-columns hint", async () => {
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue({ ...webBundle("AAA.MI"), basis: makeBasis({ kE: null, sameBasis: false }) });
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    expect(await screen.findByText(/\(web\)/)).toBeInTheDocument();
    expect(screen.queryByText(PASTE_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pasted data" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit the pasted data" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(researchMock).toHaveBeenCalledTimes(2));
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("shows the EV-columns hint on the paste editor's own preview", async () => {
    window.localStorage.setItem("sfa:grounding:AAA.MI", DRAFT);
    fetchLatestMock.mockResolvedValue(null);
    extractMock.mockResolvedValue(extracted(makeBasis({ kE: null, sameBasis: false })));
    renderSection("AAA.MI");

    fireEvent.click(await screen.findByRole("button", { name: "Add pasted data" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare data" }));
    expect(await screen.findByText(PASTE_HINT)).toBeInTheDocument();
  });

  async function mergedPreview() {
    window.localStorage.setItem("sfa:grounding:AAA.MI", DRAFT);
    fetchLatestMock.mockResolvedValue(null);
    researchMock.mockResolvedValue(webBundle("AAA.MI"));
    extractMock.mockResolvedValue(extracted());
    createPasteMock.mockResolvedValueOnce({ id: "ds-paste-new" }).mockResolvedValueOnce({ id: "ds-paste-2" });
    mergeMock.mockImplementation(async (ticker: string, pasteId: string, webId: string) => mergedBundle(ticker, pasteId, webId));
    const view = renderSection("AAA.MI");
    fireEvent.click(await screen.findByRole("button", { name: "Search the web for the data" }));
    await confirmDraft("Add pasted data");
    expect(await screen.findByText(/\(web \+ paste\)/)).toBeInTheDocument();
    return view;
  }

  it("Edit the pasted data on a merged preview reopens the draft, and a new confirm merges with the same web dataset", async () => {
    await mergedPreview();
    expect(screen.queryByRole("button", { name: "Add pasted data" })).not.toBeInTheDocument();

    await confirmDraft("Edit the pasted data");
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(2));
    expect(mergeMock).toHaveBeenLastCalledWith("AAA.MI", "ds-paste-2", "ds-web");
  });

  it("Refresh data on a merged preview researches again and merges with the same paste", async () => {
    await mergedPreview();

    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(2));
    expect(researchMock).toHaveBeenCalledTimes(2);
    expect(mergeMock).toHaveBeenLastCalledWith("AAA.MI", "ds-paste-new", "ds-web");
  });
});
