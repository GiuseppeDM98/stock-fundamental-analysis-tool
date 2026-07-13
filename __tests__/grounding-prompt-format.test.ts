import { describe, it, expect } from "vitest";
import { formatGroundingForPrompt, buildGroundingPromptContext, type GroundingPromptContext } from "@/lib/grounding/prompt-format";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied, computeImpliedExpectations } from "@/lib/grounding/anchors";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";
import type { GroundingBlock } from "@/types/grounding";

// Eni-shaped fixture, same numbers as grounding-postcheck.test.ts, so the anchors below
// are internally consistent (bridge inputs tie to the EV/EBITDA history). No
// marketCap/evSales/enterpriseValue data ⇒ kE unverifiable in THIS fixture — the
// basis-verified case (kE mismatch, Iren-shaped) is its own describe block below.
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
  const basis = computeBasisReconciliation(EXTRACT);
  return {
    blocks: BLOCKS,
    extract: EXTRACT,
    basis,
    stats: computeMultipleStats(EXTRACT.multiples),
    grid: computeValuationGrid(EXTRACT, basis),
    marketImplied: computeMarketImplied(14.18, "EUR", EXTRACT, basis),
    impliedExpectations: computeImpliedExpectations(14.18, "EUR", EXTRACT, basis),
    warnings: checkReconciliation(EXTRACT, basis),
    ...overrides,
  };
}

describe("formatGroundingForPrompt", () => {
  it("renders sections in order: raw blocks, extract, anchors (basis reconciliation first)", () => {
    const text = formatGroundingForPrompt(buildContext());
    const authIdx = text.indexOf("AUTHORITATIVE FINANCIAL DATA");
    const extractIdx = text.indexOf("STRUCTURED EXTRACT");
    const anchorsIdx = text.indexOf("DETERMINISTIC ANCHORS");
    const basisIdx = text.indexOf("BASIS RECONCILIATION");
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(extractIdx).toBeGreaterThan(authIdx);
    expect(anchorsIdx).toBeGreaterThan(extractIdx);
    // Basis reconciliation renders FIRST inside the anchors section (spec §2.6).
    expect(basisIdx).toBeGreaterThan(anchorsIdx);
    expect(basisIdx).toBeLessThan(text.indexOf("EV/EBITDA (n=10)"));
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

  it("states the EV/EBITDA stats (raw only, kE unverifiable here) and the current peer multiple with its fiscal year", () => {
    const text = formatGroundingForPrompt(buildContext());
    expect(text).toContain("EV/EBITDA (n=10)");
    // median of [2.4,2.6,2.9,3.0,3.2,3.5,3.8,4.1,4.6,5.4] via type-7 interpolation: "3.4x"
    // (computeMultipleStats itself is covered by grounding-anchors.test.ts; this just
    // asserts the formatter renders whatever it computes).
    expect(text).toContain("median 3.4x");
    expect(text).not.toContain("same-basis, applicable"); // kE null here — no adjusted line
    expect(text).toContain("Peer current EV/EBITDA: SHEL 4.1x (FY2025)");
  });

  it("states the UNVERIFIABLE basis reconciliation when kE is null", () => {
    const text = formatGroundingForPrompt(buildContext());
    expect(text).toContain("UNVERIFIABLE: the pasted multiples table lacks EV/Revenue");
  });

  it("states the market-implied dual reading with the CONTROL-not-input reminder, using the real computed numbers", () => {
    const text = formatGroundingForPrompt(buildContext());
    // impliedOnStatement = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.18 (see grounding-postcheck.test.ts)
    expect(text).toContain("implies 4.18x EV/EBITDA on the income-statement basis");
    expect(text).toContain("basis unverified — no provider-basis read available");
    expect(text).toContain("CONTROL, not an input");
    expect(text).toContain("rigor item 10");
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

  it("the ANCHORS section is never omitted, even with zero history — the unverifiable basis notice is itself information the model must have", () => {
    const emptyExtract = makeExtract({ meta: makeMeta({ reportingCurrency: "EUR" }) });
    const emptyBasis = computeBasisReconciliation(emptyExtract);
    const text = formatGroundingForPrompt(
      buildContext({ extract: emptyExtract, basis: emptyBasis, stats: [], grid: null, marketImplied: null, impliedExpectations: null, warnings: [] })
    );
    expect(text).toContain("DETERMINISTIC ANCHORS");
    expect(text).toContain("UNVERIFIABLE");
  });
});

describe("formatGroundingForPrompt — basis-verified fixture (Iren-shaped)", () => {
  const statementEbitda = 1353;
  const years = [
    { fiscalYear: 2020, kE: 0.81, evEbitda: 6.6 },
    { fiscalYear: 2021, kE: 0.82, evEbitda: 6.9 },
    { fiscalYear: 2022, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2023, kE: 0.83, evEbitda: 7.1 },
    { fiscalYear: 2024, kE: 0.84, evEbitda: 7.3 },
    { fiscalYear: 2025, kE: 0.85, evEbitda: 7.6 },
  ];
  const irenExtract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
    financials: years.map((y) => makeFinancialsRow({ fiscalYear: y.fiscalYear, ebitda: statementEbitda })),
    multiples: years.map((y) => {
      const ebitdaProvider = y.kE * statementEbitda;
      return makeMultiplesRow({ fiscalYear: y.fiscalYear, evEbitda: y.evEbitda, enterpriseValue: y.evEbitda * ebitdaProvider });
    }),
  });
  const basis = computeBasisReconciliation(irenExtract);

  function irenContext(): GroundingPromptContext {
    return {
      blocks: [],
      extract: irenExtract,
      basis,
      stats: computeMultipleStats(irenExtract.multiples),
      grid: computeValuationGrid(irenExtract, basis),
      marketImplied: null,
      impliedExpectations: null,
      warnings: checkReconciliation(irenExtract, basis),
    };
  }

  it("renders the MANDATORY basis-mismatch variant with the haircut spelled out", () => {
    const text = formatGroundingForPrompt(irenContext());
    expect(text).toContain("NOT your judgment");
    expect(text).toContain("kE = 0.83");
    expect(text).toContain("FORBIDDEN to apply the raw table multiple (median 7.1x)");
    expect(text).toContain("same-basis equivalent is 5.9x");
  });

  it("labels the EV/EBITDA stats with both the same-basis and provider-basis lines", () => {
    const text = formatGroundingForPrompt(irenContext());
    expect(text).toContain("EV/EBITDA (same-basis, applicable to the income-statement EBITDA; n=6)");
    expect(text).toContain("EV/EBITDA (provider basis — do NOT multiply by the income-statement EBITDA)");
  });
});

describe("buildGroundingPromptContext", () => {
  it("recomputes basis/stats/grid/marketImplied/impliedExpectations/warnings from the extract + price/currency, never trusting a pre-computed copy", () => {
    const ctx = buildGroundingPromptContext(BLOCKS, EXTRACT, 14.18, "EUR");
    expect(ctx.blocks).toBe(BLOCKS);
    expect(ctx.extract).toBe(EXTRACT);
    expect(ctx.basis).toEqual(computeBasisReconciliation(EXTRACT));
    expect(ctx.stats.find((s) => s.key === "evEbitda")?.n).toBe(10);
    expect(ctx.grid).not.toBeNull();
    // marketImplied.impliedOnStatement = (14.18×3150 + 11500 + 3200) / 14200 ≈ 4.18 (same fixture as postcheck tests)
    expect(ctx.marketImplied?.impliedOnStatement).toBeCloseTo(4.180774648, 6);
    expect(ctx.warnings).toEqual(checkReconciliation(EXTRACT, ctx.basis));
  });

  it("passes through an empty blocks array (the analyst-lens case) and a null price (best-effort quote failure)", () => {
    const ctx = buildGroundingPromptContext([], EXTRACT, null, "EUR");
    expect(ctx.blocks).toEqual([]);
    // No price to back out a market-implied read from — degrades to null, not a throw.
    expect(ctx.marketImplied).toBeNull();
    expect(ctx.impliedExpectations).toBeNull();
  });
});
