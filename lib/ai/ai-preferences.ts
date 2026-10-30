import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  AI_MODEL_CATALOG,
  callSiteDefaultEffort,
  isAiEffort,
  normalizeAiModelId,
  type AiModelId,
  type AiSettings,
} from "@/types/ai-settings";

/** A per-request override as a client sends it: the model may still carry an id the
 *  provider retired (an old tab, an old build), which the resolver maps to its successor. */
export type AiSettingsOverride = Partial<Omit<AiSettings, "model">> & { model?: string };

/** The `model` field of every request body that names one (the AI routes' per-run
 *  override, PATCH /api/settings/ai): a retired id is accepted and normalized to its
 *  successor, an unknown one is a 400 — so an old client never breaks, and a typo never
 *  reaches the provider. */
export const aiModelIdSchema = z
  .string()
  .transform(normalizeAiModelId)
  .refine((id): id is AiModelId => id !== null, { message: "Unknown AI model" });

/** Merge precedence: request-body override > the user's stored default > the
 * route's own historical hardcoded default (passed in as `fallback`, so every
 * route keeps behaving the same for users who never touch the new setting). */
export async function resolveAiSettings(
  userId: string,
  override: AiSettingsOverride | undefined,
  fallback: AiSettings
): Promise<AiSettings> {
  const overrideModel = override?.model ? normalizeAiModelId(override.model) ?? undefined : undefined;

  if (overrideModel && override?.effort && override.thinking !== undefined) {
    return clampEffort({ model: overrideModel, effort: override.effort, thinking: override.thinking });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { aiModel: true, aiEffort: true, aiThinkingEnabled: true },
  });

  const stored: AiSettings = {
    // A default saved under a retired id keeps resolving (to its successor), not to the fallback.
    model: (user && normalizeAiModelId(user.aiModel)) ?? fallback.model,
    effort: user && isAiEffort(user.aiEffort) ? user.aiEffort : fallback.effort,
    thinking: user?.aiThinkingEnabled ?? fallback.thinking,
  };

  const merged: AiSettings = {
    model: overrideModel ?? stored.model,
    effort: override?.effort ?? stored.effort,
    thinking: override?.thinking ?? stored.thinking,
  };

  return clampEffort(merged);
}

/** A model may be picked with an effort level it doesn't actually support
 * (e.g. a stale stored default from before DeepSeek's catalog restricted it
 * to low/high/max) — clamp DOWN to the nearest supported level, never up. */
function clampEffort(settings: AiSettings): AiSettings {
  return { ...settings, effort: callSiteDefaultEffort(settings.model, settings.effort) };
}

/** The research stage on Anthropic, whatever Claude model the user's default names: the
 *  research is a transcription of published figures, so it does not pay Opus at xhigh. */
export const RESEARCH_AI_SETTINGS: AiSettings = { model: "claude-sonnet-5-5", effort: "high", thinking: true };

/**
 * The settings of one research run (app/api/ai/research): the user's provider decides, the
 * model only on DeepSeek. Resolved like every call site (override > stored default), then an
 * Anthropic provider gets RESEARCH_AI_SETTINGS and a DeepSeek one keeps its model at `high`
 * with thinking on — never `max`: at max DeepSeek spends more search rounds, it does not
 * reason better per round. A user who chose DeepSeek did it for cost or for lack of an
 * Anthropic key, so the research stays on DeepSeek for them. The override lives only in the
 * route body (no selector of its own on /analyze).
 */
export async function researchAiSettings(userId: string, override: AiSettingsOverride | undefined): Promise<AiSettings> {
  const resolved = await resolveAiSettings(userId, override, RESEARCH_AI_SETTINGS);
  if (AI_MODEL_CATALOG[resolved.model].provider === "anthropic") return RESEARCH_AI_SETTINGS;
  return { model: resolved.model, effort: "high", thinking: true };
}
