import { describe, it, expect } from "vitest";
import { mergeExtractedBlocks, orderByBlockOrder, pasteSource, type BlockExtractResult } from "@/lib/grounding/merge";
import { EMPTY_ROW_SOURCES } from "@/types/dataset";
import { makeFinancialsRow, makeMultiplesRow, makeEstimateRow } from "./grounding-test-helpers";

/** A block result before the test names its block: `merge` numbers them b1, b2, … in order. */
type Draft = Omit<BlockExtractResult, "blockId">;
const merge = (results: Draft[]) => mergeExtractedBlocks(results.map((r, i) => ({ blockId: `b${i + 1}`, ...r })));

describe("mergeExtractedBlocks", () => {
  it("fuses income/balance/cash-flow blocks into one row per fiscalYear (disjoint fields)", () => {
    const results: Draft[] = [
      {
        kind: "income_statement",
        financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 120000, ebitda: 14200, ebit: 9800, netIncome: 3780, eps: 1.2 })],
      },
      {
        kind: "balance_sheet",
        financials: [
          makeFinancialsRow({
            fiscalYear: 2025,
            totalEquity: 45000,
            minorityInterest: 3200,
            totalDebt: 15000,
            cashAndEquivalents: 3500,
            netDebt: 11500,
            sharesDiluted: 3150,
          }),
        ],
      },
      {
        kind: "cash_flow",
        financials: [makeFinancialsRow({ fiscalYear: 2025, cfo: 9000, capex: -6000, freeCashFlow: 3000, dividendsPerShare: 0.94 })],
      },
    ];

    const { extract, warnings } = merge(results);
    expect(warnings).toEqual([]); // disjoint fields — no conflict possible
    expect(extract.financials).toHaveLength(1);
    expect(extract.financials[0]).toEqual(
      makeFinancialsRow({
        fiscalYear: 2025,
        revenue: 120000,
        ebitda: 14200,
        ebit: 9800,
        netIncome: 3780,
        eps: 1.2,
        totalEquity: 45000,
        minorityInterest: 3200,
        totalDebt: 15000,
        cashAndEquivalents: 3500,
        netDebt: 11500,
        sharesDiluted: 3150,
        cfo: 9000,
        capex: -6000,
        freeCashFlow: 3000,
        dividendsPerShare: 0.94,
        // sharesDiluted and dividendsPerShare are income-statement fields filled by the
        // balance-sheet and cash-flow blocks: the income statement is mixed.
        sources: {
          income: pasteSource("b1"),
          balance: pasteSource("b2"),
          cashFlow: pasteSource("b3"),
          mixed: { income: true, balance: false, cashFlow: false },
        },
      }),
    );
  });

  it("flags a >1% conflict on the same field/fiscalYear and keeps the first-seen value", () => {
    // |3780-4000|/3780 ≈ 5.82% > 1%
    const results: Draft[] = [
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 3780 })] },
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 4000 })] },
    ];

    const { extract, warnings } = merge(results);
    expect(extract.financials[0].netIncome).toBe(3780); // first-seen wins
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "value_conflict", fiscalYear: 2025 });
  });

  it("does not flag a conflict within the 1% tolerance", () => {
    // |3780-3800|/3780 ≈ 0.53% < 1%
    const results: Draft[] = [
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 3780 })] },
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2025, netIncome: 3800 })] },
    ];

    const { extract, warnings } = merge(results);
    expect(extract.financials[0].netIncome).toBe(3780);
    expect(warnings).toEqual([]);
  });

  it("sorts merged financials ascending by fiscalYear regardless of input order", () => {
    const results: Draft[] = [
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 2 })] },
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2023, revenue: 0 })] },
      { kind: "income_statement", financials: [makeFinancialsRow({ fiscalYear: 2024, revenue: 1 })] },
    ];
    const { extract } = merge(results);
    expect(extract.financials.map((f) => f.fiscalYear)).toEqual([2023, 2024, 2025]);
  });

  it("merges valuation_multiples rows the same way as financials", () => {
    const results: Draft[] = [
      { kind: "valuation_multiples", multiples: [makeMultiplesRow({ fiscalYear: 2024, evEbitda: 3.5 })] },
      { kind: "valuation_multiples", multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.4, pe: 8.2 })] },
    ];
    const { extract } = merge(results);
    expect(extract.multiples).toHaveLength(2);
    expect(extract.multiples[1]).toEqual(makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.4, pe: 8.2, source: pasteSource("b2") }));
  });

  it("merges estimates rows by fiscalYear", () => {
    const results: Draft[] = [
      { kind: "estimates", estimates: [makeEstimateRow({ fiscalYear: 2026, ebitda: 14900 })] },
      { kind: "estimates", estimates: [makeEstimateRow({ fiscalYear: 2026, revenue: 125000 })] },
    ];
    const { extract, warnings } = merge(results);
    expect(warnings).toEqual([]); // disjoint fields on the same year — no conflict
    expect(extract.estimates).toEqual([makeEstimateRow({ fiscalYear: 2026, ebitda: 14900, revenue: 125000, source: pasteSource("b1") })]);
  });

  it("groups peer_valuation blocks by peerTicker, separate from the subject's own multiples", () => {
    const results: Draft[] = [
      {
        kind: "peer_valuation",
        peerTicker: "SHEL",
        peerCompanyName: "Shell plc",
        multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4.1 })],
      },
      {
        kind: "peer_valuation",
        peerTicker: "SHEL",
        multiples: [makeMultiplesRow({ fiscalYear: 2024, evEbitda: 4.3 })],
      },
      {
        kind: "peer_valuation",
        peerTicker: "TTE",
        peerCompanyName: "TotalEnergies",
        multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.9 })],
      },
      // The subject's own multiples must stay OUT of `peers` and out of the top-level list
      // conflation — this block is NOT peer_valuation, so it lands in `extract.multiples`.
      { kind: "valuation_multiples", multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.4 })] },
    ];

    const { extract } = merge(results);
    expect(extract.multiples).toEqual([makeMultiplesRow({ fiscalYear: 2025, evEbitda: 3.4, source: pasteSource("b4") })]);
    expect(extract.peers).toHaveLength(2);
    const shel = extract.peers.find((p) => p.ticker === "SHEL")!;
    expect(shel.companyName).toBe("Shell plc");
    expect(shel.multiples.map((m) => m.fiscalYear)).toEqual([2024, 2025]);
    const tte = extract.peers.find((p) => p.ticker === "TTE")!;
    expect(tte.companyName).toBe("TotalEnergies");
  });

  it("first non-null value wins per meta field across statement blocks, and a currency clash is warned, not silently outvoted", () => {
    const results: Draft[] = [
      { kind: "income_statement", meta: { reportingCurrency: "EUR" } },
      { kind: "balance_sheet", meta: { reportingCurrency: "USD", units: "millions" } },
    ];
    const { extract, warnings } = merge(results);
    expect(extract.meta.reportingCurrency).toBe("EUR"); // first-seen wins
    expect(extract.meta.units).toBe("millions"); // only source — fills the gap
    expect(warnings).toEqual([{ code: "meta_currency_conflict", severity: "warn", fiscalYear: null, detail: "EUR vs USD" }]);
  });

  it("a peer block in another currency never sets the subject's reportingCurrency (and isn't a conflict)", () => {
    const results: Draft[] = [
      // The peer comes FIRST — under a first-non-null-across-all-blocks rule it would win.
      { kind: "peer_valuation", peerTicker: "SHEL", meta: { reportingCurrency: "USD", units: "billions" }, multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4.1 })] },
      { kind: "income_statement", meta: { reportingCurrency: "EUR", units: "millions" } },
    ];
    const { extract, warnings } = merge(results);
    expect(extract.meta.reportingCurrency).toBe("EUR");
    expect(extract.meta.units).toBe("millions");
    expect(warnings).toEqual([]);
  });

  it("an estimates block's (future) label never becomes the coverage date", () => {
    const results: Draft[] = [
      { kind: "estimates", meta: { latestPeriodLabel: "FY2027" }, estimates: [makeEstimateRow({ fiscalYear: 2027, ebitda: 1 })] },
      { kind: "income_statement", meta: { latestPeriodLabel: "FY2025" } },
    ];
    expect(merge(results).extract.meta.latestPeriodLabel).toBe("FY2025");
  });

  it("takes the LATEST coverage label across statement blocks, not the first", () => {
    const results: Draft[] = [
      { kind: "income_statement", meta: { latestPeriodLabel: "FY2025" } },
      { kind: "balance_sheet", meta: { latestPeriodLabel: "Q1 2026" } }, // 2026 × 12 + 3 > 2025 × 12 + 12
      { kind: "cash_flow", meta: { latestPeriodLabel: "H1 2025" } },
    ];
    expect(merge(results).extract.meta.latestPeriodLabel).toBe("Q1 2026");
  });

  it("orders quarter labels within the same year and falls back to the first label when none is datable", () => {
    expect(
      merge([
        { kind: "income_statement", meta: { latestPeriodLabel: "Q2 2026" } },
        { kind: "balance_sheet", meta: { latestPeriodLabel: "Q3 2026" } },
      ]).extract.meta.latestPeriodLabel
    ).toBe("Q3 2026");
    expect(
      merge([
        { kind: "income_statement", meta: { latestPeriodLabel: "latest" } },
        { kind: "balance_sheet", meta: { latestPeriodLabel: "most recent" } },
      ]).extract.meta.latestPeriodLabel
    ).toBe("latest");
  });

  it("warns on a thousands-vs-millions clash between statement blocks (every ratio would be off by 1000×)", () => {
    const results: Draft[] = [
      { kind: "income_statement", meta: { units: "millions" } },
      { kind: "balance_sheet", meta: { units: "thousands" } },
      { kind: "cash_flow", meta: { units: "thousands" } }, // same clash again — reported once
    ];
    const { extract, warnings } = merge(results);
    expect(extract.meta.units).toBe("millions");
    expect(warnings).toEqual([{ code: "meta_units_conflict", severity: "warn", fiscalYear: null, detail: "millions vs thousands" }]);
  });

  it("an estimates block in a different unit scale is warned (its EBITDA feeds the grid) but never sets meta", () => {
    const results: Draft[] = [
      { kind: "estimates", meta: { units: "billions", reportingCurrency: "EUR" }, estimates: [makeEstimateRow({ fiscalYear: 2026, ebitda: 15 })] },
      { kind: "income_statement", meta: { units: "millions", reportingCurrency: "EUR" } },
    ];
    const { extract, warnings } = merge(results);
    expect(extract.meta.units).toBe("millions");
    expect(warnings.map((w) => w.code)).toEqual(["meta_units_conflict"]);
  });

  it("an 'other' block counts as a statement source only when it contributed financials/multiples rows", () => {
    const withRows = merge([
      { kind: "other", meta: { reportingCurrency: "CHF" }, financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1 })] },
    ]);
    expect(withRows.extract.meta.reportingCurrency).toBe("CHF");
    const estimatesOnly = merge([
      { kind: "other", meta: { reportingCurrency: "CHF", latestPeriodLabel: "FY2027" }, estimates: [makeEstimateRow({ fiscalYear: 2027 })] },
    ]);
    expect(estimatesOnly.extract.meta.reportingCurrency).toBeNull();
    expect(estimatesOnly.extract.meta.latestPeriodLabel).toBeNull();
  });

  it("returns an empty, well-shaped extract on garbage/empty input", () => {
    const { extract, warnings } = merge([]);
    expect(warnings).toEqual([]);
    expect(extract).toEqual({
      meta: { reportingCurrency: null, units: null, latestPeriodLabel: null, fiscalYearEnd: null },
      financials: [],
      multiples: [],
      estimates: [],
      peers: [],
    });
  });
});

describe("mergeExtractedBlocks provenance", () => {
  it("attributes each statement to the block that filled it, with every row's source its own object", () => {
    const { extract } = mergeExtractedBlocks([
      { kind: "income_statement", blockId: "blk-is", financials: [makeFinancialsRow({ fiscalYear: 2024, revenue: 900 }), makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 })] },
      { kind: "balance_sheet", blockId: "blk-bs", financials: [makeFinancialsRow({ fiscalYear: 2025, totalDebt: 400 })] },
    ]);
    const [fy2024, fy2025] = extract.financials;
    expect(fy2025.sources).toEqual({
      income: pasteSource("blk-is"),
      balance: pasteSource("blk-bs"),
      cashFlow: null,
      mixed: { income: false, balance: false, cashFlow: false },
    });
    expect(fy2024.sources.balance).toBeNull();
    expect(fy2024.sources.income).not.toBe(fy2025.sources.income);
  });

  it("attributes an 'other' block field by field, through the field → statement map", () => {
    const { extract } = mergeExtractedBlocks([
      { kind: "other", blockId: "blk-other", financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 200, capex: -50 })] },
    ]);
    expect(extract.financials[0].sources).toEqual({
      income: pasteSource("blk-other"),
      balance: null,
      cashFlow: pasteSource("blk-other"),
      mixed: { income: false, balance: false, cashFlow: false },
    });
  });

  it("marks a statement mixed when a second block fills one of its empty fields, and keeps the first as its source", () => {
    const { extract } = mergeExtractedBlocks([
      { kind: "income_statement", blockId: "blk-1", financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 })] },
      { kind: "income_statement", blockId: "blk-2", financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000, eps: 2 })] },
    ]);
    expect(extract.financials[0].sources.income).toEqual(pasteSource("blk-1"));
    expect(extract.financials[0].sources.mixed).toEqual({ income: true, balance: false, cashFlow: false });
  });

  it("names both blocks of a conflict by kind and 1-based place in the editor order", () => {
    const { warnings } = mergeExtractedBlocks(
      [
        { kind: "income_statement", blockId: "blk-is", financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 100 })] },
        { kind: "other", blockId: "blk-other", financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 103 })] },
      ],
      // A peer block sits between them in the editor: the "other" block is the third.
      ["blk-is", "blk-peer", "blk-other"]
    );
    expect(warnings).toEqual([
      { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "ebitda: 100 (income_statement #1) vs 103 (other #3)" },
    ]);
  });

  it("leaves the input rows and EMPTY_ROW_SOURCES untouched", () => {
    const incomeRow = makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 });
    const balanceRow = makeFinancialsRow({ fiscalYear: 2025, totalDebt: 400 });
    const multiplesRow = makeMultiplesRow({ fiscalYear: 2025, pe: 12 });
    const before = structuredClone([incomeRow, balanceRow, multiplesRow]);
    const { extract } = mergeExtractedBlocks([
      { kind: "income_statement", blockId: "blk-1", financials: [incomeRow] },
      { kind: "balance_sheet", blockId: "blk-2", financials: [balanceRow] },
      { kind: "valuation_multiples", blockId: "blk-3", multiples: [multiplesRow] },
    ]);
    extract.financials[0].sources.mixed.income = true;
    expect([incomeRow, balanceRow, multiplesRow]).toEqual(before);
    expect(EMPTY_ROW_SOURCES).toEqual({ income: null, balance: null, cashFlow: null, mixed: { income: false, balance: false, cashFlow: false } });
    expect(Object.isFrozen(EMPTY_ROW_SOURCES.mixed)).toBe(true);
  });
});

describe("orderByBlockOrder", () => {
  it("sorts results into the editor order and drops a block no longer in it", () => {
    const results = [
      { kind: "balance_sheet", blockId: "b" },
      { kind: "income_statement", blockId: "gone" },
      { kind: "income_statement", blockId: "a" },
    ] satisfies BlockExtractResult[];
    expect(orderByBlockOrder(results, ["a", "b"]).map((r) => r.blockId)).toEqual(["a", "b"]);
  });
});
