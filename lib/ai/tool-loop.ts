import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { executeWebSearch } from "@/lib/ai/web-search-tool";

// Default cap for the client-side agentic loop for the custom web_search tool (DeepSeek
// path). Claude's web_search runs server-side and never surfaces a client-visible
// tool_use for it, so this loop always exits after one iteration for Claude — the cap
// only matters for DeepSeek, as a runaway-search guard. Matches Claude's own
// server-side web_search loop's default cap (10 rounds before pause_turn) — verified
// empirically (2026-07-10) that a broad multi-stock research prompt at high effort
// needed 7+ rounds to converge; 6 was too tight and silently cut the loop off mid-
// research with no final answer. Callers with heavier research prompts (Deep Value's
// ~5y financials + quality metrics + historical multiples + comparables) pass a higher
// `maxIterations` — reproduced in production (2026-07-10): the default 10 was too low
// for Deep Value and silently returned an empty report with no error.
const DEFAULT_MAX_TOOL_ITERATIONS = 10;

type StreamParams = Omit<Anthropic.MessageStreamParams, "messages"> & {
  messages: Anthropic.MessageParam[];
};

interface StreamLoopResult {
  stopReason: string | null;
  // True when the loop exhausted MAX_TOOL_ITERATIONS while the model was still calling
  // tools — distinct from a normal stop, so callers can surface a "still researching"
  // note instead of silently returning an empty/partial answer.
  hitIterationCap: boolean;
}

/** Runs a streaming Messages call, forwarding text deltas via `onTextDelta`. If the
 * model emits a `web_search` tool_use (the client-executed custom tool — see
 * lib/ai/web-search-tool.ts), executes the search and continues the conversation until
 * the model stops calling tools or the iteration cap is hit. */
export async function runStreamWithToolLoop(
  client: Anthropic,
  params: StreamParams,
  onTextDelta: (text: string) => void,
  maxIterations: number = DEFAULT_MAX_TOOL_ITERATIONS
): Promise<StreamLoopResult> {
  const messages = [...params.messages];
  let stopReason: string | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const stream = client.messages.stream({ ...params, messages });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onTextDelta(event.delta.text);
      } else if (event.type === "message_delta" && event.delta.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }

    const finalMessage = await stream.finalMessage();
    messages.push({ role: "assistant", content: finalMessage.content });

    const searchCalls = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "web_search"
    );

    if (finalMessage.stop_reason !== "tool_use" || searchCalls.length === 0) {
      return { stopReason, hitIterationCap: false };
    }

    const toolResults = await Promise.all(
      searchCalls.map(async (call) => ({
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: await executeWebSearch((call.input as { query: string }).query),
      }))
    );
    messages.push({ role: "user", content: toolResults });
  }

  return { stopReason, hitIterationCap: true };
}

type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "messages"> & {
  messages: Anthropic.MessageParam[];
};

/** Non-streaming equivalent of `runStreamWithToolLoop`, for one-shot structured-JSON
 * lookups (e.g. the earnings route). Returns the final message once the model stops
 * calling tools. */
export async function runCreateWithToolLoop(
  client: Anthropic,
  params: CreateParams,
  maxIterations: number = DEFAULT_MAX_TOOL_ITERATIONS
): Promise<Anthropic.Message> {
  const messages = [...params.messages];
  let finalMessage: Anthropic.Message | null = null;

  for (let i = 0; i < maxIterations; i++) {
    finalMessage = await client.messages.create({ ...params, messages });
    messages.push({ role: "assistant", content: finalMessage.content });

    const searchCalls = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "web_search"
    );

    if (finalMessage.stop_reason !== "tool_use" || searchCalls.length === 0) {
      break;
    }

    const toolResults = await Promise.all(
      searchCalls.map(async (call) => ({
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: await executeWebSearch((call.input as { query: string }).query),
      }))
    );
    messages.push({ role: "user", content: toolResults });
  }

  return finalMessage!;
}
