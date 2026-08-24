import { describe, it, expect } from "vitest";
import { isDeepSeekPeakHour, formatDeepSeekPeakWindows } from "@/lib/ai/deepseek-pricing";

describe("isDeepSeekPeakHour", () => {
  it("is true inside the first UTC peak window (01:00–04:00)", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-10T02:00:00Z"))).toBe(true);
  });

  it("is true inside the second UTC peak window (06:00–10:00)", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-10T08:30:00Z"))).toBe(true);
  });

  it("is false just before/at/after a window boundary", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-10T00:59:00Z"))).toBe(false);
    expect(isDeepSeekPeakHour(new Date("2026-07-10T04:00:00Z"))).toBe(false); // end exclusive
    expect(isDeepSeekPeakHour(new Date("2026-07-10T10:00:00Z"))).toBe(false); // end exclusive
  });

  it("is false in the gap between the two windows", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-10T05:00:00Z"))).toBe(false);
  });

  it("is false outside both windows entirely", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-10T15:00:00Z"))).toBe(false);
  });

  it("is false on weekends even inside a peak window's hours", () => {
    expect(isDeepSeekPeakHour(new Date("2026-07-11T08:30:00Z"))).toBe(false); // Saturday
    expect(isDeepSeekPeakHour(new Date("2026-07-12T02:00:00Z"))).toBe(false); // Sunday
  });
});

describe("formatDeepSeekPeakWindows", () => {
  it("converts UTC windows to Europe/Rome summer time (CEST, UTC+2)", () => {
    const summer = new Date("2026-07-10T12:00:00Z");
    expect(formatDeepSeekPeakWindows("Europe/Rome", summer)).toEqual(["03:00–06:00", "08:00–12:00"]);
  });

  it("converts UTC windows to Europe/Rome winter time (CET, UTC+1)", () => {
    const winter = new Date("2026-01-10T12:00:00Z");
    expect(formatDeepSeekPeakWindows("Europe/Rome", winter)).toEqual(["02:00–05:00", "07:00–11:00"]);
  });

  it("supports other timezones (UTC itself, no shift)", () => {
    const anyDay = new Date("2026-07-10T12:00:00Z");
    expect(formatDeepSeekPeakWindows("UTC", anyDay)).toEqual(["01:00–04:00", "06:00–10:00"]);
  });
});
