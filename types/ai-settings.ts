export type AiProvider = "anthropic" | "deepseek";

export const AI_MODEL_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "deepseek-v4-pro",
  "deepseek-flash",
] as const;
export type AiModelId = (typeof AI_MODEL_IDS)[number];

export const AI_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

export interface AiSettings {
  model: AiModelId;
  effort: AiEffort;
  thinking: boolean;
}

export interface AiModelInfo {
  label: string;
  provider: AiProvider;
  efforts: readonly AiEffort[];
  // Whether to declare the web_search tool for this model.
  supportsWebSearch: boolean;
}

export const AI_MODEL_CATALOG: Record<AiModelId, AiModelInfo> = {
  "claude-opus-4-8": {
    label: "Claude Opus 4.8",
    provider: "anthropic",
    efforts: AI_EFFORT_LEVELS,
    supportsWebSearch: true,
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    provider: "anthropic",
    efforts: AI_EFFORT_LEVELS,
    supportsWebSearch: true,
  },
  "claude-sonnet-5-5": {
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    efforts: AI_EFFORT_LEVELS,
    supportsWebSearch: true,
  },
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    // As of the V4-Pro GA update (2026-08-13), DeepSeek maps effort as:
    // low->low, medium->high, high->high, xhigh->high, max->max — "low" is a
    // genuinely distinct (cheaper/faster) level now, so it's offered; medium/xhigh
    // are omitted since they're indistinguishable from high. Verified against
    // https://api-docs.deepseek.com/guides/thinking_mode/ on 2026-08-24.
    efforts: ["low", "high", "max"],
    // DeepSeek's SERVER-SIDE web_search tool call parsing is unreliable through the
    // Anthropic-compat proxy — reproduced in production (Advisor, 2026-07-10): a failed
    // tool-call parse leaked raw internal template syntax ("<｜DSML｜tool_calls>...")
    // straight into the visible streamed chat (no JSON-fence buffer hides it there,
    // unlike Deep Value/verify). Fixed by giving DeepSeek a CLIENT-executed custom
    // web_search tool instead (lib/ai/web-search-tool.ts) — ordinary function-calling,
    // parsed as a normal tool_use block, not DeepSeek's flaky server-tool translation.
    // See lib/ai/tool-loop.ts for the client-side loop.
    // DeepSeek's Search/Fetch REST APIs (2026-10) back the client-executed tool; the
    // Anthropic-compat endpoint still documents no server-side search tool.
    supportsWebSearch: true,
  },
  // DeepSeek retired V4 Flash on 2026-09-10 and routes its old id to V4.1 Flash; since
  // 2026-10-17 `deepseek-flash` is DeepSeek-V4.1-Flash-1017 (same price as Flash).
  "deepseek-flash": {
    label: "DeepSeek V4.1 Flash",
    provider: "deepseek",
    // Same effort mapping as v4-pro (the thinking_mode page of 2026-10-18 lists both) —
    // see the comment on deepseek-v4-pro above.
    efforts: ["low", "high", "max"],
    // Same client-executed web search as v4-pro — see the comment above.
    supportsWebSearch: true,
  },
};

/** Ids the provider retired but still routes: a stored default saved under the old id keeps
 *  working and shows the current name. Empty since 2026-10-29: `deepseek-v4-flash` (V4 Flash,
 *  retired by DeepSeek on 2026-09-10) mapped to `deepseek-flash` until no stored default used it
 *  any more; an unknown stored id falls back to the route default, never reaches the provider. */
export const LEGACY_AI_MODEL_IDS: Record<string, AiModelId> = {};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: "claude-opus-4-8",
  effort: "high",
  thinking: true,
};

export function isAiModelId(value: string): value is AiModelId {
  return (AI_MODEL_IDS as readonly string[]).includes(value);
}

/** The catalog id for `value`, following a retired alias, or null when it is no model at all. */
export function normalizeAiModelId(value: string): AiModelId | null {
  if (isAiModelId(value)) return value;
  return LEGACY_AI_MODEL_IDS[value] ?? null;
}

export function isAiEffort(value: string): value is AiEffort {
  return (AI_EFFORT_LEVELS as readonly string[]).includes(value);
}

/** The effort a call site wants by default when the user has not chosen one for this run:
 *  `preferred` if the model supports it, else the highest supported level BELOW it (never
 *  above: a cheaper fallback, not a pricier one). Until 2026-10 an unsupported level jumped
 *  to the model's top level, so switching a run at xhigh to DeepSeek silently made it max. */
export function callSiteDefaultEffort(model: AiModelId, preferred: AiEffort): AiEffort {
  const supported = AI_MODEL_CATALOG[model].efforts;
  if (supported.includes(preferred)) return preferred;
  const rank = AI_EFFORT_LEVELS.indexOf(preferred);
  for (let i = rank - 1; i >= 0; i--) if (supported.includes(AI_EFFORT_LEVELS[i])) return AI_EFFORT_LEVELS[i];
  return supported[0];
}

/** The Deep Value call sites (the report and the analyst lenses) start at the HIGHER of
 *  the user's global default and xhigh: a valuation is the one task where the deeper pass
 *  is worth its cost, while the global default also drives the Advisor and the earnings
 *  lookup. The user can still lower it per run. */
export function deepValueDefaultEffort(model: AiModelId, globalEffort: AiEffort): AiEffort {
  const preferred = AI_EFFORT_LEVELS.indexOf(globalEffort) > AI_EFFORT_LEVELS.indexOf("xhigh") ? globalEffort : "xhigh";
  return callSiteDefaultEffort(model, preferred);
}
