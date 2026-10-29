import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { translations } from "@/lib/i18n/translations";
import { ANALYST_PHASE_MARKERS } from "@/lib/report/parse-deep-value-json";

vi.mock("@/lib/ai-settings-client", () => ({
  fetchAiSettings: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/lib/analyses", () => ({
  updateAnalystOpinion: vi.fn(async () => undefined),
}));
vi.mock("@/components/ai-settings-control", () => ({
  AiSettingsControl: () => null,
}));
vi.mock("@/components/report/report-body", () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="critique">{markdown}</div>,
}));

import AnalystPanel from "@/components/analyst-panel";
import { updateAnalystOpinion } from "@/lib/analyses";
import { makeExtract, makeMeta, makeFinancialsRow } from "./grounding-test-helpers";

const OLD_BLIND = JSON.stringify({
  method: "EV/EBITDA",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 99.11 },
  base: { fairValue: 88.22 },
  bear: { fairValue: 77.33 },
});

const NEW_BLIND = { method: "EV/EBITDA", sector: "Utilities", currency: "EUR", bull: { fairValue: 3.1 }, base: { fairValue: 2.6 }, bear: { fairValue: 1.9 } };

// A response body the test feeds chunk by chunk, so assertions can run mid-stream.
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    body,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function renderPanel() {
  return render(
    <AnalystPanel
      analysisId="a1"
      ticker="IRE.MI"
      reportMd="# Report"
      mosPercent={0}
      initialCritiques={{ skeptic: "old critique" }}
      initialBlind={{ skeptic: OLD_BLIND }}
      initialFinal={{ skeptic: { bull: 98, base: 87, bear: 76 } }}
      groundingExtract={null}
      currentPrice={null}
      currency="EUR"
    />
  );
}

describe("AnalystPanel blind card during a run", () => {
  let stream: ReturnType<typeof controllableStream>;

  beforeEach(() => {
    stream = controllableStream();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, body: stream.body })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops the previous run's card on re-run and shows the new one as soon as Phase 1 parses", async () => {
    renderPanel();
    expect(screen.getByText("88.22")).toBeInTheDocument();

    fireEvent.click(screen.getByText(translations.en.analystReviewRerun));
    // The persisted card from the previous run is gone before the new run sends anything.
    await waitFor(() => expect(screen.queryByText("88.22")).not.toBeInTheDocument());

    await act(async () => {
      stream.push(ANALYST_PHASE_MARKERS.blind);
      stream.push("```json-blind\n" + JSON.stringify(NEW_BLIND) + "\n```\n");
      stream.push(ANALYST_PHASE_MARKERS.reconcile);
    });

    // Stream still open (turn 2 running) — the new blind card is already on screen, with
    // its final column still pending.
    await waitFor(() => expect(screen.getByText("2.60")).toBeInTheDocument());
    expect(screen.getAllByText("…")).toHaveLength(3);
    expect(screen.queryByText("87.00")).not.toBeInTheDocument();

    await act(async () => {
      stream.push('```json\n{"method":"EV/EBITDA","sector":"U","currency":"EUR","bull":{"fairValue":3},"base":{"fairValue":2.5},"bear":{"fairValue":1.8}}\n```\nCritique.');
      stream.close();
    });
    await waitFor(() => expect(screen.getByText("2.50")).toBeInTheDocument());
  });

  it("evaluates the kill_price gate on the FINAL skeptic JSON and shows it with the blind gates", async () => {
    const extract = makeExtract({
      meta: makeMeta({ reportingCurrency: "EUR" }),
      financials: [makeFinancialsRow({ fiscalYear: 2025, ebitda: 1000, netDebt: 2000, minorityInterest: 100, sharesDiluted: 300 })],
    });
    render(
      <AnalystPanel
        analysisId="a1"
        ticker="IRE.MI"
        reportMd="# Report"
        mosPercent={0}
        initialCritiques={{}}
        initialBlind={{}}
        initialFinal={{}}
        groundingExtract={extract}
        currentPrice={2.2}
        currency="EUR"
      />
    );
    // ANALYST_ANGLES order puts the Skeptic first.
    fireEvent.click(screen.getAllByText(translations.en.analystRunButton)[0]);

    await act(async () => {
      stream.push(ANALYST_PHASE_MARKERS.blind);
      stream.push("```json-blind\n" + JSON.stringify({ ...NEW_BLIND, killPrice: 1.5 }) + "\n```\n");
      stream.push(ANALYST_PHASE_MARKERS.reconcile);
      // The final JSON drops the kill price without explaining why.
      stream.push('```json\n' + JSON.stringify({ ...NEW_BLIND, killPrice: null, revisions: [] }) + '\n```\nCritique.');
      stream.close();
    });

    const finalGate = await screen.findByText(/Final · kill_price/);
    expect(finalGate.textContent).toContain("✗");
    // The blind commitment's own kill_price gate is still listed separately, and passes.
    expect(screen.getByText(/^✓ kill_price: 1\.50/)).toBeInTheDocument();
  });

  it("clears the lens's numbers, without throwing, when the final JSON lacks a scenario", async () => {
    vi.mocked(updateAnalystOpinion).mockClear();
    renderPanel();
    fireEvent.click(screen.getByText(translations.en.analystReviewRerun));

    await act(async () => {
      stream.push(ANALYST_PHASE_MARKERS.blind);
      stream.push("```json-blind\n" + JSON.stringify(NEW_BLIND) + "\n```\n");
      stream.push(ANALYST_PHASE_MARKERS.reconcile);
      const { bear: _bear, ...noBear } = NEW_BLIND;
      stream.push("```json\n" + JSON.stringify(noBear) + "\n```\nCritique.");
      stream.close();
    });

    await waitFor(() => expect(updateAnalystOpinion).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateAnalystOpinion).mock.calls[0][1]).toMatchObject({
      angle: "skeptic",
      fairValueBull: null,
      fairValueBase: null,
      fairValueBear: null,
      valuationMethod: null,
    });
    expect(screen.getByText(translations.en.deepValueIncompleteJson)).toBeInTheDocument();
    // The blind card no longer waits on a final column that will never come.
    expect(screen.queryAllByText("…")).toHaveLength(0);
  });
});
