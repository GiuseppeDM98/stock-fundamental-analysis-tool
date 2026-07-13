import { describe, it, expect } from "vitest";
import { buildDeepValueSystemPrompt, buildDeepValueUserPrompt, buildAnalystSystemPrompt, buildAnalystUserPrompt } from "@/lib/ai/deep-value-prompts";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";
import type { GroundingBlock } from "@/types/grounding";

const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 })],
  multiples: [3.0, 3.8, 4.6].map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2023 + i, evEbitda })),
});
const BLOCKS: GroundingBlock[] = [{ id: "1", kind: "balance_sheet", text: "some pasted table" }];
const GROUNDING = buildGroundingPromptContext(BLOCKS, EXTRACT, 14.18, "EUR");

describe("Quick mode stays untouched by the grounding param", () => {
  it("buildDeepValueSystemPrompt omits GROUNDED_RULES_BLOCK when grounding is not passed", () => {
    const withNoArg = buildDeepValueSystemPrompt({ language: "English", currentDate: "July 12, 2026", mosPercent: 20 });
    const withExplicitUndefined = buildDeepValueSystemPrompt({
      language: "English",
      currentDate: "July 12, 2026",
      mosPercent: 20,
      grounding: undefined,
    });
    expect(withNoArg).toBe(withExplicitUndefined);
    expect(withNoArg).not.toContain("Grounded mode");
  });

  it("buildDeepValueUserPrompt appends nothing when grounding is not passed", () => {
    const withNoArg = buildDeepValueUserPrompt({ ticker: "ENI.MI", currentPrice: 14.18, currency: "EUR", language: "English" });
    const withExplicitUndefined = buildDeepValueUserPrompt({
      ticker: "ENI.MI",
      currentPrice: 14.18,
      currency: "EUR",
      language: "English",
      grounding: undefined,
    });
    expect(withNoArg).toBe(withExplicitUndefined);
    expect(withNoArg).not.toContain("AUTHORITATIVE FINANCIAL DATA");
  });

  it("buildAnalystSystemPrompt/buildAnalystUserPrompt omit the grounding markers when grounding is not passed (commit 7)", () => {
    const sys = buildAnalystSystemPrompt({ angle: "optimist", language: "English", currentDate: "July 12, 2026", mosPercent: 20 });
    expect(sys).not.toContain("Grounded mode");
    const usr = buildAnalystUserPrompt({ angle: "optimist", ticker: "ENI.MI", reportMd: "# R\nBody", language: "English" });
    expect(usr).not.toContain("STRUCTURED EXTRACT");
  });
});

describe("Grounded mode injects the rules block + the data section", () => {
  it("buildDeepValueSystemPrompt injects GROUNDED_RULES_BLOCK, between Step 2 and Step 3, only when grounding is passed", () => {
    const sys = buildDeepValueSystemPrompt({ language: "English", currentDate: "July 12, 2026", mosPercent: 20, grounding: GROUNDING });
    expect(sys).toContain("Grounded mode — using the user-provided data");
    expect(sys).toContain("Do not search the web for historical data already provided");
    // The rules must land AFTER Step 2 (data gathering) and BEFORE Step 3 (scenarios) —
    // otherwise the model reads "search for financial data" instructions before the
    // "don't re-search what's provided" override, in the wrong order.
    const step2Idx = sys.indexOf("## Step 2");
    const groundedIdx = sys.indexOf("Grounded mode");
    const step3Idx = sys.indexOf("## Step 3");
    expect(step2Idx).toBeLessThan(groundedIdx);
    expect(groundedIdx).toBeLessThan(step3Idx);
  });

  it("buildDeepValueUserPrompt appends the formatted grounding section after the base prompt", () => {
    const usr = buildDeepValueUserPrompt({
      ticker: "ENI.MI",
      currentPrice: 14.18,
      currency: "EUR",
      language: "English",
      grounding: GROUNDING,
    });
    expect(usr).toContain("Analyze ENI.MI.");
    expect(usr).toContain("AUTHORITATIVE FINANCIAL DATA");
    expect(usr).toContain("some pasted table");
    expect(usr.indexOf("AUTHORITATIVE FINANCIAL DATA")).toBeGreaterThan(usr.indexOf("Analyze ENI.MI."));
  });
});

describe("Grounded mode reaches the analyst lenses too (commit 7)", () => {
  // The lenses get extract + anchors + warnings, never the raw paste (spec §6.4) —
  // this fixture's blocks are intentionally empty, mirroring how the verify route
  // calls buildGroundingPromptContext([], ...) after re-reading Analysis.groundingJson.
  const LENS_GROUNDING = { ...GROUNDING, blocks: [] };

  it("buildAnalystSystemPrompt injects GROUNDED_RULES_BLOCK, between the structural checks and the valuation section", () => {
    const sys = buildAnalystSystemPrompt({ angle: "skeptic", language: "English", mosPercent: 20, grounding: LENS_GROUNDING });
    expect(sys).toContain("Grounded mode — using the user-provided data");
    const structuralIdx = sys.indexOf("Structural checks");
    const groundedIdx = sys.indexOf("Grounded mode");
    const valuationIdx = sys.indexOf("Your own independent valuation");
    expect(structuralIdx).toBeLessThan(groundedIdx);
    expect(groundedIdx).toBeLessThan(valuationIdx);
  });

  it("buildAnalystUserPrompt appends the anchors/extract/warnings but NOT the raw-paste section", () => {
    const usr = buildAnalystUserPrompt({
      angle: "skeptic",
      ticker: "ENI.MI",
      reportMd: "# R\nBody",
      language: "English",
      grounding: LENS_GROUNDING,
    });
    expect(usr).toContain("STRUCTURED EXTRACT");
    expect(usr).toContain("DETERMINISTIC ANCHORS");
    expect(usr).not.toContain("AUTHORITATIVE FINANCIAL DATA");
  });
});
