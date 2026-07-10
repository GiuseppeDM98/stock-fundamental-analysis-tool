import "server-only";
import { db } from "@/lib/db";
import {
  AI_MODEL_CATALOG,
  isAiEffort,
  isAiModelId,
  type AiSettings,
} from "@/types/ai-settings";

/** Merge precedence: request-body override > the user's stored default > the
 * route's own historical hardcoded default (passed in as `fallback`, so every
 * route keeps behaving the same for users who never touch the new setting). */
export async function resolveAiSettings(
  userId: string,
  override: Partial<AiSettings> | undefined,
  fallback: AiSettings
): Promise<AiSettings> {
  if (override?.model && override?.effort && override.thinking !== undefined) {
    return clampEffort(override as AiSettings);
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { aiModel: true, aiEffort: true, aiThinkingEnabled: true },
  });

  const stored: AiSettings = {
    model: user && isAiModelId(user.aiModel) ? user.aiModel : fallback.model,
    effort: user && isAiEffort(user.aiEffort) ? user.aiEffort : fallback.effort,
    thinking: user?.aiThinkingEnabled ?? fallback.thinking,
  };

  const merged: AiSettings = {
    model: override?.model ?? stored.model,
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
