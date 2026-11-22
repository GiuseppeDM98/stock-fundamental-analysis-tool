// How a phase of a Deep Value run ends (2026-10-27; one rule per kind of phase since
// 2026-11-22): whether the server writes the phase's result on the row ("done") or marks the
// row "failed". Pure, so the rule is pinned by a test rather than spread across the routes.

export type RunEnd =
  | { kind: "done" }
  | { kind: "failed"; reason: "empty" | "refusal" | "max_tokens" | "no_valuation"; retryable: boolean };

/**
 * How a phase that answers in text ends: the web update and the two halves of the report.
 * @param text - What the route FORWARDED (after the start-marker gate), not the raw stream.
 * @param stopReason - The last turn's stop_reason.
 * @param hitIterationCap - The tool loop ran out of rounds.
 * @returns failed on an empty answer (retryable), on a refusal (not retryable: the same
 *   request would be declined again) and on max_tokens (retryable: a cut text is not the
 *   whole answer). A text that ran out of search rounds is still a text: done, with the
 *   route's note in it.
 */
export function classifyRunEnd({
  text,
  stopReason,
}: {
  text: string;
  stopReason: string | null | undefined;
  // Read by no rule: named so a caller passes it and a reader sees it was weighed.
  hitIterationCap: boolean;
}): RunEnd {
  if (stopReason === "refusal") return { kind: "failed", reason: "refusal", retryable: false };
  if (!text.trim()) return { kind: "failed", reason: "empty", retryable: true };
  if (stopReason === "max_tokens") return { kind: "failed", reason: "max_tokens", retryable: true };
  return { kind: "done" };
}

/**
 * How the valuation phase ends. Half a valuation is no valuation: without a full
 * bull/base/bear the phase failed, and a retry may well return one.
 */
export function classifyValuationEnd({ stopReason, hasTriple }: { stopReason: string | null | undefined; hasTriple: boolean }): RunEnd {
  if (stopReason === "refusal") return { kind: "failed", reason: "refusal", retryable: false };
  if (stopReason === "max_tokens") return { kind: "failed", reason: "max_tokens", retryable: true };
  if (!hasTriple) return { kind: "failed", reason: "no_valuation", retryable: true };
  return { kind: "done" };
}
