// Shared parser for the leading JSON block that both the Deep Value analysis and the
// Analyst Review emit (` ```json … ``` `). Extracted here because the same regex and
// JSON.parse were duplicated across the live panel, the saved-review component, and
// (with extra type-guards) the saved-analysis detail page — the reviewer's own JSON
// pushed the count past the rule-of-three, so it lives in one place now.
//
// This is intentionally the permissive variant (returns null on any failure) used by
// client components. The saved detail page keeps its own guarded parser because it runs
// in a server component and validates the shape before trusting it for rendering.
import type { DeepValueResult } from "@/components/report/types";

// Matches the fenced JSON block anywhere in the text (the stream may carry preamble in
// degraded cases). Kept in sync with stripJsonBlock below — same fence convention.
const JSON_BLOCK_RE = /```json\n([\s\S]*?)\n```/;

/**
 * Parse the fair-value JSON block out of a streamed report/review.
 * @returns the parsed result, or null if no block is present or it is malformed.
 */
export function parseDeepValueJson(text: string): DeepValueResult | null {
  const match = text.match(JSON_BLOCK_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as DeepValueResult;
  } catch {
    return null;
  }
}

/**
 * Remove the leading JSON block so only the human-readable Markdown is rendered.
 * No-op when the text carries no block.
 */
export function stripJsonBlock(text: string): string {
  return text.replace(/```json\n[\s\S]*?\n```\n?/, "");
}

// Blind-first analyst lenses (docs/deep-value-rigor-v2-spec.md §6) fence the Phase-1
// commitment as ```json-blind, deliberately NOT ```json — that string does not match
// JSON_BLOCK_RE above (there is no literal "```json\n" substring inside "```json-blind\n"),
// so parseDeepValueJson/stripJsonBlock keep resolving to the Phase-2 FINAL block with zero
// code changes. A dedicated test in __tests__/parse-deep-value-json.test.ts asserts this
// non-collision explicitly — it is the only thing holding this trick together.
const BLIND_JSON_BLOCK_RE = /```json-blind\n([\s\S]*?)\n```/;

/**
 * Parse the Phase-1 (blind) commitment out of a blind-first analyst stream.
 * @returns the parsed result, or null if no blind block is present or it is malformed.
 */
export function parseBlindJson(text: string): DeepValueResult | null {
  const match = text.match(BLIND_JSON_BLOCK_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as DeepValueResult;
  } catch {
    return null;
  }
}

/** Phase markers the verify route enqueues around the blind-first turn boundary
 *  (docs/deep-value-rigor-v2-spec.md §6.2) — never forwarded as visible text, only used by
 *  the client to switch the streaming status label (see currentAnalystPhase below). */
export const ANALYST_PHASE_MARKERS = {
  blind: "<!--analyst:phase=blind-->",
  reconcile: "<!--analyst:phase=reconcile-->",
} as const;

/**
 * Which blind-first phase the stream is currently in, based on the LAST marker seen so
 * far — null when neither marker has appeared yet (a non-blind-first review, or the blind
 * turn hasn't started enqueuing).
 */
export function currentAnalystPhase(text: string): "blind" | "reconcile" | null {
  const blindIdx = text.lastIndexOf(ANALYST_PHASE_MARKERS.blind);
  const reconcileIdx = text.lastIndexOf(ANALYST_PHASE_MARKERS.reconcile);
  if (reconcileIdx > blindIdx) return "reconcile";
  if (blindIdx !== -1) return "blind";
  return null;
}

/**
 * Strips the phase markers and the ```json-blind fence (Phase-1 commitment + rationale)
 * from a blind-first stream, leaving only the FINAL JSON block + critique for
 * stripJsonBlock to then process normally. No-op on a stream with neither artifact.
 */
export function stripAnalystStreamArtifacts(text: string): string {
  return text
    .replace(ANALYST_PHASE_MARKERS.blind, "")
    .replace(ANALYST_PHASE_MARKERS.reconcile, "")
    .replace(/```json-blind\n[\s\S]*?\n```\n?/, "");
}
