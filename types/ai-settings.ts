export type AiProvider = "anthropic" | "deepseek";

export const AI_MODEL_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "deepseek-v4-pro",
  "deepseek-flash",
] as const;
export type AiModelId = (typeof AI_MODEL_IDS)[number];

/** Every effort the API knows. The app sends none above `high` (2026-11-20: a request must
 *  fit the 300 s a function lives on Vercel Hobby): `xhigh` and `max` stay in the list only
 *  so a value stored before the cap is recognised and stepped down. */
export const AI_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

const CLAUDE_EFFORTS = ["low", "medium", "high"] as const satisfies readonly AiEffort[];
const DEEPSEEK_EFFORTS = ["low", "high"] as const satisfies readonly AiEffort[];

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
    efforts: CLAUDE_EFFORTS,
    supportsWebSearch: true,
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    provider: "anthropic",
    efforts: CLAUDE_EFFORTS,
    supportsWebSearch: true,
  },
  "claude-sonnet-5-5": {
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    efforts: CLAUDE_EFFORTS,
    supportsWebSearch: true,
  },
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    // As of the V4-Pro GA update (2026-08-13), DeepSeek maps effort as:
    // low->low, medium->high, high->high, xhigh->high, max->max — "low" is a
    // genuinely distinct (cheaper/faster) level, so it's offered; medium is omitted since
    // it is indistinguishable from high. Verified against
    // https://api-docs.deepseek.com/guides/thinking_mode/ on 2026-08-24. `max` is no longer
    // offered since 2026-11-20: no request of the app runs above `high`.
    efforts: DEEPSEEK_EFFORTS,
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
    efforts: DEEPSEEK_EFFORTS,
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

/** The lower of a run's effort and a phase's ceiling: how one phase is made cheaper than the
 *  rest of its run without touching what the user chose. */
export function capEffort(effort: AiEffort, ceiling: AiEffort): AiEffort {
  return AI_EFFORT_LEVELS.indexOf(effort) > AI_EFFORT_LEVELS.indexOf(ceiling) ? ceiling : effort;
}
