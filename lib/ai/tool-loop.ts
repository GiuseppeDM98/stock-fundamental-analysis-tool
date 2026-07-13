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

// Cap for the heavy-research routes (Deep Value + its analyst-panel review). Their
// prompts demand far more one-query-at-a-time rounds than the Advisor's single-answer
// prompt — and the ANALYTICAL_RIGOR_BLOCK / analyst structural checks (EV→equity bridge,
// same-basis comparables, scenario-vs-sensitivity, anchoring, reverse) each add figures
// to web-verify. Shared by both routes so the knob lives in one place. Raised 25→35 after
// the added checks pushed real DeepSeek runs into the "too many search rounds" cutoff.
// DeepSeek-only in effect: Claude's server-side web_search never surfaces a client
// tool_use, so its loop exits after one iteration regardless of this value.
export const DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35;

// Cap for Grounded-mode Deep Value runs (and its analyst lenses) — lower than the Quick
// cap above because the web search is RESCOPED, not eliminated (spec §5.6): the model no
// longer needs to research 5y of financials/multiples/comparables (they're provided), it
// only needs the post-coverage-date update + qualitative material. DeepSeek-only in
// effect, same as DEEP_RESEARCH_MAX_TOOL_ITERATIONS — Claude's server-side web_search
// never surfaces a client tool_use, so its loop exits after one iteration regardless.
export const GROUNDED_MAX_TOOL_ITERATIONS = 12;

// Cap for the blind-first analyst lenses' RECONCILE turn (docs/deep-value-rigor-v2-spec.md
// §6.1.5) — that turn reconciles a commitment already made against the finished report, it
// does not research from scratch, so it needs far fewer rounds than either research cap
// above. Left at the shared default (10) would double the cost of the loop for no benefit.
export const RECONCILE_MAX_TOOL_ITERATIONS = 4;

type StreamParams = Omit<Anthropic.MessageStreamParams, "messages"> & {
  messages: Anthropic.MessageParam[];
};

interface StreamLoopResult {
  stopReason: string | null;
  // True when the loop exhausted MAX_TOOL_ITERATIONS while the model was still calling
  // tools — distinct from a normal stop, so callers can surface a "still researching"
  // note instead of silently returning an empty/partial answer.
  hitIterationCap: boolean;
  // The full message array (params.messages + every assistant turn + every tool_result
  // user turn), fit to be replayed verbatim as the next call's `messages` — the blind-first
  // analyst lenses' turn 2 (docs/deep-value-rigor-v2-spec.md §6.1) needs this to reconcile
  // against turn 1 without re-sending a stripped-down history that could trigger a 400 on
  // an orphaned server_tool_use/tool_use block.
  messages: Anthropic.MessageParam[];
  // Concatenation of every text delta across every round of the loop.
  text: string;
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
  let text = "";

  for (let i = 0; i < maxIterations; i++) {
    const stream = client.messages.stream({ ...params, messages });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        onTextDelta(event.delta.text);
      } else if (event.type === "message_delta" && event.delta.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }

    const finalMessage = await stream.finalMessage();
    messages.push({ role: "assistant", content: finalMessage.content });

    // No usage was logged anywhere in this loop before — without it, the ~1.9x
    // token-per-lens cost the blind-first two-turn flow is expected to add (spec §6.6)
    // stays a guess instead of a measured fact.
    console.log(
      `[tool-loop] round ${i + 1} usage: input=${finalMessage.usage.input_tokens} output=${finalMessage.usage.output_tokens}` +
        (finalMessage.usage.cache_read_input_tokens != null ? ` cache_read=${finalMessage.usage.cache_read_input_tokens}` : "") +
        (finalMessage.usage.cache_creation_input_tokens != null ? ` cache_creation=${finalMessage.usage.cache_creation_input_tokens}` : "")
    );

    // Claude's server-side web_search interrupts the turn with stop_reason "pause_turn"
    // after ~10 internal search rounds — a real, ongoing turn, not a terminal state. This
    // was previously treated as terminal (falling through to the `stop_reason !== "tool_use"`
    // branch below): a paused turn returned silently with a partial/often-empty answer.
    // Resume by re-sending the SAME messages array (the assistant turn is already appended
    // above) — never append a new user message after a pause, only after resuming it.
    if (finalMessage.stop_reason === "pause_turn") continue;

    const searchCalls = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "web_search"
    );

    if (finalMessage.stop_reason !== "tool_use" || searchCalls.length === 0) {
      return { stopReason, hitIterationCap: false, messages, text };
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

  return { stopReason, hitIterationCap: true, messages, text };
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
