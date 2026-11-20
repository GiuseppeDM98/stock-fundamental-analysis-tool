import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { LanguageProvider } from "@/context/language-context";
import { translations } from "@/lib/i18n/translations";

vi.mock("@/lib/analyses", () => ({ fetchAnalysis: vi.fn() }));

import { useLensRun } from "@/components/use-lens-run";
import { fetchAnalysis } from "@/lib/analyses";
import { sseOk, jsonResponse } from "./sse-test-helpers";
import { DEFAULT_AI_SETTINGS } from "@/types/ai-settings";

const BLIND = { method: "DCF", sector: "S", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 }, bear: { fairValue: 1 } };
const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, children);
const phaseOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string).phase;

function renderLens() {
  return renderHook(() => useLensRun("a1", "skeptic", DEFAULT_AI_SETTINGS, "English", { ticker: "AAA" }), { wrapper });
}

describe("useLensRun", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(fetchAnalysis).mockReset().mockResolvedValue({ id: "a1", reviewMd: "Critique." } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs blind then reconcile, one request each, and ends done", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: BLIND, degraded: false }]))
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "done" }]));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect([phaseOf(fetchMock, 0), phaseOf(fetchMock, 1)]).toEqual(["blind", "reconcile"]);
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a reconcile with no terminal event fails at reconcile, and retry() sends ONLY reconcile", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: BLIND, degraded: false }]))
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "text", text: "half" }]));
    vi.mocked(fetchAnalysis).mockResolvedValue({ id: "a1", reviewMd: null, reviewBlindJson: JSON.stringify(BLIND) } as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toMatchObject({ kind: "failed", retryable: true, resumeFrom: "reconcile" });

    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "done" }]));
    await act(async () => {
      await result.current.retry();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(phaseOf(fetchMock, 2)).toBe("reconcile");
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a reconcile answered 503 fails retryable with the route's sentence, resuming at reconcile", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: BLIND, degraded: false }]))
      .mockResolvedValueOnce(jsonResponse(503, { error: "The AI service is busy." }));
    vi.mocked(fetchAnalysis).mockResolvedValue({ id: "a1", reviewMd: null, reviewBlindJson: JSON.stringify(BLIND) } as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({ kind: "failed", error: "The AI service is busy.", retryable: true, resumeFrom: "reconcile" });
  });

  it("a reconcile that fails while the row cannot be read still resumes at reconcile, never at the start", async () => {
    // The row read is the only other path to "reconcile": with it failing, the phase in
    // progress alone must decide (2026-11-20: every other case masked it with a stored commitment).
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: BLIND, degraded: false }]))
      .mockResolvedValueOnce(jsonResponse(503, { error: "The AI service is busy." }));
    vi.mocked(fetchAnalysis).mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({ kind: "failed", error: "The AI service is busy.", retryable: true, resumeFrom: "reconcile" });
  });

  it("a blind phase cut after the server wrote the commitment resumes at reconcile", async () => {
    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }]));
    vi.mocked(fetchAnalysis).mockResolvedValue({ id: "a1", reviewMd: null, reviewBlindJson: JSON.stringify(BLIND) } as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      kind: "failed",
      error: translations.en.lensCut.replace("{phase}", "1"),
      retryable: true,
      resumeFrom: "reconcile",
    });
  });
});
