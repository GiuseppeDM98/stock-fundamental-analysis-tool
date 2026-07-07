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
