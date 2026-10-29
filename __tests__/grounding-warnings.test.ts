import { describe, it, expect } from "vitest";

import { buildBlockFailureWarnings, buildMarketImpliedWarnings, parseBlockFailureDetail } from "@/lib/grounding-warnings";
import type { MarketImplied } from "@/lib/grounding/anchors";
import type { GroundingBlock } from "@/types/grounding";
import { makeExtract, makeFinancialsRow, makeMeta, makeMultiplesRow } from "./grounding-test-helpers";

const COMPLETE_LATEST_FY = makeFinancialsRow({
  fiscalYear: 2025,
  ebitda: 14200,
  netDebt: 11500,
  minorityInterest: 3200,
  sharesDiluted: 3150,
});

const MARKET_IMPLIED: MarketImplied = {
  price: 15,
  driverLabel: "EBITDA",
  driverYear: 2025,
  impliedOnStatement: 4.4,
  impliedOnProvider: 4.4,
  percentile: 60,
  basisApplied: true,
};

describe("buildBlockFailureWarnings", () => {
  const blocks: Pick<GroundingBlock, "id" | "kind">[] = [
    { id: "a", kind: "income_statement" },
    { id: "b", kind: "balance_sheet" },
    { id: "c", kind: "cash_flow" },
    { id: "d", kind: "other" },
  ];
  const order = blocks.map((b) => b.id);

  it("emits one block_extract_failed per rejected block, with its kind and 1-based position", () => {
    const settled: PromiseSettledResult<unknown>[] = [
      { status: "fulfilled", value: {} },
      { status: "rejected", reason: new Error("bad JSON") },
      { status: "fulfilled", value: {} },
      { status: "rejected", reason: new Error("no fence") },
    ];

    const warnings = buildBlockFailureWarnings(settled, blocks, order);

    expect(warnings).toEqual([
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "balance_sheet #2" },
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "other #4" },
    ]);
  });

  it("counts the position in the block order, so a retried block keeps its place", () => {
    const [warning] = buildBlockFailureWarnings([{ status: "rejected", reason: new Error("x") }], [blocks[2]], order);
    expect(warning.detail).toBe("cash_flow #3");
    expect(parseBlockFailureDetail(warning.detail)).toEqual({ kind: "cash_flow", position: 3 });
    expect(parseBlockFailureDetail("#3")).toBeNull();
  });

  it("emits nothing when every block was extracted", () => {
    expect(buildBlockFailureWarnings([{ status: "fulfilled", value: {} }], [blocks[0]], order)).toEqual([]);
  });
});

describe("buildMarketImpliedWarnings", () => {
  it("emits nothing when the market-implied read exists", () => {
    const extract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }), financials: [COMPLETE_LATEST_FY] });
    expect(buildMarketImpliedWarnings(extract, "EUR", MARKET_IMPLIED)).toEqual([]);
  });

  it("names currency_mismatch first, even when bridge inputs are also missing", () => {
    const extract = makeExtract({ meta: makeMeta({ reportingCurrency: "GBP" }) });

    const warnings = buildMarketImpliedWarnings(extract, "EUR", null);

    expect(warnings).toEqual([{ code: "currency_mismatch", severity: "warn", fiscalYear: null, detail: "GBP vs EUR" }]);
  });

  it("names currency_mismatch when the reporting currency is unknown, instead of assuming a match", () => {
    const warnings = buildMarketImpliedWarnings(makeExtract({ financials: [COMPLETE_LATEST_FY] }), "EUR", null);

    expect(warnings).toEqual([{ code: "currency_mismatch", severity: "warn", fiscalYear: null, detail: "? vs EUR" }]);
  });

  it("names missing_bridge_inputs with the latest fiscal year when a bridge input is null", () => {
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [{ ...COMPLETE_LATEST_FY, minorityInterest: null }],
      multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4 })],
    });

    const warnings = buildMarketImpliedWarnings(extract, "EUR", null);

    expect(warnings).toEqual([{ code: "missing_bridge_inputs", severity: "info", fiscalYear: 2025, detail: "" }]);
  });

  it("names missing_bridge_inputs with no year when there are no financials at all", () => {
    const extract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }) });

    const warnings = buildMarketImpliedWarnings(extract, "EUR", null);

    expect(warnings).toEqual([{ code: "missing_bridge_inputs", severity: "info", fiscalYear: null, detail: "" }]);
  });

  it("names no_multiples when currency and bridge inputs are fine but there is no EV/EBITDA history", () => {
    const extract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }), financials: [COMPLETE_LATEST_FY] });

    const warnings = buildMarketImpliedWarnings(extract, "EUR", null);

    expect(warnings).toEqual([{ code: "no_multiples", severity: "info", fiscalYear: null, detail: "" }]);
  });
});
