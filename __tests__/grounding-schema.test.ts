import { describe, it, expect } from "vitest";
import {
  dataSourceSchema,
  estimateRowSchema,
  financialsRowSchema,
  groundingPayloadSchema,
  multiplesRowSchema,
  parseStoredExtract,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_TOTAL_CHARS,
} from "@/lib/grounding/schema";
import type { GroundingBlock } from "@/types/grounding";
import { EMPTY_ROW_SOURCES, type DataSource } from "@/types/dataset";
import { makeExtract, makeFinancialsRow, makeMultiplesRow } from "./grounding-test-helpers";

function payload(blocks: GroundingBlock[]) {
  return { blocks, extract: makeExtract() };
}

function block(i: number, overrides: Partial<GroundingBlock> = {}): GroundingBlock {
  return { id: String(i), kind: "income_statement", text: "Revenue 100", ...overrides };
}

describe("groundingPayloadSchema — boundary caps", () => {
  it("accepts a normal payload", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1), block(2, { kind: "peer_valuation", peerTicker: "SHEL" })])).success).toBe(true);
  });

  it("rejects more than GROUNDING_MAX_BLOCKS blocks", () => {
    const blocks = Array.from({ length: GROUNDING_MAX_BLOCKS + 1 }, (_, i) => block(i));
    expect(groundingPayloadSchema.safeParse(payload(blocks)).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload(blocks.slice(0, GROUNDING_MAX_BLOCKS))).success).toBe(true);
  });

  it("rejects a total paste above GROUNDING_MAX_TOTAL_CHARS even when every block is under its own cap", () => {
    // 5 full blocks = 5 × 40000 = 200000 (exactly at the cap) — one more character tips it over.
    const full = (i: number) => block(i, { text: "x".repeat(GROUNDING_MAX_BLOCK_CHARS) });
    const atCap = [1, 2, 3, 4, 5].map(full);
    expect(GROUNDING_MAX_BLOCK_CHARS * 5).toBe(GROUNDING_MAX_TOTAL_CHARS);
    expect(groundingPayloadSchema.safeParse(payload(atCap)).success).toBe(true);
    expect(groundingPayloadSchema.safeParse(payload([...atCap, block(6, { text: "x" })])).success).toBe(false);
  });

  it("still enforces the per-block cap", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1, { text: "x".repeat(GROUNDING_MAX_BLOCK_CHARS + 1) })])).success).toBe(false);
  });

  it("requires a non-empty peerTicker on peer_valuation blocks only", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "peer_valuation" })])).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "peer_valuation", peerTicker: "   " })])).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "balance_sheet" })])).success).toBe(true);
  });
});

describe("parseStoredExtract — Analysis.groundingJson read back", () => {
  const extract = makeExtract({
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 100 })],
    multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 6 })],
  });

  it("returns the extract of a stored payload", () => {
    expect(parseStoredExtract(JSON.stringify({ blocks: [block(1)], extract }))).toEqual(extract);
  });

  it("reads an extract saved before marketCap/enterpriseValue existed, with both null", () => {
    const { marketCap: _m, enterpriseValue: _e, ...oldRow } = extract.multiples[0];
    const parsed = parseStoredExtract(JSON.stringify({ blocks: [], extract: { ...extract, multiples: [oldRow] } }));
    expect(parsed?.multiples[0]).toMatchObject({ evEbitda: 6, marketCap: null, enterpriseValue: null });
  });

  it("reads an extract saved before rows carried sources, with every source null and nothing mixed", () => {
    // The shape of an analysis saved before the dataset table: no `sources`, no `source`.
    const v1 = {
      meta: { reportingCurrency: "EUR", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" },
      financials: [2024, 2025].map((fiscalYear) => {
        const { sources: _s, ...row } = makeFinancialsRow({ fiscalYear, revenue: 1000, totalDebt: 400, cfo: 150 });
        return row;
      }),
      multiples: [{ fiscalYear: 2025, evEbitda: 8, evSales: 1.6, pe: 12, pb: 1.5, fcfYield: 6, dividendYield: 4, marketCap: 1200, enterpriseValue: 1600 }],
      estimates: [{ fiscalYear: 2026, revenue: 1050, ebitda: 210, ebit: 165, netIncome: 95, eps: 0.95 }],
      peers: [{ ticker: "PEER.MI", companyName: null, multiples: [{ fiscalYear: 2025, evEbitda: 9, evSales: null, pe: null, pb: null, fcfYield: null, dividendYield: null }] }],
    };
    const parsed = parseStoredExtract(JSON.stringify({ blocks: [], extract: v1 }));
    expect(parsed?.financials.map((f) => f.sources)).toEqual([EMPTY_ROW_SOURCES, EMPTY_ROW_SOURCES]);
    // Each row got its own object from the factory, not one shared default.
    expect(parsed?.financials[0].sources.mixed).not.toBe(parsed?.financials[1].sources.mixed);
    expect(parsed?.multiples[0].source).toBeNull();
    expect(parsed?.estimates[0].source).toBeNull();
    expect(parsed?.peers[0].multiples[0].source).toBeNull();
  });

  it("exports the row schemas, which keep a written source", () => {
    const source: DataSource = { kind: "web", url: "https://example.com/ar-2025.pdf", title: "Annual report 2025", asOf: "2026-03-01", blockId: null, verified: false };
    expect(multiplesRowSchema.parse(makeMultiplesRow({ fiscalYear: 2025, pe: 12, source })).source).toEqual(source);
    expect(estimateRowSchema.parse({ fiscalYear: 2026, revenue: 1, ebitda: null, ebit: null, netIncome: null, eps: null }).source).toBeNull();
    expect(financialsRowSchema.safeParse(makeFinancialsRow({ fiscalYear: 2025 })).success).toBe(true);
    expect(dataSourceSchema.safeParse({ ...source, kind: "fax" }).success).toBe(false);
  });

  it("reads a partial extract (no financials) as no dataset, not as a shape the gates would crash on", () => {
    const { financials: _f, ...partial } = extract;
    expect(parseStoredExtract(JSON.stringify({ blocks: [], extract: partial }))).toBeNull();
  });

  it("reads malformed JSON, a payload without an extract and an empty column as null", () => {
    expect(parseStoredExtract("{not json")).toBeNull();
    expect(parseStoredExtract(JSON.stringify({ blocks: [] }))).toBeNull();
    expect(parseStoredExtract(null)).toBeNull();
  });
});
