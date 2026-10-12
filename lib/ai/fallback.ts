// Pure helpers for the server-side refusal fallback (`fallbacks: "default"`, beta
// `server-side-fallback-2026-07-01`) — see `usesServerSideFallback()` in lib/ai/client.ts
// for which calls opt in. Kept free of `server-only` and of any client so the response
// shapes they read can be unit-tested on plain objects.
import { AI_MODEL_CATALOG, AI_MODEL_IDS, type AiModelId } from "@/types/ai-settings";

/** The few fields of a (beta) Messages response these helpers read. */
export interface FallbackAwareMessage {
  model: string;
  stop_reason: string | null;
  usage: { iterations?: ReadonlyArray<{ type: string }> | null };
}

/** The model that served `message` through a fallback, or null when the requested model
 * answered itself.
 *
 * The signal is a `fallback_message` entry in `usage.iterations`, not the `fallback`
 * content block: a conversation that already fell back is served by the fallback model
 * directly for about an hour ("sticky" routing), and those turns carry no block. A
 * fallback model can refuse too, so a final `refusal` means nobody served the turn. */
export function fallbackServedBy(message: FallbackAwareMessage): string | null {
  const fellBack = (message.usage.iterations ?? []).some((entry) => entry.type === "fallback_message");
  return fellBack && message.stop_reason !== "refusal" ? message.model : null;
}

/** Display label for a model id the API returned — the catalog label when the id is one
 * of ours, the raw id otherwise (a fallback target the catalog doesn't list). */
export function modelLabel(model: string): string {
  return (AI_MODEL_IDS as readonly string[]).includes(model) ? AI_MODEL_CATALOG[model as AiModelId].label : model;
}

/** Prepares an assistant turn for replay as history (the tool loop's `pause_turn`
 * resume, the blind-first lenses' turn 2).
 *
 * After a mid-output fallback the API asks that every `thinking`, `redacted_thinking`
 * and `tool_use` block before the last `fallback` block be omitted, as well as any
 * `server_tool_use` whose result never arrived and any other model-internal block type:
 * they belong to the model that declined. So before the boundary only text, paired
 * server-tool blocks and earlier `fallback` markers are kept; from the boundary on,
 * everything is echoed as it came.
 * A turn with no `fallback` block is returned unchanged (same array), so the history of
 * a call that never fell back stays byte-identical and keeps its prompt cache. */
export function prepareTurnForReplay<T extends { type: string }>(content: T[]): T[] {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  if (boundary === -1) return content;

  const answeredToolIds = new Set(
    content
      .filter((block) => block.type.endsWith("_tool_result"))
      .map((block) => (block as unknown as { tool_use_id?: string }).tool_use_id)
      .filter((id): id is string => typeof id === "string")
  );

  return content.filter((block, index) => {
    if (index >= boundary) return true;
    // Earlier `fallback` blocks are audit markers the API ignores; kept as they came.
    if (block.type === "text" || block.type === "fallback" || block.type.endsWith("_tool_result")) return true;
    if (block.type === "server_tool_use") {
      return answeredToolIds.has((block as unknown as { id: string }).id);
    }
    return false;
  });
}

/** The visible note a streaming route appends when a fallback model wrote the text the
 * user is reading — the model selector still names the requested model, so without it
 * the answer would be attributed to the wrong one. Markdown italics, like the routes'
 * other end-of-stream notes. */
export function fallbackNote(requested: string, servedBy: string, italian: boolean): string {
  const from = modelLabel(requested);
  const to = modelLabel(servedBy);
  return italian
    ? `_[${from} ha rifiutato la richiesta: ha risposto ${to}.]_`
    : `_[${from} declined this request; ${to} answered it.]_`;
}
