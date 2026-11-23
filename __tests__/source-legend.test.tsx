import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { SourceLegend } from "@/components/report/source-legend";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources, type DataSource } from "@/types/dataset";
import type { GroundedFinancials } from "@/types/grounding";
import { makeExtract, makeFinancialsRow } from "./grounding-test-helpers";

const report: DataSource = { kind: "web", url: "https://ir.example.com/ar.pdf", title: "Annual report", asOf: null, blockId: null, verified: true };

function extractWith(rows: Array<{ income: DataSource | null; cashFlow?: DataSource | null } | "legacy">): GroundedFinancials {
  return makeExtract({
    financials: rows.map((r, i) => {
      const row = makeFinancialsRow({ fiscalYear: 2021 + i });
      // A blob saved before rows carried their sources has no `sources` key at all.
      if (r === "legacy") return { ...row, sources: undefined } as unknown as typeof row;
      return { ...row, sources: { ...emptyRowSources(), income: r.income, cashFlow: r.cashFlow ?? null } };
    }),
  });
}

describe("SourceLegend", () => {
  it("one chip per site, with the years its pages filled and their titles in the tooltip", () => {
    const results: DataSource = { ...report, url: "https://ir.example.com/results-2024", title: "Results 2024" };
    const extract = extractWith([{ income: report }, { income: results }, { income: report }]);
    render(createElement(SourceLegend, { extract, statement: "income" }));
    const chip = screen.getByText("🌐 ir.example.com");
    expect(screen.getAllByText("🌐 ir.example.com")).toHaveLength(1);
    expect(screen.getByText("×3")).toBeTruthy();
    expect(chip.getAttribute("title")).toBe("Annual report · Results 2024");
  });

  it("keeps a site's unverified pages apart, so «unverified» is never hidden", () => {
    const cited: DataSource = { ...report, url: "https://ir.example.com/cited", verified: false };
    render(createElement(SourceLegend, { extract: extractWith([{ income: report }, { income: cited }]), statement: "income" }));
    expect(screen.getAllByText(/ir\.example\.com/)).toHaveLength(2);
    expect(screen.getByText(/· unverified/)).toBeTruthy();
  });

  it("every pasted block is one «paste» chip", () => {
    render(createElement(SourceLegend, { extract: extractWith([{ income: pasteSource("blk-1") }, { income: pasteSource("blk-2") }]), statement: "income" }));
    expect(screen.getAllByText("📋 paste")).toHaveLength(1);
    expect(screen.getByText("×2")).toBeTruthy();
  });

  it("lists the paste and each site once, with the number of years each filled", () => {
    const extract = extractWith([{ income: pasteSource("blk-1") }, { income: pasteSource("blk-1") }, { income: report }, { income: null }]);
    render(createElement(SourceLegend, { extract, statement: "income" }));
    expect(screen.getByText("Sources:")).toBeTruthy();
    expect(screen.getByText("📋 paste")).toBeTruthy();
    expect(screen.getByText("🌐 ir.example.com")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.getByText("×1")).toBeTruthy();
  });

  it("reads only the statement asked for, every statement without one", () => {
    const extract = extractWith([{ income: null, cashFlow: report }]);
    const { container } = render(createElement(SourceLegend, { extract, statement: "income" }));
    expect(container.innerHTML).toBe("");
    render(createElement(SourceLegend, { extract }));
    expect(screen.getByText("🌐 ir.example.com")).toBeTruthy();
  });

  it("ignores rows without sources, and draws nothing when no row has one", () => {
    const { container } = render(createElement(SourceLegend, { extract: extractWith(["legacy", "legacy"]), statement: "income" }));
    expect(container.innerHTML).toBe("");
    render(createElement(SourceLegend, { extract: extractWith(["legacy", { income: report }]), statement: "income" }));
    expect(screen.getByText("×1")).toBeTruthy();
  });

  it("draws nothing without an extract", () => {
    const { container } = render(createElement(SourceLegend, { extract: null }));
    expect(container.innerHTML).toBe("");
  });
});
