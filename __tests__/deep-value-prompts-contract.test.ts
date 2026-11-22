import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAnalystFinalUserPrompt,
  buildAnalystReconcileUserPrompt,
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
  buildDeepValueSystemPrompt,
} from "@/lib/ai/deep-value-prompts";
import { CRITIQUE_START_MARKER, REPORT_START_MARKER } from "@/lib/report/parse-deep-value-json";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

// The output contract the routes and the parser rely on: research first, the report after
// a sentinel line, the JSON block last. A wording change that drops one of these breaks
// the stream gate or the parser silently, so each is pinned here by content (the golden
// snapshot pins the whole text, but a regenerated snapshot would not notice).

const METHODS = "DCF|DDM|EV/EBITDA|P/E|P/B|SOTP|EV/RAB|NAV|Residual Income";

// Invented, round figures: every builder takes a dataset since 2026-11-09.
const GROUNDING = buildGroundingPromptContext(
  [],
  makeExtract({
    meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
    financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 500, sharesDiluted: 100 })],
  }),
  10,
  "EUR"
);

describe("Deep Value report prompt — research first, report, JSON last", () => {
  const report = buildDeepValueSystemPrompt({ language: "English", currentDate: "October 11, 2026", mosPercent: 20, grounding: GROUNDING });

  it("asks for the report marker only once the research is complete", () => {
    expect(report).toContain(`start the written answer with the exact line:\n${REPORT_START_MARKER}\n`);
    expect(report).toContain("Only when your research is complete");
    expect(report).toContain(`Anything before ${REPORT_START_MARKER} is discarded.`);
  });

  it("puts the JSON block after section 10, as the very last thing", () => {
    expect(report).toContain("After section 10, as the very LAST thing you output, emit the JSON block below");
    expect(report).not.toContain("MUST be the very first thing");
    expect(report).not.toContain("After the JSON block, write the full Markdown report");
  });

  it("closes the report with the disclaimer written in the report's language, then the JSON", () => {
    expect(report).toContain('Close section 10 with this disclaimer, written in English: "⚠️ This report is for informational purposes only and does not constitute financial advice.", then emit the JSON block');
    expect(report).not.toContain("Close section 10 with the line");
    const italian = buildDeepValueSystemPrompt({ language: "Italiano", mosPercent: 20, grounding: GROUNDING });
    expect(italian).toContain("Close section 10 with this disclaimer, written in Italiano:");
    expect(report).toContain(`Do not write anything before the \`${REPORT_START_MARKER}\` line, and nothing after the JSON block's closing fence`);
  });

  it("declares units, sensitivity and dividends in the JSON template", () => {
    expect(report).toContain('"units": "<billions|millions|thousands|units');
    expect(report).toContain('"sensitivity": {');
    expect(report).toContain('"leverA": {');
    expect(report).toContain("<BASE — must equal base.bridge.intrinsicPerShare>");
    expect(report).toContain('"dividends": null | {');
    expect(report).toContain("**Sensitivity (mandatory).**");
    expect(report).toContain("**Dividend path (mandatory when the company pays a dividend).**");
    expect(report).toContain("### Dividend outlook");
    expect(report).toContain("### Sensitivity — the 3×3 table");
    expect(report).toContain("19. **Sensitivity honesty.**");
  });

  it("puts the dividend path on the same ordinary-DPS basis as lastDps, in the sentence and the template", () => {
    expect(report).toContain(
      "then project the annual ORDINARY DPS for the next three fiscal years under each scenario, on the same basis as that latest DPS (interim + final, specials excluded)"
    );
    expect(report).toContain('every "path" DPS is the annual ORDINARY DPS, on the same basis as lastDps (interim + final, specials excluded)');
  });

  it("asks for a bridge in the dataset's unit, with the bridge rule and percentage-point assumptions", () => {
    expect(report).toContain('"bridge": {');
    expect(report).toContain("\"driverValue\": <driver's numeric value, SAME unit as the dataset's meta.units>");
    expect(report).not.toContain('in the unit you declare in "units"');
    expect(report).toContain("**Bridge rule.**");
    expect(report).toContain("Equity-value methods (P/E, P/B, Residual Income, DDM, DCF on FCFE)");
    expect(report).toContain("Never subtract net debt from a value that is already equity.");
    expect(report).toContain('"wacc": <percentage points, e.g. 8.5 — or null>');
    expect(report).not.toContain("<% or null>");
  });

  it("offers the extended method list, in Step 1 and in the template", () => {
    expect(report).toContain(`"method": "<${METHODS}>"`);
    expect(report).toContain("- **NAV / SOTP**:");
    expect(report).toContain("- **P/E**:");
    expect(report).toContain("- **EV/RAB**:");
    expect(report).toContain("- **DDM** (dividend discount model)");
  });

  it("derives the current year from the date instead of hardcoding one", () => {
    expect(report).toContain("may be 2025 or 2024");
    expect(report).toContain("Never assume a different current year than 2026.");
    expect(report).not.toContain("current year is 2025");
    expect(buildDeepValueSystemPrompt({ currentDate: "", grounding: GROUNDING })).not.toContain("Today's date");
  });

  it("pins the rest of the template: the second lever, cross-check, sector, currency, units and no-tool rule", () => {
    expect(report).toContain('"leverB": {');
    expect(report).toContain('"crossCheck": {');
    expect(report).toContain('"sector": "<sector name, max 80 characters>"');
    expect(report).toContain('"currency": "<ISO 4217 code, 3 letters>"');
    expect(report).toContain("**Units.** Every monetary figure inside the bridges");
    expect(report).toContain("After that line do not call any tool");
    // bull, base, bear and the cross-check each carry one bridge.
    expect(report.split('"bridge": {')).toHaveLength(5);
  });
});

describe("Analyst lens prompts — Phase 2 the critique alone, Phase 3 the JSON, no sensitivity", () => {
  const lens = buildAnalystSystemPrompt({ angle: "skeptic", language: "English", currentDate: "October 11, 2026", mosPercent: 20, grounding: GROUNDING });

  it("asks Phase 2 for the critique alone, under the word cap, and Phase 3 for the JSON alone", () => {
    expect(lens).toContain(`open with the exact line \`${CRITIQUE_START_MARKER}\`, keep it under 700 words`);
    expect(lens).toContain("Emit NO JSON in this phase.");
    expect(lens).toContain("**PHASE 3 — a last message asks for your numbers.** Emit the FINAL JSON and nothing else");
    expect(lens).toContain('"to": <your Phase-3 fairValue>');
    expect(lens).toContain(
      `- Phase 2: close the critique with this disclaimer, written in English: "⚠️ This review is for informational purposes only and does not constitute financial advice.". Do not write anything before the \`${CRITIQUE_START_MARKER}\` line, and no JSON block.`
    );
    expect(lens).toContain("- Phase 3: the JSON block is your whole answer; nothing before it, nothing after its closing fence.");
    expect(lens).toContain("(one in Phase 1, one in Phase 3)");
    expect(lens).not.toContain("as the very LAST thing.");
    expect(lens).not.toContain("MUST be the very FIRST thing");
  });

  it("always describes the three phases: there is no single-phase lens prompt (removed 2026-11-09)", () => {
    expect(lens).toContain("## Your own independent valuation (MANDATORY, THREE PHASES)");
    expect(lens).toContain("This review runs across three user messages");
    expect(lens).toContain("**PHASE 1 — this message has NO report.**");
    expect(lens).not.toContain("## Your own independent valuation (MANDATORY)\n");
    expect(lens).not.toContain("\n- Close the critique with");
  });

  it("carries units and a bridge with the bridge rule, but no sensitivity or dividends", () => {
    expect(lens).toContain('"units": "<billions|millions|thousands|units');
    expect(lens).toContain('"bridge": {');
    expect(lens).toContain("**Bridge rule.**");
    expect(lens).toContain(`"method": "<${METHODS}>"`);
    expect(lens).not.toContain('"sensitivity"');
    expect(lens).not.toContain('"dividends"');
  });

  it("keeps Phase 1 JSON-first and Phase 2 a critique with no JSON", () => {
    const blind = buildAnalystSystemPrompt({ angle: "optimist", mosPercent: 20, currentDate: "October 11, 2026", grounding: GROUNDING });
    expect(blind).toContain("Commit to it from the data and anchors given below plus web search alone, in the JSON block below, followed by a rationale");
    expect(blind).toContain("Emit NO JSON in this phase.");
    expect(blind.split(`"method": "<${METHODS}>"`)).toHaveLength(3);
    expect(blind.split('"units": "<billions')).toHaveLength(3);
  });

  it("scopes the closing rules per phase, with the disclaimer in the critique's language", () => {
    const blind = buildAnalystSystemPrompt({ angle: "optimist", mosPercent: 20, currentDate: "October 11, 2026", language: "Italiano", grounding: GROUNDING });
    expect(blind).toContain("- Phase 1: the JSON block opens your answer and the rationale follows it; no critique marker, no disclaimer.");
    expect(blind).toContain(
      `- Phase 2: close the critique with this disclaimer, written in Italiano: "⚠️ This review is for informational purposes only and does not constitute financial advice.". Do not write anything before the \`${CRITIQUE_START_MARKER}\` line, and no JSON block.`
    );
    expect(blind).not.toContain(`\n- Do not write anything before the \`${CRITIQUE_START_MARKER}\` line`);
    expect(blind).not.toContain("\n- Close the critique with");
  });

  it("asks the reconcile message for the critique under the cap, with no JSON and no margin of safety", () => {
    const reconcile = buildAnalystReconcileUserPrompt({ ticker: "FNCT.MI", reportMd: "# R", language: "English", blind: { bull: 12, base: 10, bear: 8 } });
    expect(reconcile).toContain("under 700 words");
    expect(reconcile).toContain("emit no JSON: the final numbers are asked in the next message.");
    expect(reconcile).not.toContain("FINAL JSON");
    expect(reconcile).not.toContain("margin of safety");
  });

  it("asks the degraded single-request review for the critique alone too", () => {
    const review = buildAnalystUserPrompt({ angle: "skeptic", ticker: "FNCT.MI", reportMd: "# R", language: "English", grounding: GROUNDING });
    expect(review).toContain("emit no JSON");
    expect(review).not.toContain("JSON block");
  });

  it("asks Phase 3 for the JSON alone, with the margin of safety and no tool", () => {
    const final = buildAnalystFinalUserPrompt({ language: "English", mosPercent: 20 });
    expect(final).toContain("PHASE 3 — emit the FINAL JSON now, and nothing else");
    expect(final).toContain("margin of safety of 20% (intrinsic value × 0.80)");
    expect(final).toContain("No tool is available in this step.");
    expect(buildAnalystFinalUserPrompt({ language: "English" })).not.toContain("margin of safety");
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

  it("has no branch left for a prompt without a dataset", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "ai", "deep-value-prompts.ts"), "utf8");
    expect(source).not.toContain("grounding?:");
    expect(source).not.toContain("GroundingPromptContext | undefined");
    expect(source).not.toContain("grounding ?");
  });
});
