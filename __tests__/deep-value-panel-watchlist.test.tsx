import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1" } }, status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/ai-settings-client", () => ({
  fetchAiSettings: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/lib/analyses", () => ({
  fetchAnalysis: vi.fn(),
}));
vi.mock("@/components/ai-settings-control", () => ({
  AiSettingsControl: () => null,
}));
vi.mock("@/components/report/report-body", () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="report">{markdown}</div>,
}));

import DeepValuePanel from "@/components/deep-value-panel";
import { makeExtract, makeMeta } from "./grounding-test-helpers";
import { sseOk, jsonResponse } from "./sse-test-helpers";
import { fetchAnalysis } from "@/lib/analyses";
import type { AiRunEvent, DeepValuePhase } from "@/types/ai-run";
import type { SavedAnalysis } from "@/types/analysis";

// Every run is built on a confirmed dataset (invented, empty of rows: the panel only
// forwards its id).
const DATASET = { id: "ds1", extract: makeExtract({ meta: makeMeta({ reportingCurrency: "USD", units: "millions" }) }) };

const FULL_JSON = {
  method: "EV/EBITDA",
  sector: "Industrials",
  currency: "USD",
  bull: { fairValue: 130 },
  base: { fairValue: 100 },
  bear: { fairValue: 70 },
};

const STARTED = "2026-11-20T10:00:00.000Z";
const stage = (phase: DeepValuePhase): AiRunEvent => ({ type: "stage", stage: phase, analysisId: "an1", runStartedAt: STARTED });
const done: AiRunEvent = { type: "done", analysisId: "an1" };

/** The four requests of a run, in order: the report streams in the two report halves. */
function streamResponses(fetchMock: ReturnType<typeof vi.fn>, reportText: string) {
  fetchMock
    .mockResolvedValueOnce(sseOk([stage("update"), { type: "text", text: "notes" }, done]))
    .mockResolvedValueOnce(sseOk([stage("valuation"), done]))
    .mockResolvedValueOnce(sseOk([stage("report1"), { type: "text", text: reportText }, done]))
    .mockResolvedValueOnce(sseOk([stage("report2"), { type: "text", text: "# Second half" }, done]));
}

/** The finished row the panel reads after the last phase: its numbers come from here. */
const finishedRow = (resultJson: string | null, reportMd: string) => ({
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd,
  updateNotesMd: "notes",
  resultJson,
  mosPercent: 25,
  priceAtAnalysis: 150,
  priceCurrency: "USD",
  datasetId: "ds1",
  runStatus: "done",
  runPhase: null,
  runStartedAt: null,
  runError: null,
  createdAt: STARTED,
});

describe("DeepValuePanel — Add to Watchlist and incomplete valuation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function generate(resultJson: string | null, reportMd: string) {
    streamResponses(fetchMock, reportMd);
    vi.mocked(fetchAnalysis).mockResolvedValueOnce(finishedRow(resultJson, reportMd) as unknown as SavedAnalysis);
    render(<DeepValuePanel ticker="ORNT" companyName="Orient Co" mosPercent={25} currentPrice={150} currency="USD" dataset={DATASET} />);
    fireEvent.click(screen.getByText(translations.en.deepAnalysisBtn));
  }

  it("keeps Generate disabled without a dataset, says why, and calls nothing", () => {
    render(<DeepValuePanel ticker="ORNT" companyName="Orient Co" mosPercent={25} currentPrice={150} currency="USD" />);
    const button = screen.getByText(translations.en.deepAnalysisBtn).closest("button")!;
    expect(button).toBeDisabled();
    expect(screen.getByText(translations.en.deepValueNeedsDataset)).toBeInTheDocument();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the confirmed dataset's id", async () => {
    await generate(null, "# Report");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).datasetId).toBe("ds1");
  });

  it("reads the numbers from the finished row, and sends the MoS to the watchlist as a fraction", async () => {
    // The stream carries no valuation block at all: the Decision Panel shows on the row's numbers.
    await generate(JSON.stringify(FULL_JSON), "# Report");
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}));
    fireEvent.click(await screen.findByText(translations.en.addToWatchlist));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls.slice(0, 4).map(([url]) => url)).toEqual(Array(4).fill("/api/ai/deep-value"));
    expect(fetchAnalysis).toHaveBeenCalledWith("an1");
    const [url, init] = fetchMock.mock.calls[4];
    expect(url).toBe("/api/watchlist");
    expect(JSON.parse(init.body).mosPercent).toBe(0.25);
  });

  it("says so when the watchlist rejects the add", async () => {
    await generate(JSON.stringify(FULL_JSON), "# Report");
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Number must be less than or equal to 0.8" }));
    fireEvent.click(await screen.findByText(translations.en.addToWatchlist));

    expect(await screen.findByText(translations.en.watchlistAddError)).toBeInTheDocument();
  });

  it("warns that the valuation block is incomplete when the row holds none", async () => {
    await generate(null, "# Report without a valuation block");

    expect(await screen.findByText(translations.en.deepValueIncompleteJson)).toBeInTheDocument();
    // No fair values to act on: the Decision Panel stays hidden, the report still shows.
    expect(screen.queryByText(translations.en.addToWatchlist)).not.toBeInTheDocument();
    // Two bodies: the web notes' box and the report.
    expect(screen.getAllByTestId("report").some((n) => n.textContent?.includes("Report without a valuation block"))).toBe(true);
  });
});
