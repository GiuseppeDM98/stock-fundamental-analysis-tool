import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScenarioPanel } from "../components/scenario-panel";
import { getDefaultScenarios } from "../lib/valuation/scenario-presets";

describe("ScenarioPanel", () => {
  it("calls onMosChange and onScenarioChange", () => {
    const onMosChange = vi.fn();
    const onScenarioChange = vi.fn();

    render(
      <ScenarioPanel
        scenarios={getDefaultScenarios()}
        mosPercent={25}
        analystEstimates={null}
        scenarioSource="generic"
        onMosChange={onMosChange}
        onScenarioChange={onScenarioChange}
        onResetSmart={() => {}}
        onResetGeneric={() => {}}
        onRecalculate={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Margin of safety: 25%"), { target: { value: "30" } });
    expect(onMosChange).toHaveBeenCalledWith(30);

    // Values now display as percentages: 0.085 WACC → displays as "8.5"
    const waccInput = screen.getAllByDisplayValue("8.5")[0];
    fireEvent.change(waccInput, { target: { value: "9" } });
    // Input 9% → callback receives 0.09 (decimal)
    expect(onScenarioChange).toHaveBeenCalledWith("bull", "wacc", 0.09);
  });

  it("displays analyst estimates banner when provided", () => {
    render(
      <ScenarioPanel
        scenarios={getDefaultScenarios()}
        mosPercent={25}
        analystEstimates={{
          revenueGrowthNextYear: 0.08,
          revenueGrowth5Year: 0.12,
          earningsGrowthNextYear: 0.15,
          targetMeanPrice: 245,
          numberOfAnalysts: 30,
          operatingMargins: 0.30,
          revenueGrowthTTM: 0.05,
          freeCashflow: 100e9,
          totalRevenue: 400e9,
        }}
        scenarioSource="smart"
        onMosChange={() => {}}
        onScenarioChange={() => {}}
        onResetSmart={() => {}}
        onResetGeneric={() => {}}
        onRecalculate={() => {}}
      />
    );

    expect(screen.getByText(/30 analysts/)).toBeDefined();
    expect(screen.getByText("$245")).toBeDefined();
    expect(screen.getByText("30.0%")).toBeDefined();
  });
});
