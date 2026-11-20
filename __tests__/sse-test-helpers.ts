// Fake responses of the staged AI routes for component tests: a body of Server-Sent Events
// written exactly as lib/ai/sse.ts writes them.
import type { AiRunEvent } from "@/types/ai-run";

const encode = (event: AiRunEvent) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

/** A 200 whose body sends `events` and closes (a cut, when none of them is terminal). */
export function sseOk(events: AiRunEvent[]) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const event of events) c.enqueue(encode(event));
      c.close();
    },
  });
  return { ok: true, status: 200, body, headers: new Headers({ "Content-Type": "text/event-stream" }), json: async () => ({}) };
}

/** A 200 whose body sends `events`, then fails the read — how a function killed
 *  mid-stream reaches the browser. */
export function sseRejecting(events: AiRunEvent[]) {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        for (const event of events) c.enqueue(encode(event));
        return;
      }
      c.error(new TypeError("network error"));
    },
  });
  return { ok: true, status: 200, body, headers: new Headers(), json: async () => ({}) };
}

/** A JSON answer (a refusal before the stream, or a GET of a row). */
export function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body };
}
