// Server side of the staged AI runs' Server-Sent Events (2026-10-27, after the staged
// "Consulente" run of net-worth-tracker). The client reads them with lib/sse-reader.ts.
import "server-only";
import type { AiRunEvent } from "@/types/ai-run";

const encoder = new TextEncoder();

/** One event as the wire carries it: `data: <json>\n\n`. The JSON escapes any newline in
 *  a text, so "\n\n" only ever ends an event. */
export function encodeSseEvent(event: AiRunEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** The response of a staged route. No header names the resolved settings: the row carries
 *  them, written by the server when the run starts (since 2026-10-27). */
export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The only way a staged route writes to its stream. When the client goes away (a closed
 * tab, a dropped connection) the stream is cancelled and every later `enqueue` throws a
 * TypeError: raised inside the model's text callback, it would climb out of the tool loop
 * and turn a run that was going well into a failure. The server finishes the phase and
 * writes the row regardless of who is still listening, so a send to a closed stream is
 * simply dropped. `close` is idempotent for the same reason.
 */
export function createSseChannel(controller: ReadableStreamDefaultController<Uint8Array>): {
  send(event: AiRunEvent): void;
  close(): void;
} {
  let closed = false;
  return {
    send(event) {
      if (closed) return;
      try {
        controller.enqueue(encodeSseEvent(event));
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // Already closed or cancelled by the client: nothing left to close.
      }
    },
  };
}
