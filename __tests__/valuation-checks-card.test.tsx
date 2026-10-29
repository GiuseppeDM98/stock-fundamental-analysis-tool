import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { ValuationChecksCard } from "@/components/report/valuation-checks-card";
import type { DeepValueResult, Scenario } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";
import { makeExtract, makeFinancialsRow, makeMeta, makeMultiplesRow } from "./grounding-test-helpers";

// Lets one test force the post-check to throw, standing in for any unforeseen shape of
// unvalidated model output, without depending on which inputs the real gates guard.
const postcheckControl = vi.hoisted(() => ({ shouldThrow: false }));
vi.mock("@/lib/grounding/postcheck", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/grounding/postcheck")>();
  return {
    ...actual,
    checkValuationBridges: (...args: Parameters<typeof actual.checkValuationBridges>) => {
      if (postcheckControl.shouldThrow) throw new TypeError("Cannot read properties of undefined");
      return actual.checkValuationBridges(...args);
    },
  };
});

// Eni-shaped: EBITDA 14200, net debt 11500, minorities 3200, shares 3150; the latest year
// carries a reported EV so kE = 1 exactly (same basis).
const DRIVER = 14200;
const NET_DEBT = 11500;
const MINORITIES = 3200;
const SHARES = 3150;
const HISTORY = [2.4, 2.6, 2.9, 3.0, 3.2, 3.5, 3.8, 4.1, 4.6, 5.4];

const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: DRIVER, netDebt: NET_DEBT, minorityInterest: MINORITIES, sharesDiluted: SHARES })],
  multiples: HISTORY.map((evEbitda, i) =>
    makeMultiplesRow({ fiscalYear: 2016 + i, evEbitda, ...(2016 + i === 2025 ? { enterpriseValue: evEbitda * DRIVER } : {}) })
  ),
});

function scenarioAt(multiple: number): Scenario {
  const intrinsicPerShare = (multiple * DRIVER - NET_DEBT - MINORITIES) / SHARES;
  return {
    fairValue: intrinsicPerShare,
    bridge: { driver: "EBITDA", driverValue: DRIVER, driverYear: 2025, multiple, netDebt: NET_DEBT, minorities: MINORITIES, shares: SHARES, intrinsicPerShare },
  };
}

const RESULT: DeepValueResult = {
  method: "EV/EBITDA",
  sector: "Energy",
  currency: "EUR",
  bear: scenarioAt(3.0),
  base: scenarioAt(4.2),
  bull: scenarioAt(5.5),
};

// No JSX in this file: with vi.mock present, vitest's mock-hoisting pass parses the raw
// source before the JSX transform runs and fails on JSX ("Unexpected JSX expression"), so
// the card is rendered via createElement.
function renderCard(
  overrides: {
    result?: DeepValueResult;
    currency?: string;
    extract?: GroundedFinancials | null;
    priceSource?: "live" | "analysis";
    reportMd?: string;
  } = {}
) {
  return render(
    createElement(ValuationChecksCard, {
      result: overrides.result ?? RESULT,
      extract: overrides.extract === undefined ? EXTRACT : overrides.extract,
      mosPercent: 0,
      currentPrice: PRICE_AT_3_5X,
      currency: overrides.currency ?? "EUR",
      priceSource: overrides.priceSource ?? "live",
      reportMd: overrides.reportMd,
    })
  );
}

// Price at which the market-implied multiple is exactly 3.5x: (3.5×14200 − 14700) / 3150.
const PRICE_AT_3_5X = (3.5 * DRIVER - NET_DEBT - MINORITIES) / SHARES;

describe("ValuationChecksCard", () => {
  beforeEach(() => {
    postcheckControl.shouldThrow = false;
  });

  it("shows the market-implied percentile and the explicit base-vs-market gap", () => {
    renderCard();

    expect(screen.getByText(/Price implies 3\.50x \(Provider basis 3\.50x\) → percentile/)).toBeInTheDocument();
    // (4.2 − 3.5) / 3.5 = +20.0%
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
    expect(screen.getByText(/Multiple vs\. market-implied: 4\.20x vs 3\.50x/)).toBeInTheDocument();
  });

  it("renders the basis reconciliation row with kE, confidence and an assumed kB", () => {
    renderCard();

    expect(screen.getByText("Basis reconciliation")).toBeInTheDocument();
    expect(screen.getByText(/kE 1\.00 \(n=1\)/)).toBeInTheDocument();
    expect(screen.getByText(/confidence: low/)).toBeInTheDocument();
    expect(screen.getByText(/kB assumed = 1/)).toBeInTheDocument();
  });

  it("explains a missing market-implied read with the currency-mismatch warning", () => {
    renderCard({ currency: "USD" });

    expect(screen.getByText(/Price-implied read unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Reporting currency differs from the quote currency/)).toBeInTheDocument();
    expect(screen.getByText(/EUR vs USD/)).toBeInTheDocument();
    expect(screen.queryByText(/Multiple vs\. market-implied: /)).not.toBeInTheDocument();
  });

  it("degrades to a 'checks unavailable' line instead of throwing when the post-check fails", () => {
    postcheckControl.shouldThrow = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderCard();

    expect(screen.getByRole("heading", { name: "Deterministic checks" })).toBeInTheDocument();
    expect(screen.getByText(/Deterministic checks unavailable/)).toBeInTheDocument();
    warn.mockRestore();
  });

  it("does not throw on a result missing a whole scenario", () => {
    const malformed = { ...RESULT, bear: undefined } as unknown as DeepValueResult;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      renderCard({ result: malformed })
    ).not.toThrow();
    expect(screen.getByRole("heading", { name: "Deterministic checks" })).toBeInTheDocument();
    warn.mockRestore();
  });

  it("has exactly one title: the gate list is subtitled 'Gates', never a second 'Deterministic checks'", () => {
    renderCard();

    expect(screen.getAllByText("Deterministic checks")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Deterministic checks" }).tagName).toBe("H3");
    expect(screen.getByText("Gates")).toBeInTheDocument();
  });

  it("without a dataset: says so, draws no basis line, market-implied section nor implied multiple, keeps the cross-check's arithmetic", () => {
    const withCrossCheck: DeepValueResult = {
      ...RESULT,
      crossCheck: {
        method: "DDM",
        intrinsicPerShare: (4.0 * DRIVER - NET_DEBT - MINORITIES) / SHARES,
        reconciliation: "n/a",
        bridge: { driver: "EBITDA", driverValue: DRIVER, driverYear: 2025, multiple: 4.0, netDebt: NET_DEBT, minorities: MINORITIES, shares: SHARES },
      },
    };
    renderCard({ result: withCrossCheck, extract: null });

    expect(screen.getByText("No dataset: basis, market-implied and net-debt gates unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Basis reconciliation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Price implies/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Price-implied read unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your base multiple/)).not.toBeInTheDocument();
    const crossCheckRow = screen.getByText("Cross-check bridge").closest("p")!;
    expect(crossCheckRow.textContent).toContain("✓ Bridge arithmetic");
    expect(crossCheckRow.textContent).not.toMatch(/\d\.\d{2}x/);
    expect(screen.getAllByText(/— no dataset$/).length).toBeGreaterThanOrEqual(6);
  });

  it("a cross-check bridge with no multiple (a DDM on a per-share DPS) draws no row without a dataset", () => {
    // driverValue is a DPS per share while shares are a total: (equity + net debt) / driver
    // mixes the two scales, as on the first real Quick run.
    const ddm: DeepValueResult = {
      ...RESULT,
      crossCheck: {
        method: "DDM",
        intrinsicPerShare: 3.0,
        reconciliation: "n/a",
        bridge: { driver: "DPS", driverValue: 0.2, driverYear: 2025, netDebt: 0, minorities: 0, shares: SHARES },
      },
    };
    const { unmount } = renderCard({ result: ddm, extract: null });
    expect(screen.queryByText("Cross-check bridge")).not.toBeInTheDocument();
    unmount();

    // With a dataset both rows are drawn as before, implied multiples included.
    renderCard({ result: ddm });
    expect(screen.getByText(/Your base multiple/)).toBeInTheDocument();
    expect(screen.getByText("Cross-check bridge").closest("p")!.textContent).toMatch(/\d\.\d{2}x/);
  });

  it("an extract with no financial rows reads exactly like no dataset", () => {
    renderCard({ extract: makeExtract() });

    expect(screen.getByText("No dataset: basis, market-implied and net-debt gates unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Basis reconciliation")).not.toBeInTheDocument();
  });

  it("names the price the gates were checked against", () => {
    const { unmount } = renderCard();
    expect(screen.getByText(/checks against the live price · 11\.11 EUR/)).toBeInTheDocument();
    unmount();

    renderCard({ priceSource: "analysis" });
    expect(screen.getByText(/checks against the price at analysis \(live quote unavailable\) · 11\.11 EUR/)).toBeInTheDocument();
  });

  it("appends sections_present when the report Markdown is passed, and only then", () => {
    const { unmount } = renderCard();
    expect(screen.queryByText(/All 10 report sections present/)).not.toBeInTheDocument();
    unmount();

    renderCard({ reportMd: "## 1. Summary\n\n## 8. Valuation" });
    expect(screen.getByText(/All 10 report sections present/)).toBeInTheDocument();
    expect(screen.getByText("— missing 2,3,4,5,6,7,9,10")).toBeInTheDocument();
  });
});
