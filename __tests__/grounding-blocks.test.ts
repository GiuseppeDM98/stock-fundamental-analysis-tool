import { describe, it, expect } from "vitest";

import { remapFailedBlockPositions, selectSubmittableBlocks } from "@/lib/grounding-blocks";
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
    const warnings: ReconciliationWarning[] = [{ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "#2" }];

    expect(remapFailedBlockPositions(warnings, submitted, all)[0].detail).toBe("#3");
  });

  it("leaves other warning codes and unparseable details untouched", () => {
    const warnings: ReconciliationWarning[] = [
      { code: "eps_mismatch", severity: "warn", fiscalYear: 2025, detail: "#2" },
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "block two" },
      { code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: "#9" },
    ];

    expect(remapFailedBlockPositions(warnings, submitted, all)).toEqual(warnings);
  });
});
