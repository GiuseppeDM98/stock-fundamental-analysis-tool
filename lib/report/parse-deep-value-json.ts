// Shared parser for the JSON block that both the Deep Value analysis and the analyst
// lenses emit (` ```json … ``` `). Extracted here because the same regex and JSON.parse
// were duplicated across the live panel, the saved-review component and the saved-analysis
// detail page; every surface now goes through this one parser.
//
// Where the block sits (2026-10): the model researches first, then writes the report (or
// critique) and emits the JSON block as the very LAST thing, so the numbers restate what
// the prose already argued and the report can stream from its first heading. Reports saved
// before then carry ONE block at the top. Reading the LAST fence serves both: an older
// report's only block is also its last.
//
// It never throws: an absent or unparseable block yields null, and a parseable one is
// shape-sanitized field by field (see sanitizeDeepValueResult) rather than cast.
import type {
  AnalystResult,
  CrossCheck,
  DividendPath,
  DividendPathYear,
  Scenario,
  Sensitivity,
  SensitivityLever,
  ValuationAssumptions,
  ValuationBridge,
  ValuationUnits,
} from "@/components/report/types";

/** What the parser can prove about a JSON block: every scenario may be missing, because
 *  sanitizeDeepValueResult legitimately drops a malformed one (reproduced on a missing
 *  `bear`, 2026-10-11). Consumers that dereference `.bull/.base/.bear` must narrow through
 *  hasFullTriple first — the compiler refuses a bare dereference on this type. */
export type ParsedAnalystResult = Omit<AnalystResult, "bull" | "base" | "bear"> &
  Partial<Pick<AnalystResult, "bull" | "base" | "bear">>;

/** The ONLY door to any consumer that needs the full triple (ReportShell, the save request,
 *  the analyst PATCH, the gates). */
export function hasFullTriple(result: ParsedAnalystResult | null): result is AnalystResult {
  return !!result && !!result.bull && !!result.base && !!result.bear;
}

// Every fenced JSON block in the text. Kept in sync with stripJsonBlock below — same fence
// convention.
const JSON_BLOCK_RE_GLOBAL = /```json\n([\s\S]*?)\n```/g;

// Sentinel lines the prompts ask the model to write right before the report / the critique
// (lib/ai/deep-value-prompts.ts). Everything before them is research chatter the routes
// discard (lib/ai/stream-gate.ts). A line rather than the `## 1.` heading because it does
// not depend on the report language or on the section numbering. The routes drop the
// marker itself, but stripJsonBlock removes any repeat too: react-markdown renders an HTML
// comment as visible text (no skipHtml), so a stray marker would show on screen.
export const REPORT_START_MARKER = "<!--report-->";
export const CRITIQUE_START_MARKER = "<!--critique-->";

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

/** A lever in percentage points: the prompt asks for 8.5, not 0.085. Anything outside
 *  [-50, 100] is a unit error (a WACC of 850 is basis points), not a judgment to keep. */
function percentagePoints(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== undefined && n >= -50 && n <= 100 ? n : null;
}

/** Each lever is independently nullable; a non-object `assumptions` is dropped whole. */
export function sanitizeAssumptions(raw: unknown): ValuationAssumptions | undefined {
  if (!isObject(raw)) return undefined;
  return {
    wacc: percentagePoints(raw.wacc),
    roic: percentagePoints(raw.roic),
    terminalGrowth: percentagePoints(raw.terminalGrowth),
  };
}

const VALUATION_UNITS = new Set<ValuationUnits>(["billions", "millions", "thousands", "units"]);

/** The declared scale of the bridge figures, or undefined for anything off the list. */
export function sanitizeUnits(raw: unknown): ValuationUnits | undefined {
  return typeof raw === "string" && VALUATION_UNITS.has(raw as ValuationUnits) ? (raw as ValuationUnits) : undefined;
}

/** Exactly three finite numbers, or undefined. */
function finiteTriple(raw: unknown): [number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined;
  const values = raw.map(finiteNumber);
  return values.every((v) => v !== undefined) ? (values as [number, number, number]) : undefined;
}

function sanitizeLever(raw: unknown): SensitivityLever | undefined {
  if (!isObject(raw) || typeof raw.name !== "string" || !raw.name.trim()) return undefined;
  const values = finiteTriple(raw.values);
  return values ? { name: raw.name.trim(), values } : undefined;
}

/** Two named levers with three finite values each and a 3×3 grid of finite numbers; any
 *  defect drops the whole grid — a partial grid can't be checked against the base case. */
export function sanitizeSensitivity(raw: unknown): Sensitivity | undefined {
  if (!isObject(raw)) return undefined;
  const leverA = sanitizeLever(raw.leverA);
  const leverB = sanitizeLever(raw.leverB);
  const grid = raw.intrinsicPerShare;
  if (!leverA || !leverB || !Array.isArray(grid) || grid.length !== 3) return undefined;
  const rows = grid.map(finiteTriple);
  if (!rows.every((row) => row !== undefined)) return undefined;
  return { leverA, leverB, intrinsicPerShare: rows as Sensitivity["intrinsicPerShare"] };
}

function sanitizeDividendYear(raw: unknown): DividendPathYear | undefined {
  if (!isObject(raw)) return undefined;
  const year = finiteNumber(raw.year);
  const bull = finiteNumber(raw.bull);
  const base = finiteNumber(raw.base);
  const bear = finiteNumber(raw.bear);
  if (year === undefined || !Number.isInteger(year)) return undefined;
  if (bull === undefined || base === undefined || bear === undefined || bull < 0 || base < 0 || bear < 0) return undefined;
  return { year, bull, base, bear };
}

/**
 * The declared dividend outlook. `null` stays null — it is the model's statement that the
 * company pays nothing, which a gate reads differently from "not declared" (undefined).
 * An object needs a policy sentence, a finite non-negative lastDps and exactly three valid
 * years; anything else is undefined.
 */
export function sanitizeDividends(raw: unknown): DividendPath | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw) || typeof raw.policy !== "string") return undefined;
  const lastDps = finiteNumber(raw.lastDps);
  if (lastDps === undefined || lastDps < 0) return undefined;
  if (!Array.isArray(raw.path) || raw.path.length !== 3) return undefined;
  const path = raw.path.map(sanitizeDividendYear);
  if (!path.every((year) => year !== undefined)) return undefined;
  return { policy: raw.policy, lastDps, path: path as DividendPath["path"] };
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
 * Presence rules that matter to downstream code and are preserved deliberately:
 * - A bull/base/bear key is set only when that scenario is valid, so the return type
 *   declares all three optional: callers that need the full triple narrow through
 *   hasFullTriple.
 * - `killPrice` is set only when the key was present in the block: its PRESENCE is what
 *   makes lib/grounding/postcheck.ts add the kill_price gate (analyst lenses only). A
 *   present but non-numeric value becomes null — a declared-but-unusable kill price must
 *   still be judged by the gate, not vanish from it.
 * - `dividends` keeps a declared null (a non-payer) apart from an absent or malformed
 *   outlook (no key).
 *
 * @returns the sanitized result, or null when `raw` isn't a JSON object at all.
 */
export function sanitizeDeepValueResult(raw: unknown): ParsedAnalystResult | null {
  if (!isObject(raw)) return null;
  const result: ParsedAnalystResult = {
    method: typeof raw.method === "string" ? raw.method : "",
    sector: typeof raw.sector === "string" ? raw.sector : "",
    currency: typeof raw.currency === "string" ? raw.currency : "",
  };
  const units = sanitizeUnits(raw.units);
  if (units) result.units = units;

  for (const key of ["bull", "base", "bear"] as const) {
    const scenario = sanitizeScenario(raw[key]);
    if (scenario) result[key] = scenario;
  }

  const assumptions = sanitizeAssumptions(raw.assumptions);
  if (assumptions) result.assumptions = assumptions;
  const crossCheck = sanitizeCrossCheck(raw.crossCheck);
  if (crossCheck) result.crossCheck = crossCheck;
  const sensitivity = sanitizeSensitivity(raw.sensitivity);
  if (sensitivity) result.sensitivity = sensitivity;
  const dividends = sanitizeDividends(raw.dividends);
  if (dividends !== undefined) result.dividends = dividends;

  if ("killPrice" in raw) result.killPrice = finiteNumber(raw.killPrice) ?? null;
  if (typeof raw.killPriceNote === "string" && raw.killPriceNote.trim()) result.killPriceNote = raw.killPriceNote.trim();
  const revisions = sanitizeRevisions(raw.revisions);
  if (revisions) result.revisions = revisions;

  return result;
}

function parseFencedBlock(text: string, re: RegExp): ParsedAnalystResult | null {
  const match = text.match(re);
  if (!match) return null;
  try {
    return sanitizeDeepValueResult(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

/**
 * Parse the fair-value JSON block out of a streamed or saved report/review: the LAST
 * fenced ```json block (the final one of a current report, the only one of an older one).
 * @returns the sanitized result (analyst-only fields included when the block carries
 *   them), or null if no block is present or the last one is not a JSON object.
 */
export function parseDeepValueJson(text: string): ParsedAnalystResult | null {
  const matches = [...text.matchAll(JSON_BLOCK_RE_GLOBAL)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  try {
    return sanitizeDeepValueResult(JSON.parse(last[1]));
  } catch {
    return null;
  }
}

/**
 * A client-sent result blob (Analysis.resultJson / *ResultJson), re-read through the same
 * sanitizer as the stream. Shared by the save routes, which store what this returns and
 * never the client's own text.
 * @returns the JSON.stringify'd sanitized result when it carries a full bull/base/bear
 *   triple; null when the text is not JSON, not an object, or incomplete.
 */
export function sanitizeResultJson(text: string): string | null {
  try {
    const result = sanitizeDeepValueResult(JSON.parse(text));
    return hasFullTriple(result) ? JSON.stringify(result) : null;
  } catch {
    return null;
  }
}

/**
 * Remove EVERY fenced ```json block and every occurrence of the start markers, so only the
 * human-readable Markdown is rendered. The ```json-blind fence of a blind-first stream is
 * left alone (stripAnalystStreamArtifacts handles it). No-op on plain prose.
 */
export function stripJsonBlock(text: string): string {
  return text
    .replace(/```json\n[\s\S]*?\n```\n?/g, "")
    .replaceAll(REPORT_START_MARKER, "")
    .replaceAll(CRITIQUE_START_MARKER, "");
}

/**
 * While streaming, a current answer ends with a json fence that stays OPEN until its last
 * chunk: hide everything from the last unclosed "```json" so raw JSON never flashes on
 * screen. A text whose last fence is closed (or that has none) comes back unchanged — which
 * is also how a route tells whether a cut-off stream left a fence open.
 */
export function stripTrailingOpenJsonFence(text: string): string {
  const open = text.lastIndexOf("```json");
  if (open === -1) return text;
  const close = text.indexOf("\n```", open + 7);
  return close === -1 ? text.slice(0, open) : text;
}

// Blind-first analyst lenses fence the Phase-1
// commitment as ```json-blind, deliberately NOT ```json — that string does not match
// JSON_BLOCK_RE_GLOBAL above (there is no literal "```json\n" substring inside
// "```json-blind\n"), so parseDeepValueJson (the last ```json fence) keeps resolving to the
// Phase-2 FINAL block and stripJsonBlock leaves the blind fence alone. A dedicated test in
// __tests__/parse-deep-value-json.test.ts asserts this non-collision explicitly — it is the
// only thing holding this trick together.
const BLIND_JSON_BLOCK_RE = /```json-blind\n([\s\S]*?)\n```/;

/**
 * Parse the Phase-1 (blind) commitment out of a blind-first analyst stream.
 * @returns the sanitized result, or null if no blind block is present or it is malformed.
 */
export function parseBlindJson(text: string): ParsedAnalystResult | null {
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
