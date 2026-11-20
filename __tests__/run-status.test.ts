import { describe, it, expect } from "vitest";
import { RUN_STALE_AFTER_MS, RUN_RETRY_AFTER_MS, runStateOf, isRunStale, canRetry, isDone } from "@/lib/report/run-status";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;

describe("runStateOf", () => {
  it("reads done, and an absent status as done (the column's default)", () => {
    expect(runStateOf({ runStatus: "done" }, NOW)).toBe("done");
    expect(runStateOf({}, NOW)).toBe("done");
    expect(runStateOf({ runStatus: null }, NOW)).toBe("done");
  });

  it("reads a run started 2 minutes ago as running", () => {
    expect(runStateOf({ runStatus: "running", runStartedAt: ago(2 * MIN) }, NOW)).toBe("running");
  });

  it("keeps a run started exactly RUN_STALE_AFTER_MS ago running, and calls 21 minutes stale", () => {
    expect(runStateOf({ runStatus: "running", runStartedAt: ago(RUN_STALE_AFTER_MS) }, NOW)).toBe("running");
    expect(runStateOf({ runStatus: "running", runStartedAt: ago(21 * MIN) }, NOW)).toBe("stale");
  });

  it("calls a running row with no start time stale", () => {
    expect(runStateOf({ runStatus: "running", runStartedAt: null }, NOW)).toBe("stale");
    expect(isRunStale({ runStatus: "running" }, NOW)).toBe(true);
  });

  it("reads failed as failed, and never as done", () => {
    expect(runStateOf({ runStatus: "failed", runStartedAt: ago(MIN) }, NOW)).toBe("failed");
    expect(isDone({ runStatus: "failed" })).toBe(false);
    expect(isDone({ runStatus: "running" })).toBe(false);
  });

  it("accepts a Date as start time", () => {
    expect(runStateOf({ runStatus: "running", runStartedAt: new Date(NOW - 30 * MIN) }, NOW)).toBe("stale");
  });
});

describe("canRetry", () => {
  it("lets a failed run retry at once", () => {
    expect(canRetry({ runStatus: "failed", runStartedAt: ago(MIN) }, NOW)).toBe(true);
  });

  it("waits RUN_RETRY_AFTER_MS on a running row: 5 minutes no, 6 minutes yes", () => {
    expect(RUN_RETRY_AFTER_MS).toBe(330_000);
    expect(canRetry({ runStatus: "running", runStartedAt: ago(5 * MIN) }, NOW)).toBe(false);
    expect(canRetry({ runStatus: "running", runStartedAt: ago(6 * MIN) }, NOW)).toBe(true);
    expect(canRetry({ runStatus: "running", runStartedAt: ago(RUN_RETRY_AFTER_MS) }, NOW)).toBe(false);
  });

  it("never retries a done row", () => {
    expect(canRetry({ runStatus: "done", runStartedAt: ago(60 * MIN) }, NOW)).toBe(false);
    expect(canRetry({}, NOW)).toBe(false);
  });
});
