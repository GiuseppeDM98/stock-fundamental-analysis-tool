import { describe, it, expect } from "vitest";
import { lensNextPhase, lensPhaseWritten } from "@/lib/report/lens-progress";
import { LENS_PHASES, type LensPhase } from "@/types/ai-run";

// The Skeptic's columns, as the server leaves them after each write.
const BLIND = '{"method":"DCF"}';
const RESULT = '{"method":"DCF","bull":{"fairValue":3},"base":{"fairValue":2},"bear":{"fairValue":1}}';

describe("lensNextPhase — which request a lens still has to run, from its columns", () => {
  it("an empty lens starts at blind", () => {
    expect(lensNextPhase({}, "skeptic")).toBe("blind");
  });

  it("a commitment alone goes on to the critique", () => {
    expect(lensNextPhase({ reviewBlindJson: BLIND }, "skeptic")).toBe("reconcile");
  });

  it("a critique without numbers goes on to the final numbers", () => {
    expect(lensNextPhase({ reviewBlindJson: BLIND, reviewMd: "Critique." }, "skeptic")).toBe("final");
  });

  it("a critique with its result is complete", () => {
    expect(lensNextPhase({ reviewBlindJson: BLIND, reviewMd: "Critique.", reviewResultJson: RESULT }, "skeptic")).toBeNull();
  });

  it("a critique with three fair values and no result column (an older save) is complete", () => {
    expect(
      lensNextPhase({ reviewMd: "Critique.", reviewFairValueBull: 3, reviewFairValueBase: 2, reviewFairValueBear: 1 }, "skeptic")
    ).toBeNull();
  });

  it("an empty critique counts as none", () => {
    expect(lensNextPhase({ reviewBlindJson: BLIND, reviewMd: "" }, "skeptic")).toBe("reconcile");
  });

  it("reads the columns of the lens it is asked about", () => {
    expect(lensNextPhase({ reviewMd: "Critique.", reviewResultJson: RESULT, optimistBlindJson: BLIND }, "optimist")).toBe("reconcile");
  });
});

describe("lensPhaseWritten — a phase whose stream was lost, read against the row", () => {
  const NEXTS: (LensPhase | null)[] = [...LENS_PHASES, null];
  const WRITTEN = new Set(["blind/reconcile", "reconcile/final", "final/null"]);

  for (const failed of LENS_PHASES) {
    for (const next of NEXTS) {
      const expected = WRITTEN.has(`${failed}/${next}`);
      it(`${failed} with the row at ${next ?? "complete"} → ${expected ? "written" : "to run again"}`, () => {
        expect(lensPhaseWritten(failed, next)).toBe(expected);
      });
    }
  }
});
