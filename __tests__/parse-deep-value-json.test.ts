// Coverage for lib/report/parse-deep-value-json.ts, including the blind-first additions
// (docs/deep-value-rigor-v2-spec.md §6.5). The critical assertion is the non-collision
// between ```json-blind and ```json fences — the whole two-turn transport trick (§6.2.4)
// relies on parseDeepValueJson/stripJsonBlock continuing to resolve to the FINAL block
// when a blind block is also present in the accumulated stream.
import { describe, it, expect } from "vitest";
import {
  parseDeepValueJson,
  stripJsonBlock,
  parseBlindJson,
  currentAnalystPhase,
  stripAnalystStreamArtifacts,
  ANALYST_PHASE_MARKERS,
} from "@/lib/report/parse-deep-value-json";

const BLIND_BLOCK = '```json-blind\n{"method":"DCF","sector":"Utilities","currency":"EUR","bull":{"fairValue":10},"base":{"fairValue":8},"bear":{"fairValue":5}}\n```';
const FINAL_BLOCK = '```json\n{"method":"DCF","sector":"Utilities","currency":"EUR","bull":{"fairValue":11},"base":{"fairValue":9},"bear":{"fairValue":6}}\n```';

describe("parseDeepValueJson / stripJsonBlock — unchanged behavior", () => {
  it("parses a single json block", () => {
    expect(parseDeepValueJson(FINAL_BLOCK)?.base.fairValue).toBe(9);
  });

  it("returns null when no block is present", () => {
    expect(parseDeepValueJson("just prose, no fence")).toBeNull();
  });

  it("strips the block, leaving surrounding prose", () => {
    const text = `${FINAL_BLOCK}\nSome critique text.`;
    expect(stripJsonBlock(text)).toBe("Some critique text.");
  });
});

describe("```json-blind does NOT collide with the ```json fence (spec §6.2.4)", () => {
  it("parseDeepValueJson resolves to the FINAL block when both a blind and a final block are present", () => {
    const rationale = "Blind rationale text.";
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\n${rationale}\n${ANALYST_PHASE_MARKERS.reconcile}${FINAL_BLOCK}\nFinal critique.`;
    const parsed = parseDeepValueJson(stream);
    expect(parsed?.base.fairValue).toBe(9); // the FINAL block's value, not the blind one's (8)
  });

  it("stripJsonBlock removes only the FINAL block, leaving the blind fence untouched", () => {
    const stream = `${BLIND_BLOCK}\nRationale.\n${FINAL_BLOCK}\nCritique.`;
    const stripped = stripJsonBlock(stream);
    expect(stripped).toContain("```json-blind");
    expect(stripped).not.toContain('"fairValue":11'); // the final block's own marker value is gone
    expect(stripped).toContain("Critique.");
  });

  it("parseBlindJson parses only the blind block, ignoring a final block later in the same text", () => {
    const stream = `${BLIND_BLOCK}\nRationale.\n${FINAL_BLOCK}\nCritique.`;
    expect(parseBlindJson(stream)?.base.fairValue).toBe(8);
  });

  it("parseBlindJson returns null when no blind block is present", () => {
    expect(parseBlindJson(FINAL_BLOCK)).toBeNull();
  });
});

describe("currentAnalystPhase", () => {
  it("returns null before any marker has appeared", () => {
    expect(currentAnalystPhase("some partial stream text")).toBeNull();
  });

  it("returns 'blind' once the blind marker has appeared", () => {
    expect(currentAnalystPhase(`${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}`)).toBe("blind");
  });

  it("returns 'reconcile' once the reconcile marker appears after the blind one", () => {
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\n${ANALYST_PHASE_MARKERS.reconcile}`;
    expect(currentAnalystPhase(stream)).toBe("reconcile");
  });
});

describe("stripAnalystStreamArtifacts", () => {
  it("removes both phase markers and the blind fence, leaving the final block + critique intact", () => {
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\nRationale.\n${ANALYST_PHASE_MARKERS.reconcile}${FINAL_BLOCK}\nFinal critique.`;
    const cleaned = stripAnalystStreamArtifacts(stream);
    expect(cleaned).not.toContain(ANALYST_PHASE_MARKERS.blind);
    expect(cleaned).not.toContain(ANALYST_PHASE_MARKERS.reconcile);
    expect(cleaned).not.toContain("```json-blind");
    // stripJsonBlock still needs to run separately to remove the FINAL block for display —
    // this function only clears the blind-turn artifacts.
    expect(stripJsonBlock(cleaned)).toBe("Rationale.\nFinal critique.");
  });

  it("is a no-op on a plain (non-blind-first) stream", () => {
    const stream = `${FINAL_BLOCK}\nCritique.`;
    expect(stripAnalystStreamArtifacts(stream)).toBe(stream);
  });
});
