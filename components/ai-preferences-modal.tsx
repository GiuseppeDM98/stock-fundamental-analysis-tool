"use client";

import { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings, updateAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/types/ai-settings";

interface AiPreferencesModalProps {
  onClose: () => void;
}

/** Edits the user's global AI model/effort/thinking default (Settings icon in NavBar).
 * Every AI panel reads this as its starting point and can override per-run. */
export function AiPreferencesModal({ onClose }: AiPreferencesModalProps) {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAiSettings()
      .then(setSettings)
      .catch(() => setError("Failed to load current settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateAiSettings(settings);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-md space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-100">AI preferences</h2>
        <p className="text-xs text-muted">
          Default model, effort and thinking used across Deep Value, the Analyst panel, the
          Advisor and the earnings lookup. Individual panels can override this per run.
        </p>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <AiSettingsControl value={settings} onChange={setSettings} />
        )}

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="tap flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="tap rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-muted transition hover:border-slate-500 hover:text-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
