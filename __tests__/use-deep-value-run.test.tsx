import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { useDeepValueRun, type NewDeepValueBody } from "@/components/use-deep-value-run";
import { sseOk, sseRejecting, jsonResponse } from "./sse-test-helpers";
import type { AiRunEvent, DeepValuePhase } from "@/types/ai-run";

const en = translations.en;
const STARTED = "2026-11-20T10:00:00.000Z";
const BODY: NewDeepValueBody = {
  ticker: "ORNT",
  language: "English",
  mosPercent: 25,
  datasetId: "ds1",
  model: "claude-opus-4-8",
  effort: "high",
  thinking: true,
};

const stage = (phase: DeepValuePhase): AiRunEvent => ({ type: "stage", stage: phase, analysisId: "an1", runStartedAt: STARTED });
const done: AiRunEvent = { type: "done", analysisId: "an1" };
/** A phase that streams `text` and ends. */
const phaseOk = (phase: DeepValuePhase, text = "") => sseOk(text ? [stage(phase), { type: "text", text }, done] : [stage(phase), done]);
/** A phase whose stream closes with no terminal event. */
const phaseCut = (phase: DeepValuePhase, text = "") => sseOk(text ? [stage(phase), { type: "text", text }] : [stage(phase)]);

/** The row as GET /api/analyses/an1 returns it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd: "",
  updateNotesMd: null,
  mosPercent: 25,
  datasetId: "ds1",
  runStatus: "running",
  runStartedAt: null,
  runPhase: "valuation",
  runError: null,
  createdAt: STARTED,
  ...overrides,
});

const bodies = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/ai/deep-value").map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe("useDeepValueRun — four requests chained", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    push.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the four phases in order, then reads the row and hands it over", async () => {
    const finished = row({ runStatus: "done", runPhase: null, updateNotesMd: "notes", reportMd: "# Part one\n\n# Part two" });
    fetchMock
      .mockResolvedValueOnce(phaseOk("update", "notes"))
      .mockResolvedValueOnce(phaseOk("valuation"))
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseOk("report2", "# Part two"))
      .mockResolvedValueOnce(jsonResponse(200, finished));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("done"));

    expect(bodies(fetchMock)).toEqual([
      BODY,
      { analysisId: "an1", phase: "valuation" },
      { analysisId: "an1", phase: "report1" },
      { analysisId: "an1", phase: "report2" },
    ]);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/analyses/an1");
    expect(result.current.row).toEqual(finished);
    expect(result.current.notes).toBe("notes");
    expect(result.current.report).toBe("# Part one\n\n# Part two");
    expect(result.current.phases).toEqual({ update: "done", valuation: "done", report1: "done", report2: "done" });
    expect(result.current.error).toBeNull();
  });

  it("keeps the notes apart from the report, with a blank line between the two halves while streaming", async () => {
    fetchMock
      .mockResolvedValueOnce(phaseOk("update", "notes"))
      .mockResolvedValueOnce(phaseOk("valuation"))
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseCut("report2", "# Part two"))
      // The re-read fails: what the stream brought stays on screen.
      .mockResolvedValueOnce(jsonResponse(500, {}));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("cut"));
    expect(result.current.notes).toBe("notes");
    expect(result.current.report).toBe("# Part one\n\n# Part two");
    expect(result.current.phases.report2).toBe("failed");
  });

  it("a report1 stream with no terminal event, on a row still at report1, is a cut with the row read", async () => {
    const cutRow = row({ runPhase: "report1", runStartedAt: STARTED, updateNotesMd: "saved notes" });
    fetchMock
      .mockResolvedValueOnce(phaseOk("update", "notes"))
      .mockResolvedValueOnce(phaseOk("valuation"))
      .mockResolvedValueOnce(phaseCut("report1", "# Part"))
      .mockResolvedValueOnce(jsonResponse(200, cutRow));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("cut"));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.row).toEqual(cutRow);
    expect(result.current.notes).toBe("saved notes");
    expect(result.current.phases).toEqual({ update: "done", valuation: "done", report1: "failed", report2: "waiting" });
    expect(result.current.error).toBeNull();
  });

  it("a valuation stream lost after the server wrote it goes on to report1 by itself, with no error", async () => {
    fetchMock
      .mockResolvedValueOnce(phaseOk("update", "notes"))
      .mockResolvedValueOnce(sseRejecting([stage("valuation")]))
      // The server had written the valuation: the row stands at report1, no request in flight.
      .mockResolvedValueOnce(jsonResponse(200, row({ runPhase: "report1", runStartedAt: null })))
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseOk("report2", "# Part two"))
      .mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "done", runPhase: null, reportMd: "# Whole" })));
    const { result } = renderHook(() => useDeepValueRun());
    const states: string[] = [];

    act(() => result.current.start(BODY));
    await waitFor(() => {
      states.push(result.current.state);
      expect(result.current.state).toBe("done");
    });
    expect(states).not.toContain("cut");
    expect(states).not.toContain("error");
    expect(bodies(fetchMock).slice(2)).toEqual([
      { analysisId: "an1", phase: "report1" },
      { analysisId: "an1", phase: "report2" },
    ]);
    expect(result.current.report).toBe("# Whole");
  });

  it("a report2 stream lost on a row the server finished ends done on that row", async () => {
    const finished = row({ runStatus: "done", runPhase: null, reportMd: "# Whole" });
    fetchMock
      .mockResolvedValueOnce(phaseOk("update"))
      .mockResolvedValueOnce(phaseOk("valuation"))
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseCut("report2", "# Part"))
      .mockResolvedValueOnce(jsonResponse(200, finished));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(result.current.row).toEqual(finished);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("a 409 on a chained request reads the row and sends nothing more", async () => {
    const cutRow = row({ runPhase: "valuation", runStartedAt: STARTED });
    fetchMock
      .mockResolvedValueOnce(phaseOk("update", "notes"))
      .mockResolvedValueOnce(jsonResponse(409, { error: "phase out of order" }))
      .mockResolvedValueOnce(jsonResponse(200, cutRow));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("cut"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/analyses/an1");
    expect(result.current.row).toEqual(cutRow);
  });

  it("a 409 for a dataset gone is a final error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "dataset no longer available" }));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.retry("an1"));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toEqual({ message: "dataset no longer available", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 404 says the analysis is gone; a 401 goes to the login", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));
    const { result } = renderHook(() => useDeepValueRun());
    act(() => result.current.retry("an1"));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error?.message).toBe(en.analysisGone);

    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    act(() => result.current.retry("an1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("a re-read that fails after the last done ends done with no row", async () => {
    fetchMock
      .mockResolvedValueOnce(phaseOk("update"))
      .mockResolvedValueOnce(phaseOk("valuation"))
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseOk("report2", "# Part two"))
      .mockRejectedValueOnce(new TypeError("network error"));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(result.current.row).toBeNull();
    expect(result.current.report).toBe("# Part one\n\n# Part two");
  });

  it("a non-retryable error reads nothing back", async () => {
    fetchMock
      .mockResolvedValueOnce(phaseOk("update"))
      .mockResolvedValueOnce(sseOk([stage("valuation"), { type: "error", error: "Refused.", retryable: false }]));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toEqual({ message: "Refused.", retryable: false });
    expect(result.current.phases.valuation).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retry sends only the row, and goes on from the phase the server announces", async () => {
    fetchMock
      .mockResolvedValueOnce(phaseOk("report1", "# Part one"))
      .mockResolvedValueOnce(phaseOk("report2", "# Part two"))
      .mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "done", runPhase: null, reportMd: "# Whole" })));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.retry("an1"));
    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(bodies(fetchMock)).toEqual([{ analysisId: "an1" }, { analysisId: "an1", phase: "report2" }]);
  });

  it("refuses a second start while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    const { result } = renderHook(() => useDeepValueRun());

    act(() => result.current.start(BODY));
    act(() => result.current.start(BODY));
    act(() => result.current.retry("an1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(jsonResponse(500, {}));
    await waitFor(() => expect(result.current.state).toBe("error"));
  });
});
