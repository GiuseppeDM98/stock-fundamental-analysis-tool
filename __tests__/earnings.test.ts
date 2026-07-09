import { describe, it, expect } from "vitest";

import {
  isAnalysisStalePreEarnings,
  isFutureEarnings,
  formatEarningsDate,
  EARNINGS_QUARTER_DAYS,
} from "@/lib/earnings";

const DAY_MS = 24 * 60 * 60 * 1000;

// Offsets relative to *now*, so the past/future branches are exercised deterministically.
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

describe("isFutureEarnings", () => {
  it("is true for a date in the future", () => {
    expect(isFutureEarnings(daysFromNow(20))).toBe(true);
  });

  it("is false for a date in the past", () => {
    expect(isFutureEarnings(daysFromNow(-20))).toBe(false);
  });

  it("is false for null or an unparseable date", () => {
    expect(isFutureEarnings(null)).toBe(false);
    expect(isFutureEarnings("garbage")).toBe(false);
  });
});

describe("isAnalysisStalePreEarnings", () => {
  it("future date: flags an analysis older than the previous (estimated) earnings", () => {
    // Next earnings 20 days out → previous ≈ 70 days ago; analysis saved 100 days ago.
    const createdAt = daysFromNow(-100);
    expect(isAnalysisStalePreEarnings(createdAt, daysFromNow(20))).toBe(true);
  });

  it("future date: does not flag an analysis newer than the previous earnings", () => {
    // Next earnings 20 days out → previous ≈ 70 days ago; analysis saved 30 days ago.
    const createdAt = daysFromNow(-30);
    expect(isAnalysisStalePreEarnings(createdAt, daysFromNow(20))).toBe(false);
  });

  it("past date: flags an analysis saved before that already-reported earnings", () => {
    // Earnings reported 10 days ago; analysis saved 40 days ago → stale.
    expect(isAnalysisStalePreEarnings(daysFromNow(-40), daysFromNow(-10))).toBe(true);
  });

  it("past date: does not flag an analysis saved after that earnings", () => {
    // Earnings reported 40 days ago; analysis saved 10 days ago → still fresh.
    expect(isAnalysisStalePreEarnings(daysFromNow(-10), daysFromNow(-40))).toBe(false);
  });

  it("returns false when there is no earnings date", () => {
    expect(isAnalysisStalePreEarnings(daysFromNow(-200), null)).toBe(false);
  });

  it("returns false on an unparseable date rather than throwing", () => {
    expect(isAnalysisStalePreEarnings("not-a-date", daysFromNow(20))).toBe(false);
  });
});

describe("formatEarningsDate", () => {
  it("formats a valid ISO date compactly for the given locale", () => {
    // en-US → "Aug 1, 2026"
    const out = formatEarningsDate("2026-08-01T12:00:00.000Z", "en-US");
    expect(out).toContain("2026");
    expect(out).toContain("Aug");
  });

  it("returns an empty string for an unparseable input", () => {
    expect(formatEarningsDate("garbage", "en-US")).toBe("");
  });
});
