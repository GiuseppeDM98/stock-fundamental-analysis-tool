import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import type { DeepValueResult } from "@/components/report/types";

// The panel is replaced by a recorder: what matters here is the price it is handed, not
// its own behaviour (analyst-panel.test.tsx covers that).
const panelCalls = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("@/components/analyst-panel", () => ({
  default: (props: Record<string, unknown>) => {
    panelCalls.props.push(props);
    return null;
  },
}));

import AnalysisDetailBody from "@/components/analysis-detail-body";

// Round, invented figures: intrinsic 220 / 180 / 130 at MoS 25 → buy targets 165 / 135 / 97.5.
const RESULT: DeepValueResult = {
  method: "EV/EBITDA",
  sector: "Industrials",
  currency: "USD",
  bull: { fairValue: 165 },
  base: { fairValue: 135 },
  bear: { fairValue: 97.5 },
};

type BodyProps = ComponentProps<typeof AnalysisDetailBody>;

// No JSX in this file: with vi.mock present, vitest's mock-hoisting pass parses the raw
// source before the JSX transform runs (the same reason as valuation-checks-card.test.tsx).
function renderBody(overrides: Partial<BodyProps> = {}) {
  const props: BodyProps = {
    analysisId: "a1",
    ticker: "ORNT",
    companyName: "Orient Test Corp",
    reportDate: "October 1, 2026",
    markdown: "## 1. Summary\n\nBody.",
    result: RESULT,
    mosPercent: 25,
    priceAtAnalysis: 142,
    groundingExtract: null,
    position: { totalShares: 20, weightedAvgCost: 140, currency: "USD" },
    initialCritiques: {},
    initialBlind: {},
    initialResult: {},
    initialFinal: {},
    ...overrides,
  };
  return render(createElement(AnalysisDetailBody, props));
}

function stubQuote(response: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn(async () => ({ ok: response.ok, status: response.status, json: async () => response.body ?? {} }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const lastPanelProps = () => panelCalls.props[panelCalls.props.length - 1];

describe("AnalysisDetailBody — one price for the whole page", () => {
  beforeEach(() => {
    panelCalls.props = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("when the quote fails, every surface reads the price at analysis and says so", async () => {
    const fetchMock = stubQuote({ ok: false, status: 503 });
    renderBody();

    expect(await screen.findByText(/checks against the price at analysis \(live quote unavailable\) · 142\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText("Price at analysis")).toBeInTheDocument();
    expect(screen.queryByText("Current Price")).not.toBeInTheDocument();
    expect(lastPanelProps()).toMatchObject({ currentPrice: 142, currency: "USD", priceSource: "analysis" });
    // The banner keeps the shares and the cost, but makes no P&L up from an old price.
    expect(screen.getByText(/20 shares/)).toBeInTheDocument();
    expect(screen.queryByText(/\(\+?-?\d+\.\d%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("Loading P&L…")).not.toBeInTheDocument();
    // One quote request for the page, not one per card.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/quote/ORNT");
  });

  it("with a live quote, every surface reads it and the banner shows the live P&L (positive control)", async () => {
    stubQuote({ ok: true, status: 200, body: { regularMarketPrice: 150, currency: "USD" } });
    renderBody();

    expect(await screen.findByText(/checks against the live price · 150\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText("Current Price")).toBeInTheDocument();
    expect(lastPanelProps()).toMatchObject({ currentPrice: 150, currency: "USD", priceSource: "live" });
    // (150 − 140) × 20 = +200.00 (+7.1%) — the separator follows the runner's locale.
    expect(screen.getByText(/\+200[.,]00 \(\+7\.1%\)/)).toBeInTheDocument();
  });

  it("without a complete valuation block: the Markdown fallback, no quote fetch, no card, no panel", () => {
    const fetchMock = stubQuote({ ok: true, status: 200, body: { regularMarketPrice: 150, currency: "USD" } });
    renderBody({ result: null });

    expect(screen.getByRole("heading", { name: "Orient Test Corp" })).toBeInTheDocument();
    expect(screen.getByText("Body.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Deterministic checks" })).not.toBeInTheDocument();
    expect(panelCalls.props).toHaveLength(0);
  });

  it("with no quote and no saved price: the no-price line in place of the card", async () => {
    stubQuote({ ok: false, status: 503 });
    renderBody({ priceAtAnalysis: null });

    expect(
      await screen.findByText("Deterministic checks need a price: no live quote and no price saved with this analysis.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deterministic checks" })).not.toBeInTheDocument();
    await waitFor(() => expect(lastPanelProps()).toMatchObject({ currentPrice: null }));
  });
});
