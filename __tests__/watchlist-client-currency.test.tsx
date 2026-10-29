import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { SavedAnalysis } from "@/types/analysis";

const fetchAnalysesMock = vi.fn();

vi.mock("@/lib/analyses", () => ({
  fetchAnalyses: () => fetchAnalysesMock(),
}));
vi.mock("@/lib/earnings-client", () => ({
  fetchEarnings: vi.fn(async () => []),
  refreshEarnings: vi.fn(),
}));
// The price dot is what the verdict weighs: expose it.
vi.mock("@/components/report/valuation-ruler", () => ({
  ValuationRuler: ({ price }: { price?: number }) => <div data-testid="ruler" data-price={price ?? ""} />,
  ComparisonTable: () => null,
}));

import WatchlistClient from "@/components/watchlist-client";

// Round, invented figures: MoS 0, base 100, item MoS 20% → buy target 80.
const ANALYSIS = {
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd: "",
  mosPercent: 0,
  priceAtAnalysis: 90,
  fairValueBull: 130,
  fairValueBase: 100,
  fairValueBear: 70,
  valuationMethod: "DCF",
  currency: "GBP",
  createdAt: "2026-10-01T00:00:00.000Z",
} as SavedAnalysis;

function stubFetch(quote: { regularMarketPrice: number; currency: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/api/watchlist"
          ? {
              items: [{ id: "w1", ticker: "ORNT", companyName: "Orient Co", mosPercent: 0.2, notes: null, addedAt: "2026-10-01T00:00:00.000Z" }],
              settings: { watchlistEmail: null, watchlistEnabled: true },
            }
          : quote,
    }))
  );
}

describe("WatchlistClient — the verdict weighs only a quote in the analysis's currency", () => {
  beforeEach(() => {
    fetchAnalysesMock.mockResolvedValue([ANALYSIS]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a quote in GBp against an analysis in GBP: no verdict, no price dot, and a note", async () => {
    // 7000 pence is 70 pounds — under the buy target, but only once converted, which the
    // app never does.
    stubFetch({ regularMarketPrice: 7000, currency: "GBp" });
    render(<WatchlistClient />);

    expect(await screen.findByText("No verdict: quote and analysis in different currencies")).toBeInTheDocument();
    expect(screen.queryByText(/^(OVER FV|WATCH|BUY) [+-]?\d+%$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("ruler").dataset.price).toBe("");
  });

  it("the same price in the analysis's currency gets its verdict and its dot (positive control)", async () => {
    stubFetch({ regularMarketPrice: 70, currency: "GBP" });
    render(<WatchlistClient />);

    expect(await screen.findByText(/^BUY -\d+%$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("ruler").dataset.price).toBe("70"));
    expect(screen.queryByText(/No verdict/)).not.toBeInTheDocument();
  });
});
