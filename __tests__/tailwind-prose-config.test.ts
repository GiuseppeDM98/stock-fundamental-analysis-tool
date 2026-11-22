import { describe, it, expect } from "vitest";
import config from "../tailwind.config";

// The typography plugin wraps inline code in literal backticks; every `prose` block in the app
// (report, lens critiques, Advisor) shows gate names as inline code, so the base variant drops them.
describe("tailwind typography config", () => {
  const typography = (config.theme?.extend as { typography: Record<string, { css: Record<string, unknown> }> })
    .typography;

  it("removes the plugin's backticks around inline code in the base prose variant", () => {
    expect(typography.DEFAULT.css["code::before"]).toEqual({ content: "none" });
    expect(typography.DEFAULT.css["code::after"]).toEqual({ content: "none" });
  });

  it("keeps the Tailwind 3 gray palette in the base prose variant", () => {
    expect(typography.DEFAULT.css["--tw-prose-code"]).toBe("#111827");
  });
});
