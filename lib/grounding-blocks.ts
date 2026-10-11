// Pure helpers for the Grounded paste editor (components/grounding-input.tsx) — which
// blocks are worth sending to the extraction route, and how to map the route's per-block
// failure positions back onto what the user actually sees.
import type { GroundingBlock } from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

/**
 * The blocks to send to POST /api/ai/grounding/extract: every block with some non-
 * whitespace text. An empty block is a normal editing state (just added, not yet pasted),
 * but the route validates `text.min(1)` per block and would reject the WHOLE request for
 * it — so empty blocks are dropped here rather than failing everything else.
 */
export function selectSubmittableBlocks(blocks: GroundingBlock[]): GroundingBlock[] {
  return blocks.filter((b) => b.text.trim().length > 0);
}

/**
 * Rewrites the `#N` position carried by `block_extract_failed` warnings from the
 * submitted-list position (what the route saw) to the editor-list position (what the user
 * sees). The two differ whenever an empty block sat before the failed one and was dropped
 * by `selectSubmittableBlocks`. Other warnings pass through untouched; a detail that
 * doesn't parse as a valid position is left as-is rather than guessed.
 *
 * @param submitted The exact list sent to the route, in order.
 * @param all The editor's full block list, including empty blocks.
 */
export function remapFailedBlockPositions(
  warnings: ReconciliationWarning[],
  submitted: GroundingBlock[],
  all: GroundingBlock[]
): ReconciliationWarning[] {
  return warnings.map((w) => {
    if (w.code !== "block_extract_failed") return w;
    const match = /^#(\d+)$/.exec(w.detail);
    if (!match) return w;
    const block = submitted[Number(match[1]) - 1];
    const editorIndex = block ? all.findIndex((b) => b.id === block.id) : -1;
    return editorIndex >= 0 ? { ...w, detail: `#${editorIndex + 1}` } : w;
  });
}
