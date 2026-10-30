import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// Each fetch records when it started and ended: the loop must run a turn's fetches one at a
// time (the Fetch API limits requests per domain), which the order of these marks proves.
const fetchSpans: { url: string; start: number; end: number }[] = [];
let clock = 0;

vi.mock("@/lib/ai/web-search-tool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/web-search-tool")>()),
  executeWebSearch: vi.fn(async (query: string) => `results for ${query}`),
  executeWebFetch: vi.fn(async (url: string) => {
    const span = { url, start: ++clock, end: 0 };
    await new Promise((resolve) => setTimeout(resolve, 5));
    span.end = ++clock;
    fetchSpans.push(span);
    return `# page\n\n${url}`;
  }),
}));

import { runCreateWithToolLoop, runStreamWithToolLoop, buildPromptCacheParam } from "@/lib/ai/tool-loop";
import { executeWebFetch, executeWebSearch } from "@/lib/ai/web-search-tool";

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

// A refusal arrives as HTTP 200 with stop_reason "refusal" and little or no content; the
// loop must hand it to the route as such (not as a cap, not as a normal end) so the route
// can say the model declined instead of "no parseable result".
const REFUSED = message("refusal", []);

function fallbackMessage(model: string, stop_reason: string, content: unknown[]): Anthropic.Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    usage: { ...USAGE, iterations: [{ type: "message" }, { type: "fallback_message" }] },
  } as unknown as Anthropic.Message;
}

/** A client whose regular and beta endpoints are recorded separately, so a test can tell
 * which one a call went through and with which params. */
function mockDualClient(replies: Anthropic.Message[]) {
  const queue = [...replies];
  const calls: { endpoint: "regular" | "beta"; params: Record<string, unknown> }[] = [];
  const record = (endpoint: "regular" | "beta") =>
    vi.fn(async (params: Record<string, unknown>) => {
      calls.push({ endpoint, params: { ...params, messages: [...(params.messages as unknown[])] } });
      return queue.shift()!;
    });
  const streamOf = (endpoint: "regular" | "beta") =>
    vi.fn((params: Record<string, unknown>) => {
      calls.push({ endpoint, params: { ...params, messages: [...(params.messages as unknown[])] } });
      const reply = queue.shift()!;
      const events = [
        ...reply.content
          .filter((b) => b.type === "text")
          .map((b) => ({ type: "content_block_delta", delta: { type: "text_delta", text: (b as Anthropic.TextBlock).text } })),
        { type: "message_delta", delta: { stop_reason: reply.stop_reason } },
      ];
      return {
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
        finalMessage: async () => reply,
      };
    });
  const client = {
    messages: { create: record("regular"), stream: streamOf("regular") },
    beta: { messages: { create: record("beta"), stream: streamOf("beta") } },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("refusal and the server-side fallback", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a refusal as stopReason 'refusal', not as an iteration cap (non-streaming)", async () => {
    const { client } = mockDualClient([REFUSED]);
    const result = await runCreateWithToolLoop(client, PARAMS, 5);
    expect(result.stopReason).toBe("refusal");
    expect(result.hitIterationCap).toBe(false);
    expect(result.servedBy).toBeNull();
  });

  it("returns a refusal as stopReason 'refusal' from the streaming loop, with no text", async () => {
    const { client } = mockDualClient([REFUSED]);
    const deltas: string[] = [];
    const result = await runStreamWithToolLoop(client, PARAMS, (t) => deltas.push(t), 5);
    expect(result.stopReason).toBe("refusal");
    expect(result.hitIterationCap).toBe(false);
    expect(result.text).toBe("");
    expect(deltas).toEqual([]);
  });

  it("sends Sonnet 5.5 through the beta endpoint with fallbacks: 'default' and its beta header", async () => {
    const { client, calls } = mockDualClient([TEXT_ANSWER, TEXT_ANSWER]);
    await runCreateWithToolLoop(client, { ...PARAMS, model: "claude-sonnet-5-5" }, 5);
    await runStreamWithToolLoop(client, { ...PARAMS, model: "claude-sonnet-5-5" }, () => {}, 5);
    expect(calls.map((c) => c.endpoint)).toEqual(["beta", "beta"]);
    for (const call of calls) {
      expect(call.params.fallbacks).toBe("default");
      expect(call.params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    }
  });

  it("keeps every other model, DeepSeek included, on the regular endpoint without the fallback", async () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-5", "deepseek-v4-pro"]) {
      const { client, calls } = mockDualClient([TEXT_ANSWER]);
      await runStreamWithToolLoop(client, { ...PARAMS, model }, () => {}, 5);
      expect(calls).toHaveLength(1);
      expect(calls[0].endpoint).toBe("regular");
      expect(calls[0].params).not.toHaveProperty("fallbacks");
      expect(calls[0].params).not.toHaveProperty("betas");
    }
  });

  it("reports the model that actually answered when the fallback served the turn", async () => {
    const served = fallbackMessage("claude-sonnet-5", "end_turn", [{ type: "text", text: "answer" }]);
    const { client } = mockDualClient([served]);
    const result = await runStreamWithToolLoop(client, { ...PARAMS, model: "claude-sonnet-5-5" }, () => {}, 5);
    expect(result.servedBy).toBe("claude-sonnet-5");
    expect(result.stopReason).toBe("end_turn");
  });

  it("drops the declined model's internal blocks before resuming a paused fallback turn", async () => {
    const paused = fallbackMessage("claude-sonnet-5", "pause_turn", [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "partial" },
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } },
      { type: "text", text: "continued" },
    ]);
    const { client, calls } = mockDualClient([paused, TEXT_ANSWER]);
    await runStreamWithToolLoop(client, { ...PARAMS, model: "claude-sonnet-5-5" }, () => {}, 5);
    const resumed = calls[1].params.messages as Anthropic.MessageParam[];
    expect((resumed[1].content as { type: string }[]).map((b) => b.type)).toEqual(["text", "fallback", "text"]);
  });
});

const fetchCall = (id: string, url: string) => ({ type: "tool_use", id, name: "web_fetch", input: { url } });

describe("client-executed web_fetch and its budget", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fetchSpans.length = 0;
    vi.mocked(executeWebFetch).mockClear();
    vi.mocked(executeWebSearch).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a turn with a web_search and a web_fetch, one tool_result per call id", async () => {
    const turn = message("tool_use", [
      { type: "tool_use", id: "s1", name: "web_search", input: { query: "orn results" } },
      fetchCall("f1", "https://ir.example.com/fy2025"),
    ]);
    const { client, sentMessages } = mockClient([turn, TEXT_ANSWER]);
    await runCreateWithToolLoop(client, PARAMS, 5, { fetchBudget: 8 });
    expect(executeWebSearch).toHaveBeenCalledWith("orn results");
    expect(executeWebFetch).toHaveBeenCalledWith("https://ir.example.com/fy2025");
    expect(sentMessages[1][2].content).toEqual([
      { type: "tool_result", tool_use_id: "s1", content: "results for orn results" },
      { type: "tool_result", tool_use_id: "f1", content: "# page\n\nhttps://ir.example.com/fy2025" },
    ]);
  });

  it("executes 8 of 9 fetches across two turns, one at a time, and answers the 9th with the budget message", async () => {
    const first = message("tool_use", [1, 2, 3, 4, 5].map((n) => fetchCall(`f${n}`, `https://ir.example.com/p${n}`)));
    const second = message("tool_use", [6, 7, 8, 9].map((n) => fetchCall(`f${n}`, `https://ir.example.com/p${n}`)));
    const run = mockClient([first, second, TEXT_ANSWER]);
    await runCreateWithToolLoop(run.client, PARAMS, 5, { fetchBudget: 8 });
    expect(executeWebFetch).toHaveBeenCalledTimes(8);
    const lastTurn = run.sentMessages[2][4].content as { tool_use_id: string; content: string }[];
    expect(lastTurn.map((r) => r.tool_use_id)).toEqual(["f6", "f7", "f8", "f9"]);
    expect(lastTurn[3].content).toBe(
      "FETCH FAILED: fetch budget exhausted (8 per run): use the pages already read and the search summaries."
    );
    // One at a time: every fetch ends before the next one starts.
    expect(fetchSpans).toHaveLength(8);
    for (let i = 1; i < fetchSpans.length; i++) expect(fetchSpans[i].start).toBeGreaterThan(fetchSpans[i - 1].end);
  });

  it("gives the streaming loop, the one the research runs on, the same budget: 8 of 9 fetches, the 9th refused", async () => {
    const first = message("tool_use", [1, 2, 3, 4, 5].map((n) => fetchCall(`f${n}`, `https://ir.example.com/p${n}`)));
    const second = message("tool_use", [6, 7, 8, 9].map((n) => fetchCall(`f${n}`, `https://ir.example.com/p${n}`)));
    const { client, calls } = mockDualClient([first, second, TEXT_ANSWER]);
    const result = await runStreamWithToolLoop(client, { ...PARAMS, model: "deepseek-v4-pro" }, () => {}, 5, { fetchBudget: 8 });
    expect(result.hitIterationCap).toBe(false);
    expect(executeWebFetch).toHaveBeenCalledTimes(8);
    const lastTurn = (calls[2].params.messages as Anthropic.MessageParam[])[4].content as { tool_use_id: string; content: string }[];
    expect(lastTurn.map((r) => r.tool_use_id)).toEqual(["f6", "f7", "f8", "f9"]);
    expect(lastTurn[2].content).toBe("# page\n\nhttps://ir.example.com/p8");
    expect(lastTurn[3].content).toMatch(/^FETCH FAILED: fetch budget exhausted \(8 per run\)/);
  });

  it("spends the budget on a failed fetch as on a read one", async () => {
    for (let i = 0; i < 3; i++) vi.mocked(executeWebFetch).mockResolvedValueOnce("FETCH FAILED (HTTP 404): no usable content: try the HTML version of the page.");
    const turn = message("tool_use", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => fetchCall(`f${n}`, `https://ir.example.com/p${n}`)));
    const run = mockClient([turn, TEXT_ANSWER]);
    await runCreateWithToolLoop(run.client, PARAMS, 5, { fetchBudget: 8 });
    expect(executeWebFetch).toHaveBeenCalledTimes(8);
    const results = run.sentMessages[1][2].content as { content: string }[];
    expect(results[8].content).toMatch(/^FETCH FAILED: fetch budget exhausted/);
  });

  it("answers an unexpected web_fetch with the budget message when the route sets no budget, without a call or a throw", async () => {
    const turn = message("tool_use", [fetchCall("f1", "https://ir.example.com/a")]);
    const { client, sentMessages } = mockClient([turn, TEXT_ANSWER]);
    const result = await runCreateWithToolLoop(client, PARAMS, 5);
    expect(result.hitIterationCap).toBe(false);
    expect(executeWebFetch).not.toHaveBeenCalled();
    expect((sentMessages[1][2].content as { content: string }[])[0].content).toMatch(/^FETCH FAILED: fetch budget exhausted \(0 per run\)/);
  });
});
