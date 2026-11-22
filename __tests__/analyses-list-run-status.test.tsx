import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";
import type { SavedAnalysis } from "@/types/analysis";

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
// The real chain, spied: which saves the evolution reads is the point.
const evolutionSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/report/evolution", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/report/evolution")>();
  return { ...real, computeEvolutionChain: (...args: Parameters<typeof real.computeEvolutionChain>) => { evolutionSpy(...args); return real.computeEvolutionChain(...args); } };
});
vi.mock("@/components/report/valuation-ruler", () => ({
  ValuationRuler: () => null,
  ComparisonTable: () => null,
}));

import AnalysesList from "@/components/analyses-list";

const en = translations.en;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

// Invented, round figures.
const done = (overrides: Partial<SavedAnalysis> = {}): SavedAnalysis => ({
  id: "an-done",
  ticker: "NSCA",
  companyName: "Nasica Co",
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
const pending = (overrides: Partial<SavedAnalysis>): SavedAnalysis => ({
  id: "an-pending",
  ticker: "NSCA",
  companyName: "Nasica Interrotta SpA",
  reportMd: "",
  mosPercent: 25,
  datasetId: "ds1",
  runStatus: "running",
  runStartedAt: minutesAgo(2),
  createdAt: minutesAgo(2),
  ...overrides,
});

describe("AnalysesList — rows whose run has not finished", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const statusLines = () => screen.queryAllByTestId("analysis-run-status");

  it("a run in progress is a status line above the card, with Delete only; the card reads the finished save", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({}), done()]);
    render(<AnalysesList />);

    const line = await waitFor(() => {
      const [only] = statusLines();
      expect(only).toBeDefined();
      return only;
    });
    expect(within(line).getByText(en.analysisRunning.replace("{m}", "2"), { exact: false })).toBeInTheDocument();
    expect(within(line).queryByText(en.analysisRetry)).not.toBeInTheDocument();
    expect(within(line).getByText(en.deleteBtn)).toBeInTheDocument();
    // The card's header comes from the finished save, not the newest row.
    expect(screen.getByText("Nasica Co")).toBeInTheDocument();
    // One finished analysis in the count, not two.
    expect(screen.getByText(new RegExp(`1 ${en.analysesCountLabel}`))).toBeInTheDocument();
  });

  it("a failed run with its dataset says interrupted, with Retry towards /analyze?resume= and Delete", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ id: "an-cut", runStatus: "failed", runError: "Stopped early." }), done()]);
    render(<AnalysesList />);

    const line = await waitFor(() => {
      const [only] = statusLines();
      expect(only).toBeDefined();
      return only;
    });
    expect(within(line).getByText(en.analysisCut, { exact: false })).toBeInTheDocument();
    expect(within(line).getByText("Stopped early.")).toBeInTheDocument();
    expect(within(line).getByText(en.analysisRetry).closest("a")).toHaveAttribute("href", "/analyze?ticker=NSCA&resume=an-cut");
    expect(within(line).getByText(en.deleteBtn)).toBeInTheDocument();
  });

  it("a run left running past 20 minutes reads interrupted; without its dataset it offers Run again", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ runStartedAt: minutesAgo(21), datasetId: null })]);
    render(<AnalysesList />);

    const line = await waitFor(() => {
      const [only] = statusLines();
      expect(only).toBeDefined();
      return only;
    });
    expect(within(line).getByText(en.analysisCut, { exact: false })).toBeInTheDocument();
    expect(within(line).getByText(en.analysisRelaunch).closest("a")).toHaveAttribute("href", "/analyze?ticker=NSCA");
    expect(within(line).queryByText(en.analysisRetry)).not.toBeInTheDocument();
  });

  it("a failed run without its dataset offers Run again towards a fresh /analyze, not Retry", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ runStatus: "failed", datasetId: null }), done()]);
    render(<AnalysesList />);

    const line = await waitFor(() => {
      const [only] = statusLines();
      expect(only).toBeDefined();
      return only;
    });
    expect(within(line).getByText(en.analysisRelaunch).closest("a")).toHaveAttribute("href", "/analyze?ticker=NSCA");
    expect(within(line).queryByText(en.analysisRetry)).not.toBeInTheDocument();
  });

  it("the evolution reads the finished saves only: a failed run between them is not a step", async () => {
    evolutionSpy.mockClear();
    fetchAnalysesMock.mockResolvedValue([
      done({ id: "an-new", createdAt: "2026-11-10T00:00:00.000Z" }),
      pending({ id: "an-cut", runStatus: "failed", fairValueBull: 30, fairValueBase: 25, fairValueBear: 20, createdAt: "2026-11-05T00:00:00.000Z" }),
      done({ id: "an-old", fairValueBase: 11 }),
    ]);
    render(<AnalysesList />);

    await waitFor(() => expect(evolutionSpy).toHaveBeenCalled());
    for (const [saves] of evolutionSpy.mock.calls) {
      expect((saves as SavedAnalysis[]).map((a) => a.id)).toEqual(["an-new", "an-old"]);
    }
  });

  it("a ticker with only unfinished rows shows the status line alone, no card", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ runStatus: "failed" })]);
    render(<AnalysesList />);

    await waitFor(() => expect(statusLines()).toHaveLength(1));
    expect(screen.queryByText("Nasica Interrotta SpA")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`0 ${en.analysesCountLabel}`))).toBeInTheDocument();
  });

  const onlyLine = () =>
    waitFor(() => {
      const [only] = statusLines();
      expect(only).toBeDefined();
      return only;
    });

  it("a phased run in flight names its phase, counts minutes from the run's start, and offers no Retry", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ runPhase: "update", runStartedAt: minutesAgo(1), createdAt: minutesAgo(3) })]);
    render(<AnalysesList />);

    const line = await onlyLine();
    expect(within(line).getByText(en.runRunningPhase.replace("{phase}", en.runPhaseUpdate), { exact: false })).toBeInTheDocument();
    expect(within(line).getByText(en.analysisRunning.replace("{m}", "3"))).toBeInTheDocument();
    expect(within(line).queryByText(en.runRetryFrom, { exact: false })).not.toBeInTheDocument();
  });

  it("a phased run cut at the valuation says so, and Retry resumes from there within the hour", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ id: "an-cut", runStatus: "failed", runPhase: "valuation", runStartedAt: null, createdAt: minutesAgo(30) })]);
    render(<AnalysesList />);

    const line = await onlyLine();
    expect(within(line).getByText(en.runCutAtPhase.replace("{phase}", en.runPhaseValuation), { exact: false })).toBeInTheDocument();
    const retry = within(line).getByText(en.runRetryFrom.replace("{phase}", en.runPhaseValuation));
    expect(retry.closest("a")).toHaveAttribute("href", "/analyze?ticker=NSCA&resume=an-cut");
  });

  it("past the hour, Retry starts over with a new quote", async () => {
    fetchAnalysesMock.mockResolvedValue([pending({ runStatus: "failed", runPhase: "report1", runStartedAt: null, createdAt: minutesAgo(61) })]);
    render(<AnalysesList />);

    const line = await onlyLine();
    expect(within(line).getByText(en.runRetryRestart)).toBeInTheDocument();
    expect(within(line).queryByText(en.runRetryFrom.replace("{phase}", en.runPhaseReport1))).not.toBeInTheDocument();
  });

  it("a phased row with no request in flight (the tab closed between phases) shows the plan, not 'Interrupted during'", async () => {
    // The plan comes from the phase and the run's start, never from runStartedAt.
    fetchAnalysesMock.mockResolvedValue([pending({ runStatus: "running", runPhase: "report1", runStartedAt: null, createdAt: minutesAgo(10) })]);
    render(<AnalysesList />);

    const line = await onlyLine();
    expect(within(line).getByText(en.runRetryFrom.replace("{phase}", en.runPhaseReport1))).toBeInTheDocument();
    expect(within(line).queryByText(en.runCutAtPhase.replace("{phase}", en.runPhaseReport1), { exact: false })).not.toBeInTheDocument();
  });

  it("finished rows alone render exactly as before: no status line", async () => {
    fetchAnalysesMock.mockResolvedValue([done(), done({ id: "an-older", createdAt: "2026-10-01T00:00:00.000Z" })]);
    render(<AnalysesList />);

    await waitFor(() => expect(screen.getByText("Nasica Co")).toBeInTheDocument());
    expect(statusLines()).toHaveLength(0);
  });
});
