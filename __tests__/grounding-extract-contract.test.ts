import { describe, it, expect } from "vitest";
import { z } from "zod";

import { GROUNDING_BLOCK_KINDS } from "@/types/grounding";
import { buildGroundingExtractSystemPrompt } from "@/lib/ai/grounding-extract-prompt";
import { EXTRACTION_SCHEMA_BY_KIND } from "@/lib/ai/grounding-extract-schema";

// The extraction prompt's JSON example and the route's Zod schema are one contract: a key
// the schema expects but the example omits is a field the model is never shown (it then
// silently defaults to null or fails validation), and a key the example shows but the
// schema lacks is stripped on parse. Both directions are checked, at every nesting level.

function exampleFor(kind: (typeof GROUNDING_BLOCK_KINDS)[number]): unknown {
  const match = buildGroundingExtractSystemPrompt({ kind }).match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error(`no JSON example in the ${kind} prompt`);
  return JSON.parse(match[1]);
}

/** Strips the wrappers that don't change an object's key set. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return unwrap(schema.unwrap());
  if (schema instanceof z.ZodDefault) return unwrap(schema._def.innerType);
  return schema;
}

/** Every key-set mismatch between `schema` and `value`, as readable paths. */
function keyMismatches(schema: z.ZodTypeAny, value: unknown, path: string): string[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodArray) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => keyMismatches(inner.element, item, `${path}[${i}]`));
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
    expect(keyMismatches(EXTRACTION_SCHEMA_BY_KIND[kind], exampleFor(kind), kind)).toEqual([]);
  });

  it("states the other block's multiples basis-reconciliation columns explicitly", () => {
    const example = exampleFor("other") as { multiples: Record<string, unknown>[] };
    expect(example.multiples[0]).toHaveProperty("marketCap");
    expect(example.multiples[0]).toHaveProperty("enterpriseValue");
  });
});

describe("grounding extraction prompt — unit rules", () => {
  it("allows rescaling only for share counts, never for monetary values", () => {
    const prompt = buildGroundingExtractSystemPrompt({ kind: "income_statement" });
    expect(prompt).toContain("The ONLY permitted conversion is the share-count rescaling");
    expect(prompt).not.toContain("no unit conversion");
  });
});
