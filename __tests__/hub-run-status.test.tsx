import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { SavedAnalysis } from "@/types/analysis";

const fetchAnalysesMock = vi.fn();
vi.mock("@/lib/analyses", () => ({ fetchAnalyses: () => fetchAnalysesMock() }));
vi.mock("@/lib/portfolio", () => ({ fetchSnapshots: vi.fn(async () => []) }));

import HubClient from "@/components/hub-client";

const analysis = (id: string, ticker: string, runStatus: SavedAnalysis["runStatus"] = "done"): SavedAnalysis => ({
  id,
  ticker,
  companyName: `${ticker} Co`,
  reportMd: "",
  mosPercent: 25,
  runStatus,
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("HubClient — recent analyses", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the three newest FINISHED analyses: a run in progress never takes a slot", async () => {
    // Newest first, as the API returns them.
    fetchAnalysesMock.mockResolvedValue([
      analysis("live", "LIVE", "running"),
      analysis("a1", "AAA"),
      analysis("cut", "CUTT", "failed"),
      analysis("a2", "BBB"),
      analysis("a3", "CCC"),
    ]);
    render(<HubClient isAuthed />);

    await waitFor(() => expect(screen.getByText("AAA")).toBeInTheDocument());
    expect(screen.getByText("BBB")).toBeInTheDocument();
    expect(screen.getByText("CCC")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
    expect(screen.queryByText("CUTT")).not.toBeInTheDocument();
  });

  it("shows one row per ticker, linked to the stock's page, with the verdict of its newest valued analysis", async () => {
    // Round, invented figures: buy target 80 at MoS 20% is a fair value of 100.
    const valued = { fairValueBear: 60, fairValueBase: 80, fairValueBull: 100, mosPercent: 20, currency: "USD" };
    fetchAnalysesMock.mockResolvedValue([
      { ...analysis("a1", "AAA"), ...valued },
      { ...analysis("a1-older", "AAA"), ...valued, createdAt: "2026-09-01T00:00:00.000Z" },
      analysis("b1", "BBB"),
      { ...analysis("c1", "CCC"), ...valued },
      { ...analysis("d1", "DDD"), ...valued },
    ]);
    // AAA quoted under its buy target, CCC in another currency than its analysis; the
    // watchlist call and BBB's quote get the empty answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith("/api/quote/AAA")
            ? { regularMarketPrice: 70, currency: "USD" }
            : url.endsWith("/api/quote/CCC")
              ? { regularMarketPrice: 70, currency: "GBp" }
              : { items: [] },
      }))
    );
    render(<HubClient isAuthed />);

    // Two saves of AAA are one row: the third slot goes to CCC, and DDD is the fourth ticker.
    const aaa = await screen.findByRole("link", { name: /AAA/ });
    expect(aaa).toHaveAttribute("href", "/stocks/AAA");
    await waitFor(() => expect(aaa).toHaveTextContent("BUY"));
    expect(screen.getAllByText("AAA")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "BBB" })).toHaveAttribute("href", "/stocks/BBB");
    // No verdict on a quote in another currency: the ticker alone.
    expect(screen.getByRole("link", { name: "CCC" })).toHaveAttribute("href", "/stocks/CCC");
    expect(screen.queryByText("DDD")).not.toBeInTheDocument();
  });
});
