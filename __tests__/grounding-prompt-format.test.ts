import { describe, it, expect } from "vitest";
import { formatGroundingForPrompt, buildGroundingPromptContext, type GroundingPromptContext } from "@/lib/grounding/prompt-format";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied } from "@/lib/grounding/anchors";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";
import type { GroundingBlock } from "@/types/grounding";

// Eni-shaped fixture, same numbers as grounding-postcheck.test.ts, so the anchors below
// are internally consistent (bridge inputs tie to the EV/EBITDA history).
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions", latestPeriodLabel: "FY2025" }),
  financials: [
    makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 }),
  ],
  multiples: [2.4, 2.6, 2.9, 3.0, 3.2, 3.5, 3.8, 4.1, 4.6, 5.4].map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2016 + i, evEbitda })),
  peers: [{ ticker: "SHEL", companyName: "Shell plc", multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4.1 })] }],
});

const BLOCKS: GroundingBlock[] = [
  { id: "1", kind: "balance_sheet", text: "Net debt 11500, minorities 3200, shares 3150" },
  { id: "2", kind: "peer_valuation", peerTicker: "SHEL", text: "EV/EBITDA 4.1x" },
];

function buildContext(overrides: Partial<GroundingPromptContext> = {}): GroundingPromptContext {
  return {
    blocks: BLOCKS,
    extract: EXTRACT,
    stats: computeMultipleStats(EXTRACT.multiples),
    grid: computeValuationGrid(EXTRACT),
    marketImplied: computeMarketImplied(14.18, "EUR", EXTRACT),
    warnings: checkReconciliation(EXTRACT),
    ...overrides,
  };
}

describe("formatGroundingForPrompt", () => {
  it("renders all four sections, in order, when every input is present", () => {
    const text = formatGroundingForPrompt(buildContext());
    const authIdx = text.indexOf("AUTHORITATIVE FINANCIAL DATA");
    const extractIdx = text.indexOf("STRUCTURED EXTRACT");
    const anchorsIdx = text.indexOf("DETERMINISTIC ANCHORS");
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(extractIdx).toBeGreaterThan(authIdx);
    expect(anchorsIdx).toBeGreaterThan(extractIdx);
  });

  it("labels each raw block by kind, and a peer block by its ticker", () => {
    const text = formatGroundingForPrompt(buildContext());
    expect(text).toContain("[Balance sheet]\nNet debt 11500, minorities 3200, shares 3150");
    expect(text).toContain("[Peer valuation — SHEL]\nEV/EBITDA 4.1x");
  });

  it("embeds the structured extract as parseable JSON", () => {
    const text = formatGroundingForPrompt(buildContext());
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.meta.reportingCurrency).toBe("EUR");
    expect(parsed.financials[0].ebitda).toBe(14200);
  });

  it("states the EV/EBITDA stats and the current peer multiple", () => {
    const text = formatGroundingForPrompt(buildContext());
    expect(text).toContain("EV/EBITDA (n=10)");
    // median of [2.4,2.6,2.9,3.0,3.2,3.5,3.8,4.1,4.6,5.4] via type-7 interpolation:
    // h=(10-1)*0.5=4.5 → sorted[4]=3.2, sorted[5]=3.5 → 3.2+0.5*(3.5-3.2)=3.35 → "3.4x"
    // (computeMultipleStats itself is covered by grounding-anchors.test.ts; this just
    // asserts the formatter renders whatever it computes).
    expect(text).toContain("median 3.4x");
    expect(text).toContain("Peer current EV/EBITDA: SHEL 4.1x");
  });

  it("states the market-implied multiple/percentile with the CONTROL-not-input reminder, using the real computed number", () => {
    const text = formatGroundingForPrompt(buildContext());
    // marketImplied = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.18 (see grounding-postcheck.test.ts)
    expect(text).toContain("implies 4.18x EV/EBITDA");
    expect(text).toContain("CONTROL, not an input");
    expect(text).toContain("rigor item 10");
  });

  it("omits the ANCHORS section entirely when there is no history, grid, or market-implied read", () => {
    const emptyExtract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }) });
    const text = formatGroundingForPrompt(
      buildContext({ extract: emptyExtract, stats: [], grid: null, marketImplied: null, warnings: [] })
    );
    expect(text).not.toContain("DETERMINISTIC ANCHORS");
  });

  it("omits the WARNINGS section when there are none, and includes it (with the code + detail) when there are", () => {
    const clean = formatGroundingForPrompt(buildContext({ warnings: [] }));
    expect(clean).not.toContain("RECONCILIATION WARNINGS");

    const withWarning = formatGroundingForPrompt(
      buildContext({ warnings: [{ code: "share_count_jump", severity: "warn", fiscalYear: 2025, detail: "3300 → 3150 (4.5%)" }] })
    );
    expect(withWarning).toContain("RECONCILIATION WARNINGS");
    expect(withWarning).toContain("share_count_jump (FY2025) — 3300 → 3150 (4.5%)");
  });

  it("omits the AUTHORITATIVE FINANCIAL DATA section when blocks is empty (the analyst-lens case, spec §6.4)", () => {
    const text = formatGroundingForPrompt(buildContext({ blocks: [] }));
    expect(text).not.toContain("AUTHORITATIVE FINANCIAL DATA");
    // The rest still renders — lenses still get extract + anchors + warnings.
    expect(text).toContain("STRUCTURED EXTRACT");
    expect(text).toContain("DETERMINISTIC ANCHORS");
  });
});

describe("buildGroundingPromptContext", () => {
  it("recomputes stats/grid/marketImplied/warnings from the extract + price/currency, never trusting a pre-computed copy", () => {
    const ctx = buildGroundingPromptContext(BLOCKS, EXTRACT, 14.18, "EUR");
    expect(ctx.blocks).toBe(BLOCKS);
    expect(ctx.extract).toBe(EXTRACT);
    expect(ctx.stats.find((s) => s.key === "evEbitda")?.n).toBe(10);
    expect(ctx.grid).not.toBeNull();
    // marketImplied = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.18 (same fixture as postcheck tests)
    expect(ctx.marketImplied?.impliedMultiple).toBeCloseTo(4.180774648, 6);
    expect(ctx.warnings).toEqual(checkReconciliation(EXTRACT));
  });

  it("passes through an empty blocks array (the analyst-lens case) and a null price (best-effort quote failure)", () => {
    const ctx = buildGroundingPromptContext([], EXTRACT, null, "EUR");
    expect(ctx.blocks).toEqual([]);
    // No price to back out a market-implied read from — degrades to null, not a throw.
    expect(ctx.marketImplied).toBeNull();
  });
});
