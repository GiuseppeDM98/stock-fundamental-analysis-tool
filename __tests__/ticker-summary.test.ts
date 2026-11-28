import { describe, it, expect } from "vitest";
import { buildTickerSummary, formatTickerSummaryForPrompt, type TickerSummaryInput } from "@/lib/stocks/ticker-summary";
import { verdictBasis } from "@/lib/report/latest-analysis";
import type { SavedAnalysis } from "@/types/analysis";

function makeAnalysis(overrides: Partial<SavedAnalysis>): SavedAnalysis {
  return {
    id: "id",
    ticker: "TEST",
    companyName: "Test Co",
    reportMd: "",
    mosPercent: 20,
    currency: "USD",
    valuationMethod: "DCF",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

// Round, invented figures. Buy targets 60/80/100 at MoS 20% are fair values 75/100/125; a
// Skeptic at 44/64/84 makes the consensus base 72 (buy target) = 90 (fair value).
const VALUED = { fairValueBear: 60, fairValueBase: 80, fairValueBull: 100 };
const SKEPTIC = { reviewFairValueBear: 44, reviewFairValueBase: 64, reviewFairValueBull: 84 };

const newest = makeAnalysis({ id: "new", ...VALUED, ...SKEPTIC });
const older = makeAnalysis({ id: "old", fairValueBear: 48, fairValueBase: 64, fairValueBull: 80, createdAt: "2026-01-01T00:00:00.000Z" });

function input(overrides: Partial<TickerSummaryInput>): TickerSummaryInput {
  return {
    ticker: "TEST",
    analyses: [newest, older],
    price: 85,
    currency: "USD",
    positions: [],
    positionCurrency: null,
    watchlistItem: null,
    earnings: null,
    dividendsReceivedEur: null,
    ...overrides,
  };
}

describe("buildTickerSummary", () => {
  it("should read the consensus, the verdict on it and one evolution step from two analyses with a lens", () => {
    const s = buildTickerSummary(input({}));

    expect(s.latest?.id).toBe("new");
    expect(s.analysisCount).toBe(2);
    expect(s.intrinsic).toEqual({ bear: 75, base: 100, bull: 125 });
    expect(s.consensus).toEqual({ bear: 65, base: 90, bull: 115 });
    expect(s.analysts.map((a) => a.angle)).toEqual(["skeptic"]);
    expect(s.basis).toEqual({ buyTargetBase: 72, intrinsicBase: 90, source: "consensus" });
    // 85 sits between the consensus buy target (72) and its fair value (90).
    expect(s.verdict).toBe("watch");
    expect(s.distanceToBuyTargetPct).toBeCloseTo(((85 - 72) / 72) * 100, 10);
    // Edge |90 − 85| / 85 against the cone (125 − 75) / 90: about a tenth, inside the noise.
    expect(s.signal).toBe("low");
    expect(s.evolution).toHaveLength(1);
    expect(s.evolution[0].base).toMatchObject({ prev: 80, curr: 100 });
  });

  it("should rate the signal on the analysis's own cone around the verdict's base, like the /analyses ruler", () => {
    // A narrow Skeptic (buy targets 60/64/68) makes the consensus 75/90/105 at fair value.
    // At 84 the edge is |90 − 84| / 84: «low» against the analysis's cone (125 − 75) / 90,
    // «moderate» against the consensus's narrower one, and «moderate» around the analysis's
    // own base of 100.
    const narrow = makeAnalysis({ id: "narrow", ...VALUED, reviewFairValueBear: 60, reviewFairValueBase: 64, reviewFairValueBull: 68 });

    const s = buildTickerSummary(input({ analyses: [narrow], price: 84 }));

    expect(s.consensus).toEqual({ bear: 75, base: 90, bull: 105 });
    expect(s.signal).toBe("low");
  });

  it("should call the valuation stale when a report came out after the analysis it reads, not after the newest save", () => {
    const blank = makeAnalysis({ id: "blank", createdAt: "2026-07-01T00:00:00.000Z" });
    const reported = (date: string) => ({ nextEarningsDate: date, confidence: "confirmed" as const, fetchedAt: "2026-01-01T00:00:00.000Z" });

    // The valued analysis is of March 1: a report of June 1 came after it, though before the blank save of July.
    expect(buildTickerSummary(input({ analyses: [blank, newest, older], earnings: reported("2026-06-01T00:00:00.000Z") })).staleForEarnings).toBe(true);
    expect(buildTickerSummary(input({ earnings: reported("2026-02-01T00:00:00.000Z") })).staleForEarnings).toBe(false);
    expect(buildTickerSummary(input({ earnings: null })).staleForEarnings).toBe(false);
    expect(buildTickerSummary(input({ analyses: [], earnings: reported("2026-06-01T00:00:00.000Z") })).staleForEarnings).toBe(false);
  });

  it("should take the newest analysis WITH fair values when the newest save has none", () => {
    const noValues = makeAnalysis({ id: "blank", createdAt: "2026-04-01T00:00:00.000Z" });

    const s = buildTickerSummary(input({ analyses: [noValues, newest, older] }));

    expect(s.latest?.id).toBe("new");
    expect(s.analysisCount).toBe(3);
    expect(s.evolution).toHaveLength(1);
  });

  it("should drop an unfinished run before any count, even when it is the newest and carries values", () => {
    const noValues = makeAnalysis({ id: "blank", createdAt: "2026-04-01T00:00:00.000Z" });
    const failed = makeAnalysis({ id: "failed", runStatus: "failed", fairValueBear: 90, fairValueBase: 120, fairValueBull: 150, createdAt: "2026-05-01T00:00:00.000Z" });

    const s = buildTickerSummary(input({ analyses: [failed, noValues, newest, older] }));

    expect(s.latest?.id).toBe("new");
    expect(s.analysisCount).toBe(3);
    expect(s.evolution).toHaveLength(1);
  });

  it("should give no verdict, distance or signal without a price", () => {
    const s = buildTickerSummary(input({ price: null, currency: null }));

    expect(s.verdict).toBeNull();
    expect(s.distanceToBuyTargetPct).toBeNull();
    expect(s.signal).toBeNull();
    expect(s.currencyMismatch).toBe(false);
  });

  it("should give no verdict on a quote in another currency than the analysis, and say so", () => {
    const s = buildTickerSummary(input({ currency: "GBp" }));

    expect(s.verdict).toBeNull();
    expect(s.signal).toBeNull();
    expect(s.currencyMismatch).toBe(true);
    expect(formatTickerSummaryForPrompt(s)).toContain("price 85.00 GBp (analysis in USD: no verdict)");
  });

  it("should discount the verdict basis (the consensus when there is one) with the watchlist item's MoS", () => {
    const s = buildTickerSummary(input({ watchlistItem: { mosPercent: 0.25 } }));

    expect(s.watchlistBuyTarget).toBe(verdictBasis(newest)!.intrinsicBase * (1 - 0.25));
    expect(s.watchlistBuyTarget).toBe(67.5);
  });

  it("should report the holding's P&L as a percentage", () => {
    const s = buildTickerSummary(input({ positions: [{ shares: 10, purchasePrice: 50 }], positionCurrency: "USD" }));

    expect(s.holding).toEqual({ totalShares: 10, weightedAvgCost: 50, pnlPct: 70 });
  });

  it("should give no P&L when the lots are in another currency than the quote", () => {
    const s = buildTickerSummary(input({ positions: [{ shares: 10, purchasePrice: 50 }], positionCurrency: "EUR" }));

    expect(s.holding).toEqual({ totalShares: 10, weightedAvgCost: 50, pnlPct: null });
  });
});

describe("formatTickerSummaryForPrompt", () => {
  it("should write one line with every part when everything is known", () => {
    const s = buildTickerSummary(
      input({
        positions: [{ shares: 10, purchasePrice: 50 }],
        positionCurrency: "USD",
        watchlistItem: { mosPercent: 0.25 },
        earnings: { nextEarningsDate: "2099-01-15T00:00:00.000Z", confidence: "confirmed", fetchedAt: "2026-03-02T00:00:00.000Z" },
      })
    );

    const line = formatTickerSummaryForPrompt(s);

    expect(line).not.toContain("\n");
    expect(line).toBe(
      `- TEST [DCF, 2 analyses, saved Mar 1, 2026] intrinsic bear/base/bull 75.00/100.00/125.00 · buy target (−20%) 60.00/80.00/100.00 · consensus base 90.00 (1 lens) · verdict WATCH (consensus) · signal low · price 85.00 USD · next earnings 2099-01-15 (confirmed) · watchlist target 67.50 · held 10 sh @ 50.00 (+70.0%)`
    );
  });

  it("should leave out verdict, signal and P&L without a price, and a past earnings date", () => {
    const s = buildTickerSummary(
      input({
        price: null,
        currency: null,
        positions: [{ shares: 10, purchasePrice: 50 }],
        positionCurrency: "USD",
        earnings: { nextEarningsDate: "2020-01-15T00:00:00.000Z", confidence: "confirmed", fetchedAt: "2020-01-01T00:00:00.000Z" },
      })
    );

    const line = formatTickerSummaryForPrompt(s);

    expect(line).not.toContain("verdict");
    expect(line).not.toContain("signal");
    expect(line).not.toContain("price");
    expect(line).not.toContain("next earnings");
    expect(line).not.toContain("watchlist target");
    expect(line).toMatch(/held 10 sh @ 50\.00$/);
  });

  it("should say «fair value» once, not two scales, when the analysis has no margin of safety", () => {
    const flat = makeAnalysis({ id: "flat", mosPercent: 0, ...VALUED });

    const line = formatTickerSummaryForPrompt(buildTickerSummary(input({ analyses: [flat] })));

    expect(line).toContain("[DCF, 1 analysis, saved Mar 1, 2026] fair value bear/base/bull 60.00/80.00/100.00");
    expect(line).not.toContain("buy target");
    expect(line).not.toContain("intrinsic");
    expect(line).not.toContain("next earnings");
    expect(line).not.toContain("watchlist target");
  });

  it("should leave the earnings out when the estimate carries no date", () => {
    const s = buildTickerSummary(input({ earnings: { nextEarningsDate: null, confidence: "unknown", fetchedAt: "2026-03-02T00:00:00.000Z" } }));

    expect(formatTickerSummaryForPrompt(s)).not.toContain("next earnings");
  });

  it("should date the save in UTC, whatever the time zone of the process", () => {
    // Half past eleven at night in UTC is already March 2 east of Greenwich; half past
    // midnight is still February 28 west of it.
    const late = makeAnalysis({ id: "late", ...VALUED, createdAt: "2026-03-01T23:30:00.000Z" });
    const early = makeAnalysis({ id: "early", ...VALUED, createdAt: "2026-03-01T00:30:00.000Z" });

    expect(formatTickerSummaryForPrompt(buildTickerSummary(input({ analyses: [late] })))).toContain("saved Mar 1, 2026]");
    expect(formatTickerSummaryForPrompt(buildTickerSummary(input({ analyses: [early] })))).toContain("saved Mar 1, 2026]");
  });

  it("should say «no valuation» for a held ticker with no valued analysis", () => {
    const s = buildTickerSummary(input({ analyses: [], positions: [{ shares: 10, purchasePrice: 50 }], positionCurrency: "USD" }));

    expect(s.latest).toBeNull();
    expect(formatTickerSummaryForPrompt(s)).toBe("- TEST [no valuation, 0 analyses] · held 10 sh @ 50.00 (+70.0%)");
  });
});
