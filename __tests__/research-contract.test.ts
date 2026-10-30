import { describe, it, expect } from "vitest";
import { z } from "zod";

import { buildResearchSystemPrompt, buildResearchUserPrompt } from "@/lib/ai/research-prompt";
import { hasNoFinancialRows, preprocessResearchOutput, researchOutputSchema } from "@/lib/ai/research-schema";
import { lastJsonFence } from "@/lib/report/parse-deep-value-json";

// The research prompt's JSON example and researchOutputSchema are one contract: a key the
// schema expects but the example omits is a field the model is never shown, and a key the
// example shows but the schema lacks is stripped on parse. Both directions, every level.

const SYSTEM = buildResearchSystemPrompt({ currentDate: "October 30, 2026" });

function example(): unknown {
  const fence = lastJsonFence(SYSTEM);
  if (fence == null) throw new Error("no JSON example in the research prompt");
  return JSON.parse(fence);
}

/** Strips the wrappers that don't change an object's key set. */
function unwrap(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return unwrap(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodDefault) return unwrap(schema.def.innerType as z.ZodType);
  return schema;
}

function keyMismatches(schema: z.ZodType, value: unknown, path: string): string[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodArray) {
    if (!Array.isArray(value)) return [`${path} is not an array in the example`];
    if (value.length === 0) return [`${path} has no row in the example`];
    return value.flatMap((item, i) => keyMismatches(inner.element as z.ZodType, item, `${path}[${i}]`));
  }
  if (inner instanceof z.ZodObject) {
    if (value == null || typeof value !== "object") return [`${path} is not an object in the example`];
    const schemaKeys = Object.keys(inner.shape);
    const valueKeys = Object.keys(value as Record<string, unknown>);
    const issues = [
      ...schemaKeys.filter((k) => !valueKeys.includes(k)).map((k) => `${path}.${k} missing from example`),
      ...valueKeys.filter((k) => !schemaKeys.includes(k)).map((k) => `${path}.${k} not in schema`),
    ];
    for (const k of schemaKeys.filter((key) => valueKeys.includes(key))) {
      issues.push(...keyMismatches(inner.shape[k], (value as Record<string, unknown>)[k], `${path}.${k}`));
    }
    return issues;
  }
  return [];
}

describe("research prompt ↔ schema contract", () => {
  it("the example parses with the schema", () => {
    expect(researchOutputSchema.safeParse(example()).success).toBe(true);
  });

  it("the example states exactly the schema's keys, one row per array", () => {
    // A schema built with another zod major fails every instanceof and would compare nothing.
    expect(unwrap(researchOutputSchema)).toBeInstanceOf(z.ZodObject);
    expect(keyMismatches(researchOutputSchema, example(), "output")).toEqual([]);
    const value = example() as Record<string, unknown[]>;
    for (const key of ["sources", "financials", "multiples", "estimates", "peers"]) expect(value[key]).toHaveLength(1);
  });

  it("states the rules the route and the gates rely on", () => {
    expect(SYSTEM).toContain("at most 3 PDF");
    expect(SYSTEM).toContain("ENDS");
    expect(SYSTEM).toContain("at most 30 entries");
    expect(SYSTEM).toContain("Never use analyst target prices");
    // The model never does arithmetic: EBITDA = EBIT + D&A is computed on the server.
    expect(SYSTEM).toContain("Never compute a figure from other figures");
    expect(SYSTEM).toContain("the server computes EBIT + D&A");
    expect(SYSTEM).toContain("October 30, 2026");
    // The JSON block is the last thing in the answer: nothing after the example's fence
    // tells the model to write more JSON.
    expect(SYSTEM).toContain("Nothing after the fence.");
  });
});

describe("buildResearchUserPrompt", () => {
  it("names the trading currency as such, and never a price", () => {
    const prompt = buildResearchUserPrompt({ ticker: "ORNT", companyName: "Ornitorinco Inc.", exchange: "NasdaqGS", quoteCurrency: "USD" });
    expect(prompt).toBe(
      "Research Ornitorinco Inc. (ORNT, listed on NasdaqGS; the share trades in USD). The reporting currency may differ from the trading currency — read it from the filings and declare it in meta.reportingCurrency. Fetch the primary documents; return the JSON."
    );
  });

  it("omits the listing clause when the exchange is unknown", () => {
    const prompt = buildResearchUserPrompt({ ticker: "ORNT", companyName: "Ornitorinco Inc.", exchange: "UNKNOWN", quoteCurrency: "USD" });
    expect(prompt).toContain("(ORNT; the share trades in USD)");
  });
});

describe("preprocessResearchOutput", () => {
  const source = (overrides: Record<string, unknown>) => ({ id: "s1", url: "https://a.example/x", title: "A", asOf: "2026-03", kind: "press_release", ...overrides });

  it("drops a source with a relative url, a non-http url or a bad id, and keeps the first of a repeated id", () => {
    const out = preprocessResearchOutput({
      sources: [
        source({ id: "ok" }),
        source({ id: "rel", url: "/ir/report.pdf" }),
        source({ id: "ftp", url: "ftp://a.example/x" }),
        source({ id: "much-too-long-id" }),
        source({ id: "ok", url: "https://b.example/y" }),
      ],
    }) as { sources: { id: string; url: string }[] };
    expect(out.sources.map((s) => `${s.id} ${s.url}`)).toEqual(["ok https://a.example/x"]);
  });

  it("keeps the first 30 sources, nulls a free-text asOf and maps an unknown kind to other", () => {
    const sources = Array.from({ length: 35 }, (_, i) => source({ id: `s${i}`, asOf: i === 0 ? "March 2026" : "2026", kind: i === 0 ? "blog" : "filing" }));
    const out = preprocessResearchOutput({ sources }) as { sources: { id: string; asOf: string | null; kind: string }[] };
    expect(out.sources).toHaveLength(30);
    expect(out.sources[0]).toMatchObject({ id: "s0", asOf: null, kind: "other" });
    expect(out.sources[29].id).toBe("s29");
  });

  it("drops financials rows with no figure, so an answer with none reads as no financial data", () => {
    const out = preprocessResearchOutput({ financials: [{ fiscalYear: 2025, revenue: null, sourceIds: {} }] });
    expect(hasNoFinancialRows(out)).toBe(true);
    expect(hasNoFinancialRows(preprocessResearchOutput({ financials: [{ fiscalYear: 2025, revenue: 1000 }] }))).toBe(false);
    // A missing array is a malformed answer, not an empty one.
    expect(hasNoFinancialRows(preprocessResearchOutput({}))).toBe(false);
  });

  it("reads a missing nullable field as null and clips the free text", () => {
    const parsed = researchOutputSchema.parse({
      meta: { reportingCurrency: "EUR", units: "millions", notes: "n".repeat(600) },
      sources: [source({ title: "t".repeat(250) })],
      financials: [{ fiscalYear: 2025, revenue: 1000, sourceIds: { income: "s1" } }],
      multiples: [],
      estimates: [],
      peers: [],
    });
    expect(parsed.financials[0].ebitda).toBeNull();
    expect(parsed.financials[0].sourceIds.balance).toBeNull();
    expect(parsed.meta.latestPeriodLabel).toBeNull();
    expect(parsed.meta.notes).toHaveLength(500);
    expect(parsed.sources[0].title).toHaveLength(200);
  });
});
