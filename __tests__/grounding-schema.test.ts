import { describe, it, expect } from "vitest";
import { groundingPayloadSchema, GROUNDING_MAX_BLOCKS, GROUNDING_MAX_BLOCK_CHARS, GROUNDING_MAX_TOTAL_CHARS } from "@/lib/grounding/schema";
import type { GroundingBlock } from "@/types/grounding";
import { makeExtract } from "./grounding-test-helpers";

function payload(blocks: GroundingBlock[]) {
  return { blocks, extract: makeExtract() };
}

function block(i: number, overrides: Partial<GroundingBlock> = {}): GroundingBlock {
  return { id: String(i), kind: "income_statement", text: "Revenue 100", ...overrides };
}

describe("groundingPayloadSchema — boundary caps", () => {
  it("accepts a normal payload", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1), block(2, { kind: "peer_valuation", peerTicker: "SHEL" })])).success).toBe(true);
  });

  it("rejects more than GROUNDING_MAX_BLOCKS blocks", () => {
    const blocks = Array.from({ length: GROUNDING_MAX_BLOCKS + 1 }, (_, i) => block(i));
    expect(groundingPayloadSchema.safeParse(payload(blocks)).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload(blocks.slice(0, GROUNDING_MAX_BLOCKS))).success).toBe(true);
  });

  it("rejects a total paste above GROUNDING_MAX_TOTAL_CHARS even when every block is under its own cap", () => {
    // 5 full blocks = 5 × 40000 = 200000 (exactly at the cap) — one more character tips it over.
    const full = (i: number) => block(i, { text: "x".repeat(GROUNDING_MAX_BLOCK_CHARS) });
    const atCap = [1, 2, 3, 4, 5].map(full);
    expect(GROUNDING_MAX_BLOCK_CHARS * 5).toBe(GROUNDING_MAX_TOTAL_CHARS);
    expect(groundingPayloadSchema.safeParse(payload(atCap)).success).toBe(true);
    expect(groundingPayloadSchema.safeParse(payload([...atCap, block(6, { text: "x" })])).success).toBe(false);
  });

  it("still enforces the per-block cap", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1, { text: "x".repeat(GROUNDING_MAX_BLOCK_CHARS + 1) })])).success).toBe(false);
  });

  it("requires a non-empty peerTicker on peer_valuation blocks only", () => {
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "peer_valuation" })])).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "peer_valuation", peerTicker: "   " })])).success).toBe(false);
    expect(groundingPayloadSchema.safeParse(payload([block(1, { kind: "balance_sheet" })])).success).toBe(true);
  });
});
