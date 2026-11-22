// @vitest-environment node
// How the research client turns each answer of /api/ai/research into a step or a
// ResearchPartError. The hook decides on `lost` alone whether to read GET ?runId= and go on
// by itself, so a lost answer must never be classified as a refusal, nor the other way round.
import { afterEach, describe, expect, it, vi } from "vitest";
import { continueResearch, ResearchPartError, startResearch } from "@/lib/dataset-client";

function respond(status: number, body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } })));
}

async function caught(promise: Promise<unknown>): Promise<ResearchPartError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ResearchPartError);
  return error as ResearchPartError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research client — answers and errors", () => {
  it("returns the step of a 200", async () => {
    respond(200, JSON.stringify({ runId: "run1", part: "statements", next: "market" }));
    await expect(startResearch("ORNT")).resolves.toEqual({ runId: "run1", part: "statements", next: "market" });
  });

  it("calls a rejected fetch lost, with no status, keeping the caller's run and part", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const error = await caught(continueResearch("run1", "market"));
    expect(error).toMatchObject({ lost: true, status: null, runId: "run1", part: "market" });
  });

  it("calls a body that is not JSON lost (a 504 from the platform), with its status", async () => {
    respond(504, "<html>Gateway Timeout</html>");
    const error = await caught(continueResearch("run1", "estimates"));
    expect(error).toMatchObject({ lost: true, status: 504, runId: "run1", part: "estimates" });
  });

  it("calls a 409 an answer, not a loss, and carries the part the run expects", async () => {
    respond(409, JSON.stringify({ error: "part out of order", runId: "run1", part: "estimates", next: "market" }));
    const error = await caught(continueResearch("run1", "estimates"));
    expect(error).toMatchObject({ lost: false, status: 409, runId: "run1", part: "estimates", next: "market", message: "part out of order" });
  });

  it("takes the run id from the body of an error on the start, where the caller has none", async () => {
    respond(502, JSON.stringify({ error: "No financial data found", runId: "run9", part: "statements" }));
    const error = await caught(startResearch("ORNT"));
    expect(error).toMatchObject({ lost: false, status: 502, runId: "run9", part: "statements" });
    expect(error.next).toBeUndefined();
  });
});
