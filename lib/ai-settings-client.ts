// Client-side fetch helpers for the user's global AI model/effort/thinking default.
// Thin wrappers over /api/settings/ai — keeps components clean.
import type { AiSettings } from "@/types/ai-settings";

export async function fetchAiSettings(): Promise<AiSettings> {
  const res = await fetch("/api/settings/ai");
  if (!res.ok) throw new Error("Failed to load AI settings");
  return (await res.json()) as AiSettings;
}

export async function updateAiSettings(settings: AiSettings): Promise<AiSettings> {
  const res = await fetch("/api/settings/ai", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to update AI settings");
  }
  return (await res.json()) as AiSettings;
}
