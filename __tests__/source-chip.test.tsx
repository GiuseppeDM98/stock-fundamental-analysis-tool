import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import { SourceChip } from "@/components/report/source-chip";
import { pasteSource } from "@/lib/grounding/merge";
import type { DataSource } from "@/types/dataset";

const web = (overrides: Partial<DataSource> = {}): DataSource => ({
  kind: "web",
  url: "https://www.example.com/ar-2025.pdf",
  title: "Annual report 2025",
  asOf: "2026-03-01",
  blockId: null,
  verified: true,
  ...overrides,
});

const chip = (source: DataSource | null, mixed?: boolean) => render(createElement(SourceChip, { source, mixed })).container;

describe("SourceChip", () => {
  it("names a paste, and adds +1 when a second block filled the statement", () => {
    expect(chip(pasteSource("blk-1")).textContent).toBe("📋 paste");
    expect(chip(pasteSource("blk-1"), true).textContent).toBe("📋 paste+1");
  });

  it("names a web source by its host, with its title and date in the tooltip", () => {
    chip(web());
    const el = screen.getByText(/example\.com/);
    expect(el.textContent).toBe("🌐 example.com");
    expect(el.getAttribute("title")).toBe("Annual report 2025 · 2026-03-01");
  });

  it("marks a web source the research never opened as unverified", () => {
    expect(chip(web({ verified: false })).textContent).toContain("unverified");
  });

  it("shows a dash for no source", () => {
    expect(chip(null).textContent).toBe("—");
  });
});
