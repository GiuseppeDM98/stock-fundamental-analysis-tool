import { describe, it, expect } from "vitest";
import { sameCurrency } from "@/lib/grounding/currency";
import { checkCurrencyMismatch } from "@/lib/grounding/reconcile";
import { makeMeta } from "./grounding-test-helpers";

describe("sameCurrency", () => {
  it("is true for the same code, ignoring surrounding whitespace", () => {
    expect(sameCurrency("EUR", "EUR")).toBe(true);
    expect(sameCurrency(" EUR ", "EUR")).toBe(true);
  });

  it("is case-sensitive: a pence quote (GBp) is not a pound value (GBP)", () => {
    expect(sameCurrency("GBp", "GBP")).toBe(false);
    expect(sameCurrency("eur", "EUR")).toBe(false);
  });

  it("is false whenever either side is unknown — an unknown currency is never assumed to match", () => {
    expect(sameCurrency(null, "EUR")).toBe(false);
    expect(sameCurrency("EUR", undefined)).toBe(false);
    expect(sameCurrency("", "")).toBe(false);
    expect(sameCurrency("  ", "  ")).toBe(false);
  });
});

describe("checkCurrencyMismatch goes through sameCurrency", () => {
  it("warns on GBP statements against a GBp quote", () => {
    expect(checkCurrencyMismatch({ meta: makeMeta({ reportingCurrency: "GBP" }) }, "GBp")?.code).toBe("currency_mismatch");
  });

  it("stays silent when the codes match", () => {
    expect(checkCurrencyMismatch({ meta: makeMeta({ reportingCurrency: "EUR" }) }, "EUR")).toBeNull();
  });
});
