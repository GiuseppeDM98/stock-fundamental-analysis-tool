import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAnalystSystemPrompt, buildDeepValueSystemPrompt } from "@/lib/ai/deep-value-prompts";
import { CRITIQUE_START_MARKER, REPORT_START_MARKER } from "@/lib/report/parse-deep-value-json";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

// The output contract the routes and the parser rely on: research first, the report after
// a sentinel line, the JSON block last. A wording change that drops one of these breaks
// the stream gate or the parser silently, so each is pinned here by content (the Quick
// golden snapshot pins the whole text, but a regenerated snapshot would not notice).

const METHODS = "DCF|DDM|EV/EBITDA|P/E|P/B|SOTP|EV/RAB|NAV|Residual Income";

describe("Deep Value report prompt — research first, report, JSON last", () => {
  const quick = buildDeepValueSystemPrompt({ language: "English", currentDate: "October 11, 2026", mosPercent: 20 });

  it("asks for the report marker only once the research is complete", () => {
    expect(quick).toContain(`start the written answer with the exact line:\n${REPORT_START_MARKER}\n`);
    expect(quick).toContain("Only when your research is complete");
    expect(quick).toContain(`Anything before ${REPORT_START_MARKER} is discarded.`);
  });

  it("puts the JSON block after section 10, as the very last thing", () => {
    expect(quick).toContain("After section 10, as the very LAST thing you output, emit the JSON block below");
    expect(quick).not.toContain("MUST be the very first thing");
    expect(quick).not.toContain("After the JSON block, write the full Markdown report");
  });

  it("closes the report with the disclaimer, then the JSON", () => {
    expect(quick).toContain('Close section 10 with the line "⚠️ This report is for informational purposes only and does not constitute financial advice.", then emit the JSON block');
    expect(quick).toContain(`Do not write anything before the \`${REPORT_START_MARKER}\` line, and nothing after the JSON block's closing fence`);
  });

  it("declares units, sensitivity and dividends in the JSON template", () => {
    expect(quick).toContain('"units": "<billions|millions|thousands|units');
    expect(quick).toContain('"sensitivity": {');
    expect(quick).toContain('"leverA": {');
    expect(quick).toContain("<BASE — must equal base.bridge.intrinsicPerShare>");
    expect(quick).toContain('"dividends": null | {');
    expect(quick).toContain("**Sensitivity (mandatory).**");
    expect(quick).toContain("**Dividend path (mandatory when the company pays a dividend).**");
    expect(quick).toContain("### Dividend outlook");
    expect(quick).toContain("### Sensitivity — the 3×3 table");
    expect(quick).toContain("19. **Sensitivity honesty.**");
  });

  it("asks for a bridge in Quick mode too, with the bridge rule and percentage-point assumptions", () => {
    expect(quick).toContain('"bridge": {');
    expect(quick).toContain('"driverValue": <driver\'s numeric value, in the unit you declare in "units">');
    expect(quick).toContain("**Bridge rule.**");
    expect(quick).toContain("Equity-value methods (P/E, P/B, Residual Income, DDM, DCF on FCFE)");
    expect(quick).toContain("Never subtract net debt from a value that is already equity.");
    expect(quick).toContain('"wacc": <percentage points, e.g. 8.5 — or null>');
    expect(quick).not.toContain("<% or null>");
  });

  it("offers the extended method list, in Step 1 and in the template", () => {
    expect(quick).toContain(`"method": "<${METHODS}>"`);
    expect(quick).toContain("- **NAV / SOTP**:");
    expect(quick).toContain("- **P/E**:");
    expect(quick).toContain("- **EV/RAB**:");
    expect(quick).toContain("- **DDM** (dividend discount model)");
  });

  it("derives the current year from the date instead of hardcoding one", () => {
    expect(quick).toContain("may be 2025 or 2024");
    expect(quick).toContain("Never assume a different current year than 2026.");
    expect(quick).not.toContain("current year is 2025");
    expect(buildDeepValueSystemPrompt({ currentDate: "" })).not.toContain("Today's date");
  });

  it("pins the rest of the template: the second lever, cross-check, sector, currency, units and no-tool rule", () => {
    expect(quick).toContain('"leverB": {');
    expect(quick).toContain('"crossCheck": {');
    expect(quick).toContain('"sector": "<sector name, max 80 characters>"');
    expect(quick).toContain('"currency": "<ISO 4217 code, 3 letters>"');
    expect(quick).toContain("**Units.** Every monetary figure inside the bridges");
    expect(quick).toContain("After that line do not call any tool");
    // bull, base, bear and the cross-check each carry one bridge.
    expect(quick.split('"bridge": {')).toHaveLength(5);
  });
});

describe("Deep Value report prompt — Grounded mode keeps the same contract", () => {
  const extract = makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, sharesDiluted: 100 })],
  });
  const grounded = buildDeepValueSystemPrompt({
    language: "English",
    currentDate: "October 11, 2026",
    mosPercent: 20,
    grounding: buildGroundingPromptContext([], extract, 10, "EUR"),
  });

  it("asks for research first, the marker, and the JSON last", () => {
    expect(grounded).toContain(`start the written answer with the exact line:\n${REPORT_START_MARKER}\n`);
    expect(grounded).toContain("After section 10, as the very LAST thing you output, emit the JSON block below");
    expect(grounded).toContain('"sensitivity": {');
    expect(grounded).toContain('"dividends": null | {');
  });

  it("puts the bridge figures in the extract's own unit, not a declared one", () => {
    expect(grounded).toContain("\"driverValue\": <driver's numeric value, SAME unit as the extract's meta.units>");
    expect(grounded).not.toContain('in the unit you declare in "units"');
    expect(grounded.split('"bridge": {')).toHaveLength(5);
  });
});

describe("Analyst lens prompts — critique first, JSON last, no sensitivity", () => {
  const lens = buildAnalystSystemPrompt({ angle: "skeptic", language: "English", currentDate: "October 11, 2026", mosPercent: 20 });

  it("asks for the critique marker and the JSON as the very last thing", () => {
    expect(lens).toContain(`Write the critique first, opening with the exact line \`${CRITIQUE_START_MARKER}\`, and emit the JSON block as the very LAST thing.`);
    expect(lens).toContain('Close the critique with the line "⚠️ This review is for informational purposes only and does not constitute financial advice.", then emit the JSON block.');
    expect(lens).toContain(`Do not write anything before the \`${CRITIQUE_START_MARKER}\` line`);
    expect(lens).not.toContain("MUST be the very FIRST thing");
  });

  it("carries units and a bridge with the bridge rule, but no sensitivity or dividends", () => {
    expect(lens).toContain('"units": "<billions|millions|thousands|units');
    expect(lens).toContain('"bridge": {');
    expect(lens).toContain("**Bridge rule.**");
    expect(lens).toContain(`"method": "<${METHODS}>"`);
    expect(lens).not.toContain('"sensitivity"');
    expect(lens).not.toContain('"dividends"');
  });

  it("keeps Phase 1 JSON-first and moves Phase 2 to critique-first in a blind-first review", () => {
    const blind = buildAnalystSystemPrompt({ angle: "optimist", blindFirst: true, mosPercent: 20, currentDate: "October 11, 2026" });
    expect(blind).toContain("Commit to it from the data and anchors given below plus web search alone, in the JSON block below, followed by a rationale");
    expect(blind).toContain(`Write your critique first, opening with the exact line \`${CRITIQUE_START_MARKER}\`, then emit the FINAL JSON`);
    expect(blind.split(`"method": "<${METHODS}>"`)).toHaveLength(3);
    expect(blind.split('"units": "<billions')).toHaveLength(3);
  });

  it("scopes the closing rules to Phase 2 in a blind-first review, so Phase 1 gets one order", () => {
    const blind = buildAnalystSystemPrompt({ angle: "optimist", blindFirst: true, mosPercent: 20, currentDate: "October 11, 2026" });
    expect(blind).toContain("- Phase 1: the JSON block opens your answer and the rationale follows it; no critique marker, no disclaimer.");
    expect(blind).toContain(`- Phase 2: close the critique with the line "⚠️ This review is for informational purposes only and does not constitute financial advice.", then emit the final JSON block. Do not write anything before the \`${CRITIQUE_START_MARKER}\` line`);
    expect(blind).not.toContain(`\n- Do not write anything before the \`${CRITIQUE_START_MARKER}\` line`);
    expect(blind).not.toContain("\n- Close the critique with the line");
  });

  it("derives the current year from the date in the lens prompt too", () => {
    expect(lens).toContain("may be 2025 or 2024");
    expect(lens).toContain("Never assume a different current year than 2026.");
    expect(lens).not.toContain("current year is 2025");
  });
});

describe("prompt source", () => {
  it("hardcodes no year the calendar has already passed", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "ai", "deep-value-prompts.ts"), "utf8");
    expect(source).not.toMatch(/\b2025\b/);
  });
});
