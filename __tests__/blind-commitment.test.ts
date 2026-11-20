import { describe, it, expect } from "vitest";
import { pickBlindCommitment, buildBlindAssistantTurn } from "@/lib/ai/blind-commitment";
import { parseBlindJson } from "@/lib/report/parse-deep-value-json";

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
  it("returns the commitment and the prose after it as the rationale, dropping the prose before", () => {
    const text = `Let me check the latest results first.\n\n${block(COMMITMENT)}\n\nRationale: the 2025 EBITDA supports a 6x multiple.  `;
    const picked = pickBlindCommitment(text);
    expect(picked).not.toBeNull();
    expect(picked!.result.base.fairValue).toBe(2.6);
    expect(picked!.rationale).toBe("Rationale: the 2025 EBITDA supports a 6x multiple.");
    expect(picked!.rationale).not.toContain("Let me check");
  });

  it("caps the rationale at 2500 characters", () => {
    expect(pickBlindCommitment(`${block(COMMITMENT)}\n${"x".repeat(3000)}`)!.rationale).toHaveLength(2500);
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
  });
});

describe("buildBlindAssistantTurn", () => {
  it("rebuilds the commitment as a JSON fence followed by its rationale, the rationale kept out of the JSON", () => {
    const stored = parseBlindJson(JSON.stringify({ ...COMMITMENT, rationale: "Net debt dominates." }))!;
    const turn = buildBlindAssistantTurn(stored as Parameters<typeof buildBlindAssistantTurn>[0], stored.rationale ?? "");
    expect(turn.startsWith("```json\n")).toBe(true);
    expect(turn.endsWith("\n```\n\nNet debt dominates.")).toBe(true);
    const json = JSON.parse(turn.slice("```json\n".length, turn.indexOf("\n```")));
    expect(json.base.fairValue).toBe(2.6);
    expect(json.killPrice).toBe(1.5);
    expect(json).not.toHaveProperty("rationale");
  });

  it("keeps the route's Phase-1 quote out of the JSON the model is shown", () => {
    const stored = parseBlindJson(JSON.stringify({ ...COMMITMENT, rationale: "R.", phase1Quote: { price: 10, currency: "EUR" } }))!;
    const turn = buildBlindAssistantTurn(stored as Parameters<typeof buildBlindAssistantTurn>[0], "R.");
    expect(turn).not.toContain("phase1Quote");
  });
});
