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
});
