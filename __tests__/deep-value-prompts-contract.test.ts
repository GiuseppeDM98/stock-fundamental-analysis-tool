import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAnalystFinalUserPrompt,
  buildAnalystReconcileUserPrompt,
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
  buildReportContinuationPrompt,
  buildReportSystemPrompt,
  buildReportUserPrompt,
  buildUpdateSystemPrompt,
  buildUpdateUserPrompt,
  buildValuationSystemPrompt,
  UPDATE_MAX_SEARCHES,
} from "@/lib/ai/deep-value-prompts";
import { CRITIQUE_START_MARKER, NOTES_START_MARKER, REPORT_START_MARKER } from "@/lib/report/parse-deep-value-json";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";

// The output contract the routes and the parser rely on: the web notes after their sentinel
// line, the valuation's JSON block last, the report after its sentinel line with no JSON. A wording change that drops one of these breaks
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

// Invented, round figures for the phases after the web update.
const RESULT_JSON = JSON.stringify({ method: "EV/EBITDA", currency: "EUR", bull: { fairValue: 12 }, base: { fairValue: 10 }, bear: { fairValue: 8 } });
const REPORT_HEADINGS = [
  "## 1. Company Overview",
  "## 2. Competitive Moat Analysis",
  "## 3. Valuation Method",
  "## 4. Key Financial Data & Quality Metrics",
  "## 5. Bull Case",
  "## 6. Base Case",
  "## 7. Bear Case",
  "## 8. Key Risks",
  "## 9. Near-term Catalysts & Falsification Conditions",
  "## 10. Investment Summary",
];

describe("Deep Value valuation prompt — no tools, a rationale, the JSON last", () => {
  const valuation = buildValuationSystemPrompt({ language: "English", currentDate: "October 11, 2026", mosPercent: 20, grounding: GROUNDING });

  it("has no tools and sends every search rule to WEB UPDATE", () => {
    expect(valuation).toContain("## No tools in this step");
    expect(valuation).toContain("Wherever a rule in this prompt tells you to search, verify or check on the web, read WEB UPDATE instead");
    expect(valuation).not.toContain("web search to identify");
    expect(valuation).not.toContain("After that line do not call any tool");
  });

  it("asks for a rationale under the word cap, then the JSON block as the very last thing", () => {
    expect(valuation).toContain("First write a rationale of AT MOST 400 words in English");
    expect(valuation).toContain("as the very LAST thing you output, emit the JSON block below. Nothing after its closing fence.");
    expect(valuation).toContain("Write the rationale and every free-text JSON field in English");
  });

  it("writes none of the report's sections", () => {
    for (const heading of REPORT_HEADINGS) expect(valuation).not.toContain(heading);
    expect(valuation).not.toContain(REPORT_START_MARKER);
  });

  it("declares units, sensitivity and dividends in the JSON template", () => {
    expect(valuation).toContain('"units": "<billions|millions|thousands|units');
    expect(valuation).toContain('"sensitivity": {');
    expect(valuation).toContain('"leverA": {');
    expect(valuation).toContain('"leverB": {');
    expect(valuation).toContain("<BASE — must equal base.bridge.intrinsicPerShare>");
    expect(valuation).toContain('"dividends": null | {');
    expect(valuation).toContain("**Sensitivity (mandatory).**");
    expect(valuation).toContain("**Dividend path (mandatory when the company pays a dividend).**");
    expect(valuation).toContain("19. **Sensitivity honesty.**");
  });

  it("puts the dividend path on the same ordinary-DPS basis as lastDps, in the sentence and the template", () => {
    expect(valuation).toContain(
      "then project the annual ORDINARY DPS for the next three fiscal years under each scenario, on the same basis as that latest DPS (interim + final, specials excluded)"
    );
    expect(valuation).toContain('every "path" DPS is the annual ORDINARY DPS, on the same basis as lastDps (interim + final, specials excluded)');
  });

  it("asks for a bridge in the dataset's unit, with the bridge rule and percentage-point assumptions", () => {
    expect(valuation).toContain("\"driverValue\": <driver's numeric value, SAME unit as the dataset's meta.units>");
    expect(valuation).not.toContain('in the unit you declare in "units"');
    expect(valuation).toContain("**Bridge rule.**");
    expect(valuation).toContain("Equity-value methods (P/E, P/B, Residual Income, DDM, DCF on FCFE)");
    expect(valuation).toContain("Never subtract net debt from a value that is already equity.");
    expect(valuation).toContain('"wacc": <percentage points, e.g. 8.5 — or null>');
    expect(valuation).not.toContain("<% or null>");
    // bull, base, bear and the cross-check each carry one bridge.
    expect(valuation.split('"bridge": {')).toHaveLength(5);
  });

  it("pins the rest of the template: cross-check, sector, currency and units", () => {
    expect(valuation).toContain('"crossCheck": {');
    expect(valuation).toContain('"sector": "<sector name, max 80 characters>"');
    expect(valuation).toContain('"currency": "<ISO 4217 code, 3 letters>"');
    expect(valuation).toContain("**Units.** Every monetary figure inside the bridges");
  });

  it("offers the extended method list, in Step 1 and in the template", () => {
    expect(valuation).toContain(`"method": "<${METHODS}>"`);
    expect(valuation).toContain("- **NAV / SOTP**:");
    expect(valuation).toContain("- **P/E**:");
    expect(valuation).toContain("- **EV/RAB**:");
    expect(valuation).toContain("- **DDM** (dividend discount model)");
  });

  it("derives the current year from the date instead of hardcoding one", () => {
    expect(valuation).toContain("may be 2025 or 2024");
    expect(valuation).toContain("Never assume a different current year than 2026.");
    expect(valuation).not.toContain("current year is 2025");
    expect(buildValuationSystemPrompt({ currentDate: "", grounding: GROUNDING })).not.toContain("Today's date");
  });
});

describe("Deep Value report prompt — the fixed numbers explained, in two answers", () => {
  const report = buildReportSystemPrompt({ language: "English", mosPercent: 20 });

  it("treats the valuation as final and takes every computed figure from it", () => {
    expect(report).toContain("They are final: explain them, never change, recompute or contradict them.");
    expect(report).toContain("take the figure from FIXED VALUATION and the reasoning from RATIONALE");
    expect(report).toContain("You have no tools.");
  });

  it("asks for the English heading template translated into the report's language", () => {
    // A real Italian run (2026-11-22) copied the headings in English ("Valuation Method — Why questo metodo?").
    const italian = buildReportSystemPrompt({ language: "Italiano", mosPercent: 20 });
    expect(italian).toContain("translate every heading and subheading into Italiano");
    expect(italian).toContain(`keep each section's "## N." number`);
  });

  it("says fairValue is already the buy target, so the margin of safety is not applied twice", () => {
    // A real run (2026-11-22) titled the buy target "Intrinsic Value" and took 20% off it again.
    expect(report).toContain(`Each scenario's "fairValue" is already the buy target, after the 20% margin of safety`);
    expect(report).toContain(`Intrinsic Value is "intrinsicPerShare" and Buy Target is "fairValue"`);
  });

  it("carries the ten section headings and no JSON template", () => {
    for (const heading of REPORT_HEADINGS) expect(report).toContain(heading);
    expect(report).not.toContain('"bridge": {');
    expect(report).not.toContain('"sensitivity": {');
    expect(report).toContain("no JSON block.");
  });

  it("opens each answer with the report marker and splits the sections 1–5 / 6–10", () => {
    expect(report).toContain(`Start each answer with the exact line:\n${REPORT_START_MARKER}\n`);
    expect(report).toContain("You write sections 1–5 in your first answer and sections 6–10 in your second.");
    expect(buildReportContinuationPrompt({ language: "English" })).toContain("Continue with sections 6 to 10, in English");
  });

  it("closes section 10 with the disclaimer in the report's language", () => {
    expect(report).toContain('Close section 10 with this disclaimer, written in English: "⚠️ This report is for informational purposes only and does not constitute financial advice."');
    expect(buildReportSystemPrompt({ language: "Italiano", mosPercent: 20 })).toContain("Close section 10 with this disclaimer, written in Italiano:");
  });

  it("puts the fixed valuation, the rationale and the web notes in the first message", () => {
    const user = buildReportUserPrompt({
      ticker: "FNCT.MI",
      currentPrice: 10,
      currency: "EUR",
      language: "English",
      currentDate: "October 11, 2026",
      mosPercent: 20,
      grounding: GROUNDING,
      updateNotes: "Nothing after FY2025.",
      resultJson: RESULT_JSON,
      memo: "Median multiple.",
    });
    expect(user).toContain("--- FIXED VALUATION ---\n{\n");
    expect(user).toContain("--- RATIONALE ---\nMedian multiple.");
    expect(user).toContain("Nothing after FY2025.");
    expect(user).toContain("Write sections 1 to 5 now, in English.");
  });
});

describe("Deep Value web update prompt — facts with sources, never a valuation", () => {
  const update = buildUpdateSystemPrompt({ language: "English", currentDate: "October 11, 2026" });

  it("forbids analyst targets, asks for restatements with their period, and caps the searches", () => {
    expect(update).toContain("Never report an analyst target price");
    expect(update).toContain("the period it restates");
    expect(update).not.toContain("the dataset already holds");
    expect(update).toContain(`at most ${UPDATE_MAX_SEARCHES} searches`);
    expect(update).toContain(`start your answer with the exact line:\n${NOTES_START_MARKER}\n`);
  });

  it("never gives the model the price", () => {
    const user = buildUpdateUserPrompt({
      ticker: "FNCT.MI",
      companyName: "Fenicottero Holding",
      currency: "EUR",
      latestPeriodLabel: "FY2025",
      fiscalYearEnd: "December",
      reportingCurrency: "EUR",
      researchNotes: null,
    });
    expect(user).toContain("FNCT.MI");
    expect(user).toContain("FY2025");
    expect(user).not.toMatch(/price/i);
    expect(user).not.toContain("10.00");
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
