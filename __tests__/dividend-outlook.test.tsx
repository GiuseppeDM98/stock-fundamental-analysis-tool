import { describe, it, expect, beforeAll } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";

import { DividendOutlook } from "@/components/report/dividend-outlook";
import { hasDividendOutlook } from "@/components/analysis-detail-body";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources } from "@/types/dataset";
import type { DeepValueResult, DividendPath } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

// Recharts' ResponsiveContainer observes its size; jsdom has no ResizeObserver. The chart
// draws at width 0 here, so the assertions read text, the aria-label and the table only.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const DPS = [0.36, 0.38, 0.4, 0.4, 0.4];
const FCF = [70, 80, 90, 100, 110];

function extract(currency = "EUR", withSources = true): GroundedFinancials {
  return makeExtract({
    meta: makeMeta({ reportingCurrency: currency, units: "millions" }),
    financials: DPS.map((dps, i) => {
      const row = makeFinancialsRow({ fiscalYear: 2021 + i, dividendsPerShare: dps, freeCashFlow: FCF[i], sharesDiluted: 100, eps: 1 });
      if (!withSources) return { ...row, sources: undefined } as unknown as typeof row;
      return { ...row, sources: { ...emptyRowSources(), income: pasteSource("blk-is") } };
    }),
  });
}

const PATH: DividendPath = {
  policy: "Pays out about 60% of net income.",
  lastDps: 0.4,
  path: [
    { year: 2026, bull: 0.44, base: 0.42, bear: 0.38 },
    { year: 2027, bull: 0.47, base: 0.44, bear: 0.36 },
    { year: 2028, bull: 0.5, base: 0.46, bear: 0.34 },
  ],
};

function result(overrides: Partial<DeepValueResult> = {}): DeepValueResult {
  return { method: "EV/EBITDA", sector: "Utilities", currency: "EUR", bull: { fairValue: 14 }, base: { fairValue: 12 }, bear: { fairValue: 9 }, dividends: PATH, ...overrides };
}

type Props = Parameters<typeof DividendOutlook>[0];
const renderCard = (props: Partial<Props> = {}) =>
  render(
    createElement(DividendOutlook, {
      result: result(),
      extract: extract(),
      price: { value: 11.4, currency: "EUR" },
      position: null,
      ...props,
    })
  );

const tile = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

describe("DividendOutlook", () => {
  it("shows the history, the stated policy, the forward yield per scenario and the coverage the gate computes", () => {
    renderCard();
    expect(screen.getByText("Dividend outlook")).toBeTruthy();
    expect(tile("Last DPS")).toBe("0.40");
    expect(tile("Years without a cut")).toBe("4");
    expect(tile("Cuts")).toBe("—");
    expect(tile("5-yr DPS CAGR")).toBe("—");
    expect(tile("Payout (EPS)")).toBe("40.0%");
    // 0.42 × 100 shares over the mean of 90, 100, 110: the gate's 0.42, passing.
    expect(tile("FCF coverage")).toBe("0.42 ✓");
    expect(screen.getByText(/Pays out about 60%/)).toBeTruthy();
    // Bear 0.38, base 0.42 and bull 0.44 over 11.40.
    expect(screen.getByText("Forward yield").parentElement!.textContent).toBe("Forward yieldBear 3.3%Base 3.7%Bull 3.9%");
    // No position: neither a yield on cost nor a note about one.
    expect(screen.queryByText("Forward yield on cost")).toBeNull();
    expect(screen.queryByText(/Yield on cost not shown/)).toBeNull();
  });

  it("a position in the dividend's currency gets the forward yield on cost", () => {
    renderCard({ position: { weightedAvgCost: 10.7333, currency: "EUR" } });
    const row = screen.getByText("Forward yield on cost").parentElement!;
    // Base 0.42 / 10.7333.
    expect(row.textContent).toContain("Base 3.9%");
  });

  it("a position in another currency gets a note instead of a yield on cost", () => {
    renderCard({ position: { weightedAvgCost: 10.7333, currency: "USD" } });
    expect(screen.queryByText("Forward yield on cost")).toBeNull();
    expect(screen.getByText("Yield on cost not shown: position and dividend currencies differ")).toBeTruthy();
  });

  it("lots in different currencies (no position currency) get the same note", () => {
    renderCard({ position: { weightedAvgCost: 10.7333, currency: null } });
    expect(screen.getByText("Yield on cost not shown: position and dividend currencies differ")).toBeTruthy();
  });

  it("a quote in pence against a dividend in pounds gets a note instead of a yield", () => {
    renderCard({ result: result({ currency: "GBP" }), extract: extract("GBP"), price: { value: 1140, currency: "GBp" } });
    expect(screen.queryByText("Forward yield")).toBeNull();
    expect(screen.getByText("Yield not shown: quote and dividend currencies differ")).toBeTruthy();
  });

  it("without a declared path, a trailing yield on the last reported DPS, in one pill", () => {
    renderCard({ result: result({ dividends: undefined }), position: { weightedAvgCost: 10, currency: "EUR" } });
    const row = screen.getByText("Trailing yield").parentElement!;
    // 0.40 / 11.40, once: three scenarios would repeat the same number.
    expect(row.textContent).toBe("Trailing yield3.5%");
    expect(screen.getByText("Trailing yield on cost").parentElement!.textContent).toBe("Trailing yield on cost4.0%");
    // The coverage is the last reported year's, labelled trailing: 0.40 × 100 / 100.
    expect(tile("FCF coverage")).toBe("0.40 (trailing)");
  });

  it("the coverage reads unavailable when the dataset reports in another currency, as the gate does", () => {
    renderCard({ extract: extract("USD") });
    expect(tile("FCF coverage")).toBe("unavailable");
  });

  it("a declared non-payer says so in place of the yields, and keeps the history", () => {
    renderCard({ result: result({ dividends: null }), position: { weightedAvgCost: 10, currency: "EUR" } });
    expect(screen.getByText("No dividend")).toBeTruthy();
    expect(screen.queryByText(/yield/i)).toBeNull();
    expect(tile("Last DPS")).toBe("0.40");
    expect(tile("FCF coverage")).toBe("0.00 ✓");
  });

  it("labels the chart alone as an image, and keeps its data table outside it", () => {
    const { container } = renderCard();
    const img = screen.getByRole("img", { name: "Dividend per share, history and projected path" });
    const table = container.querySelector("table.sr-only")!;
    expect(table).toBeTruthy();
    expect(table.closest('[role="img"]')).toBeNull();
    expect(img.contains(table)).toBe(false);
    // One row per year: five reported, three on the path, none invented.
    const rows = within(table as HTMLElement).getAllByRole("row");
    expect(rows.slice(1).map((r) => r.querySelector("th")?.textContent)).toEqual(["2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028"]);
    expect(rows[1].textContent).toBe("20210.36———");
    expect(rows[6].textContent).toBe("2026—0.440.420.38");
    // The chart's sources, from the income statement the DPS lives on.
    expect(screen.getByTestId("source-legend").textContent).toContain("📋 paste");
  });

  it("an extract saved before rows carried their sources renders, with no source legend", () => {
    renderCard({ extract: extract("EUR", false) });
    expect(screen.getByText("Dividend outlook")).toBeTruthy();
    expect(screen.queryByTestId("source-legend")).toBeNull();
  });

  it("with neither a history nor a declaration there is nothing to draw", () => {
    const { container } = renderCard({ result: result({ dividends: undefined }), extract: null });
    expect(container.innerHTML).toBe("");
  });
});

describe("hasDividendOutlook — when the saved page mounts the card", () => {
  const zeros = makeExtract({ financials: [makeFinancialsRow({ fiscalYear: 2025, dividendsPerShare: 0 })] });

  it("mounts on a DPS above 0, or on any declaration, a non-payer included", () => {
    expect(hasDividendOutlook(result({ dividends: undefined }), extract())).toBe(true);
    expect(hasDividendOutlook(result(), null)).toBe(true);
    expect(hasDividendOutlook(result({ dividends: null }), null)).toBe(true);
  });

  it("does not mount on zeros alone with nothing declared, nor without either", () => {
    expect(hasDividendOutlook(result({ dividends: undefined }), zeros)).toBe(false);
    expect(hasDividendOutlook(result({ dividends: undefined }), null)).toBe(false);
  });
});
