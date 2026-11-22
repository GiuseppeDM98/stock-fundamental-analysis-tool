import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";
import type { AiRunEvent } from "@/types/ai-run";

vi.mock("@/lib/ai-settings-client", () => ({
  fetchAiSettings: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/lib/analyses", () => ({
  fetchAnalysis: vi.fn(),
}));
vi.mock("@/components/ai-settings-control", () => ({
  AiSettingsControl: () => "AI model selector",
}));
vi.mock("@/components/report/report-body", () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="critique">{markdown}</div>,
}));

import AnalystPanel from "@/components/analyst-panel";
import { fetchAnalysis } from "@/lib/analyses";
import { makeExtract, makeMeta, makeFinancialsRow } from "./grounding-test-helpers";
import { sseOk } from "./sse-test-helpers";

const en = translations.en;

const OLD_BLIND = JSON.stringify({
  method: "EV/EBITDA",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 99.11 },
  base: { fairValue: 88.22 },
  bear: { fairValue: 77.33 },
});

const NEW_BLIND = { method: "EV/EBITDA", sector: "Utilities", currency: "EUR", bull: { fairValue: 3.1 }, base: { fairValue: 2.6 }, bear: { fairValue: 1.9 } };
const NEW_FINAL = { method: "EV/EBITDA", sector: "U", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2.5 }, bear: { fairValue: 1.8 } };

/** A response whose SSE events the test sends one by one, so assertions can run mid-stream. */
function controllableSse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: { ok: true, status: 200, body, headers: new Headers(), json: async () => ({}) },
    send: (event: AiRunEvent) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
  };
}

/** The row as GET /api/analyses/a1 returns it after a Skeptic run. */
const skepticRow = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  reviewMd: "Critique.",
  reviewBlindJson: JSON.stringify({ ...NEW_BLIND, rationale: "Net debt." }),
  reviewResultJson: JSON.stringify(NEW_FINAL),
  reviewFairValueBull: 3,
  reviewFairValueBase: 2.5,
  reviewFairValueBear: 1.8,
  ...overrides,
});

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

const retryPhase = (phase: number) => en.lensRetryPhase.replace("{phase}", String(phase));
const finalDone = () => sseOk([{ type: "stage", stage: "final" }, { type: "done" }]);

function renderPanel(
  overrides: {
    initialResult?: string | null;
    currentPrice?: number | null;
    initialBlind?: string | null;
    initialCritique?: string | null;
    // null: a row whose lens has no final numbers yet.
    initialFinal?: { bull: number; base: number; bear: number } | null;
    hasDataset?: boolean;
  } = {}
) {
  const initialFinal = overrides.initialFinal === undefined ? { bull: 98, base: 87, bear: 76 } : overrides.initialFinal;
  return render(
    <AnalystPanel
      analysisId="a1"
      ticker="IRE.MI"
      mosPercent={0}
      initialCritiques={{ skeptic: overrides.initialCritique === undefined ? "old critique" : overrides.initialCritique }}
      initialBlind={{ skeptic: overrides.initialBlind === undefined ? OLD_BLIND : overrides.initialBlind }}
      initialFinal={initialFinal ? { skeptic: initialFinal } : {}}
      initialResult={{ skeptic: overrides.initialResult ?? null }}
      groundingExtract={null}
      hasDataset={overrides.hasDataset ?? true}
      currentPrice={overrides.currentPrice ?? null}
      currency="EUR"
      priceSource="live"
    />
  );
}

describe("AnalystPanel — a lens in three phases written by the server", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(fetchAnalysis).mockReset().mockResolvedValue(skepticRow() as never);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops the previous card on re-run, shows the new one when Phase 1 ends, and reads the final numbers from the row", async () => {
    const blind = controllableSse();
    const reconcile = controllableSse();
    fetchMock.mockResolvedValueOnce(blind.response).mockResolvedValueOnce(reconcile.response).mockResolvedValueOnce(finalDone());
    renderPanel();
    expect(screen.getByText("88.22")).toBeInTheDocument();

    fireEvent.click(screen.getByText(en.analystReviewRerun));
    // The persisted card from the previous run is gone before the new run sends anything.
    await waitFor(() => expect(screen.queryByText("88.22")).not.toBeInTheDocument());

    await act(async () => {
      blind.send({ type: "stage", stage: "blind" });
    });
    // The phase label comes from the stage event.
    expect(screen.getByText(en.analystPhaseBlind)).toBeInTheDocument();

    await act(async () => {
      blind.send({ type: "done", blind: NEW_BLIND, degraded: false });
      blind.close();
    });
    // Phase 2 running: the new blind card is already on screen, its final column pending.
    await waitFor(() => expect(screen.getByText("2.60")).toBeInTheDocument());
    expect(screen.getAllByText("…")).toHaveLength(3);

    await act(async () => {
      reconcile.send({ type: "stage", stage: "reconcile" });
      reconcile.send({ type: "text", text: "Critique so far" });
    });
    expect(screen.getByText(en.analystPhaseReconcile)).toBeInTheDocument();
    expect(screen.getByTestId("critique").textContent).toContain("Critique so far");

    await act(async () => {
      reconcile.send({ type: "done" });
      reconcile.close();
    });
    // The numbers come from the row the server wrote, re-read once the run ended.
    await waitFor(() => expect(screen.getByText("2.50")).toBeInTheDocument());
    expect(fetchAnalysis).toHaveBeenCalledWith("a1");
    expect(screen.getByTestId("critique").textContent).toBe("Critique.");
    expect(screen.getByText(en.analystReviewRerun)).toBeInTheDocument();
  });

  it("sends phases blind, reconcile and final on the row, without the report, at high before the default loads", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: NEW_BLIND, degraded: false }]))
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "done" }]))
      .mockResolvedValueOnce(finalDone());
    renderPanel();
    fireEvent.click(screen.getByText(en.analystReviewRerun));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/deep-value/verify");
    expect(bodyOf(fetchMock, 0)).toMatchObject({ analysisId: "a1", angle: "skeptic", phase: "blind", effort: "high" });
    expect(bodyOf(fetchMock, 1)).toMatchObject({ analysisId: "a1", phase: "reconcile" });
    expect(bodyOf(fetchMock, 2)).toMatchObject({ analysisId: "a1", phase: "final" });
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("reportMd");
  });

  it("evaluates the kill_price gate on the FINAL skeptic JSON and shows it with the blind gates", async () => {
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 2000, minorityInterest: 100, sharesDiluted: 300 })],
    });
    vi.mocked(fetchAnalysis).mockResolvedValue(
      skepticRow({
        reviewBlindJson: JSON.stringify({ ...NEW_BLIND, killPrice: 1.5 }),
        // The final JSON drops the kill price without explaining why.
        reviewResultJson: JSON.stringify({ ...NEW_BLIND, killPrice: null, revisions: [] }),
      }) as never
    );
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: { ...NEW_BLIND, killPrice: 1.5 }, degraded: false }]))
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "text", text: "Critique." }, { type: "done" }]))
      .mockResolvedValueOnce(finalDone());
    render(
      <AnalystPanel
        analysisId="a1"
        ticker="IRE.MI"
        mosPercent={0}
        initialCritiques={{}}
        initialBlind={{}}
        initialFinal={{}}
        initialResult={{}}
        groundingExtract={extract}
        hasDataset
        currentPrice={2.2}
        currency="EUR"
        priceSource="live"
      />
    );
    // ANALYST_ANGLES order puts the Skeptic first.
    fireEvent.click(screen.getAllByText(en.analystRunButton)[0]);

    const finalGate = await screen.findByText(/Final · Kill price declared/);
    expect(finalGate.textContent).toContain("✗");
    // The blind commitment's own kill_price gate is still listed separately, and passes.
    expect(screen.getByText(/^✓ Kill price declared — 1\.50/)).toBeInTheDocument();
  });

  it("a row with a critique and no numbers opens on Retry phase 3, with the critique on screen", () => {
    renderPanel({ initialFinal: null });

    expect(screen.getByText(retryPhase(3))).toBeInTheDocument();
    expect(screen.getByTestId("critique").textContent).toBe("old critique");
    // The final column waits for Phase 3.
    expect(screen.getAllByText("…")).toHaveLength(3);
    expect(screen.queryByText(en.analystReviewRerun)).not.toBeInTheDocument();
  });

  it("a row saved before the result column (a critique and its three numbers) is done, with Re-run", () => {
    renderPanel({ initialResult: null });

    expect(screen.getByText(en.analystReviewRerun)).toBeInTheDocument();
    expect(screen.queryByText(retryPhase(3))).not.toBeInTheDocument();
  });

  it("Retry phase 3 from a reloaded row sends only final and keeps the critique and the blind card while it runs", async () => {
    const final = controllableSse();
    fetchMock.mockResolvedValueOnce(final.response);
    renderPanel({ initialFinal: null });

    fireEvent.click(screen.getByText(retryPhase(3)));
    await act(async () => {
      final.send({ type: "stage", stage: "final" });
    });
    expect(screen.getByText(en.analystPhaseFinal)).toBeInTheDocument();
    expect(screen.getByText("88.22")).toBeInTheDocument();
    expect(screen.getByTestId("critique").textContent).toBe("old critique");

    await act(async () => {
      final.send({ type: "done" });
      final.close();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0).phase).toBe("final");
    await waitFor(() => expect(screen.getByText("2.50")).toBeInTheDocument());
  });

  it("a final that fails offers Retry phase 3, which sends only final", async () => {
    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "final" }, { type: "error", error: "The final numbers did not arrive: retry.", retryable: true }]));
    vi.mocked(fetchAnalysis).mockResolvedValue(skepticRow({ reviewResultJson: null, reviewFairValueBull: null, reviewFairValueBase: null, reviewFairValueBear: null }) as never);
    renderPanel({ initialFinal: null });

    fireEvent.click(screen.getByText(retryPhase(3)));
    expect(await screen.findByText("The final numbers did not arrive: retry.")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(finalDone());
    vi.mocked(fetchAnalysis).mockResolvedValue(skepticRow() as never);
    fireEvent.click(screen.getByText(retryPhase(3)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock, 1).phase).toBe("final");
    await waitFor(() => expect(screen.getByText("2.50")).toBeInTheDocument());
  });

  it("a commitment on the row with no critique offers Retry phase 2, which sends reconcile then final and keeps the card", async () => {
    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "done" }])).mockResolvedValueOnce(finalDone());
    vi.mocked(fetchAnalysis).mockResolvedValue(skepticRow({ reviewBlindJson: OLD_BLIND }) as never);
    renderPanel({ initialCritique: null });

    expect(screen.getByText("88.22")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: en.analystRunButton }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(retryPhase(2)));
    // The card stays while Phase 2 runs.
    expect(screen.getByText("88.22")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect([bodyOf(fetchMock, 0).phase, bodyOf(fetchMock, 1).phase]).toEqual(["reconcile", "final"]);
    await waitFor(() => expect(screen.getByText(en.analystReviewRerun)).toBeInTheDocument());
  });

  it("a Phase 2 cut offers to retry Phase 2 alone", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: NEW_BLIND, degraded: false }]))
      // Stage, then the stream ends with no terminal event: the function was cut.
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "text", text: "Half a critique" }]));
    vi.mocked(fetchAnalysis).mockResolvedValue(skepticRow({ reviewMd: null, reviewResultJson: null }) as never);
    renderPanel();
    fireEvent.click(screen.getByText(en.analystReviewRerun));

    expect(await screen.findByText(en.lensCut.replace("{phase}", "2"))).toBeInTheDocument();
    expect(screen.getByText("2.60")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "done" }])).mockResolvedValueOnce(finalDone());
    vi.mocked(fetchAnalysis).mockResolvedValue(skepticRow() as never);
    fireEvent.click(screen.getByText(retryPhase(2)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect([bodyOf(fetchMock, 2).phase, bodyOf(fetchMock, 3).phase]).toEqual(["reconcile", "final"]);
    await waitFor(() => expect(screen.getByText("2.50")).toBeInTheDocument());
  });

  it("a Phase 2 cut offers Retry phase 2 even when the row cannot be read back", async () => {
    fetchMock
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: NEW_BLIND, degraded: false }]))
      .mockResolvedValueOnce(sseOk([{ type: "stage", stage: "reconcile" }, { type: "text", text: "Half a critique" }]));
    vi.mocked(fetchAnalysis).mockRejectedValue(new TypeError("Failed to fetch"));
    renderPanel();
    fireEvent.click(screen.getByText(en.analystReviewRerun));

    expect(await screen.findByText(en.lensCut.replace("{phase}", "2"))).toBeInTheDocument();
    expect(screen.getByText(retryPhase(2))).toBeInTheDocument();
  });

  it("a re-run that fails before Phase 1 brings the persisted blind card and critique back", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.mocked(fetchAnalysis).mockRejectedValue(new TypeError("Failed to fetch"));
    renderPanel();
    expect(screen.getByText("88.22")).toBeInTheDocument();

    fireEvent.click(screen.getByText(en.analystReviewRerun));

    expect(await screen.findByText(en.lensCut.replace("{phase}", "1"))).toBeInTheDocument();
    expect(screen.getByText("88.22")).toBeInTheDocument();
    expect(screen.getByTestId("critique").textContent).toBe("old critique");
  });
});

describe("AnalystPanel after a reload reads the FINAL JSON from *ResultJson", () => {
  const FINAL = {
    method: "EV/EBITDA",
    sector: "Utilities",
    currency: "EUR",
    bull: { fairValue: 98 },
    base: { fairValue: 87 },
    bear: { fairValue: 76 },
    killPrice: 7.9,
    revisions: [{ scenario: "base", from: 88.22, to: 87, reason: "a pangolin-sized regulatory cut" }],
  };

  it("shows the final kill price, the revisions and the final kill_price gate on the blind card", () => {
    renderPanel({ initialResult: JSON.stringify(FINAL), currentPrice: 80 });

    expect(screen.getByText("88.22")).toBeInTheDocument(); // the blind column
    expect(screen.getByText("7.90")).toBeInTheDocument(); // the final kill price
    expect(screen.getByText(/a pangolin-sized regulatory cut/)).toBeInTheDocument();
    expect(screen.getByText(/Final · Kill price declared — 7\.90/)).toBeInTheDocument();
    // Lenses declare no sensitivity grid nor dividend path: the blind gates leave both out.
    expect(screen.queryByText(en.groundingGateSensitivityCenter, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(en.groundingGateDividendCoverage, { exact: false })).not.toBeInTheDocument();
  });

  it("treats a stored blind commitment without a full triple as absent: no blind card, no crash", () => {
    const partial = JSON.stringify({ method: "EV/EBITDA", sector: "Utilities", currency: "EUR", base: { fairValue: 88.22 } });
    renderPanel({ initialBlind: partial, currentPrice: 80 });

    expect(screen.queryByText("88.22")).not.toBeInTheDocument();
    expect(screen.getByTestId("critique").textContent).toBe("old critique");
  });

  it("with no blind commitment (Quick), mounts AnalystFinalCard with the final JSON's gates", () => {
    render(
      <AnalystPanel
        analysisId="a1"
        ticker="IRE.MI"
        mosPercent={0}
        initialCritiques={{ skeptic: "old critique" }}
        initialBlind={{}}
        initialFinal={{ skeptic: { bull: 98, base: 87, bear: 76 } }}
        initialResult={{ skeptic: JSON.stringify(FINAL) }}
        groundingExtract={null}
        hasDataset
        currentPrice={80}
        currency="EUR"
        priceSource="analysis"
      />
    );

    expect(screen.getByText(en.analystFinalCardTitle)).toBeInTheDocument();
    expect(screen.getByText(/✓ Kill price declared — 7\.90/)).toBeInTheDocument();
    // The reader sees the gate's name, never its code.
    expect(screen.queryByText(/kill_price|scenario_order|horizon_consistent/)).not.toBeInTheDocument();
    expect(screen.getByText(/Consistent scenario horizon/)).toBeInTheDocument();
    expect(screen.getByText(/a pangolin-sized regulatory cut/)).toBeInTheDocument();
    // Lenses declare no sensitivity grid nor dividend path: those gates are not listed (by
    // name: the card never prints a code, so a code would be absent anyway).
    expect(screen.queryByText(en.groundingGateSensitivityCenter, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(en.groundingGateDividendCoverage, { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(en.valuationChecksPriceAtAnalysis)).toBeInTheDocument();
  });

  it("without a dataset disables every Run, says why, keeps the saved lens readable and calls nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel({ hasDataset: false });

    expect(screen.getByText(en.analystNeedsDataset)).toBeInTheDocument();
    // Nothing can run, so there is no model to pick.
    expect(screen.queryByText("AI model selector")).not.toBeInTheDocument();
    // The Skeptic has a saved critique (Re-run), the other two lenses have none (Run).
    const buttons = [screen.getByRole("button", { name: en.analystReviewRerun }), ...screen.getAllByRole("button", { name: en.analystRunButton })];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("critique")).toHaveTextContent("old critique");
    vi.unstubAllGlobals();
  });
});
