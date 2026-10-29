// Picks a blind-first analyst lens's Phase-1 commitment out of the raw turn-1 text.
//
// Turn 1 is never streamed to the client as-is: besides the JSON commitment it carries
// whatever the model wrote around it (reasoning between searches before the block, the
// short rationale after it). Forwarding all of that made it land in the visible critique
// and in the persisted *CritiqueMd, because the client only strips the fenced block
// itself. So the route forwards ONLY the commitment, re-fenced as ```json-blind — a fence
// the FINAL-block parser deliberately does not match (see
// lib/report/parse-deep-value-json.ts), so turn 2's own ```json block still resolves as
// the final valuation.
//
// Pure (no I/O) so the selection rules are unit-testable without a stream.
import type { DeepValueResult } from "@/components/report/types";

const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/g;

export type BlindCommitment = {
  // The parsed commitment — guaranteed to carry numeric bull/base/bear fair values.
  result: DeepValueResult;
  // The same JSON re-fenced as ```json-blind, ready to enqueue to the client. Ends with a
  // newline so the client-side stripper (which consumes one trailing newline) leaves no
  // stray blank line behind.
  fenced: string;
};

function hasAllFairValues(value: unknown): value is DeepValueResult {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, { fairValue?: unknown } | undefined>;
  return (["bull", "base", "bear"] as const).every((s) => typeof v[s]?.fairValue === "number");
}

/**
 * Find the Phase-1 commitment in turn-1 text.
 *
 * Scans every ```json fence in order and returns the FIRST one that parses and carries
 * all three scenario fair values — so a malformed or partial block (an aborted draft, an
 * illustrative snippet) cannot hide a valid commitment emitted after it. Prose before,
 * between or after the fences is ignored.
 *
 * @returns the commitment, or null when no fence holds a usable one (the caller then
 *   degrades to a single-phase review).
 */
export function pickBlindCommitment(turn1Text: string): BlindCommitment | null {
  for (const match of turn1Text.matchAll(JSON_FENCE_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (hasAllFairValues(parsed)) {
      return { result: parsed, fenced: "```json-blind\n" + match[1] + "\n```\n" };
    }
  }
  return null;
}
