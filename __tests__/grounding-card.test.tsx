import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { GroundingCard } from "@/components/report/grounding-card";
import type { DeepValueResult, Scenario } from "@/components/report/types";
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
function renderCard(overrides: { result?: DeepValueResult; currency?: string } = {}) {
  return render(
    createElement(GroundingCard, {
      result: overrides.result ?? RESULT,
      extract: EXTRACT,
      mosPercent: 0,
      currentPrice: PRICE_AT_3_5X,
      currency: overrides.currency ?? "EUR",
    })
  );
}

// Price at which the market-implied multiple is exactly 3.5x: (3.5×14200 − 14700) / 3150.
const PRICE_AT_3_5X = (3.5 * DRIVER - NET_DEBT - MINORITIES) / SHARES;

describe("GroundingCard", () => {
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

    expect(screen.getByText("Deterministic post-check")).toBeInTheDocument();
    expect(screen.getByText(/Deterministic checks unavailable/)).toBeInTheDocument();
    warn.mockRestore();
  });

  it("does not throw on a result missing a whole scenario", () => {
    const malformed = { ...RESULT, bear: undefined } as unknown as DeepValueResult;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      renderCard({ result: malformed })
    ).not.toThrow();
    expect(screen.getByText("Deterministic post-check")).toBeInTheDocument();
    warn.mockRestore();
  });
});
