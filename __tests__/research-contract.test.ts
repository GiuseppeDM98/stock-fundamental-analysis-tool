import { describe, it, expect } from "vitest";
import { z } from "zod";

import { buildResearchPartUserPrompt, buildResearchSystemPrompt, buildResearchUserPrompt } from "@/lib/ai/research-prompt";
import { hasNoFinancialRows, preprocessResearchOutput, RESEARCH_PART_SCHEMAS, researchOutputSchema } from "@/lib/ai/research-schema";
import { lastJsonFence } from "@/lib/report/parse-deep-value-json";
import { RESEARCH_PARTS, type ResearchPart } from "@/types/dataset";

// Each part's JSON example and its part's schema are one contract: a key the schema expects
// but the example omits is a field the model is never shown, and a key the example shows but
// the schema lacks is stripped on parse. Both directions, every level.

const system = (part: ResearchPart) => buildResearchSystemPrompt({ currentDate: "October 30, 2026", part });
const SYSTEM = system("statements");

function example(part: ResearchPart = "statements"): unknown {
  const fence = lastJsonFence(system(part));
  if (fence == null) throw new Error(`no JSON example in the ${part} prompt`);
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

const PART_KEYS: Record<ResearchPart, string[]> = {
  statements: ["meta", "sources", "financials"],
  market: ["notes", "sources", "multiples", "peers"],
  estimates: ["notes", "sources", "estimates"],
};

/** The task line, the second line of each prompt. */
const taskOf = (part: ResearchPart) => system(part).split("\n")[0];

describe("research prompt ↔ schema contract, per part", () => {
  for (const part of RESEARCH_PARTS) {
    it(`the ${part} example parses with its part's schema and states exactly its keys`, () => {
      const schema = RESEARCH_PART_SCHEMAS[part];
      expect(schema.safeParse(example(part)).success).toBe(true);
      // A schema built with another zod major fails every instanceof and would compare nothing.
      expect(unwrap(schema)).toBeInstanceOf(z.ZodObject);
      expect(keyMismatches(schema, example(part), part)).toEqual([]);
      expect(Object.keys(example(part) as object)).toEqual(PART_KEYS[part]);
    });

    it(`the ${part} prompt keeps the shared rules`, () => {
      const prompt = system(part);
      expect(prompt).toContain("Never use analyst target prices, ratings or target multiples.");
      expect(prompt).toContain("Never use a figure you have not seen");
      expect(prompt).toContain("Never compute a figure from other figures");
      expect(prompt).toContain("ENDS");
      expect(prompt).toContain("at most 30 entries");
      expect(prompt).toContain("October 30, 2026");
      expect(prompt).toContain("Read a document with web_fetch before you take figures from it: a search snippet is not the\ndocument.");
      // The JSON block is the last thing in the answer.
      expect(prompt).toContain("Nothing after the fence.");
    });
  }

  it("lets the statements fetch at most 2 PDFs, with its own budget, and no longer asks it for multiples", () => {
    expect(SYSTEM).toContain("Fetch at most 2 PDF documents in this step");
    expect(SYSTEM).toContain("You have 10 searches and 5 fetches in this step");
    expect(SYSTEM).not.toContain("at most 3 PDF");
    expect(taskOf("statements")).not.toContain("valuation multiples");
    // The model never does arithmetic: EBITDA = EBIT + D&A is computed on the server.
    expect(SYSTEM).toContain("the server computes EBIT + D&A");
    expect(SYSTEM).not.toContain("forward estimates");
  });

  it("forbids a PDF in the market and estimates parts and states their budgets, without the statements' points", () => {
    expect(system("market")).toContain("You have 9 searches and 2 fetches in this step");
    expect(system("estimates")).toContain("You have 6 searches and 1 fetches in this step");
    for (const part of ["market", "estimates"] as const) {
      const prompt = system(part);
      expect(prompt).toContain("Do not fetch a PDF in this step.");
      expect(prompt).not.toContain("as PDF only when");
      expect(prompt).not.toContain("- income statement:");
      expect(prompt).not.toContain("- balance sheet:");
      expect(prompt).not.toContain("- cash flow:");
      expect(prompt).toContain("- notes is at most 500 characters: what you could not find.");
    }
    expect(system("estimates")).toContain("you collect the published ones");
    expect(system("estimates")).toContain("never a target price");
  });
});

describe("buildResearchPartUserPrompt", () => {
  const listing = { ticker: "ORNT", companyName: "Ornitorinco Inc.", exchange: "NasdaqGS", quoteCurrency: "USD" };

  it("names what the statements declared, and never a price", () => {
    const prompt = buildResearchPartUserPrompt({
      ...listing,
      meta: { reportingCurrency: "EUR", units: "millions", fiscalYearEnd: "December", latestPeriodLabel: "FY2025" },
      fiscalYears: [2023, 2024, 2025],
    });
    expect(prompt).toBe(
      "Research Ornitorinco Inc. (ORNT, listed on NasdaqGS; the share trades in USD). The statements already collected report in EUR, in millions, fiscal year end December, latest period FY2025, fiscal years 2023, 2024, 2025. Return the JSON."
    );
  });

  it("says what the statements did not state", () => {
    const prompt = buildResearchPartUserPrompt({ ...listing, meta: { reportingCurrency: "EUR", units: null, fiscalYearEnd: null, latestPeriodLabel: null }, fiscalYears: [2025] });
    expect(prompt).toContain("in units not stated, fiscal year end not stated, latest period not stated");
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
