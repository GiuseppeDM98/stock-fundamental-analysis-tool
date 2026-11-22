import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";
import type { SavedAnalysis } from "@/types/analysis";

// The /analyses card says when a lens stopped at its critique: the numbers of Phase 3 are
// still to run, from the detail page.
const fetchAnalysesMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/analyses", () => ({
  fetchAnalyses: () => fetchAnalysesMock(),
  deleteAnalysis: vi.fn(),
}));
vi.mock("@/lib/portfolio", () => ({
  fetchPositions: vi.fn(async () => []),
}));
vi.mock("@/lib/earnings-client", () => ({
  fetchEarnings: vi.fn(async () => []),
  refreshEarnings: vi.fn(),
}));
vi.mock("@/components/report/valuation-ruler", () => ({
  ValuationRuler: () => null,
  ComparisonTable: () => null,
}));

import AnalysesList from "@/components/analyses-list";

const en = translations.en;
const RESULT = JSON.stringify({ method: "DCF", sector: "S", currency: "EUR", bull: { fairValue: 14 }, base: { fairValue: 11 }, bear: { fairValue: 8 } });

// Invented, round figures.
const analysis = (overrides: Partial<SavedAnalysis> = {}): SavedAnalysis => ({
  id: "an1",
  ticker: "TRPN",
  companyName: "Tarpone Co",
  reportMd: "",
  mosPercent: 25,
  priceAtAnalysis: 10,
  fairValueBull: 15,
  fairValueBase: 12,
  fairValueBear: 9,
  valuationMethod: "DCF",
  runStatus: "done",
  createdAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const completeLens = (prefix: "review" | "optimist" | "quality") => {
  const critique = prefix === "review" ? "reviewMd" : `${prefix}CritiqueMd`;
  return {
    [critique]: "Critique.",
    [`${prefix}ResultJson`]: RESULT,
    [`${prefix}FairValueBull`]: 14,
    [`${prefix}FairValueBase`]: 11,
    [`${prefix}FairValueBear`]: 8,
  } as Partial<SavedAnalysis>;
};

describe("AnalysesList — a lens stopped at its critique", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a lens with a critique and no numbers puts Phase 3 pending next to Reviewed", async () => {
    fetchAnalysesMock.mockResolvedValue([analysis({ ...completeLens("review"), optimistCritiqueMd: "Critique, numbers to come." })]);
    render(<AnalysesList />);

    const reviewed = await screen.findByText(`✓ ${en.analystReviewBadge}`);
    const pill = screen.getByText(en.lensPhase3Pending);
    expect(pill.parentElement).toBe(reviewed.parentElement);
  });

  it("three complete lenses carry no pill", async () => {
    fetchAnalysesMock.mockResolvedValue([analysis({ ...completeLens("review"), ...completeLens("optimist"), ...completeLens("quality") })]);
    render(<AnalysesList />);

    await screen.findByText(`✓ ${en.analystReviewBadge}`);
    expect(screen.queryByText(en.lensPhase3Pending)).not.toBeInTheDocument();
  });

  it("a lens saved before the result column (a critique and its three numbers) carries no pill", async () => {
    fetchAnalysesMock.mockResolvedValue([analysis({ ...completeLens("quality"), qualityResultJson: null })]);
    render(<AnalysesList />);

    await screen.findByText(`✓ ${en.analystReviewBadge}`);
    expect(screen.queryByText(en.lensPhase3Pending)).not.toBeInTheDocument();
  });
});
