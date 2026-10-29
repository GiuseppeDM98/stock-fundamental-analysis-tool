import { describe, it, expect } from "vitest";
import { pickBlindCommitment } from "@/lib/ai/blind-commitment";
import { parseBlindJson, parseDeepValueJson, stripAnalystStreamArtifacts } from "@/lib/report/parse-deep-value-json";

const COMMITMENT = {
  method: "EV/EBITDA",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 3.1 },
  base: { fairValue: 2.6 },
  bear: { fairValue: 1.9 },
  killPrice: 1.5,
};
const block = (obj: unknown) => "```json\n" + JSON.stringify(obj, null, 2) + "\n```";

describe("pickBlindCommitment", () => {
  it("returns only the re-fenced commitment, dropping prose before and after it", () => {
    const text = `Let me check the latest results first.\n\n${block(COMMITMENT)}\n\nRationale: the 2025 EBITDA supports a 6x multiple.`;
    const picked = pickBlindCommitment(text);
    expect(picked).not.toBeNull();
    expect(picked!.result.base.fairValue).toBe(2.6);
    expect(picked!.fenced.startsWith("```json-blind\n")).toBe(true);
    expect(picked!.fenced).not.toContain("Let me check");
    expect(picked!.fenced).not.toContain("Rationale");
  });

  it("leaves nothing behind in the critique once the client strips stream artifacts", () => {
    const picked = pickBlindCommitment(`preamble\n${block(COMMITMENT)}\nrationale`)!;
    const stream = picked.fenced + "```json\n{\"base\":{\"fairValue\":2}}\n```\nCritique body.";
    expect(parseBlindJson(stream)?.killPrice).toBe(1.5);
    // The re-fenced block never collides with the FINAL block's parser.
    expect(parseDeepValueJson(stream)?.base?.fairValue).toBe(2);
    expect(stripAnalystStreamArtifacts(stream).startsWith("```json\n")).toBe(true);
  });

  it("returns null when there is no JSON fence", () => {
    expect(pickBlindCommitment("I could not value this company.")).toBeNull();
  });

  it("returns null when the only fence is unparseable or lacks a scenario", () => {
    expect(pickBlindCommitment("```json\n{ not json\n```")).toBeNull();
    expect(pickBlindCommitment(block({ bull: { fairValue: 1 }, base: { fairValue: 1 } }))).toBeNull();
  });

  it("with multiple fences, picks the first usable one", () => {
    const draft = "```json\n{ \"bull\": \n```";
    const second = { ...COMMITMENT, base: { fairValue: 2.7 } };
    const third = { ...COMMITMENT, base: { fairValue: 9.9 } };
    const picked = pickBlindCommitment(`${draft}\nretrying\n${block(second)}\nand\n${block(third)}`);
    expect(picked!.result.base.fairValue).toBe(2.7);
    expect(picked!.fenced).not.toContain("9.9");
  });
});
