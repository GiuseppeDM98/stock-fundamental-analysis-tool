import { describe, it, expect } from "vitest";
import { createStreamGate } from "@/lib/ai/stream-gate";
import { REPORT_START_MARKER } from "@/lib/report/parse-deep-value-json";

describe("createStreamGate", () => {
  it("should discard everything before the marker and forward what follows it, marker dropped", () => {
    const gate = createStreamGate(REPORT_START_MARKER);
    expect(gate.push("Let me search the filings… ")).toBe("");
    expect(gate.push(`more chatter${REPORT_START_MARKER}\n## 1. Overview`)).toBe("\n## 1. Overview");
    expect(gate.push(" body")).toBe(" body");
    expect(gate.opened()).toBe(true);
    expect(gate.flush()).toBe("");
  });

  it("should find a marker split across two chunks", () => {
    const gate = createStreamGate(REPORT_START_MARKER);
    expect(gate.push("chatter <!--rep")).toBe("");
    expect(gate.opened()).toBe(false);
    expect(gate.push("ort-->## 1. Title")).toBe("## 1. Title");
    expect(gate.opened()).toBe(true);
  });

  it("should give back the whole buffer on flush when the marker never came", () => {
    const gate = createStreamGate(REPORT_START_MARKER);
    gate.push("## 1. Overview\n");
    gate.push("a report written straight into prose");
    expect(gate.opened()).toBe(false);
    expect(gate.flush()).toBe("## 1. Overview\na report written straight into prose");
  });

  it("should forward a later repeat of the marker untouched (the client strips it)", () => {
    const gate = createStreamGate(REPORT_START_MARKER);
    gate.push(REPORT_START_MARKER);
    expect(gate.push(`x${REPORT_START_MARKER}y`)).toBe(`x${REPORT_START_MARKER}y`);
  });
});
