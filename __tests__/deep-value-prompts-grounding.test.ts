import { describe, it, expect } from "vitest";
import { buildDeepValueSystemPrompt, buildDeepValueUserPrompt, buildAnalystSystemPrompt, buildAnalystUserPrompt, buildAnalystReconcileUserPrompt } from "@/lib/ai/deep-value-prompts";
import { CRITIQUE_START_MARKER } from "@/lib/report/parse-deep-value-json";
import { buildGroundingPromptContext, formatGroundingForPrompt, formatRowSources } from "@/lib/grounding/prompt-format";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources, type DataSource } from "@/types/dataset";
import { makeEstimateRow, makeFinancialsRow, makeMultiplesRow, makeExtract, makeMeta } from "./grounding-test-helpers";
import type { GroundingBlock } from "@/types/grounding";

const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 })],
  multiples: [3.0, 3.8, 4.6].map((evEbitda, i) => makeMultiplesRow({ fiscalYear: 2023 + i, evEbitda })),
});
const BLOCKS: GroundingBlock[] = [{ id: "1", kind: "balance_sheet", text: "some pasted table" }];
const GROUNDING = buildGroundingPromptContext(BLOCKS, EXTRACT, 10, "EUR");
// The lenses get extract + anchors + warnings, never the raw paste — the verify route
// calls buildGroundingPromptContext([], ...) after re-reading the analysis's dataset.
const LENS_GROUNDING = { ...GROUNDING, blocks: [] };

const SYSTEM = buildDeepValueSystemPrompt({ language: "English", currentDate: "July 12, 2026", mosPercent: 20, grounding: GROUNDING });

function web(url: string, verified: boolean): DataSource {
  return { kind: "web", url, title: null, asOf: null, blockId: null, verified };
}

describe("The dataset rules block and the data section", () => {
  it("buildDeepValueSystemPrompt injects DATASET_RULES_BLOCK between Step 2 and Step 3", () => {
    expect(SYSTEM).toContain("## Financial dataset — how to use it (MANDATORY)");
    expect(SYSTEM).toContain("The financial dataset below was transcribed from documents the user pasted and/or researched from primary sources, with a source per row");
    // The rules must land AFTER Step 2 (data gathering) and BEFORE Step 3 (scenarios) —
    // otherwise the model reads "gather the data" before the "don't re-collect what's
    // provided" override, in the wrong order.
    const step2Idx = SYSTEM.indexOf("## Step 2");
    const rulesIdx = SYSTEM.indexOf("## Financial dataset — how to use it");
    const step3Idx = SYSTEM.indexOf("## Step 3");
    expect(step2Idx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(step3Idx);
    expect(SYSTEM).not.toContain("Grounded mode");
  });

  it("states the rescoped web search (1), the dataset winning on history unless restated (3), unverified rows (11) and the declared units (12)", () => {
    expect(SYSTEM).toContain(
      "Web search is for what the dataset cannot hold: anything published after `meta.latestPeriodLabel`, qualitative context (moat, risks, catalysts, guidance) and restatements. Never re-collect a historical figure the dataset already has."
    );
    expect(SYSTEM).toContain(
      "On conflict between a web figure and the dataset on a HISTORICAL figure, the dataset wins — unless the web source is a restatement published after `meta.latestPeriodLabel`, in which case use the restated figure and say so in the Data conflicts note. Never let a web figure silently replace a dataset figure."
    );
    expect(SYSTEM).toContain(
      "11. **Unverified sources.** Rows whose source is marked UNVERIFIED carry lower confidence: use them, say so in the Data conflicts note, and never let an unverified row be the single support of the thesis."
    );
    expect(SYSTEM).toContain('12. **Declared units.** Declare "units" in the JSON equal to the dataset\'s meta.units.');
    expect(SYSTEM).toContain("The deterministic anchors below were computed in code from the dataset: they are facts, not suggestions");
    expect(SYSTEM).toContain("When raw pasted text is present, the RAW TEXT wins over the structured extract for a field that was mis-transcribed; say so in the Data conflicts note");
    expect(SYSTEM).not.toContain("your own pasted data");
  });

  it("states the rigor checks without the conditions a dataset always meets", () => {
    expect(SYSTEM).not.toContain("When a BASIS RECONCILIATION block is provided");
    expect(SYSTEM).not.toContain("When the anchors give you");
    expect(SYSTEM).not.toContain("gathered in Step 2)");
    expect(SYSTEM).toContain("The BASIS RECONCILIATION block below");
    expect(SYSTEM).toContain("The anchors give you");
    expect(SYSTEM).toContain("the company's OWN historical distribution as given in the dataset's anchors (median/percentile)");
  });

  it("buildDeepValueUserPrompt appends the formatted dataset section after the base prompt", () => {
    const usr = buildDeepValueUserPrompt({ ticker: "FNCT.MI", currentPrice: 10, currency: "EUR", language: "English", grounding: GROUNDING });
    expect(usr).toContain("Analyze FNCT.MI.");
    expect(usr).toContain("AUTHORITATIVE FINANCIAL DATA");
    expect(usr).toContain("some pasted table");
    expect(usr.indexOf("AUTHORITATIVE FINANCIAL DATA")).toBeGreaterThan(usr.indexOf("Analyze FNCT.MI."));
  });
});

describe("The dataset reaches the analyst lenses too", () => {
  it("buildAnalystSystemPrompt injects DATASET_RULES_BLOCK between the structural checks and the valuation section", () => {
    const sys = buildAnalystSystemPrompt({ angle: "skeptic", language: "English", mosPercent: 20, grounding: LENS_GROUNDING });
    const structuralIdx = sys.indexOf("Structural checks");
    const rulesIdx = sys.indexOf("## Financial dataset — how to use it");
    const valuationIdx = sys.indexOf("Your own independent valuation");
    expect(structuralIdx).toBeLessThan(rulesIdx);
    expect(rulesIdx).toBeLessThan(valuationIdx);
  });

  it("buildAnalystUserPrompt appends the anchors/extract/warnings but NOT the raw-paste section", () => {
    const usr = buildAnalystUserPrompt({ angle: "skeptic", ticker: "FNCT.MI", reportMd: "# R\nBody", language: "English", grounding: LENS_GROUNDING });
    expect(usr).toContain("STRUCTURED EXTRACT");
    expect(usr).toContain("DETERMINISTIC ANCHORS");
    expect(usr).not.toContain("AUTHORITATIVE FINANCIAL DATA");
  });

  it("buildAnalystUserPrompt appends the base report's gates after the report when gatesText is passed, and only then", () => {
    const args = { angle: "skeptic" as const, ticker: "FNCT.MI", reportMd: "# R\nBody", language: "English", grounding: LENS_GROUNDING };
    const gatesText = "--- DETERMINISTIC GATES ON THE BASE REPORT (computed in code — NOT the model's judgment) ---\n✓ scenario_order: bear 8.00 · base 10.00 · bull 12.00\n--- END DETERMINISTIC GATES ---";
    const withGates = buildAnalystUserPrompt({ ...args, gatesText });
    expect(withGates).toContain("DETERMINISTIC GATES ON THE BASE REPORT");
    expect(withGates.indexOf("--- END REPORT ---")).toBeLessThan(withGates.indexOf("DETERMINISTIC GATES ON THE BASE REPORT"));
    // Absent (not empty): the prompt is byte-identical to a call without the param.
    expect(buildAnalystUserPrompt({ ...args, gatesText: undefined })).toBe(buildAnalystUserPrompt(args));
    expect(withGates.startsWith(buildAnalystUserPrompt(args))).toBe(true);
  });

  it("a lens on a currency-mismatched extract is told why the market-implied read is missing", () => {
    // Same call shape as the verify route: no raw blocks, the route's own quote currency.
    const mismatched = buildGroundingPromptContext([], EXTRACT, 15, "USD"); // extract is EUR
    const usr = buildAnalystUserPrompt({ angle: "skeptic", ticker: "FNCT.MI", reportMd: "# R\nBody", language: "English", grounding: mismatched });
    expect(usr).toContain("currency_mismatch — EUR vs USD");
    expect(usr).toContain("Market-implied: NOT computed — currency mismatch");
  });
});

describe("The report prompts rescope web search to what the dataset cannot hold", () => {
  it("system prompt Step 2 does not say to gather the data via web search", () => {
    expect(SYSTEM).not.toContain("Gather financial data via web search");
    expect(SYSTEM).not.toContain("Search for the most recent annual financial data");
    expect(SYSTEM).toContain("## Step 2 — Gather financial data\n");
    expect(SYSTEM).toContain("Use web search only for what was published after that data's coverage period");
  });

  it("user prompt does not say to find the financial data via web search", () => {
    const usr = buildDeepValueUserPrompt({ ticker: "FNCT.MI", currentPrice: 10, currency: "EUR", language: "English", grounding: GROUNDING });
    expect(usr).not.toContain("Use web search to find the financial data");
    expect(usr).toContain("use web search only for what was published after its coverage period");
  });
});

describe("Analyst prompts: two-phase wording, Skeptic framing, basis check, kill price note", () => {
  it("names the two JSON blocks, one per phase", () => {
    const sys = buildAnalystSystemPrompt({ angle: "optimist", mosPercent: 20, grounding: LENS_GROUNDING });
    expect(sys).toContain("The ONLY JSON you emit is the two valuation blocks above (one in Phase 1, one in Phase 2);");
    expect(sys).not.toContain("The ONLY JSON you emit is the valuation block above;");
  });

  it("frames the Skeptic as breaking the thesis, not judging whether it holds up", () => {
    const sys = buildAnalystSystemPrompt({ angle: "skeptic", grounding: LENS_GROUNDING });
    expect(sys).not.toContain("does the base-case fair value hold up");
    expect(sys).toContain("**break the thesis**");
    expect(sys).toContain("**Kill price & verdict**");
  });

  it("always includes the basis-reconciliation structural check", () => {
    const sys = buildAnalystSystemPrompt({ angle: "quality", grounding: LENS_GROUNDING });
    expect(sys).toContain("7. **Basis reconciliation.**");
    // Part of the structural checks, before the dataset rules block.
    expect(sys.indexOf("7. **Basis reconciliation.**")).toBeLessThan(sys.indexOf("## Financial dataset — how to use it"));
  });

  it("puts killPriceNote in the Skeptic JSON contract only", () => {
    expect(buildAnalystSystemPrompt({ angle: "skeptic", grounding: LENS_GROUNDING })).toContain('"killPriceNote"');
    expect(buildAnalystSystemPrompt({ angle: "optimist", grounding: LENS_GROUNDING })).not.toContain("killPrice");
    // Both phases' blocks carry it.
    expect(buildAnalystSystemPrompt({ angle: "skeptic", grounding: LENS_GROUNDING }).split('"killPriceNote"')).toHaveLength(3);
  });
});

describe("Analyst lenses do not tell the model to re-search the dataset's history", () => {
  it("rescopes the spot-check to the dataset", () => {
    const sys = buildAnalystSystemPrompt({ angle: "skeptic", language: "English", mosPercent: 20, grounding: LENS_GROUNDING });
    const usr = buildAnalystUserPrompt({ angle: "skeptic", ticker: "FNCT.MI", reportMd: "# R", language: "English", grounding: LENS_GROUNDING });
    expect(sys).toContain("The dataset's historical figures are authoritative");
    expect(sys).not.toContain("against primary sources");
    expect(usr).toContain("spot-check key figures against the dataset");
    expect(usr).not.toContain("spot-check key figures via web search");
  });
});

describe("Phase 2 reconcile prompt asks for the critique before the final JSON", () => {
  it("opens the critique with the marker and closes with the FINAL JSON", () => {
    const usr = buildAnalystReconcileUserPrompt({
      ticker: "FNCT.MI",
      reportMd: "# R",
      language: "English",
      mosPercent: 20,
      blind: { bull: 12, base: 10, bear: 8 },
    });
    expect(usr).toContain(`Write your critique first, opening with the line \`${CRITIQUE_START_MARKER}\`, then the FINAL JSON`);
    expect(usr).toContain("as the very last thing, in English.");
    expect(usr).not.toContain("and then your critique");
  });
});

describe("formatRowSources — where each row came from", () => {
  const SOURCED = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
    financials: [
      makeFinancialsRow({
        fiscalYear: 2025,
        revenue: 1000,
        totalDebt: 400,
        cfo: 150,
        sources: {
          ...emptyRowSources(),
          income: pasteSource("blk-7"),
          balance: web("https://www.ir.alfa.example/report.pdf", true),
          cashFlow: web("https://data.example/alfa/cf", false),
          mixed: { income: true, balance: false, cashFlow: false },
        },
      }),
    ],
    multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 6, source: web("https://data.example/alfa/multiples", false) })],
    estimates: [makeEstimateRow({ fiscalYear: 2026, revenue: 1100, source: web("https://broker.example/alfa", true) })],
    peers: [{ ticker: "BETA", companyName: null, multiples: [makeMultiplesRow({ fiscalYear: 2025, evEbitda: 7, source: web("https://data.example/beta", true) })] }],
  });

  it("prints one line per financials row, per statement, paste without its block number", () => {
    const text = formatRowSources(SOURCED)!;
    expect(text).toContain("FY2025 — income: paste + another source; balance: ir.alfa.example; cash flow: data.example, UNVERIFIED");
    expect(text).not.toContain("blk-7");
  });

  it("prints the multiples, the estimates and the peers' multiples too", () => {
    const text = formatRowSources(SOURCED)!;
    expect(text).toContain("FY2025 multiples: data.example, UNVERIFIED");
    expect(text).toContain("FY2026 estimates: broker.example");
    expect(text).toContain("Peer BETA FY2025 multiples: data.example");
  });

  it("is omitted for an extract whose rows carry no source (an older analysis)", () => {
    const legacy = { ...EXTRACT, financials: EXTRACT.financials.map(({ sources: _sources, ...row }) => row) } as unknown as typeof EXTRACT;
    expect(formatRowSources(legacy)).toBeNull();
    expect(formatGroundingForPrompt(buildGroundingPromptContext([], legacy, null, "EUR"))).not.toContain("ROW SOURCES");
  });

  it("sits after the extract and before the anchors in the prompt", () => {
    const text = formatGroundingForPrompt(buildGroundingPromptContext([], SOURCED, null, "EUR"));
    expect(text.indexOf("STRUCTURED EXTRACT")).toBeLessThan(text.indexOf("ROW SOURCES"));
    expect(text.indexOf("ROW SOURCES")).toBeLessThan(text.indexOf("DETERMINISTIC ANCHORS"));
  });
});

describe("The anchors say when their multiples come from unverified rows", () => {
  const withMultiples = (rows: ReturnType<typeof makeMultiplesRow>[]) => formatGroundingForPrompt(buildGroundingPromptContext([], makeExtract({ ...EXTRACT, multiples: rows }), null, "EUR"));

  it("leads the ANCHORS section with the unverified years the statistics use", () => {
    const text = withMultiples([
      makeMultiplesRow({ fiscalYear: 2023, evEbitda: 5, source: web("https://data.example/m", false) }),
      makeMultiplesRow({ fiscalYear: 2024, pe: 12, source: web("https://data.example/m", false) }),
      makeMultiplesRow({ fiscalYear: 2025, evEbitda: 6, source: web("https://ir.example/m", true) }),
      // No value the statistics read: not an anchor input.
      makeMultiplesRow({ fiscalYear: 2022, fcfYield: 4, source: web("https://data.example/m", false) }),
    ]);
    const anchors = text.slice(text.indexOf("--- DETERMINISTIC ANCHORS"));
    expect(anchors.split("\n")[1]).toBe("Anchor inputs include UNVERIFIED multiples (years: 2023, 2024)");
  });

  it("says nothing when every multiples row is verified", () => {
    const text = withMultiples([makeMultiplesRow({ fiscalYear: 2025, evEbitda: 6, source: web("https://ir.example/m", true) })]);
    expect(text).not.toContain("UNVERIFIED multiples");
  });
});

describe("The research notes lead the extract", () => {
  it("prints them at the head of the extract section, and nothing without them", () => {
    const withNotes = formatGroundingForPrompt(buildGroundingPromptContext([], EXTRACT, null, "EUR", [], "EBITDA as reported, not adjusted."));
    const extract = withNotes.slice(withNotes.indexOf("--- STRUCTURED EXTRACT"));
    expect(extract.split("\n")[1]).toBe("Research notes: EBITDA as reported, not adjusted.");
    expect(formatGroundingForPrompt(buildGroundingPromptContext([], EXTRACT, null, "EUR"))).not.toContain("Research notes");
  });
});
