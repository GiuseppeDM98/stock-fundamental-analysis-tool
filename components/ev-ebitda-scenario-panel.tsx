"use client";

import React from "react";
import { EvEbitdaScenariosInput, ScenarioName } from "@/types/valuation";
import { formatCompactNumber } from "@/lib/format";

type ScenarioSource = "smart" | "generic" | "custom";

type EvEbitdaScenarioPanelProps = {
  scenarios: EvEbitdaScenariosInput;
  mosPercent: number;
  ebitda: number | null;
  currentEvEbitda: number | null;
  scenarioSource: ScenarioSource;
  loading?: boolean;
  onMosChange: (value: number) => void;
  onScenarioChange: (scenario: ScenarioName, key: string, value: number) => void;
  onResetSmart: () => void;
  onResetGeneric: () => void;
  onRecalculate: () => void;
};

const sourceBadge: Record<ScenarioSource, { label: string; color: string }> = {
  smart:   { label: "Smart defaults (Yahoo)", color: "border-emerald-600 text-emerald-400" },
  generic: { label: "Generic defaults",       color: "border-slate-600 text-slate-400"    },
  custom:  { label: "Custom",                 color: "border-amber-600 text-amber-400"    },
};

export function EvEbitdaScenarioPanel({
  scenarios,
  mosPercent,
  ebitda,
  currentEvEbitda,
  scenarioSource,
  loading = false,
  onMosChange,
  onScenarioChange,
  onResetSmart,
  onResetGeneric,
  onRecalculate,
}: EvEbitdaScenarioPanelProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scenario controls · EV/EBITDA</p>
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

      {(ebitda !== null || currentEvEbitda !== null) && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-muted">
          {ebitda !== null && (
            <span>EBITDA (TTM): <span className="font-semibold text-slate-200">{formatCompactNumber(ebitda)}</span></span>
          )}
          {currentEvEbitda !== null && (
            <span className={ebitda !== null ? " · " : ""}>
              EV/EBITDA corrente: <span className="font-semibold text-slate-200">{currentEvEbitda.toFixed(1)}x</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="mos-ev" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
          Margin of safety: {mosPercent}%
        </label>
        <input
          id="mos-ev"
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
            <label className="block text-xs text-slate-200">
              Target EV/EBITDA (x)
              <input
                type="number"
                step={0.5}
                min={1}
                max={30}
                value={scenarios[scenarioName].targetMultiple}
                onChange={(event) => {
                  onScenarioChange(scenarioName, "targetMultiple", Number(event.target.value));
                }}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
