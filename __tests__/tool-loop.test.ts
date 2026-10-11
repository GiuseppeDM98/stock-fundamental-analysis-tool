import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("@/lib/ai/web-search-tool", () => ({
  executeWebSearch: vi.fn(async (query: string) => `results for ${query}`),
}));

import { runCreateWithToolLoop, buildPromptCacheParam } from "@/lib/ai/tool-loop";

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null };

function message(stop_reason: string, content: unknown[]): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, usage: USAGE } as unknown as Anthropic.Message;
}

const TEXT_ANSWER = message("end_turn", [{ type: "text", text: "```json\n{}\n```" }]);
const PAUSED = message("pause_turn", [{ type: "text", text: "still searching" }]);
const SEARCH_CALL = message("tool_use", [{ type: "tool_use", id: "t1", name: "web_search", input: { query: "q" } }]);

// The loop mutates one messages array across rounds, so each call's array is copied at
// call time — otherwise every recorded call would show the final state.
function mockClient(replies: Anthropic.Message[]) {
  const sentMessages: Anthropic.MessageParam[][] = [];
  const queue = [...replies];
  const create = vi.fn(async (params: { messages: Anthropic.MessageParam[] }) => {
    sentMessages.push([...params.messages]);
    return queue.shift()!;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create, sentMessages };
}

const PARAMS = { model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user" as const, content: "hi" }] };

describe("runCreateWithToolLoop", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resumes on pause_turn instead of returning the partial turn", async () => {
    const { client, create, sentMessages } = mockClient([PAUSED, TEXT_ANSWER]);
    const result = await runCreateWithToolLoop(client, PARAMS, 5);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.message).toBe(TEXT_ANSWER);
    expect(result.hitIterationCap).toBe(false);
    // Resumed with the paused assistant turn appended and no new user turn after it.
    const resumedMessages = sentMessages[1];
    expect(resumedMessages).toHaveLength(2);
    expect(resumedMessages[1].role).toBe("assistant");
  });

  it("answers a client-executed web_search call and continues", async () => {
    const { client, create, sentMessages } = mockClient([SEARCH_CALL, TEXT_ANSWER]);
    const result = await runCreateWithToolLoop(client, PARAMS, 5);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.hitIterationCap).toBe(false);
    const toolTurn = sentMessages[1][2];
    expect(toolTurn.role).toBe("user");
    expect((toolTurn.content as unknown[])[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: "results for q" });
  });

  it("reports hitIterationCap when the cap runs out while still searching", async () => {
    const { client } = mockClient([SEARCH_CALL, SEARCH_CALL]);
    const result = await runCreateWithToolLoop(client, PARAMS, 2);
    expect(result.hitIterationCap).toBe(true);
    expect(result.message.stop_reason).toBe("tool_use");
  });

  it("reports hitIterationCap when the cap runs out on a paused turn", async () => {
    const { client } = mockClient([PAUSED, PAUSED]);
    const result = await runCreateWithToolLoop(client, PARAMS, 2);
    expect(result.hitIterationCap).toBe(true);
    expect(result.stopReason).toBe("pause_turn");
  });

  it("logs usage once per round", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client } = mockClient([PAUSED, TEXT_ANSWER]);
    await runCreateWithToolLoop(client, PARAMS, 5);
    const usageLines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[tool-loop] round"));
    expect(usageLines).toEqual([
      "[tool-loop] round 1 usage: input=10 output=5",
      "[tool-loop] round 2 usage: input=10 output=5",
    ]);
  });
});

describe("buildPromptCacheParam", () => {
  it("adds an ephemeral cache breakpoint for Anthropic models", () => {
    expect(buildPromptCacheParam("claude-opus-4-8")).toEqual({ cache_control: { type: "ephemeral" } });
  });

  it("adds nothing for DeepSeek, whose Anthropic-compat proxy rejects cache_control", () => {
    expect(buildPromptCacheParam("deepseek-v4-pro")).toEqual({});
  });
});
