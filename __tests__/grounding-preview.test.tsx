import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";

import { GroundingPreview } from "@/components/report/grounding-preview";
import type { GroundingExtractResponse } from "@/lib/grounding-client";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
import {
  computeImpliedExpectations,
  computeMarketImplied,
  computeMultipleStats,
  computeValuationGrid,
} from "@/lib/grounding/anchors";
import { translations } from "@/lib/i18n/translations";
import { makeEstimateRow, makeExtract, makeFinancialsRow, makeMeta, makeMultiplesRow } from "./grounding-test-helpers";

// Rendered in Italian on purpose: the grid row labels in the pure lib are plain English,
// so only a non-English render proves they are translated at display time.
vi.mock("@/context/language-context", () => ({
  useLanguage: () => ({
    language: "it" as const,
    setLanguage: () => {},
    t: (key: string) => translations.it[key as keyof typeof translations.it] ?? key,
    locale: "it-IT",
  }),
}));

// Two overlapping years with a reported EV (kE computable, but n=2 ⇒ low confidence), no
// market-cap data (kB not estimable ⇒ assumed), and a forward estimate for the grid's
// third row and the implied-expectations read.
const BRIDGE = { netDebt: 11500, minorityInterest: 3200, sharesDiluted: 3150 };
const EXTRACT = makeExtract({
  meta: makeMeta({ reportingCurrency: "EUR", units: "millions" }),
  financials: [
    makeFinancialsRow({ fiscalYear: 2024, ebitda: 13600, ...BRIDGE }),
    makeFinancialsRow({ fiscalYear: 2025, ebitda: 14200, ...BRIDGE }),
  ],
  multiples: [
    makeMultiplesRow({ fiscalYear: 2023, evEbitda: 3.0 }),
    makeMultiplesRow({ fiscalYear: 2024, evEbitda: 3.4, enterpriseValue: 3.4 * 13600 }),
    makeMultiplesRow({ fiscalYear: 2025, evEbitda: 4.0, enterpriseValue: 4.0 * 14200 }),
  ],
  estimates: [makeEstimateRow({ fiscalYear: 2026, ebitda: 15100 })],
});

function buildResult(): GroundingExtractResponse {
  const basis = computeBasisReconciliation(EXTRACT);
  return {
    extract: EXTRACT,
    basis,
    stats: computeMultipleStats(EXTRACT.multiples),
    grid: computeValuationGrid(EXTRACT, basis),
    marketImplied: computeMarketImplied(16, "EUR", EXTRACT, basis),
    impliedExpectations: computeImpliedExpectations(16, "EUR", EXTRACT, basis),
    warnings: [],
  };
}

function renderPreview(result: GroundingExtractResponse = buildResult()) {
  return render(createElement(GroundingPreview, { ticker: "ENI.MI", result, confirmed: false, onEdit: () => {}, onConfirm: () => {} }));
}

describe("GroundingPreview", () => {
  it("translates the grid row labels and tags each row with its horizon", () => {
    renderPreview();
    const grid = within(screen.getByRole("table"));

    expect(grid.getByText(/Ultimo esercizio \(2025\)/)).toBeInTheDocument();
    expect(grid.getByText(/Mediana 5a/)).toBeInTheDocument();
    expect(grid.getByText(/2026e/)).toBeInTheDocument();
    expect(grid.getByText("trailing")).toBeInTheDocument();
    expect(grid.getByText("metà ciclo")).toBeInTheDocument();
    expect(grid.getByText("forward")).toBeInTheDocument();
    expect(screen.queryByText(/Last FY/)).not.toBeInTheDocument();
  });

  it("labels the raw EV/EBITDA history as provider basis, apart from the same-basis grid", () => {
    renderPreview();

    expect(screen.getByText(/tabella grezza, base fornitore/)).toBeInTheDocument();
    expect(screen.getByText(/stessa base del conto economico, riscalata per kE/)).toBeInTheDocument();
  });

  it("shows a low kE confidence and an assumed kB", () => {
    renderPreview();

    expect(screen.getByText(/affidabilità: bassa/)).toBeInTheDocument();
    expect(screen.getByText(/Affidabilità bassa/)).toBeInTheDocument();
    expect(screen.getByText(/kB assunto = 1/)).toBeInTheDocument();
  });

  it("renders the 'what must be true' implied-expectations read", () => {
    renderPreview();

    expect(screen.getByText("Cosa deve essere vero")).toBeInTheDocument();
    expect(screen.getByText(/il prezzo attuale richiede un EBITDA di/)).toBeInTheDocument();
    expect(screen.getByText(/Multiplo che il mercato paga sulla prossima stima/)).toBeInTheDocument();
  });

  it("omits the implied-expectations read when the route could not compute it", () => {
    renderPreview({ ...buildResult(), impliedExpectations: null });

    expect(screen.queryByText("Cosa deve essere vero")).not.toBeInTheDocument();
  });
});
