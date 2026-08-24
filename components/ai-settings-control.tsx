"use client";

import { useEffect, useState } from "react";
import { AI_MODEL_CATALOG, AI_MODEL_IDS, type AiSettings } from "@/types/ai-settings";
import { isDeepSeekPeakHour, formatDeepSeekPeakWindows } from "@/lib/ai/deepseek-pricing";

interface AiSettingsControlProps {
  value: AiSettings;
  onChange: (value: AiSettings) => void;
  className?: string;
}

/** Compact model + effort + thinking selector, reused across the Deep Value panel,
 * Advisor, the Analyst panel, and the global AI-preferences modal. Effort options are
 * filtered to whatever the currently-selected model actually supports. */
export function AiSettingsControl({ value, onChange, className }: AiSettingsControlProps) {
  const catalog = AI_MODEL_CATALOG[value.model];

  // Live peak-hour indicator for DeepSeek's upcoming peak/valley pricing (2x during
  // peak windows) — re-checked every minute so the badge flips as the window opens/closes.
  const [isPeakNow, setIsPeakNow] = useState<boolean | null>(null);
  useEffect(() => {
    if (catalog.provider !== "deepseek") return;
    const update = () => setIsPeakNow(isDeepSeekPeakHour());
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [catalog.provider]);

  function handleModelChange(model: AiSettings["model"]) {
    const efforts = AI_MODEL_CATALOG[model].efforts;
    const effort = efforts.includes(value.effort) ? value.effort : efforts[efforts.length - 1];
    onChange({ ...value, model, effort });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs ${className ?? ""}`}>
      <select
        value={value.model}
        onChange={(e) => handleModelChange(e.target.value as AiSettings["model"])}
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200"
        title="AI model"
      >
        {AI_MODEL_IDS.map((id) => (
          <option key={id} value={id}>
            {AI_MODEL_CATALOG[id].label}
          </option>
        ))}
      </select>
      <select
        value={value.effort}
        onChange={(e) => onChange({ ...value, effort: e.target.value as AiSettings["effort"] })}
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200"
        title="Effort level"
      >
        {catalog.efforts.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-slate-400">
        <input
          type="checkbox"
          checked={value.thinking}
          onChange={(e) => onChange({ ...value, thinking: e.target.checked })}
        />
        thinking
      </label>
      {catalog.provider === "deepseek" && isPeakNow !== null && (
        <span
          className={isPeakNow ? "text-danger" : "text-muted"}
          title={`DeepSeek applica una tariffazione a fasce dal 16 agosto 2026: prezzo doppio nelle ore di punta, solo dal lunedì al venerdì (weekend sempre a tariffa normale). Fasce di punta (ora italiana): ${formatDeepSeekPeakWindows().join(", ")}.`}
        >
          {isPeakNow ? "💰 tariffa doppia ora" : "tariffa normale"}
        </span>
      )}
    </div>
  );
}
