import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1" } }, status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/ai-settings-client", () => ({
  fetchAiSettings: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/components/ai-settings-control", () => ({
  AiSettingsControl: () => null,
}));
vi.mock("@/components/report/report-body", () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="report">{markdown}</div>,
}));

import DeepValuePanel from "@/components/deep-value-panel";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { makeExtract, makeMeta } from "./grounding-test-helpers";
import { sseOk, sseRejecting, jsonResponse } from "./sse-test-helpers";
import type { AiRunEvent, DeepValuePhase } from "@/types/ai-run";

const en = translations.en;
const DATASET = { id: "ds1", extract: makeExtract({ meta: makeMeta({ reportingCurrency: "USD", units: "millions" }) }) };
const STARTED = "2026-11-20T10:00:00.000Z";

const stage = (phase: DeepValuePhase): AiRunEvent => ({ type: "stage", stage: phase, analysisId: "an1", runStartedAt: STARTED });
const done: AiRunEvent = { type: "done", analysisId: "an1" };
const phaseOk = (phase: DeepValuePhase, text = "") => sseOk(text ? [stage(phase), { type: "text", text }, done] : [stage(phase), done]);
/** A request that never answers: the phase stays in flight for the whole test. */
const pending = () => new Promise(() => {});

/** The row as GET /api/analyses/an1 returns it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd: "",
  updateNotesMd: null,
  mosPercent: 25,
  reportLanguage: "English",
  datasetId: "ds1",
  runStatus: "running",
  runStartedAt: STARTED,
  runPhase: "update",
  runError: null,
  createdAt: STARTED,
  ...overrides,
});

/** The four phases answered in order, then the finished row. */
function mockWholeRun(fetchMock: ReturnType<typeof vi.fn>, finished = row({ runStatus: "done", runPhase: null, runStartedAt: null, reportMd: "# Report" })) {
  fetchMock
    .mockResolvedValueOnce(phaseOk("update", "notes"))
    .mockResolvedValueOnce(phaseOk("valuation"))
    .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
    .mockResolvedValueOnce(phaseOk("report2", "# Part two"))
    .mockResolvedValueOnce(jsonResponse(200, finished));
}

const panel = (props: Record<string, unknown> = {}) => (
  <DeepValuePanel ticker="ORNT" companyName="Orient Co" mosPercent={25} currentPrice={150} currency="USD" dataset={DATASET} {...props} />
);

const phaseItem = (phase: DeepValuePhase) => screen.getByTestId("deep-value-phases").querySelector(`[data-phase="${phase}"]`) as HTMLElement;

describe("DeepValuePanel — a run in four requests written by the server", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists the four phases while running: the one in flight, the others with their usual minutes", async () => {
    fetchMock.mockReturnValueOnce(pending());
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    await screen.findByTestId("deep-value-phases");
    expect(phaseItem("update")).toHaveAttribute("data-state", "running");
    expect(phaseItem("valuation")).toHaveAttribute("data-state", "waiting");
    expect(within(phaseItem("valuation")).getByText(en.runPhaseTypical.replace("{minutes}", "4"))).toBeInTheDocument();
    expect(within(phaseItem("report1")).getByText(en.runPhaseTypical.replace("{minutes}", "2"))).toBeInTheDocument();
    expect(within(phaseItem("valuation")).getByText(en.runPhaseValuation)).toBeInTheDocument();
  });

  it("shows the web notes in their box once the update ends", async () => {
    fetchMock.mockResolvedValueOnce(phaseOk("update", "Q3 results, from example.com")).mockReturnValueOnce(pending());
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    const card = await screen.findByTestId("web-update-card");
    expect(card.textContent).toContain("Q3 results, from example.com");
    expect(card.textContent).toContain(en.webUpdateTitle);
    expect(phaseItem("update")).toHaveAttribute("data-state", "done");
    expect(phaseItem("valuation")).toHaveAttribute("data-state", "running");
  });

  it("chains the four phases and shows the saved row's report and a link to it, and no Save", async () => {
    mockWholeRun(fetchMock);
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    const link = await screen.findByText(en.deepValueOpenSaved);
    expect(link.closest("a")).toHaveAttribute("href", "/analyses/an1");
    // The report shown is the row's, not the stream's.
    expect(screen.getAllByTestId("report").some((n) => n.textContent === "# Report")).toBe(true);
    expect(screen.queryByText(/^Save/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/analyses/an1");
  });

  it("sends the user's default effort once it arrives, with no floor lifting it", async () => {
    vi.mocked(fetchAiSettings).mockResolvedValueOnce({ model: "claude-opus-4-8", effort: "medium", thinking: true });
    fetchMock.mockReturnValueOnce(pending());
    render(panel());
    await waitFor(() => expect(fetchAiSettings).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ model: "claude-opus-4-8", effort: "medium", datasetId: "ds1" });
  });

  it("a request cut in flight: Retry waits for 330 s from its start, says where it resumes, then sends only the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T10:01:00.000Z"));
    fetchMock.mockResolvedValueOnce(sseOk([stage("update"), { type: "text", text: "partial notes" }])).mockResolvedValueOnce(jsonResponse(200, row()));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/analyses/an1");
    const waiting = screen.getByText(en.deepValueRetryIn.replace("{s}", "270"));
    expect(waiting.closest("button")).toBeDisabled();
    expect(phaseItem("update")).toHaveAttribute("data-state", "failed");

    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(271_000);
    });
    const retry = (await screen.findByText(en.runRetryFrom.replace("{phase}", en.runPhaseUpdate))).closest("button")!;
    expect(retry).toBeEnabled();

    mockWholeRun(fetchMock);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/ai/deep-value");
    expect(JSON.parse(init.body)).toEqual({ analysisId: "an1" });
    expect(await screen.findByText(en.deepValueOpenSaved)).toBeInTheDocument();
  });

  it("a read that rejects on a row that failed: retryable at once, its error shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T10:01:00.000Z"));
    fetchMock
      .mockResolvedValueOnce(sseRejecting([stage("update")]))
      .mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "failed", runStartedAt: null, runError: "Retry." })));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(screen.getByText("Retry.")).toBeInTheDocument();
    expect(screen.getByText(en.runRetryFrom.replace("{phase}", en.runPhaseUpdate)).closest("button")).toBeEnabled();
  });

  it("with ?resume= on a row cut at the valuation: its notes, the cut text, Retry from the valuation, nothing started", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T10:30:00.000Z"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, row({ runStatus: "failed", runPhase: "valuation", runStartedAt: null, updateNotesMd: "saved notes", runError: "Stopped." }))
    );
    render(panel({ resumeId: "an1" }));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(screen.getByTestId("web-update-card").textContent).toContain("saved notes");
    expect(screen.getByText(en.runRetryFrom.replace("{phase}", en.runPhaseValuation)).closest("button")).toBeEnabled();
    expect(phaseItem("update")).toHaveAttribute("data-state", "done");
    expect(phaseItem("valuation")).toHaveAttribute("data-state", "failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/ai/deep-value")).toBe(false);
  });

  it("with ?resume= on a row started over an hour ago: Retry starts over, with a new quote", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T11:01:00.000Z"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "failed", runPhase: "valuation", runStartedAt: null })));
    render(panel({ resumeId: "an1" }));

    expect(await screen.findByText(en.runRetryRestart)).toBeInTheDocument();
    expect(screen.queryByText(en.runRetryFrom.replace("{phase}", en.runPhaseValuation))).not.toBeInTheDocument();
  });
});
