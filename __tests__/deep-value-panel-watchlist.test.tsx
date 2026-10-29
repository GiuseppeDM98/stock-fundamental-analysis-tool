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
  saveAnalysis: vi.fn(async () => undefined),
}));
vi.mock("@/components/ai-settings-control", () => ({
  AiSettingsControl: () => null,
}));
vi.mock("@/components/report/report-body", () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="report">{markdown}</div>,
}));

import DeepValuePanel from "@/components/deep-value-panel";

const FULL_JSON = {
  method: "EV/EBITDA",
  sector: "Industrials",
  currency: "USD",
  bull: { fairValue: 130 },
  base: { fairValue: 100 },
  bear: { fairValue: 70 },
};

function streamResponse(text: string) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return { ok: true, status: 200, body, json: async () => ({}) };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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
    render(<DeepValuePanel ticker="ORNT" companyName="Orient Co" mosPercent={25} currentPrice={150} currency="USD" />);
    fireEvent.click(screen.getByText(translations.en.deepAnalysisBtn));
  }

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
