// Golden capture-and-diff test of the Deep Value and lens prompts on the single dataset
// path (every report and lens is built on a financial dataset since 2026-11-09). It pins
// the whole text the model reads, on one invented dataset (fixtures/dataset-fenicottero.ts).
//
// Regenerated only when a spec declares it, with `-u` and the diff read section by section
// and reported in that session's notes. Any other diff is a regression: a change to a shared
// builder that leaked into a prompt nobody meant to change.
//
// It replaced, on 2026-11-09, the golden of the prompts without a dataset (Quick mode),
// deleted with that path.
import { describe, it, expect } from "vitest";
import {
  buildDeepValueSystemPrompt,
  buildDeepValueUserPrompt,
  buildAnalystSystemPrompt,
  buildAnalystBlindUserPrompt,
  buildAnalystReconcileUserPrompt,
} from "@/lib/ai/deep-value-prompts";
import { buildGroundingPromptContext } from "@/lib/grounding/prompt-format";
import { ANALYST_ANGLES } from "@/types/analysis";
import type { GroundingBlock } from "@/types/grounding";
import { DATASET_FENICOTTERO } from "./fixtures/dataset-fenicottero";

const CURRENT_DATE = "November 9, 2026";
const PRICE = 11.4;
const MOS = 20;

// The lenses get the extract, never the raw paste (the verify route passes no blocks).
const CONTEXT = buildGroundingPromptContext([], DATASET_FENICOTTERO, PRICE, "EUR");
// The paste block the income statement was transcribed from (its id is the rows' blockId).
const PASTE_BLOCK: GroundingBlock = {
  id: "fx-b1",
  kind: "income_statement",
  text: "Fenicottero Holding — conto economico (EUR m)\nRicavi 1.000 / 1.100 / 1.200 / 1.250\nEBITDA 200 / 220 / 240 / 250",
};
const CONTEXT_WITH_PASTE = buildGroundingPromptContext([PASTE_BLOCK], DATASET_FENICOTTERO, PRICE, "EUR");

// The base report's gates, as formatGatesForPrompt writes them (two lines suffice: the
// golden pins where the section lands, the gate texts are pinned by their own tests).
const GATES_TEXT =
  "--- DETERMINISTIC GATES ON THE BASE REPORT (computed in code — NOT the model's judgment) ---\n✓ scenario_order: bear 8.00 · base 10.00 · bull 12.00\n✗ bear_breaks_price: bear 12.00 · price 11.40\n--- END DETERMINISTIC GATES ---";

describe("Deep Value report prompts on a dataset — golden", () => {
  it("(1) base report: system and user prompt, no paste block", () => {
    expect(buildDeepValueSystemPrompt({ language: "Italiano", currentDate: CURRENT_DATE, mosPercent: MOS, grounding: CONTEXT })).toMatchSnapshot();
    expect(
      buildDeepValueUserPrompt({ ticker: "FNCT.MI", currentPrice: PRICE, currency: "EUR", language: "Italiano", currentDate: CURRENT_DATE, mosPercent: MOS, grounding: CONTEXT })
    ).toMatchSnapshot();
  });

  it("(2) base report: user prompt with the income-statement paste block", () => {
    expect(
      buildDeepValueUserPrompt({
        ticker: "FNCT.MI",
        currentPrice: PRICE,
        currency: "EUR",
        language: "Italiano",
        currentDate: CURRENT_DATE,
        mosPercent: MOS,
        grounding: CONTEXT_WITH_PASTE,
      })
    ).toMatchSnapshot();
  });
});

describe("Analyst lens prompts on a dataset — golden", () => {
  it.each(ANALYST_ANGLES)("(3) %s system prompt, blind-first", (angle) => {
    expect(buildAnalystSystemPrompt({ angle, language: "Italiano", currentDate: CURRENT_DATE, mosPercent: MOS, grounding: CONTEXT, blindFirst: true })).toMatchSnapshot();
  });

  it("(4) Phase 1 user prompt (no report)", () => {
    expect(
      buildAnalystBlindUserPrompt({ ticker: "FNCT.MI", language: "Italiano", currentDate: CURRENT_DATE, currentPrice: PRICE, currency: "EUR", mosPercent: MOS, grounding: CONTEXT })
    ).toMatchSnapshot();
  });

  it("(5) Phase 2 user prompt, with the base report's gates", () => {
    expect(
      buildAnalystReconcileUserPrompt({
        ticker: "FNCT.MI",
        reportMd: "## 1. Panoramica\nReport di prova fenicottero.",
        language: "Italiano",
        currentDate: CURRENT_DATE,
        mosPercent: MOS,
        blind: { bull: 12, base: 10, bear: 8 },
        gatesText: GATES_TEXT,
      })
    ).toMatchSnapshot();
  });
});
