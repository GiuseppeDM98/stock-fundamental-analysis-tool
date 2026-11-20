// @vitest-environment node
import { describe, it, expect } from "vitest";
import { forEachSseEvent, parseSseEvent } from "@/lib/sse-reader";

/** A body that delivers exactly these chunks, in order. */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<unknown[]> {
  const events: unknown[] = [];
  await forEachSseEvent(body(chunks), (e) => events.push(e));
  return events;
}

describe("forEachSseEvent", () => {
  it("reads two events delivered in one chunk", async () => {
    expect(await collect(['data: {"type":"stage"}\n\ndata: {"type":"done"}\n\n'])).toEqual([{ type: "stage" }, { type: "done" }]);
  });

  it("reads an event split across two chunks once its second half arrives", async () => {
    expect(await collect(['data: {"type":"te', 'xt","text":"ab"}\n\n'])).toEqual([{ type: "text", text: "ab" }]);
  });

  it("ignores the [DONE] sentinel and a line without data:", async () => {
    expect(await collect(["data: [DONE]\n\n", ": keep-alive\n\n", 'data: {"type":"done"}\n\n'])).toEqual([{ type: "done" }]);
  });

  it("reads a text whose payload carries an escaped blank line as ONE event", async () => {
    const event = { type: "text", text: "## 1. Title\n\nbody" };
    expect(await collect([`data: ${JSON.stringify(event)}\n\n`])).toEqual([event]);
  });

  it("drops a tail the stream ended before terminating — a half-written event of a cut stream", async () => {
    expect(await collect(['data: {"type":"stage"}\n\ndata: {"type":"done"}'])).toEqual([{ type: "stage" }]);
  });

  it("rejects when the connection drops mid-read", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull() {
        throw new TypeError("network error");
      },
    });
    await expect(forEachSseEvent(broken, () => {})).rejects.toThrow("network error");
  });
});

describe("parseSseEvent", () => {
  it("throws on a payload that is not JSON (the caller reads it as a cut)", () => {
    expect(() => parseSseEvent("data: {oops")).toThrow();
  });
});
