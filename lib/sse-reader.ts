// Reader for the staged AI routes' Server-Sent Events (2026-10-27; a faithful copy of
// lib/utils/sseReader.ts in net-worth-tracker, whose staged "Consulente" run reads the same
// shape). Pure: no React, no fetch — the panels and the lens hook own the request.
//
// Every event the server writes ends with "\n\n" (lib/ai/sse.ts), so the buffer splits on
// it and keeps the tail for the next chunk: an event cut across two chunks is read whole
// once its second half arrives. A tail left without its "\n\n" when the stream ends is NOT
// read — it is the half-written event of a stream the platform cut, and treating it as an
// event could read a `done` that the server never finished writing.

/**
 * Reads a `text/event-stream` body to its end, handing each `data:` payload to `onEvent`
 * in order. A rejected `reader.read()` (a dropped connection, a function killed mid-stream)
 * and a payload that is not JSON both reject this promise: the caller treats either as a
 * cut of the phase in progress.
 */
export async function forEachSseEvent<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const event = parseSseEvent<T>(raw);
      if (event) onEvent(event);
    }
  }
}

/** One raw event (the text between two "\n\n") → its JSON payload, or null for a line
 *  without `data:`, an empty payload or the `[DONE]` sentinel. Throws on a payload that is
 *  not JSON. */
export function parseSseEvent<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;
  return JSON.parse(payload) as T;
}
