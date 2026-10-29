import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  AI_MODEL_CATALOG,
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
 * to high/max) — clamp down to the model's nearest supported level. */
function clampEffort(settings: AiSettings): AiSettings {
  const allowed = AI_MODEL_CATALOG[settings.model].efforts;
  if (allowed.includes(settings.effort)) return settings;
  return { ...settings, effort: allowed[allowed.length - 1] };
}
