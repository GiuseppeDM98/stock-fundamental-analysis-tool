// A blind-first analyst lens's Phase-1 commitment: picked out of the raw Phase-1 text, and
// rebuilt as the assistant turn Phase 2 is sent; and the Phase-2 critique, rebuilt as the
// assistant turn Phase 3 is sent (2026-11-20: the final numbers are a request of their own).
//
// Phase 1 is never streamed to the client: besides the JSON commitment it carries whatever
// the model wrote around it (reasoning between searches before the block, the short
// rationale after it). The route persists the commitment with its rationale (*BlindJson)
// and the panel draws the blind card from that.
//
// Since 2026-10-27 the two phases are two requests (each under the 300 s a function lives
// on Vercel Hobby), so Phase 2 cannot replay Phase 1's transcript: it starts from the same
// blind user message, then an assistant turn of text only — the commitment and its
// rationale, what the model itself produced — then the reconcile prompt. The prefix
// (system + tools + blind message) is identical to Phase 1's — built on the quote Phase 1
// stored with the commitment — so the prompt cache reads it.
//
// Pure (no I/O) so the selection rules are unit-testable without a stream.
import type { DeepValueResult } from "@/components/report/types";
import { CRITIQUE_START_MARKER, RATIONALE_MAX_CHARS, type Phase1Quote } from "@/lib/report/parse-deep-value-json";

const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/g;

export type BlindCommitment = {
  // The parsed commitment — guaranteed to carry numeric bull/base/bear fair values.
  result: DeepValueResult;
  // The model's text after the commitment's fence, trimmed, at most RATIONALE_MAX_CHARS.
  rationale: string;
};

function hasAllFairValues(value: unknown): value is DeepValueResult {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, { fairValue?: unknown } | undefined>;
  return (["bull", "base", "bear"] as const).every((s) => typeof v[s]?.fairValue === "number");
}

/**
 * Find the Phase-1 commitment in Phase-1 text.
 *
 * Scans every ```json fence in order and returns the FIRST one that parses and carries
 * all three scenario fair values — so a malformed or partial block (an aborted draft, an
 * illustrative snippet) cannot hide a valid commitment emitted after it. The prose after
 * that fence is its rationale; prose before it is ignored.
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
      const after = turn1Text.slice((match.index ?? 0) + match[0].length);
      return { result: parsed, rationale: after.trim().slice(0, RATIONALE_MAX_CHARS) };
    }
  }
  return null;
}

/**
 * The assistant turn of Phase 2: the commitment as the JSON fence Phase 1 wrote (its
 * rationale and the route's quote left out of the JSON), then the rationale as prose — only
 * what the model produced itself, no thinking, no tool calls.
 */
export function buildBlindAssistantTurn(blind: DeepValueResult & { rationale?: string; phase1Quote?: Phase1Quote }, rationale: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rationale: _omitted, phase1Quote: _quote, ...json } = blind;
  return "```json\n" + JSON.stringify(json, null, 2) + "\n```\n\n" + rationale;
}

/** The critique as the assistant turn Phase 3 answers to: the marker the stream gate dropped,
 *  then the stored text. */
export function buildCritiqueAssistantTurn(critiqueMd: string): string {
  return `${CRITIQUE_START_MARKER}\n${critiqueMd}`;
}
