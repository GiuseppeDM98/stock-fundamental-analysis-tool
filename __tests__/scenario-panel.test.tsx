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
        onMosChange={onMosChange}
        onScenarioChange={onScenarioChange}
        onReset={() => {}}
        onRecalculate={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Margin of safety: 25%"), { target: { value: "30" } });
    expect(onMosChange).toHaveBeenCalledWith(30);

    const waccInput = screen.getAllByDisplayValue("0.085")[0];
    fireEvent.change(waccInput, { target: { value: "0.09" } });
    expect(onScenarioChange).toHaveBeenCalled();
  });
});
