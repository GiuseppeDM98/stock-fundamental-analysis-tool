"use client";

import React, { useEffect, useState } from "react";
import { DdmScenariosInput, ScenarioName } from "@/types/valuation";

type ScenarioSource = "smart" | "generic" | "custom";

type DdmScenarioPanelProps = {
  scenarios: DdmScenariosInput;
  mosPercent: number;
  dividendRate: number | null;
  scenarioSource: ScenarioSource;
  loading?: boolean;
  onMosChange: (value: number) => void;
  onScenarioChange: (scenario: ScenarioName, key: string, value: number) => void;
  onResetSmart: () => void;
  onResetGeneric: () => void;
  onRecalculate: () => void;
};

const labels: Record<string, string> = {
  dividendGrowthRate: "Dividend growth (%)",
  costOfEquity: "Cost of equity / Ke (%)",
  terminalGrowthRate: "Terminal growth (%)",
};

const fieldBounds: Record<string, { min: number; max: number; step: number }> = {
  dividendGrowthRate: { min: -2, max: 15, step: 0.1 },
  costOfEquity:       { min: 3,  max: 25, step: 0.1 },
  terminalGrowthRate: { min: -1, max: 5,  step: 0.1 },
};

const sourceBadge: Record<ScenarioSource, { label: string; color: string }> = {
  smart:   { label: "Smart defaults (Yahoo)", color: "border-emerald-600 text-emerald-400" },
  generic: { label: "Generic defaults",       color: "border-slate-600 text-slate-400"    },
  custom:  { label: "Custom",                 color: "border-amber-600 text-amber-400"    },
};

export function DdmScenarioPanel({
  scenarios,
  mosPercent,
  dividendRate,
  scenarioSource,
  loading = false,
  onMosChange,
  onScenarioChange,
  onResetSmart,
  onResetGeneric,
  onRecalculate,
}: DdmScenarioPanelProps) {
  const [riskFreeRate, setRiskFreeRate] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/macro/risk-free-rate")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.rate != null) setRiskFreeRate(data.rate); })
      .catch(() => {});
  }, []);

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scenario controls · DDM</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadge[scenarioSource].color}`}>
            {sourceBadge[scenarioSource].label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onResetSmart} className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800">
            Smart defaults
          </button>
          <button onClick={onResetGeneric} className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800">
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

      {dividendRate !== null && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-muted">
          Dividendo annuale per azione (D₀): <span className="text-slate-200 font-semibold">{dividendRate.toFixed(2)}</span>
          {riskFreeRate !== null && (
            <span> · Tasso risk-free (US 10Y): <span className="text-slate-200 font-semibold">{(riskFreeRate * 100).toFixed(2)}%</span></span>
          )}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="mos-ddm" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
          Margin of safety: {mosPercent}%
        </label>
        <input
          id="mos-ddm"
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
                const bounds = fieldBounds[key] ?? { min: -100, max: 100, step: 0.1 };
                return (
                  <label key={key} className="block text-xs text-slate-200">
                    <span className="flex items-center gap-1.5">
                      {labels[key]}
                      {key === "costOfEquity" && riskFreeRate !== null && (
                        <span className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          US 10Y: {(riskFreeRate * 100).toFixed(2)}%
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      step={bounds.step}
                      min={bounds.min}
                      max={bounds.max}
                      value={parseFloat((value * 100).toFixed(2))}
                      onChange={(event) => {
                        onScenarioChange(scenarioName, key, Number(event.target.value) / 100);
                      }}
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-sky-400/30"
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
