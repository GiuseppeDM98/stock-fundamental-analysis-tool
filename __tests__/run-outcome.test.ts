import { describe, it, expect } from "vitest";
import { classifyRunEnd, classifyValuationEnd } from "@/lib/ai/run-outcome";
import { runErrorMessage } from "@/lib/ai/error-status";

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

describe("classifyValuationEnd", () => {
  it("fails a valuation without a full triple, retryable", () => {
    expect(classifyValuationEnd({ stopReason: "end_turn", hasTriple: false })).toEqual({ kind: "failed", reason: "no_valuation", retryable: true });
  });

  it("fails a refusal, not retryable", () => {
    expect(classifyValuationEnd({ stopReason: "refusal", hasTriple: true })).toEqual({ kind: "failed", reason: "refusal", retryable: false });
  });

  it("fails a valuation cut by max_tokens, retryable", () => {
    expect(classifyValuationEnd({ stopReason: "max_tokens", hasTriple: false })).toEqual({ kind: "failed", reason: "max_tokens", retryable: true });
  });

  it("finishes a valuation with its full triple", () => {
    expect(classifyValuationEnd({ stopReason: "end_turn", hasTriple: true })).toEqual({ kind: "done" });
  });

  it("names the missing triple, not an empty answer", () => {
    const end = classifyValuationEnd({ stopReason: "end_turn", hasTriple: false });
    const empty = classifyRunEnd({ text: "", stopReason: "end_turn", hitIterationCap: false });
    expect(runErrorMessage(end, "English")).toBe("The valuation came back without a complete bull/base/bear: retry.");
    expect(runErrorMessage(end, "English")).not.toBe(runErrorMessage(empty, "English"));
    expect(runErrorMessage(end, "Italiano")).toBe("La valutazione è arrivata senza la terna completa: riprova.");
  });
});
