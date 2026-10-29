import { describe, it, expect } from "vitest";
import { toWatchlistMosFraction } from "@/lib/watchlist-mos";

describe("toWatchlistMosFraction", () => {
  it("should convert a percent into the fraction the watchlist stores", () => {
    expect(toWatchlistMosFraction(25)).toBe(0.25);
    expect(toWatchlistMosFraction(0)).toBe(0);
    expect(toWatchlistMosFraction(80)).toBe(0.8);
  });

  it("should clamp above the watchlist schema's 0.8 ceiling", () => {
    expect(toWatchlistMosFraction(95)).toBe(0.8);
  });
});
