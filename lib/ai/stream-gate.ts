// Streaming gate for the Deep Value and analyst-lens routes.
//
// The prompts ask the model to finish ALL its web research first and then open the
// written answer with a sentinel line (REPORT_START_MARKER / CRITIQUE_START_MARKER in
// lib/report/parse-deep-value-json.ts). What it writes before that line is chatter between
// tool calls ("Let me search…") that must never reach the client or the saved report, so
// the route buffers it and forwards only what follows the marker. The marker itself is
// dropped here; stripJsonBlock removes any repeat on the client.
//
// Pure (no I/O): the route owns the controller and decides what to do with flush().

/** Buffers a text stream until `marker` appears, then forwards everything after it (the
 *  marker itself is dropped). flush() returns what was buffered when the marker never came,
 *  so a run that opened straight into prose is not swallowed (AGENTS.md gotcha #26). */
export function createStreamGate(marker: string): { push(chunk: string): string; flush(): string; opened(): boolean } {
  let buffer = "";
  let open = false;
  return {
    push(chunk) {
      if (open) return chunk;
      // The marker can be split across two chunks: search the whole buffer, not the chunk.
      buffer += chunk;
      const idx = buffer.indexOf(marker);
      if (idx === -1) return "";
      open = true;
      const out = buffer.slice(idx + marker.length);
      buffer = "";
      return out;
    },
    flush() {
      return open ? "" : buffer;
    },
    opened() {
      return open;
    },
  };
}
