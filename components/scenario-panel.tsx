"use client";

import React from "react";
import { AnalystEstimates, ScenariosInput, ScenarioName } from "@/types/valuation";

type ScenarioSource = "smart" | "generic" | "custom";

type ScenarioPanelProps = {
  scenarios: ScenariosInput;
  mosPercent: number;
  analystEstimates: AnalystEstimates | null;
  scenarioSource: ScenarioSource;
  onMosChange: (value: number) => void;
  onScenarioChange: (scenario: ScenarioName, key: string, value: number) => void;
  onResetSmart: () => void;
  onResetGeneric: () => void;
  onRecalculate: () => void;
  loading?: boolean;
};

// User-friendly labels with percentage indicator
const labels: Record<string, string> = {
  revenueGrowthYears1to5: "Revenue growth Y1-5 (%)",
  revenueGrowthYears6to10: "Revenue growth Y6-10 (%)",
  operatingMarginTarget: "Operating margin target (%)",
  taxRate: "Tax rate (%)",
  reinvestmentRate: "Reinvestment rate (%)",
  wacc: "WACC (%)",
  terminalGrowth: "Terminal growth (%)"
};

// Input constraints per field (in percentage space, matching API validation bounds)
const fieldBounds: Record<string, { min: number; max: number; step: number }> = {
  revenueGrowthYears1to5: { min: -50, max: 60, step: 0.5 },
  revenueGrowthYears6to10: { min: -50, max: 40, step: 0.5 },
  operatingMarginTarget: { min: 0, max: 80, step: 0.5 },
  taxRate: { min: 0, max: 60, step: 0.5 },
  reinvestmentRate: { min: 0, max: 90, step: 0.5 },
  wacc: { min: 3, max: 30, step: 0.5 },
  terminalGrowth: { min: -2, max: 6, step: 0.1 }
};

/**
 * Format analyst estimate for display in the info banner.
 *
 * Shows growth as a signed percentage with + prefix for positive values.
 */
function formatGrowthPercent(value: number | null): string | null {
  if (value === null) return null;
  const pct = (value * 100).toFixed(1);
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Interactive control panel for DCF scenario inputs and margin of safety.
 *
 * Displays three scenario columns (bull, base, bear) with independent input controls
 * for seven DCF parameters each. All values are displayed as percentages (user types "12"
 * for 12%) but stored internally as decimals (0.12). Includes global margin of safety
 * slider, analyst estimate reference info, and action buttons.
 *
 * @param scenarios - Current values for all three scenarios (decimals internally)
 * @param mosPercent - Margin of safety percentage (0-80%)
 * @param analystEstimates - Analyst consensus data shown as reference (nullable)
 * @param onMosChange - Callback when margin of safety slider changes
 * @param onScenarioChange - Callback when any scenario input changes (receives decimal)
 * @param onResetSmart - Callback to reset scenarios to company-specific smart defaults
 * @param onResetGeneric - Callback to reset scenarios to generic conservative defaults
 * @param onRecalculate - Callback to trigger new valuation API call
 * @param loading - Disables recalculate button during API request
 */
const sourceBadge: Record<ScenarioSource, { label: string; color: string }> = {
  smart: { label: "Smart defaults (Yahoo)", color: "border-emerald-600 text-emerald-400" },
  generic: { label: "Generic defaults", color: "border-slate-600 text-slate-400" },
  custom: { label: "Custom", color: "border-amber-600 text-amber-400" },
};

export function ScenarioPanel({
  scenarios,
  mosPercent,
  analystEstimates,
  scenarioSource,
  onMosChange,
  onScenarioChange,
  onResetSmart,
  onResetGeneric,
  onRecalculate,
  loading = false
}: ScenarioPanelProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scenario controls</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadge[scenarioSource].color}`}>
            {sourceBadge[scenarioSource].label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onResetSmart}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Smart defaults
          </button>
          <button
            onClick={onResetGeneric}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Generic defaults
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

      {/* Analyst estimates reference banner */}
      {analystEstimates && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-muted">
          {analystEstimates.numberOfAnalysts ? (
            <span>
              Analyst estimates ({analystEstimates.numberOfAnalysts} analysts):{" "}
              {formatGrowthPercent(analystEstimates.revenueGrowth5Year) && (
                <span>Rev. growth 5yr: <span className="text-slate-200">{formatGrowthPercent(analystEstimates.revenueGrowth5Year)}</span></span>
              )}
              {analystEstimates.operatingMargins !== null && (
                <span> | Op. margin: <span className="text-slate-200">{(analystEstimates.operatingMargins * 100).toFixed(1)}%</span></span>
              )}
              {analystEstimates.targetMeanPrice !== null && (
                <span> | Target price: <span className="text-slate-200">${analystEstimates.targetMeanPrice.toFixed(0)}</span></span>
              )}
            </span>
          ) : (
            <span>No analyst coverage available — using historical data for smart defaults</span>
          )}
        </div>
      )}

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
              {Object.entries(scenarios[scenarioName]).map(([key, value]) => {
                const bounds = fieldBounds[key] ?? { min: -100, max: 100, step: 0.5 };

                return (
                  <label key={key} className="block text-xs text-slate-200">
                    {labels[key]}
                    <input
                      type="number"
                      step={bounds.step}
                      min={bounds.min}
                      max={bounds.max}
                      // Display: decimal → percentage (0.12 → 12)
                      value={parseFloat((value * 100).toFixed(2))}
                      onChange={(event) => {
                        // Input: percentage → decimal (12 → 0.12)
                        onScenarioChange(scenarioName, key, Number(event.target.value) / 100);
                      }}
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
