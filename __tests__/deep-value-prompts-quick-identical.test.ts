// Golden capture-and-diff test for Quick mode (no `grounding`, no `blindFirst`) — spec
// docs/deep-value-rigor-v2-spec.md §0 hard invariant: "Quick mode resta byte-identico."
// Snapshots are captured from the pre-v2 prompt builders and MUST NOT change as the rest
// of the v2 spec is implemented. If a snapshot in this file needs updating, that is a
// signal the change leaked into Quick mode — stop and verify it was intentional before
// re-running with `-u`. Written FIRST, before touching lib/ai/deep-value-prompts.ts
// (spec §9 commit 1).
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
