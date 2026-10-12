import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { executeWebSearch } from "@/lib/ai/web-search-tool";
import { SERVER_SIDE_FALLBACK_BETA, usesServerSideFallback } from "@/lib/ai/client";
import { fallbackServedBy, prepareTurnForReplay } from "@/lib/ai/fallback";
import { AI_MODEL_CATALOG, type AiModelId } from "@/types/ai-settings";

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

// Cap for the heavy-research routes (Deep Value + its analyst-panel review), and also
// reused by the earnings lookup even though its research is much lighter — a single
// shared "give DeepSeek plenty of room" knob is simpler than tuning a separate value per
// route, and 35 rounds only costs anything if the model actually needs them. Deep Value's
// prompts demand far more one-query-at-a-time rounds than the Advisor's single-answer
// prompt — and the ANALYTICAL_RIGOR_BLOCK / analyst structural checks (EV→equity bridge,
// same-basis comparables, scenario-vs-sensitivity, anchoring, reverse) each add figures
// to web-verify. Raised 25→35 after the added checks pushed real DeepSeek runs into the
// "too many search rounds" cutoff; the earnings route hit the same cutoff independently
// at the old 10-round default (reproduced in production, 2026-08-24) and was moved onto
// this shared cap rather than getting its own. DeepSeek-only in effect: Claude's
// server-side web_search never surfaces a client tool_use, so its loop exits after one
// iteration regardless of this value.
export const DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35;

// Cap for Grounded-mode Deep Value runs (and its analyst lenses) — lower than the Quick
// cap above because the web search is RESCOPED, not eliminated: the model no
// longer needs to research 5y of financials/multiples/comparables (they're provided), it
// only needs the post-coverage-date update + qualitative material. DeepSeek-only in
// effect, same as DEEP_RESEARCH_MAX_TOOL_ITERATIONS — Claude's server-side web_search
// never surfaces a client tool_use, so its loop exits after one iteration regardless.
export const GROUNDED_MAX_TOOL_ITERATIONS = 12;

// Cap for the blind-first analyst lenses' RECONCILE turn — that turn reconciles a
// commitment already made against the finished report, it does not research from scratch,
// so it needs far fewer rounds than either research cap above. Left at the shared default
// (10) would double the cost of the loop for no benefit.
export const RECONCILE_MAX_TOOL_ITERATIONS = 4;

type StreamParams = Omit<Anthropic.MessageStreamParams, "messages"> & {
  messages: Anthropic.MessageParam[];
};

/**
 * Top-level automatic prompt-caching param for one request, or an empty object when the
 * provider can't take it. Spread into the request params.
 *
 * A cache READ only happens at a breakpoint present in the CURRENT request, so a caller
 * that wants turn N+1 to reuse turn N's prefix must send this on BOTH requests — setting
 * it only on the first one pays the write premium and never reads it back. Anthropic
 * only: DeepSeek's Anthropic-compat proxy rejects `cache_control`.
 */
export function buildPromptCacheParam(model: AiModelId): { cache_control?: { type: "ephemeral" } } {
  return AI_MODEL_CATALOG[model].provider === "anthropic" ? { cache_control: { type: "ephemeral" } } : {};
}

// Logged per round so the extra token cost of the blind-first two-turn flow (roughly
// 1.9x per lens, since turn 2 replays turn 1's thinking as input) and whether the prompt
// cache is actually read are measured, not guessed. Shared by both loop variants so the
// non-streaming earnings lookup is just as observable as the streaming routes.
function logRoundUsage(
  round: number,
  usage: Pick<Anthropic.Usage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">
): void {
  console.log(
    `[tool-loop] round ${round} usage: input=${usage.input_tokens} output=${usage.output_tokens}` +
      (usage.cache_read_input_tokens != null ? ` cache_read=${usage.cache_read_input_tokens}` : "") +
      (usage.cache_creation_input_tokens != null ? ` cache_creation=${usage.cache_creation_input_tokens}` : "")
  );
}

/** The assistant turn as it goes back into `messages`: unchanged unless a fallback
 * happened mid-output, in which case the declined model's internal blocks are dropped
 * (see `prepareTurnForReplay`). */
function assistantTurn(message: Anthropic.Message): Anthropic.MessageParam {
  return { role: "assistant", content: prepareTurnForReplay(message.content) };
}

/** Logs the switch when a fallback model served the round — the cost and the latency
 * belong to that model, and nothing else in the server logs would show it. */
function logFallback(round: number, requested: string, message: Anthropic.Message): string | null {
  const servedBy = fallbackServedBy(message as unknown as Parameters<typeof fallbackServedBy>[0]);
  if (servedBy) console.log(`[tool-loop] round ${round}: ${requested} declined, served by ${servedBy}`);
  return servedBy;
}

/** Runs every client-executed `web_search` call in `message` and returns the tool_result
 * user turn to send back — or null when the turn is final (no tool call to answer). */
async function answerSearchCalls(message: Anthropic.Message): Promise<Anthropic.MessageParam | null> {
  const searchCalls = message.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "web_search"
  );
  if (message.stop_reason !== "tool_use" || searchCalls.length === 0) return null;

  const toolResults = await Promise.all(
    searchCalls.map(async (call) => ({
      type: "tool_result" as const,
      tool_use_id: call.id,
      content: await executeWebSearch((call.input as { query: string }).query),
    }))
  );
  return { role: "user", content: toolResults };
}

interface StreamLoopResult {
  stopReason: string | null;
  // True when the loop exhausted MAX_TOOL_ITERATIONS while the model was still calling
  // tools (or still paused) — distinct from a normal stop, so callers can surface a
  // "still researching" note instead of silently returning an empty/partial answer.
  hitIterationCap: boolean;
  // The full message array (params.messages + every assistant turn + every tool_result
  // user turn), fit to be replayed verbatim as the next call's `messages` — the blind-first
  // analyst lenses' turn 2 needs this to reconcile against turn 1 without re-sending a
  // stripped-down history that could trigger a 400 on an orphaned server_tool_use/tool_use
  // block.
  messages: Anthropic.MessageParam[];
  // Concatenation of every text delta across every round of the loop.
  text: string;
  // The model that actually answered when the server-side refusal fallback served the
  // final round instead of the requested model (Sonnet 5.5 only), else null. Routes that
  // show text append a note naming it, so the reader knows which model wrote it.
  servedBy: string | null;
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
  let servedBy: string | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const stream = openStream(client, { ...params, messages });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        onTextDelta(event.delta.text);
      } else if (event.type === "message_delta" && event.delta.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }

    const finalMessage = await stream.finalMessage();
    messages.push(assistantTurn(finalMessage));
    logRoundUsage(i + 1, finalMessage.usage);
    servedBy = logFallback(i + 1, params.model, finalMessage);

    // Claude's server-side web_search interrupts the turn with stop_reason "pause_turn"
    // after ~10 internal search rounds — a real, ongoing turn, not a terminal state.
    // Treating it as terminal returns a partial/often-empty answer silently. Resume by
    // re-sending the SAME messages array (the assistant turn is already appended above)
    // — never append a new user message after a pause, only after resuming it.
    if (finalMessage.stop_reason === "pause_turn") continue;

    const toolResultTurn = await answerSearchCalls(finalMessage);
    if (!toolResultTurn) return { stopReason, hitIterationCap: false, messages, text, servedBy };
    messages.push(toolResultTurn);
  }

  return { stopReason, hitIterationCap: true, messages, text, servedBy };
}

/** The raw streaming events and final message the loop reads — the part the regular and
 * the beta stream have in common. */
interface LoopStream extends AsyncIterable<Anthropic.RawMessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

/** Opens one streaming round: on the beta endpoint with the server-side refusal fallback
 * for the models that opt in (`usesServerSideFallback`), on the regular one otherwise.
 * The casts are the seam between the beta and regular types: the loop reads only text
 * deltas, `stop_reason`, content, model and usage, which both shapes share. (The SDK's
 * beta namespace exports no stream-params alias; `.stream()` takes the same body as the
 * non-streaming create, so that type stands in for it.) */
function openStream(client: Anthropic, params: Anthropic.MessageStreamParams): LoopStream {
  if (!usesServerSideFallback(params.model)) return client.messages.stream(params);
  return client.beta.messages.stream({
    ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: "default",
  }) as unknown as LoopStream;
}

/** Non-streaming twin of `openStream`. */
function createMessage(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  if (!usesServerSideFallback(params.model)) return client.messages.create(params);
  return client.beta.messages.create({
    ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: "default",
  }) as unknown as Promise<Anthropic.Message>;
}

type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "messages"> & {
  messages: Anthropic.MessageParam[];
};

export interface CreateLoopResult {
  // The last assistant message received — the final answer unless hitIterationCap.
  message: Anthropic.Message;
  stopReason: string | null;
  // Same meaning as StreamLoopResult.hitIterationCap: the cap ran out while the model was
  // still calling tools or still paused, so `message` is NOT a final answer (typically
  // another tool_use or a paused partial turn). Callers must not parse it as one.
  hitIterationCap: boolean;
  messages: Anthropic.MessageParam[];
  // Same meaning as StreamLoopResult.servedBy.
  servedBy: string | null;
}

/** Non-streaming equivalent of `runStreamWithToolLoop`, for one-shot structured-JSON
 * lookups (e.g. the earnings route). Same loop semantics: resumes on `pause_turn`,
 * answers client-executed `web_search` calls, logs usage per round, and reports
 * `hitIterationCap` when it gave up before a final answer. */
export async function runCreateWithToolLoop(
  client: Anthropic,
  params: CreateParams,
  maxIterations: number = DEFAULT_MAX_TOOL_ITERATIONS
): Promise<CreateLoopResult> {
  const messages = [...params.messages];
  let lastMessage: Anthropic.Message | null = null;
  let servedBy: string | null = null;

  for (let i = 0; i < maxIterations; i++) {
    lastMessage = await createMessage(client, { ...params, messages });
    messages.push(assistantTurn(lastMessage));
    logRoundUsage(i + 1, lastMessage.usage);
    servedBy = logFallback(i + 1, params.model, lastMessage);

    // Same resume-on-pause rule as the streaming loop above.
    if (lastMessage.stop_reason === "pause_turn") continue;

    const toolResultTurn = await answerSearchCalls(lastMessage);
    if (!toolResultTurn) {
      return { message: lastMessage, stopReason: lastMessage.stop_reason, hitIterationCap: false, messages, servedBy };
    }
    messages.push(toolResultTurn);
  }

  if (!lastMessage) throw new Error("runCreateWithToolLoop: maxIterations must be at least 1");
  return { message: lastMessage, stopReason: lastMessage.stop_reason, hitIterationCap: true, messages, servedBy };
}
