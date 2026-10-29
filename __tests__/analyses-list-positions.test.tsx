import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { SavedAnalysis } from "@/types/analysis";
import type { Position } from "@/types/portfolio";

const fetchAnalysesMock = vi.fn();
const fetchPositionsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/analyses", () => ({
  fetchAnalyses: () => fetchAnalysesMock(),
  deleteAnalysis: vi.fn(),
}));
vi.mock("@/lib/portfolio", () => ({
  fetchPositions: () => fetchPositionsMock(),
}));
vi.mock("@/lib/earnings-client", () => ({
  fetchEarnings: vi.fn(async () => []),
  refreshEarnings: vi.fn(),
}));
// The ruler's zone edges are what the verdict is measured against: expose them.
vi.mock("@/components/report/valuation-ruler", () => ({
  ValuationRuler: ({ buyTargetEdge, fvEdge }: { buyTargetEdge: number; fvEdge: number }) => (
    <div data-testid="ruler" data-buy-target={buyTargetEdge} data-fv={fvEdge} />
  ),
  ComparisonTable: () => null,
}));

import AnalysesList from "@/components/analyses-list";

// Same numbers as the e2e seed's ORNT fixture: MoS 25%, base 135 and three lenses at
// 90/120/105 → consensus base 112.5 → intrinsic 150, the stub quote price.
const ORNT: SavedAnalysis = {
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd: "",
  mosPercent: 25,
  priceAtAnalysis: 140,
  fairValueBull: 165,
  fairValueBase: 135,
  fairValueBear: 97.5,
  valuationMethod: "DCF",
  reviewMd: "skeptic",
  reviewFairValueBull: 112.5,
  reviewFairValueBase: 90,
  reviewFairValueBear: 60,
  reviewValuationMethod: "DCF",
  optimistCritiqueMd: "optimist",
  optimistFairValueBull: 150,
  optimistFairValueBase: 120,
  optimistFairValueBear: 90,
  optimistValuationMethod: "DCF",
  qualityCritiqueMd: "quality",
  qualityFairValueBull: 135,
  qualityFairValueBase: 105,
  qualityFairValueBear: 75,
  qualityValuationMethod: "DCF",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const lot = (overrides: Partial<Position>): Position => ({
  id: "p",
  ticker: "ORNT",
  companyName: "Orient Co",
  purchasePrice: 140,
  shares: 20,
  currency: "USD",
  purchasedAt: "2025-06-15T00:00:00.000Z",
  createdAt: "2025-06-15T10:00:00.000Z",
  ...overrides,
});

describe("AnalysesList — open lots and verdict basis", () => {
  beforeEach(() => {
    fetchAnalysesMock.mockResolvedValue([ORNT]);
    fetchPositionsMock.mockResolvedValue([
      lot({ id: "open", shares: 20 }),
      lot({ id: "sold", shares: 5, purchasePrice: 150, closedAt: "2026-07-01T00:00:00.000Z", sellPrice: 130 }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ regularMarketPrice: 150 }) }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts only the open lot in the position badge", async () => {
    render(<AnalysesList />);
    // The badge lives in the card's expanded body: open it from the ticker header.
    fireEvent.click(await screen.findByText("ORNT"));
    expect(await screen.findByText(/Position: 20 shares @/)).toBeInTheDocument();
    expect(screen.queryByText(/Position: 25 shares/)).not.toBeInTheDocument();
  });

  it("measures the ruler against the consensus basis", async () => {
    render(<AnalysesList />);
    const ruler = await screen.findByTestId("ruler");
    await waitFor(() => expect(Number(ruler.dataset.buyTarget)).toBeCloseTo(112.5, 10));
    expect(Number(ruler.dataset.fv)).toBeCloseTo(150, 10);
  });
});
