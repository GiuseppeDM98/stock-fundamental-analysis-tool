import { describe, it, expect } from "vitest";
import { isNavActive } from "@/components/nav-bar";

describe("isNavActive", () => {
  it("should mark a link on its own path", () => {
    expect(isNavActive("/portfolio", "/portfolio")).toBe(true);
    expect(isNavActive("/analyses", "/analyses")).toBe(true);
  });

  it("should mark «Saved Analyses» on a report and on a stock's page", () => {
    expect(isNavActive("/analyses/abc123", "/analyses")).toBe(true);
    expect(isNavActive("/stocks/ENI.MI", "/analyses")).toBe(true);
  });

  it("should not mark «Saved Analyses» elsewhere, nor another link on those pages", () => {
    expect(isNavActive("/portfolio", "/analyses")).toBe(false);
    expect(isNavActive("/analyze", "/analyses")).toBe(false);
    expect(isNavActive("/stocks/ENI.MI", "/portfolio")).toBe(false);
    expect(isNavActive("/analyses/abc123", "/analyze")).toBe(false);
  });
});
