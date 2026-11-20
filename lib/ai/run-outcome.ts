// How a Deep Value run ends (2026-10-27): whether the server writes the report as the
// row's result ("done") or marks the row "failed". Pure, so the rule is pinned by a test
// rather than spread across the route's branches.

export type RunEnd =
  | { kind: "done" }
  | { kind: "failed"; reason: "empty" | "refusal" | "max_tokens"; retryable: boolean };

/**
 * @param text - What the route FORWARDED (after the start-marker gate), not the raw stream.
 * @param stopReason - The last turn's stop_reason.
 * @param hitIterationCap - The tool loop ran out of rounds.
 * @returns failed on an empty answer (retryable), on a refusal (not retryable: the same
 *   request would be declined again) and on max_tokens (retryable: the JSON block comes
 *   last, so a cut report has lost its valuation anyway). A report that ran out of search
 *   rounds is still a report: done, with the route's note in it. A JSON that does not parse
 *   is not a failure here either: the row is done without fair values.
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
