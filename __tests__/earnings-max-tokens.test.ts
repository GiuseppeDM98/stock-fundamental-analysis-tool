// @vitest-environment node
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import { EARNINGS_MAX_TOKENS } from "@/lib/ai/earnings-prompt";

// The earnings lookup is a non-streaming `messages.create` call. The SDK refuses such a call
// before sending it when max_tokens implies more than 10 minutes of generation, so the
// ceiling has to clear the thinking + web-search budget of the stored default (Opus 4.8 at
// `high`) while staying under that limit.
describe("EARNINGS_MAX_TOKENS", () => {
  const client = new Anthropic({ apiKey: "test-key" });

  it("leaves room for thinking and web-search turns, beyond the old 6000 fallback budget", () => {
    expect(EARNINGS_MAX_TOKENS).toBeGreaterThanOrEqual(16000);
  });

  it("is accepted by the SDK for a non-streaming call", () => {
    expect(() => client.calculateNonstreamingTimeout(EARNINGS_MAX_TOKENS)).not.toThrow();
  });

  it("would be refused by the SDK at the 64000 used by the streaming routes", () => {
    // Positive control: proves the check above can fail.
    expect(() => client.calculateNonstreamingTimeout(64000)).toThrow(/Streaming is required/);
  });
});
