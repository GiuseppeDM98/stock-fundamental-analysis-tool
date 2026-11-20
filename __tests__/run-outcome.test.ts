import { describe, it, expect } from "vitest";
import { classifyRunEnd } from "@/lib/ai/run-outcome";

describe("classifyRunEnd", () => {
  it("fails an empty answer, retryable", () => {
    expect(classifyRunEnd({ text: "  \n", stopReason: "end_turn", hitIterationCap: false })).toEqual({ kind: "failed", reason: "empty", retryable: true });
  });

  it("fails a refusal, not retryable — also when some text came first", () => {
    expect(classifyRunEnd({ text: "## 1. X", stopReason: "refusal", hitIterationCap: false })).toEqual({ kind: "failed", reason: "refusal", retryable: false });
  });

  it("fails a report cut by max_tokens, retryable: its JSON block was the last thing", () => {
    expect(classifyRunEnd({ text: "## 1. X\n```json\n{", stopReason: "max_tokens", hitIterationCap: false })).toEqual({ kind: "failed", reason: "max_tokens", retryable: true });
  });

  it("keeps a report that ran out of search rounds", () => {
    expect(classifyRunEnd({ text: "## 1. X", stopReason: "tool_use", hitIterationCap: true })).toEqual({ kind: "done" });
  });

  it("finishes a normal end_turn", () => {
    expect(classifyRunEnd({ text: "## 1. X", stopReason: "end_turn", hitIterationCap: false })).toEqual({ kind: "done" });
  });
});
