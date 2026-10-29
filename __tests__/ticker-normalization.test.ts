import { describe, it, expect } from "vitest";
import { normalizeTicker, tickerSchema, TICKER_MAX_LENGTH } from "@/lib/ticker";

describe("normalizeTicker", () => {
  it("should trim and uppercase", () => {
    expect(normalizeTicker(" eni.mi ")).toBe("ENI.MI");
  });
});

describe("tickerSchema", () => {
  it("should normalize a padded lowercase ticker", () => {
    expect(tickerSchema.parse(" eni.mi ")).toBe("ENI.MI");
  });

  it("should accept a 13-character exchange-suffixed ticker", () => {
    expect(tickerSchema.parse("ABCDEFGHIJ.MI")).toBe("ABCDEFGHIJ.MI");
  });

  it("should reject a ticker longer than the maximum", () => {
    expect(TICKER_MAX_LENGTH).toBe(20);
    expect(tickerSchema.safeParse("A".repeat(21)).success).toBe(false);
  });

  it("should reject a whitespace-only ticker (min 1 after trim)", () => {
    expect(tickerSchema.safeParse("   ").success).toBe(false);
  });
});
