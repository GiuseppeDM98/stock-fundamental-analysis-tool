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

/** The route's answer to a run that streams this text and finishes. */
function streamResponse(text: string) {
  return sseOk([
    { type: "stage", stage: "valuation", analysisId: "an1", runStartedAt: "2026-11-20T10:00:00.000Z" },
    { type: "text", text },
    { type: "done", analysisId: "an1" },
  ]);
}

describe("DeepValuePanel — Add to Watchlist and incomplete valuation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function generate(streamText: string) {
    fetchMock.mockResolvedValueOnce(streamResponse(streamText));
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
    await generate("# Report");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).datasetId).toBe("ds1");
  });

  it("sends the MoS to the watchlist as a fraction", async () => {
    await generate("```json\n" + JSON.stringify(FULL_JSON) + "\n```\n# Report");
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {}));
    fireEvent.click(await screen.findByText(translations.en.addToWatchlist));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/watchlist");
    expect(JSON.parse(init.body).mosPercent).toBe(0.25);
  });

  it("says so when the watchlist rejects the add", async () => {
    await generate("```json\n" + JSON.stringify(FULL_JSON) + "\n```\n# Report");
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Number must be less than or equal to 0.8" }));
    fireEvent.click(await screen.findByText(translations.en.addToWatchlist));

    expect(await screen.findByText(translations.en.watchlistAddError)).toBeInTheDocument();
  });

  it("warns that the valuation block is incomplete when the stream has no JSON fence", async () => {
    await generate("# Report without a valuation block");

    expect(await screen.findByText(translations.en.deepValueIncompleteJson)).toBeInTheDocument();
    // No fair values to act on: the Decision Panel stays hidden, the report still shows.
    expect(screen.queryByText(translations.en.addToWatchlist)).not.toBeInTheDocument();
    expect(screen.getByTestId("report").textContent).toContain("Report without a valuation block");
  });
});
