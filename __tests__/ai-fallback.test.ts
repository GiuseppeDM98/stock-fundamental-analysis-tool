import { describe, it, expect } from "vitest";
import { fallbackNote, fallbackServedBy, modelLabel, prepareTurnForReplay } from "@/lib/ai/fallback";

const ITERATIONS_FELL_BACK = [{ type: "message" }, { type: "fallback_message" }];

describe("fallbackServedBy", () => {
  it("names the model that served the turn when a fallback_message iteration is present", () => {
    expect(
      fallbackServedBy({ model: "claude-sonnet-5", stop_reason: "end_turn", usage: { iterations: ITERATIONS_FELL_BACK } })
    ).toBe("claude-sonnet-5");
  });

  it("is null when the requested model answered, or when usage carries no iterations", () => {
    expect(
      fallbackServedBy({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { iterations: [{ type: "message" }] } })
    ).toBeNull();
    expect(fallbackServedBy({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: {} })).toBeNull();
    expect(fallbackServedBy({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { iterations: null } })).toBeNull();
  });

  it("is null when the fallback model refused too: nobody served the turn", () => {
    expect(
      fallbackServedBy({ model: "claude-sonnet-5", stop_reason: "refusal", usage: { iterations: ITERATIONS_FELL_BACK } })
    ).toBeNull();
  });
});

describe("prepareTurnForReplay", () => {
  it("returns a turn without a fallback block unchanged (same array, prompt cache intact)", () => {
    const content = [
      { type: "thinking" },
      { type: "server_tool_use", id: "s1" },
      { type: "text" },
    ];
    expect(prepareTurnForReplay(content)).toBe(content);
  });

  it("drops the declined model's internal blocks before the last fallback block and keeps the rest", () => {
    const content = [
      { type: "thinking" },
      { type: "redacted_thinking" },
      { type: "server_tool_use", id: "paired" },
      { type: "web_search_tool_result", tool_use_id: "paired" },
      { type: "server_tool_use", id: "orphan" },
      { type: "tool_use", id: "t1" },
      { type: "text", text: "partial" },
      { type: "some_future_internal_block" },
      { type: "fallback" },
      { type: "thinking" },
      { type: "text", text: "continued" },
    ];
    expect(prepareTurnForReplay(content)).toEqual([
      { type: "server_tool_use", id: "paired" },
      { type: "web_search_tool_result", tool_use_id: "paired" },
      { type: "text", text: "partial" },
      { type: "fallback" },
      { type: "thinking" },
      { type: "text", text: "continued" },
    ]);
  });

  it("uses the LAST fallback block as the boundary when the chain switched twice", () => {
    const content = [{ type: "thinking" }, { type: "fallback" }, { type: "thinking" }, { type: "fallback" }, { type: "text" }];
    expect(prepareTurnForReplay(content).map((b) => b.type)).toEqual(["fallback", "fallback", "text"]);
  });
});

describe("modelLabel and fallbackNote", () => {
  it("labels catalog ids and passes unknown ids through", () => {
    expect(modelLabel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("claude-opus-4-8")).toBe("Claude Opus 4.8");
    expect(modelLabel("claude-something-new")).toBe("claude-something-new");
  });

  it("names the requested model and the one that answered, in the reader's language", () => {
    expect(fallbackNote("claude-sonnet-5-5", "claude-sonnet-5", false)).toBe(
      "_[Claude Sonnet 5.5 declined this request; Claude Sonnet 5 answered it.]_"
    );
    expect(fallbackNote("claude-sonnet-5-5", "claude-sonnet-5", true)).toBe(
      "_[Claude Sonnet 5.5 ha rifiutato la richiesta: ha risposto Claude Sonnet 5.]_"
    );
  });
});
