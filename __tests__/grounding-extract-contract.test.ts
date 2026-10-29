import { describe, it, expect } from "vitest";
import { z } from "zod";

import { GROUNDING_BLOCK_KINDS } from "@/types/grounding";
import { buildGroundingExtractSystemPrompt } from "@/lib/ai/grounding-extract-prompt";
import { EXTRACTION_SCHEMA_BY_KIND, extractionOutputFormat } from "@/lib/ai/grounding-extract-schema";

// The extraction prompt's JSON example and the route's Zod schema are one contract: a key
// the schema expects but the example omits is a field the model is never shown (it then
// silently defaults to null or fails validation), and a key the example shows but the
// schema lacks is stripped on parse. Both directions are checked, at every nesting level.

function exampleFor(kind: (typeof GROUNDING_BLOCK_KINDS)[number]): unknown {
  const match = buildGroundingExtractSystemPrompt({ kind }).match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error(`no JSON example in the ${kind} prompt`);
  return JSON.parse(match[1]);
}

/** Strips the wrappers that don't change an object's key set. zod 4 types the inner schema
 *  of a wrapper as the core `$ZodType`, so it is re-cast to the classic `ZodType`. */
function unwrap(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return unwrap(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodDefault) return unwrap(schema.def.innerType as z.ZodType);
  return schema;
}

/** Every key-set mismatch between `schema` and `value`, as readable paths. */
function keyMismatches(schema: z.ZodType, value: unknown, path: string): string[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodArray) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => keyMismatches(inner.element as z.ZodType, item, `${path}[${i}]`));
  }
  if (inner instanceof z.ZodObject) {
    if (value == null || typeof value !== "object") return [];
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

describe("grounding extraction prompt ↔ schema contract", () => {
  it.each(GROUNDING_BLOCK_KINDS)("the %s example parses with its schema", (kind) => {
    expect(EXTRACTION_SCHEMA_BY_KIND[kind].safeParse(exampleFor(kind)).success).toBe(true);
  });

  it.each(GROUNDING_BLOCK_KINDS)("the %s example states exactly the schema's keys", (kind) => {
    // A schema built with another zod major fails every instanceof below and would compare
    // nothing: pin the walk's entry point so that drift reads as red, not as "no mismatch".
    expect(unwrap(EXTRACTION_SCHEMA_BY_KIND[kind])).toBeInstanceOf(z.ZodObject);
    expect(keyMismatches(EXTRACTION_SCHEMA_BY_KIND[kind], exampleFor(kind), kind)).toEqual([]);
  });

  it("states the other block's multiples basis-reconciliation columns explicitly", () => {
    const example = exampleFor("other") as { multiples: Record<string, unknown>[] };
    expect(example.multiples[0]).toHaveProperty("marketCap");
    expect(example.multiples[0]).toHaveProperty("enterpriseValue");
  });
});

/** Paths of the properties a JSON Schema leaves out of `required`, at every nesting level. */
function optionalProperties(node: unknown, path: string): string[] {
  if (node == null || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const own =
    n.properties && typeof n.properties === "object"
      ? Object.keys(n.properties).filter((k) => !((n.required as string[] | undefined) ?? []).includes(k))
      : [];
  return [
    ...own.map((k) => `${path}.${k}`),
    ...Object.entries(n).flatMap(([k, v]) => optionalProperties(v, `${path}/${k}`)),
  ];
}

describe("grounding extraction structured-output format", () => {
  // The API caps a request at 24 properties outside `required` across its schemas and
  // answers 400 past it (structured-outputs docs, checked 2026-10-29). Every block is its
  // own request, so one kind past the cap would fail all its blocks before any generation.
  it.each(GROUNDING_BLOCK_KINDS)("the %s format stays within the optional-property cap", (kind) => {
    const { schema } = extractionOutputFormat(kind) as unknown as { schema: unknown };
    expect(optionalProperties(schema, kind).length).toBeLessThanOrEqual(24);
  });

  it("leaves out of required only the arrays the other prompt says to omit", () => {
    const { schema } = extractionOutputFormat("other") as unknown as { schema: unknown };
    expect(optionalProperties(schema, "other")).toEqual(["other.financials", "other.multiples", "other.estimates"]);
  });
});

describe("grounding extraction prompt — unit rules", () => {
  it("allows rescaling only for share counts, never for monetary values", () => {
    const prompt = buildGroundingExtractSystemPrompt({ kind: "income_statement" });
    expect(prompt).toContain("The ONLY permitted conversion is the share-count rescaling");
    expect(prompt).not.toContain("no unit conversion");
  });
});
