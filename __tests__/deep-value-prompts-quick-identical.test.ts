// Golden capture-and-diff test for Quick mode (no `grounding`, no `blindFirst`). Hard
// invariant: Grounded and blind-first work must leave Quick-mode prompts byte-identical,
// so these snapshots MUST NOT change when the shared prompt builders are touched. If a
// snapshot in this file needs updating, that is a signal the change leaked into Quick
// mode — stop and verify it was intentional before re-running with `-u`.
//
// Last regenerated on purpose on 2026-10-29, with the diff read section by section, when the
// output contract changed for every mode: research first, the report after the
// `<!--report-->` line (the lenses' critique after `<!--critique-->`), the JSON block last;
// units, a bridge in every scenario, sensitivity and dividends in the JSON; the extended
// method list; a date clause derived from the current year. The next allowed change is
// deleting this file, when the Quick path goes away and a golden on the single dataset path
// (`deep-value-prompts-golden.test.ts`) replaces it — until then any diff is a regression.
import { describe, it, expect } from "vitest";
import {
  buildDeepValueSystemPrompt,
  buildDeepValueUserPrompt,
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
} from "@/lib/ai/deep-value-prompts";

describe("Quick mode prompt builders — golden snapshots (no grounding, no blindFirst)", () => {
  it("buildDeepValueSystemPrompt — default args", () => {
    expect(buildDeepValueSystemPrompt()).toMatchSnapshot();
  });

  it("buildDeepValueSystemPrompt — full args, English, mos 20", () => {
    expect(
      buildDeepValueSystemPrompt({ language: "English", currentDate: "July 12, 2026", mosPercent: 20 })
    ).toMatchSnapshot();
  });

  it("buildDeepValueSystemPrompt — Italiano, mos 0, no currentDate", () => {
    expect(buildDeepValueSystemPrompt({ language: "Italiano", mosPercent: 0 })).toMatchSnapshot();
  });

  it("buildDeepValueUserPrompt — default currentDate/mos", () => {
    expect(
      buildDeepValueUserPrompt({ ticker: "ENI.MI", currentPrice: 14.18, currency: "EUR", language: "English" })
    ).toMatchSnapshot();
  });

  it("buildDeepValueUserPrompt — full args, mos 20", () => {
    expect(
      buildDeepValueUserPrompt({
        ticker: "AAPL",
        currentPrice: 230.5,
        currency: "USD",
        language: "English",
        currentDate: "July 12, 2026",
        mosPercent: 20,
      })
    ).toMatchSnapshot();
  });

  const angles = ["skeptic", "optimist", "quality"] as const;

  for (const angle of angles) {
    it(`buildAnalystSystemPrompt — angle=${angle}, default args`, () => {
      expect(buildAnalystSystemPrompt({ angle })).toMatchSnapshot();
    });

    it(`buildAnalystSystemPrompt — angle=${angle}, full args, mos 20`, () => {
      expect(
        buildAnalystSystemPrompt({ angle, language: "Italiano", currentDate: "July 12, 2026", mosPercent: 20 })
      ).toMatchSnapshot();
    });

    it(`buildAnalystUserPrompt — angle=${angle}, minimal args`, () => {
      expect(
        buildAnalystUserPrompt({ angle, ticker: "ENI.MI", reportMd: "# Report\nBody text.", language: "English" })
      ).toMatchSnapshot();
    });

    it(`buildAnalystUserPrompt — angle=${angle}, full args, mos 20`, () => {
      expect(
        buildAnalystUserPrompt({
          angle,
          ticker: "AAPL",
          reportMd: "# Report\nBody text.",
          language: "English",
          currentDate: "July 12, 2026",
          currentPrice: 230.5,
          currency: "USD",
          mosPercent: 20,
        })
      ).toMatchSnapshot();
    });
  }
});
