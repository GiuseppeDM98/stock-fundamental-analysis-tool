// Coverage for lib/report/parse-deep-value-json.ts, including the blind-first additions.
// The critical assertion is the non-collision between ```json-blind and ```json fences —
// the whole two-turn transport trick
// relies on parseDeepValueJson/stripJsonBlock continuing to resolve to the FINAL block
// when a blind block is also present in the accumulated stream.
import { describe, it, expect } from "vitest";
import {
  parseDeepValueJson,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  parseBlindJson,
  hasFullTriple,
  currentAnalystPhase,
  stripAnalystStreamArtifacts,
  sanitizeSensitivity,
  sanitizeDividends,
  sanitizeUnits,
  ANALYST_PHASE_MARKERS,
  REPORT_START_MARKER,
  CRITIQUE_START_MARKER,
  lastJsonFence,
} from "@/lib/report/parse-deep-value-json";

const BLIND_BLOCK = '```json-blind\n{"method":"DCF","sector":"Utilities","currency":"EUR","bull":{"fairValue":10},"base":{"fairValue":8},"bear":{"fairValue":5}}\n```';
const FINAL_BLOCK = '```json\n{"method":"DCF","sector":"Utilities","currency":"EUR","bull":{"fairValue":11},"base":{"fairValue":9},"bear":{"fairValue":6}}\n```';

describe("parseDeepValueJson / stripJsonBlock — unchanged behavior", () => {
  it("parses a single json block", () => {
    expect(parseDeepValueJson(FINAL_BLOCK)?.base?.fairValue).toBe(9);
  });

  it("returns null when no block is present", () => {
    expect(parseDeepValueJson("just prose, no fence")).toBeNull();
  });

  it("strips the block, leaving surrounding prose", () => {
    const text = `${FINAL_BLOCK}\nSome critique text.`;
    expect(stripJsonBlock(text)).toBe("Some critique text.");
  });
});

describe("report first, JSON last — the parser reads the LAST fence", () => {
  const OLDER_FENCE = '```json\n{"method":"DCF","sector":"S","currency":"EUR","bull":{"fairValue":30},"base":{"fairValue":20},"bear":{"fairValue":10}}\n```';

  it("resolves to the second of two fences", () => {
    const text = `${OLDER_FENCE}\nprose\n${FINAL_BLOCK}`;
    expect(parseDeepValueJson(text)?.base?.fairValue).toBe(9);
  });

  it("parses a report saved with its only block at the top exactly as before", () => {
    const leading = `${FINAL_BLOCK}\n\n## 1. Overview\n\nBody.`;
    expect(parseDeepValueJson(leading)?.base?.fairValue).toBe(9);
    expect(stripJsonBlock(leading)).toBe("\n## 1. Overview\n\nBody.");
  });

  it("parses a report whose block closes it", () => {
    const trailing = `${REPORT_START_MARKER}\n## 1. Overview\n\nBody.\n\n${FINAL_BLOCK}`;
    expect(parseDeepValueJson(trailing)?.bull?.fairValue).toBe(11);
  });

  it("strips every fence and every repeated marker", () => {
    const text = `${REPORT_START_MARKER}\n## 1. A\n${OLDER_FENCE}\nmiddle ${REPORT_START_MARKER}\n${CRITIQUE_START_MARKER}tail\n${FINAL_BLOCK}`;
    const stripped = stripJsonBlock(text);
    expect(stripped).not.toContain("```json");
    expect(stripped).not.toContain(REPORT_START_MARKER);
    expect(stripped).not.toContain(CRITIQUE_START_MARKER);
    expect(stripped).toContain("## 1. A");
    expect(stripped).toContain("middle");
    expect(stripped).toContain("tail");
  });

  it("parses the final block even when a blind block precedes it", () => {
    const stream = `${BLIND_BLOCK}\nRationale.\n${CRITIQUE_START_MARKER}Critique.\n${FINAL_BLOCK}`;
    expect(parseDeepValueJson(stream)?.base?.fairValue).toBe(9);
    expect(parseBlindJson(stream)?.base?.fairValue).toBe(8);
  });
});

describe("lastJsonFence", () => {
  it("returns the body of the last ```json fence, unparsed, and ignores a json-blind one", () => {
    const text = `log\n\`\`\`json\n{"a":1}\n\`\`\`\nmore\n${BLIND_BLOCK}\n\`\`\`json\n{"b":2}\n\`\`\`\n`;
    expect(lastJsonFence(text)).toBe('{"b":2}');
    expect(lastJsonFence("no fence here")).toBeNull();
    // Unparseable content still comes back: the caller's schema judges it.
    expect(lastJsonFence("```json\n{broken\n```")).toBe("{broken");
  });
});

describe("stripTrailingOpenJsonFence", () => {
  it("hides an unclosed json fence still streaming at the end", () => {
    expect(stripTrailingOpenJsonFence('## 10. Summary\nDone.\n\n```json\n{"method":"DC')).toBe("## 10. Summary\nDone.\n\n");
  });

  it("hides a fence whose closing backticks have not fully arrived", () => {
    expect(stripTrailingOpenJsonFence('Body\n```json\n{"a":1}\n``')).toBe("Body\n");
  });

  it("returns the text unchanged when the last fence is closed or there is none", () => {
    const closed = `Body\n${FINAL_BLOCK}`;
    expect(stripTrailingOpenJsonFence(closed)).toBe(closed);
    expect(stripTrailingOpenJsonFence("plain prose")).toBe("plain prose");
  });

  it("treats a closed blind fence as closed", () => {
    const stream = `${BLIND_BLOCK}\n${CRITIQUE_START_MARKER}Critique so far`;
    expect(stripTrailingOpenJsonFence(stream)).toBe(stream);
  });
});

describe("```json-blind does NOT collide with the ```json fence", () => {
  it("parseDeepValueJson resolves to the FINAL block when both a blind and a final block are present", () => {
    const rationale = "Blind rationale text.";
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\n${rationale}\n${ANALYST_PHASE_MARKERS.reconcile}${FINAL_BLOCK}\nFinal critique.`;
    const parsed = parseDeepValueJson(stream);
    expect(parsed?.base?.fairValue).toBe(9); // the FINAL block's value, not the blind one's (8)
  });

  it("stripJsonBlock removes only the FINAL block, leaving the blind fence untouched", () => {
    const stream = `${BLIND_BLOCK}\nRationale.\n${FINAL_BLOCK}\nCritique.`;
    const stripped = stripJsonBlock(stream);
    expect(stripped).toContain("```json-blind");
    expect(stripped).not.toContain('"fairValue":11'); // the final block's own marker value is gone
    expect(stripped).toContain("Critique.");
  });

  // Reading the LAST fence makes the case above pass even if the blind fence matched; this
  // is the case where a collision would change the result (a lens cut before its final block).
  it("parseDeepValueJson ignores a blind fence when no final block follows", () => {
    expect(parseDeepValueJson(BLIND_BLOCK)).toBeNull();
    const cut = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\nRationale.\n${ANALYST_PHASE_MARKERS.reconcile}${CRITIQUE_START_MARKER}Critique cut mid-`;
    expect(parseDeepValueJson(cut)).toBeNull();
  });

  it("parseBlindJson parses only the blind block, ignoring a final block later in the same text", () => {
    const stream = `${BLIND_BLOCK}\nRationale.\n${FINAL_BLOCK}\nCritique.`;
    expect(parseBlindJson(stream)?.base?.fairValue).toBe(8);
  });

  it("parseBlindJson returns null when no blind block is present", () => {
    expect(parseBlindJson(FINAL_BLOCK)).toBeNull();
  });
});

describe("currentAnalystPhase", () => {
  it("returns null before any marker has appeared", () => {
    expect(currentAnalystPhase("some partial stream text")).toBeNull();
  });

  it("returns 'blind' once the blind marker has appeared", () => {
    expect(currentAnalystPhase(`${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}`)).toBe("blind");
  });

  it("returns 'reconcile' once the reconcile marker appears after the blind one", () => {
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\n${ANALYST_PHASE_MARKERS.reconcile}`;
    expect(currentAnalystPhase(stream)).toBe("reconcile");
  });
});

describe("stripAnalystStreamArtifacts", () => {
  it("removes both phase markers and the blind fence, leaving the final block + critique intact", () => {
    const stream = `${ANALYST_PHASE_MARKERS.blind}${BLIND_BLOCK}\nRationale.\n${ANALYST_PHASE_MARKERS.reconcile}${FINAL_BLOCK}\nFinal critique.`;
    const cleaned = stripAnalystStreamArtifacts(stream);
    expect(cleaned).not.toContain(ANALYST_PHASE_MARKERS.blind);
    expect(cleaned).not.toContain(ANALYST_PHASE_MARKERS.reconcile);
    expect(cleaned).not.toContain("```json-blind");
    // stripJsonBlock still needs to run separately to remove the FINAL block for display —
    // this function only clears the blind-turn artifacts.
    expect(stripJsonBlock(cleaned)).toBe("Rationale.\nFinal critique.");
  });

  it("is a no-op on a plain (non-blind-first) stream", () => {
    const stream = `${FINAL_BLOCK}\nCritique.`;
    expect(stripAnalystStreamArtifacts(stream)).toBe(stream);
  });
});

describe("parseDeepValueJson — shape sanitization (untrusted model JSON)", () => {
  const fence = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```";
  const VALID_BRIDGE = { driver: "EBITDA", driverValue: 1000, driverYear: 2025, multiple: 5, netDebt: 500, minorities: 200, shares: 100, intrinsicPerShare: 43 };

  it("drops malformed optional fields instead of propagating them", () => {
    const parsed = parseDeepValueJson(
      fence({
        method: "EV/EBITDA",
        sector: "Utilities",
        currency: "EUR",
        bull: { fairValue: 12, probability: "0.25", bridge: "see text" },
        base: { fairValue: 10, probability: 0.5, bridge: { ...VALID_BRIDGE, netDebt: null } },
        bear: { fairValue: 7, probability: null, bridge: VALID_BRIDGE },
        assumptions: "n/a",
        crossCheck: { method: "DDM", intrinsicPerShare: "11", reconciliation: "x" },
        revisions: "none",
      })
    )!;
    expect(parsed.bull).toEqual({ fairValue: 12 }); // string probability + string bridge dropped
    expect(parsed.base).toEqual({ fairValue: 10, probability: 0.5 }); // bridge missing a term ⇒ whole bridge dropped
    expect(parsed.bear?.bridge).toEqual(VALID_BRIDGE);
    expect(parsed.bear?.probability).toBeUndefined();
    expect(parsed.assumptions).toBeUndefined();
    expect(parsed.crossCheck).toBeUndefined();
    expect(parsed.revisions).toBeUndefined();
  });

  it("keeps a bridge whose only defect is an invalid optional `multiple` (DCF/DDM omit it legitimately)", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", bull: { fairValue: 1 }, base: { fairValue: 1, bridge: { ...VALID_BRIDGE, multiple: "n/a" } }, bear: { fairValue: 1 } }))!;
    expect(parsed.base?.bridge).toBeDefined();
    expect(parsed.base?.bridge?.multiple).toBeUndefined();
  });

  it("nulls individual assumption levers that aren't numbers, keeping the valid ones", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", base: { fairValue: 1 }, assumptions: { wacc: 6.5, roic: "8", terminalGrowth: null } }))!;
    expect(parsed.assumptions).toEqual({ wacc: 6.5, roic: null, terminalGrowth: null });
  });

  it("nulls an assumption outside [-50, 100] percentage points, keeping the boundaries", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", base: { fairValue: 1 }, assumptions: { wacc: 850, roic: -50, terminalGrowth: 100 } }))!;
    expect(parsed.assumptions).toEqual({ wacc: null, roic: -50, terminalGrowth: 100 });
    const below = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", base: { fairValue: 1 }, assumptions: { wacc: 8, roic: -51, terminalGrowth: 2 } }))!;
    expect(below.assumptions?.roic).toBeNull();
  });

  it("keeps a declared unit only when it is on the list", () => {
    expect(sanitizeUnits("millions")).toBe("millions");
    expect(sanitizeUnits("EUR m")).toBeUndefined();
    expect(sanitizeUnits(1e6)).toBeUndefined();
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", units: "billions", base: { fairValue: 1 } }))!;
    expect(parsed.units).toBe("billions");
  });

  it("drops a scenario with no numeric fairValue rather than passing a wrong-typed one along", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", bull: { fairValue: "12" }, base: { fairValue: 10 }, bear: null }))!;
    expect(parsed.bull).toBeUndefined();
    expect(parsed.bear).toBeUndefined();
    expect(parsed.base?.fairValue).toBe(10);
  });

  it("keeps the killPrice key only when the block had it — its presence drives the kill_price gate", () => {
    const base = { method: "DCF", sector: "", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 }, bear: { fairValue: 1 } };
    expect("killPrice" in parseDeepValueJson(fence(base))!).toBe(false);
    expect(parseDeepValueJson(fence({ ...base, killPrice: 1.5 }))!.killPrice).toBe(1.5);
    // Declared but unusable ⇒ null (judged by the gate), never dropped from it.
    expect(parseDeepValueJson(fence({ ...base, killPrice: "around 1.5" }))!.killPrice).toBeNull();
  });

  it("keeps a non-empty killPriceNote (trimmed) and drops an empty or non-string one", () => {
    const base = { method: "DCF", sector: "", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 }, bear: { fairValue: 1 }, killPrice: null };
    expect(parseDeepValueJson(fence({ ...base, killPriceNote: "  no single trigger  " }))!.killPriceNote).toBe("no single trigger");
    expect(parseDeepValueJson(fence({ ...base, killPriceNote: "   " }))!.killPriceNote).toBeUndefined();
    expect(parseDeepValueJson(fence({ ...base, killPriceNote: 42 }))!.killPriceNote).toBeUndefined();
  });

  it("keeps only well-formed revisions entries", () => {
    const parsed = parseDeepValueJson(
      fence({
        method: "DCF",
        sector: "",
        currency: "EUR",
        base: { fairValue: 2 },
        revisions: [{ scenario: "base", from: 2.5, to: 2, reason: "FY25 capex restated" }, { scenario: "middle", from: 1, to: 2, reason: "x" }, { scenario: "bull", from: "3", to: 2 }, null],
      })
    )!;
    expect(parsed.revisions).toEqual([{ scenario: "base", from: 2.5, to: 2, reason: "FY25 capex restated" }]);
  });

  it("returns null — never throws — when the block is valid JSON but not an object", () => {
    expect(parseDeepValueJson("```json\nnull\n```")).toBeNull();
    expect(parseDeepValueJson("```json\n[1, 2]\n```")).toBeNull();
    expect(parseDeepValueJson('```json\n"text"\n```')).toBeNull();
    expect(parseBlindJson("```json-blind\n42\n```")).toBeNull();
  });

  it("sanitizes the blind block the same way", () => {
    const parsed = parseBlindJson("```json-blind\n" + JSON.stringify({ method: "DCF", sector: "", currency: "EUR", base: { fairValue: 2, bridge: 7 }, killPrice: 1 }) + "\n```")!;
    expect(parsed.base).toEqual({ fairValue: 2 });
    expect(parsed.killPrice).toBe(1);
  });
});

describe("hasFullTriple — the only door to consumers that need bull/base/bear", () => {
  const fence = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```";

  it("is false when a scenario was dropped by the sanitizer (missing bear)", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 } }));
    expect(parsed).not.toBeNull();
    expect(hasFullTriple(parsed)).toBe(false);
  });

  it("is false on null", () => {
    expect(hasFullTriple(null)).toBe(false);
  });

  it("is true with all three scenarios, and narrows the type", () => {
    const parsed = parseDeepValueJson(fence({ method: "DCF", sector: "", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 }, bear: { fairValue: 1 } }));
    expect(hasFullTriple(parsed)).toBe(true);
    if (hasFullTriple(parsed)) expect(parsed.bear.fairValue).toBe(1);
  });
});

describe("sensitivity and dividends — drop, never repair", () => {
  const LEVER_A = { name: "EV/EBITDA exit multiple", values: [7, 8, 9] };
  const LEVER_B = { name: "EBITDA 2026e", values: [190, 200, 210] };
  const GRID = [[10.2, 10.9, 11.6], [12.1, 12.9, 13.7], [14, 14.9, 15.8]];
  const PATH = [
    { year: 2026, bull: 0.44, base: 0.42, bear: 0.4 },
    { year: 2027, bull: 0.48, base: 0.44, bear: 0.38 },
    { year: 2028, bull: 0.52, base: 0.46, bear: 0.36 },
  ];

  it("keeps a well-formed 3×3 grid", () => {
    expect(sanitizeSensitivity({ leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: GRID })).toEqual({ leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: GRID });
  });

  it("drops a 2×3 grid, a row of two, a non-finite cell or an unnamed lever", () => {
    expect(sanitizeSensitivity({ leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: GRID.slice(0, 2) })).toBeUndefined();
    expect(sanitizeSensitivity({ leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: [GRID[0], [12.1, 12.9], GRID[2]] })).toBeUndefined();
    expect(sanitizeSensitivity({ leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: [GRID[0], [12.1, "12.9", 13.7], GRID[2]] })).toBeUndefined();
    expect(sanitizeSensitivity({ leverA: { ...LEVER_A, name: " " }, leverB: LEVER_B, intrinsicPerShare: GRID })).toBeUndefined();
    expect(sanitizeSensitivity({ leverA: { ...LEVER_A, values: [7, 8] }, leverB: LEVER_B, intrinsicPerShare: GRID })).toBeUndefined();
  });

  it("carries a well-formed grid through parseDeepValueJson and drops a malformed one", () => {
    const fence = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```";
    const base = { method: "EV/EBITDA", sector: "", currency: "EUR", base: { fairValue: 1 } };
    expect(parseDeepValueJson(fence({ ...base, sensitivity: { leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: GRID } }))!.sensitivity).toEqual({
      leverA: LEVER_A,
      leverB: LEVER_B,
      intrinsicPerShare: GRID,
    });
    expect("sensitivity" in parseDeepValueJson(fence({ ...base, sensitivity: { leverA: LEVER_A, leverB: LEVER_B, intrinsicPerShare: GRID.slice(0, 2) } }))!).toBe(false);
  });

  it("keeps a declared non-payer (null) apart from a missing outlook", () => {
    expect(sanitizeDividends(null)).toBeNull();
    expect(sanitizeDividends(undefined)).toBeUndefined();
    const fence = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```";
    const base = { method: "DDM", sector: "", currency: "EUR", base: { fairValue: 1 } };
    expect(parseDeepValueJson(fence({ ...base, dividends: null }))!.dividends).toBeNull();
    expect("dividends" in parseDeepValueJson(fence(base))!).toBe(false);
  });

  it("keeps a three-year path and drops a path of two, a negative DPS or a fractional year", () => {
    const valid = { policy: "Pays out about 60% of net income.", lastDps: 0.4, path: PATH };
    expect(sanitizeDividends(valid)).toEqual(valid);
    expect(sanitizeDividends({ ...valid, path: PATH.slice(0, 2) })).toBeUndefined();
    expect(sanitizeDividends({ ...valid, lastDps: -0.1 })).toBeUndefined();
    expect(sanitizeDividends({ ...valid, path: [{ ...PATH[0], bear: -1 }, PATH[1], PATH[2]] })).toBeUndefined();
    expect(sanitizeDividends({ ...valid, path: [{ ...PATH[0], year: 2026.5 }, PATH[1], PATH[2]] })).toBeUndefined();
    expect(sanitizeDividends({ ...valid, policy: 3 })).toBeUndefined();
  });
});
