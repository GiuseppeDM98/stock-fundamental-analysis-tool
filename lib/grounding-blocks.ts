// Pure helpers for the Grounded paste editor (components/grounding-input.tsx) — which
// blocks are worth sending to the extraction route, and how to map the route's per-block
// failure positions back onto what the user actually sees.
import type { GroundingBlock } from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import { parseBlockFailureDetail, withBlockFailurePosition } from "@/lib/grounding-warnings";

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
 * block-order position (what the route counts: submittable blocks only) to the editor-list
 * position (what the user sees). The two differ whenever an empty block sat before the
 * failed one and was dropped by `selectSubmittableBlocks`. Other warnings pass through
 * untouched; a detail that doesn't parse as a valid position is left as-is rather than
 * guessed.
 *
 * @param ordered The submittable blocks in editor order — the route's `blockOrder`.
 * @param all The editor's full block list, including empty blocks.
 */
export function remapFailedBlockPositions(
  warnings: ReconciliationWarning[],
  ordered: GroundingBlock[],
  all: GroundingBlock[]
): ReconciliationWarning[] {
  return warnings.map((w) => {
    if (w.code !== "block_extract_failed") return w;
    const parsed = parseBlockFailureDetail(w.detail);
    if (!parsed) return w;
    const block = ordered[parsed.position - 1];
    const editorIndex = block ? all.findIndex((b) => b.id === block.id) : -1;
    return editorIndex >= 0 ? { ...w, detail: withBlockFailurePosition(w.detail, editorIndex + 1) } : w;
  });
}

/**
 * The blocks the editor opens with when "Refresh data" seeds it with a stored dataset's
 * blocks: the seed, unless the local draft differs from it — an unsaved draft is never
 * overwritten, it is kept and the caller says so (`draftKept`). The draft must match block
 * for block, text included: the same ids with an edited text are an unsaved edit too.
 */
export function chooseStartingBlocks(draft: GroundingBlock[], seed: GroundingBlock[] | undefined): { blocks: GroundingBlock[]; draftKept: boolean } {
  if (!seed) return { blocks: draft, draftKept: false };
  const sameBlock = (a: GroundingBlock, b: GroundingBlock) =>
    a.id === b.id && a.kind === b.kind && a.text === b.text && (a.peerTicker ?? "") === (b.peerTicker ?? "");
  const identical = draft.length === seed.length && draft.every((b, i) => sameBlock(b, seed[i]));
  if (draft.length === 0 || identical) return { blocks: seed, draftKept: false };
  return { blocks: draft, draftKept: true };
}
