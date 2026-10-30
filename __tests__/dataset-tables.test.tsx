import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";

import { DatasetTables } from "@/components/report/dataset-tables";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources } from "@/types/dataset";
import { makeExtract, makeFinancialsRow, makeMeta, makeMultiplesRow } from "./grounding-test-helpers";

// Invented, round figures: five years of income statement from one block, the balance
// sheet of the last year from another block with no source recorded.
const YEARS = [2021, 2022, 2023, 2024, 2025];
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: YEARS.map((fiscalYear, i) =>
    makeFinancialsRow({
      fiscalYear,
      revenue: 800 + 50 * i,
      eps: 0.7 + 0.05 * i,
      totalDebt: fiscalYear === 2025 ? 400 : null,
      sources: { ...emptyRowSources(), income: pasteSource("blk-is"), mixed: { income: fiscalYear === 2025, balance: false, cashFlow: false } },
    })
  ),
  multiples: [makeMultiplesRow({ fiscalYear: 2025, pe: 12, source: pasteSource("blk-mult") })],
});

describe("DatasetTables", () => {
  it("shows the income statement with one column per year and the source row first", () => {
    render(createElement(DatasetTables, { extract: EXTRACT }));
    const income = within(screen.getByTestId("dataset-table-income"));
    expect(income.getByText("Income statement")).toBeInTheDocument();
    expect(income.getByText("EUR · millions")).toBeInTheDocument();
    const [header, sourceRow, revenueRow] = income.getAllByRole("row");
    expect(within(header).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", ...YEARS.map(String)]);
    expect(within(sourceRow).getByText("Source")).toBeInTheDocument();
    expect(within(sourceRow).getAllByText(/paste/)).toHaveLength(5);
    expect(within(sourceRow).getByText("+1")).toBeInTheDocument();
    expect(revenueRow.textContent).toContain("1,000");
    // EPS with two decimals, a missing value as a dash.
    expect(income.getByText("0.90")).toBeInTheDocument();
  });

  it("shows a statement with values but no recorded source with a dash chip, and hides the empty ones", () => {
    render(createElement(DatasetTables, { extract: EXTRACT }));
    const balance = within(screen.getByTestId("dataset-table-balance"));
    const sourceRow = balance.getAllByRole("row")[1];
    expect(within(sourceRow).getAllByText("—")).toHaveLength(5);
    expect(screen.queryByTestId("dataset-table-cashFlow")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dataset-table-estimates")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("dataset-table-multiples")).getByText("12.00")).toBeInTheDocument();
  });

  it("keeps the three most recent years when compact", () => {
    render(createElement(DatasetTables, { extract: EXTRACT, compact: true }));
    const header = within(screen.getByTestId("dataset-table-income")).getAllByRole("row")[0];
    expect(within(header).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "2023", "2024", "2025"]);
  });
});
