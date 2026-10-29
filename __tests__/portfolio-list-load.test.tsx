import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Position } from "@/types/portfolio";

const fetchSnapshotsMock = vi.fn();

vi.mock("@/lib/portfolio", () => ({
  fetchPositions: vi.fn(async (): Promise<Position[]> => [
    {
      id: "p1",
      ticker: "ORNT",
      companyName: "Orient Co",
      purchasePrice: 100,
      shares: 10,
      currency: "EUR",
      purchasedAt: "2025-06-15T00:00:00.000Z",
      createdAt: "2025-06-15T10:00:00.000Z",
    },
  ]),
  // The history chart owns the snapshot request; the list must not depend on it.
  fetchSnapshots: () => fetchSnapshotsMock(),
  fetchDividendTotals: vi.fn(async () => ({ totalEur: 0, byTicker: {} })),
  createPosition: vi.fn(),
  deletePosition: vi.fn(),
  closePosition: vi.fn(),
}));
vi.mock("@/lib/analyses", () => ({ fetchAnalyses: vi.fn(async () => []) }));
vi.mock("@/lib/earnings-client", () => ({
  fetchEarnings: vi.fn(async () => []),
  refreshEarnings: vi.fn(),
}));

import PortfolioList from "@/components/portfolio-list";

describe("PortfolioList — initial load", () => {
  beforeEach(() => {
    fetchSnapshotsMock.mockRejectedValue(new Error("Failed to load portfolio history"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ regularMarketPrice: 110, regularMarketChange: 1, regularMarketChangePercent: 0.9 }),
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the positions even when the snapshot route fails", async () => {
    render(<PortfolioList />);
    expect((await screen.findAllByText("ORNT")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Failed to load portfolio history")).not.toBeInTheDocument();
  });
});
