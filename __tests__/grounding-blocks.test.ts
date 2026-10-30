import { describe, it, expect } from "vitest";

import { chooseStartingBlocks, remapFailedBlockPositions, selectSubmittableBlocks } from "@/lib/grounding-blocks";
import type { GroundingBlock } from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

function block(id: string, text: string): GroundingBlock {
  return { id, kind: "income_statement", text };
}

describe("selectSubmittableBlocks", () => {
  it("drops empty and whitespace-only blocks, keeping order", () => {
    const blocks = [block("a", "Revenue 100"), block("b", ""), block("c", "  \n\t "), block("d", "EBITDA 20")];

    expect(selectSubmittableBlocks(blocks).map((b) => b.id)).toEqual(["a", "d"]);
  });

  it("returns an empty list when every block is empty", () => {
    expect(selectSubmittableBlocks([block("a", " "), block("b", "")])).toEqual([]);
  });

  it("keeps a block whose text has surrounding whitespace untouched", () => {
    const [kept] = selectSubmittableBlocks([block("a", "  Revenue 100  ")]);
    expect(kept.text).toBe("  Revenue 100  ");
  });
});

describe("remapFailedBlockPositions", () => {
  const all = [block("a", "x"), block("b", ""), block("c", "y")];
  const submitted = selectSubmittableBlocks(all);

  it("maps a submitted position onto the editor position when an empty block was skipped", () => {
    const warnings: ReconciliationWarning[] = [{ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "income_statement #2" }];

    expect(remapFailedBlockPositions(warnings, submitted, all)[0].detail).toBe("income_statement #3");
  });

  it("leaves other warning codes and unparseable details untouched", () => {
    const warnings: ReconciliationWarning[] = [
      { code: "eps_mismatch", severity: "warn", fiscalYear: 2025, detail: "income_statement #2" },
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "block two" },
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "income_statement #9" },
    ];

    expect(remapFailedBlockPositions(warnings, submitted, all)).toEqual(warnings);
  });
});

describe("chooseStartingBlocks", () => {
  const seed = [block("a", "Revenue 1000"), block("b", "EBITDA 200")];

  it("opens on the seed when there is no draft, or the draft is the seed itself", () => {
    expect(chooseStartingBlocks([], seed)).toEqual({ blocks: seed, draftKept: false });
    expect(chooseStartingBlocks(seed.map((b) => ({ ...b })), seed)).toEqual({ blocks: seed, draftKept: false });
  });

  it("keeps a draft with other blocks, and says so", () => {
    const draft = [block("x", "Total debt 400")];
    expect(chooseStartingBlocks(draft, seed)).toEqual({ blocks: draft, draftKept: true });
  });

  it("keeps a draft with the same blocks but an edited text: an unsaved edit is never overwritten", () => {
    const draft = [block("a", "Revenue 1100"), block("b", "EBITDA 200")];
    expect(chooseStartingBlocks(draft, seed)).toEqual({ blocks: draft, draftKept: true });
  });

  it("opens on the draft, with no notice, when there is no seed", () => {
    const draft = [block("x", "Total debt 400")];
    expect(chooseStartingBlocks(draft, undefined)).toEqual({ blocks: draft, draftKept: false });
  });
});
