"use client";

import React from "react";
import { ScenariosInput, ScenarioName } from "@/types/valuation";

type ScenarioPanelProps = {
  scenarios: ScenariosInput;
  mosPercent: number;
  onMosChange: (value: number) => void;
  onScenarioChange: (scenario: ScenarioName, key: string, value: number) => void;
  onReset: () => void;
  onRecalculate: () => void;
  loading?: boolean;
};

// User-friendly labels for DCF input parameters
const labels: Record<string, string> = {
  revenueGrowthYears1to5: "Revenue growth Y1-5",
  revenueGrowthYears6to10: "Revenue growth Y6-10",
  operatingMarginTarget: "Operating margin target",
  taxRate: "Tax rate",
  reinvestmentRate: "Reinvestment rate",
  wacc: "WACC",
  terminalGrowth: "Terminal growth"
};

/**
 * Interactive control panel for DCF scenario inputs and margin of safety.
 *
 * Displays three scenario columns (bull, base, bear) with independent input controls
 * for seven DCF parameters each. Includes global margin of safety slider and action
 * buttons for resetting defaults and recalculating valuation.
 *
 * @param scenarios - Current values for all three scenarios
 * @param mosPercent - Margin of safety percentage (0-80%)
 * @param onMosChange - Callback when margin of safety slider changes
 * @param onScenarioChange - Callback when any scenario input changes
 * @param onReset - Callback to reset all scenarios to default presets
 * @param onRecalculate - Callback to trigger new valuation API call
 * @param loading - Disables recalculate button during API request
 */
export function ScenarioPanel({
  scenarios,
  mosPercent,
  onMosChange,
  onScenarioChange,
  onReset,
  onRecalculate,
  loading = false
}: ScenarioPanelProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scenario controls</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Reset defaults
          </button>
          <button
            onClick={onRecalculate}
            disabled={loading}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Running..." : "Recalculate"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="mos" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
          Margin of safety: {mosPercent}%
        </label>
        <input
          id="mos"
          type="range"
          min={0}
          max={80}
          value={mosPercent}
          onChange={(event) => onMosChange(Number(event.target.value))}
          className="w-full"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {(Object.keys(scenarios) as ScenarioName[]).map((scenarioName) => (
          <div key={scenarioName} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{scenarioName}</p>
            <div className="space-y-2">
              {Object.entries(scenarios[scenarioName]).map(([key, value]) => (
                <label key={key} className="block text-xs text-slate-200">
                  {labels[key]}
                  <input
                    type="number"
                    step={0.005}
                    min={-1}
                    max={1}
                    value={value}
                    onChange={(event) => onScenarioChange(scenarioName, key, Number(event.target.value))}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
