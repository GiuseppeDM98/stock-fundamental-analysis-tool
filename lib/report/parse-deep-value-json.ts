// Shared parser for the leading JSON block that both the Deep Value analysis and the
// Analyst Review emit (` ```json … ``` `). Extracted here because the same regex and
// JSON.parse were duplicated across the live panel, the saved-review component, and
// (with extra type-guards) the saved-analysis detail page — the reviewer's own JSON
// pushed the count past the rule-of-three, so it lives in one place now.
//
// It never throws: an absent or unparseable block yields null, and a parseable one is
// shape-sanitized field by field (see sanitizeDeepValueResult) rather than cast. The saved
// detail page keeps its own stricter parser, which rejects the whole block unless
// method/sector/currency and all three fair values are present.
import type {
  AnalystResult,
  CrossCheck,
  Scenario,
  ValuationAssumptions,
  ValuationBridge,
} from "@/components/report/types";

// Matches the fenced JSON block anywhere in the text (the stream may carry preamble in
// degraded cases). Kept in sync with stripJsonBlock below — same fence convention.
const JSON_BLOCK_RE = /```json\n([\s\S]*?)\n```/;

// ─── Shape sanitization ────────────────────────────────────────────────────────────
// The JSON block is untrusted model output: a field can be null, a string, an array or
// simply missing, and a bare `as DeepValueResult` cast would carry that garbage into the
// deterministic gates and the UI (where a `.toFixed` on a string throws mid-render). The
// rule below is "drop, never repair": a malformed optional sub-object becomes undefined,
// so every consumer degrades to its "not declared" path instead of computing on a wrong
// type. Nothing is coerced (no "12.5" → 12.5): a number that arrives as a string is a
// sign the block was mangled, and silently accepting it would hide that.

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The fields every bridge shares (scenario and cross-check alike). Any required numeric
 *  field that isn't a finite number invalidates the whole bridge — a bridge with one
 *  missing term can't be recomputed, and a partial one would read as verified. */
function sanitizeBridgeCore(raw: unknown): Omit<ValuationBridge, "intrinsicPerShare"> | undefined {
  if (!isObject(raw)) return undefined;
  const driverValue = finiteNumber(raw.driverValue);
  const driverYear = finiteNumber(raw.driverYear);
  const netDebt = finiteNumber(raw.netDebt);
  const minorities = finiteNumber(raw.minorities);
  const shares = finiteNumber(raw.shares);
  if (driverValue === undefined || driverYear === undefined || netDebt === undefined || minorities === undefined || shares === undefined) {
    return undefined;
  }
  const bridge: Omit<ValuationBridge, "intrinsicPerShare"> = {
    driver: typeof raw.driver === "string" ? raw.driver : "",
    driverValue,
    driverYear,
    netDebt,
    minorities,
    shares,
  };
  // `multiple` is legitimately absent for DCF/DDM — an invalid one is treated the same.
  const multiple = finiteNumber(raw.multiple);
  if (multiple !== undefined) bridge.multiple = multiple;
  return bridge;
}

function sanitizeScenarioBridge(raw: unknown): ValuationBridge | undefined {
  const core = sanitizeBridgeCore(raw);
  const intrinsicPerShare = isObject(raw) ? finiteNumber(raw.intrinsicPerShare) : undefined;
  if (!core || intrinsicPerShare === undefined) return undefined;
  return { ...core, intrinsicPerShare };
}

/**
 * Validates one bull/base/bear entry. A scenario without a finite `fairValue` is not a
 * scenario at all and is dropped (undefined); its optional `probability`/`bridge` are
 * dropped individually when malformed.
 */
export function sanitizeScenario(raw: unknown): Scenario | undefined {
  if (!isObject(raw)) return undefined;
  const fairValue = finiteNumber(raw.fairValue);
  if (fairValue === undefined) return undefined;
  const scenario: Scenario = { fairValue };
  const probability = finiteNumber(raw.probability);
  if (probability !== undefined) scenario.probability = probability;
  const bridge = sanitizeScenarioBridge(raw.bridge);
  if (bridge) scenario.bridge = bridge;
  return scenario;
}

/** Each lever is independently nullable; a non-object `assumptions` is dropped whole. */
export function sanitizeAssumptions(raw: unknown): ValuationAssumptions | undefined {
  if (!isObject(raw)) return undefined;
  return {
    wacc: finiteNumber(raw.wacc) ?? null,
    roic: finiteNumber(raw.roic) ?? null,
    terminalGrowth: finiteNumber(raw.terminalGrowth) ?? null,
  };
}

/** A cross-check needs a method name and a finite intrinsic to mean anything; its own
 *  bridge is optional and dropped independently when malformed. */
export function sanitizeCrossCheck(raw: unknown): CrossCheck | undefined {
  if (!isObject(raw)) return undefined;
  const intrinsicPerShare = finiteNumber(raw.intrinsicPerShare);
  if (typeof raw.method !== "string" || intrinsicPerShare === undefined) return undefined;
  const crossCheck: CrossCheck = {
    method: raw.method,
    intrinsicPerShare,
    reconciliation: typeof raw.reconciliation === "string" ? raw.reconciliation : "",
  };
  const bridge = sanitizeBridgeCore(raw.bridge);
  if (bridge) crossCheck.bridge = bridge;
  return crossCheck;
}

const REVISION_SCENARIOS = new Set(["bull", "base", "bear"]);

function sanitizeRevisions(raw: unknown): AnalystResult["revisions"] {
  if (!Array.isArray(raw)) return undefined;
  const revisions: NonNullable<AnalystResult["revisions"]> = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const from = finiteNumber(entry.from);
    const to = finiteNumber(entry.to);
    if (typeof entry.scenario !== "string" || !REVISION_SCENARIOS.has(entry.scenario) || from === undefined || to === undefined) continue;
    revisions.push({
      scenario: entry.scenario as "bull" | "base" | "bear",
      from,
      to,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  return revisions;
}

/**
 * Rebuilds a parsed JSON block into a well-typed result, keeping only fields whose shape
 * is valid (see the section comment above). Never throws.
 *
 * Two presence rules matter to downstream code and are preserved deliberately:
 * - A bull/base/bear key is set only when that scenario is valid. The type still declares
 *   all three (they are the contract), so callers that need the full triple must check —
 *   as the saved-detail page and the blind-commitment picker already do.
 * - `killPrice` is set only when the key was present in the block: its PRESENCE is what
 *   makes lib/grounding/postcheck.ts add the kill_price gate (analyst lenses only). A
 *   present but non-numeric value becomes null — a declared-but-unusable kill price must
 *   still be judged by the gate, not vanish from it.
 *
 * @returns the sanitized result, or null when `raw` isn't a JSON object at all.
 */
export function sanitizeDeepValueResult(raw: unknown): AnalystResult | null {
  if (!isObject(raw)) return null;
  const result = {
    method: typeof raw.method === "string" ? raw.method : "",
    sector: typeof raw.sector === "string" ? raw.sector : "",
    currency: typeof raw.currency === "string" ? raw.currency : "",
  } as AnalystResult;

  for (const key of ["bull", "base", "bear"] as const) {
    const scenario = sanitizeScenario(raw[key]);
    if (scenario) result[key] = scenario;
  }

  const assumptions = sanitizeAssumptions(raw.assumptions);
  if (assumptions) result.assumptions = assumptions;
  const crossCheck = sanitizeCrossCheck(raw.crossCheck);
  if (crossCheck) result.crossCheck = crossCheck;

  if ("killPrice" in raw) result.killPrice = finiteNumber(raw.killPrice) ?? null;
  if (typeof raw.killPriceNote === "string" && raw.killPriceNote.trim()) result.killPriceNote = raw.killPriceNote.trim();
  const revisions = sanitizeRevisions(raw.revisions);
  if (revisions) result.revisions = revisions;

  return result;
}

function parseFencedBlock(text: string, re: RegExp): AnalystResult | null {
  const match = text.match(re);
  if (!match) return null;
  try {
    return sanitizeDeepValueResult(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

/**
 * Parse the fair-value JSON block out of a streamed report/review.
 * @returns the sanitized result (analyst-only fields included when the block carries
 *   them), or null if no block is present or it is not a JSON object.
 */
export function parseDeepValueJson(text: string): AnalystResult | null {
  return parseFencedBlock(text, JSON_BLOCK_RE);
}

/**
 * Remove the leading JSON block so only the human-readable Markdown is rendered.
 * No-op when the text carries no block.
 */
export function stripJsonBlock(text: string): string {
  return text.replace(/```json\n[\s\S]*?\n```\n?/, "");
}

// Blind-first analyst lenses fence the Phase-1
// commitment as ```json-blind, deliberately NOT ```json — that string does not match
// JSON_BLOCK_RE above (there is no literal "```json\n" substring inside "```json-blind\n"),
// so parseDeepValueJson/stripJsonBlock keep resolving to the Phase-2 FINAL block with zero
// code changes. A dedicated test in __tests__/parse-deep-value-json.test.ts asserts this
// non-collision explicitly — it is the only thing holding this trick together.
const BLIND_JSON_BLOCK_RE = /```json-blind\n([\s\S]*?)\n```/;

/**
 * Parse the Phase-1 (blind) commitment out of a blind-first analyst stream.
 * @returns the sanitized result, or null if no blind block is present or it is malformed.
 */
export function parseBlindJson(text: string): AnalystResult | null {
  return parseFencedBlock(text, BLIND_JSON_BLOCK_RE);
}

/** Phase markers the verify route enqueues around the blind-first turn boundary — never
 *  forwarded as visible text, only used by the client to switch the streaming status
 *  label (see currentAnalystPhase below). */
export const ANALYST_PHASE_MARKERS = {
  blind: "<!--analyst:phase=blind-->",
  reconcile: "<!--analyst:phase=reconcile-->",
} as const;

/**
 * Which blind-first phase the stream is currently in, based on the LAST marker seen so
 * far — null when neither marker has appeared yet (a non-blind-first review, or the blind
 * turn hasn't started enqueuing).
 */
export function currentAnalystPhase(text: string): "blind" | "reconcile" | null {
  const blindIdx = text.lastIndexOf(ANALYST_PHASE_MARKERS.blind);
  const reconcileIdx = text.lastIndexOf(ANALYST_PHASE_MARKERS.reconcile);
  if (reconcileIdx > blindIdx) return "reconcile";
  if (blindIdx !== -1) return "blind";
  return null;
}

/**
 * Strips the phase markers and the ```json-blind fence (Phase-1 commitment + rationale)
 * from a blind-first stream, leaving only the FINAL JSON block + critique for
 * stripJsonBlock to then process normally. No-op on a stream with neither artifact.
 */
export function stripAnalystStreamArtifacts(text: string): string {
  return text
    .replace(ANALYST_PHASE_MARKERS.blind, "")
    .replace(ANALYST_PHASE_MARKERS.reconcile, "")
    .replace(/```json-blind\n[\s\S]*?\n```\n?/, "");
}
