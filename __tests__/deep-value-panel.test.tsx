import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

const en = translations.en;
const DATASET = { id: "ds1", extract: makeExtract({ meta: makeMeta({ reportingCurrency: "USD", units: "millions" }) }) };
const STARTED = "2026-11-20T10:00:00.000Z";
const STAGE = { type: "stage" as const, stage: "valuation" as const, analysisId: "an1", runStartedAt: STARTED };

/** The row as GET /api/analyses/an1 returns it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "an1",
  ticker: "ORNT",
  companyName: "Orient Co",
  reportMd: "",
  mosPercent: 25,
  reportLanguage: "English",
  datasetId: "ds1",
  runStatus: "running",
  runStartedAt: STARTED,
  runError: null,
  ...overrides,
});

const panel = (props: Record<string, unknown> = {}) => (
  <DeepValuePanel ticker="ORNT" companyName="Orient Co" mosPercent={25} currentPrice={150} currency="USD" dataset={DATASET} {...props} />
);

describe("DeepValuePanel — a staged run written by the server", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the report and a link to the saved row once done, and no Save", async () => {
    fetchMock.mockResolvedValueOnce(sseOk([STAGE, { type: "text", text: "# Report" }, { type: "done", analysisId: "an1" }]));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    const link = await screen.findByText(en.deepValueOpenSaved);
    expect(link.closest("a")).toHaveAttribute("href", "/analyses/an1");
    expect(screen.getByTestId("report").textContent).toContain("# Report");
    expect(screen.queryByText(/^Save/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the user's default effort once it arrives, with no floor lifting it", async () => {
    vi.mocked(fetchAiSettings).mockResolvedValueOnce({ model: "claude-opus-4-8", effort: "medium", thinking: true });
    fetchMock.mockResolvedValueOnce(sseOk([STAGE, { type: "done", analysisId: "an1" }]));
    render(panel());
    await waitFor(() => expect(fetchAiSettings).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ model: "claude-opus-4-8", effort: "medium" });
  });

  it("a stream that ends without done is a cut: Retry waits for 330 s from the start, then sends only the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-20T10:01:00.000Z"));
    fetchMock.mockResolvedValueOnce(sseOk([STAGE, { type: "text", text: "# Partial" }])).mockResolvedValueOnce(jsonResponse(200, row()));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/analyses/an1");
    const waiting = screen.getByText(en.deepValueRetryIn.replace("{s}", "270"));
    expect(waiting.closest("button")).toBeDisabled();
    // The streamed text stays on screen.
    expect(screen.getByTestId("report").textContent).toContain("# Partial");

    // Let the countdown effect register its interval before moving the clock.
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(271_000);
    });
    const retry = (await screen.findByText(en.deepValueRetry)).closest("button")!;
    expect(retry).toBeEnabled();

    fetchMock.mockResolvedValueOnce(sseOk([STAGE, { type: "text", text: "# Report" }, { type: "done", analysisId: "an1" }]));
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/ai/deep-value");
    expect(JSON.parse(init.body)).toEqual({ analysisId: "an1" });
    expect(await screen.findByText(en.deepValueOpenSaved)).toBeInTheDocument();
  });

  it("a cut whose row the server finished shows the saved report", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([STAGE, { type: "text", text: "# Part" }]))
      .mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "done", reportMd: "# Whole report" })));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    expect(await screen.findByText(en.deepValueOpenSaved)).toBeInTheDocument();
    expect(screen.getByTestId("report").textContent).toContain("# Whole report");
    expect(screen.queryByText(en.deepValueCut)).not.toBeInTheDocument();
  });

  it("a read that rejects (the function killed mid-stream) is a cut too", async () => {
    fetchMock.mockResolvedValueOnce(sseRejecting([STAGE])).mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "failed", runError: "Retry." })));
    render(panel());
    fireEvent.click(screen.getByText(en.deepAnalysisBtn));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(screen.getByText("Retry.")).toBeInTheDocument();
    // A failed row is retryable at once.
    expect(screen.getByText(en.deepValueRetry).closest("button")).toBeEnabled();
  });

  it("with ?resume= it reads the row and shows the cut state, starting nothing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, row({ runStatus: "failed", runError: "Stopped." })));
    render(panel({ resumeId: "an1" }));

    expect(await screen.findByText(en.deepValueCut)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/analyses/an1");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/ai/deep-value")).toBe(false);
  });
});
