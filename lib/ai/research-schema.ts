// The research stage's output contract: the JSON block the model writes LAST in its answer
// (app/api/ai/research), validated here before anything is stored. The example in the
// prompt (lib/ai/research-prompt.ts) states exactly these keys, and a test keeps the two
// aligned key for key (__tests__/research-contract.test.ts).
//
// Pure, no server-only: the route and the tests share it.
//
// The rule is "a bad source costs that source, not the run": a research run costs about
// a dollar, so one malformed entry in `sources` is dropped by the preprocess and the rows
// citing it read as citing an unknown id, instead of the whole dataset failing. A missing
// nullable field reads as null (the prompt says "null when not found"); a wrong type still
// fails, since it is a sign the block was mangled.
import { z } from "zod";

/** At most this many entries in `sources`: the prompt says so, the preprocess keeps the first ones. */
export const RESEARCH_MAX_SOURCES = 30;

export const RESEARCH_SOURCE_KINDS = ["annual_report", "filing", "press_release", "ir_page", "data_provider", "other"] as const;

const nullableNumber = z.number().nullable().default(null);
const nullableId = z.string().nullable().default(null);
const unitsEnum = z.enum(["billions", "millions", "thousands", "units"]);

/** Free text the UI shows: cut to `max`, never a reason to reject the run. */
const clippedText = (max: number) =>
  z
    .string()
    .nullable()
    .default(null)
    .transform((s) => (s == null ? null : s.slice(0, max)));

const SOURCE_ID_RE = /^.{1,10}$/;
const AS_OF_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export const researchSourceSchema = z.object({
  id: z.string().regex(SOURCE_ID_RE),
  url: z.url({ protocol: /^https?$/ }),
  title: clippedText(200),
  asOf: z.string().regex(AS_OF_RE).nullable().default(null),
  kind: z.enum(RESEARCH_SOURCE_KINDS),
});

const financialsRowSchema = z.object({
  fiscalYear: z.number().int(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  sharesDiluted: nullableNumber,
  dividendsPerShare: nullableNumber,
  totalEquity: nullableNumber,
  minorityInterest: nullableNumber,
  totalDebt: nullableNumber,
  cashAndEquivalents: nullableNumber,
  netDebt: nullableNumber,
  cfo: nullableNumber,
  capex: nullableNumber,
  depreciationAmortization: nullableNumber,
  freeCashFlow: nullableNumber,
  sourceIds: z.object({ income: nullableId, balance: nullableId, cashFlow: nullableId }),
});

const multiplesRowSchema = z.object({
  fiscalYear: z.number().int(),
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  marketCap: nullableNumber,
  enterpriseValue: nullableNumber,
  sourceId: nullableId,
});

const estimateRowSchema = z.object({
  fiscalYear: z.number().int(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  sourceId: nullableId,
});

const peerSchema = z.object({
  ticker: z.string().min(1).max(20),
  companyName: clippedText(120),
  multiples: z.array(multiplesRowSchema).max(3),
});

/** The model's `meta`. Named apart from lib/datasets/parse.ts's researchMetaSchema, which
 *  validates the stored ResearchMeta (model, searches, fetches…), a different object. */
export const researchOutputMetaSchema = z.object({
  reportingCurrency: z.string().min(1).max(10),
  units: unitsEnum.nullable(),
  latestPeriodLabel: clippedText(40),
  fiscalYearEnd: clippedText(40),
  notes: clippedText(500),
});

export const researchOutputSchema = z.object({
  meta: researchOutputMetaSchema,
  sources: z.array(researchSourceSchema).min(1).max(RESEARCH_MAX_SOURCES),
  financials: z.array(financialsRowSchema).min(1).max(8),
  multiples: z.array(multiplesRowSchema).max(8),
  estimates: z.array(estimateRowSchema).max(3),
  peers: z.array(peerSchema).max(6),
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;
export type ResearchSource = ResearchOutput["sources"][number];

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isAbsoluteHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A financials row with at least one figure. A row of nulls is no data: dropping it lets an
 *  answer with no figures at all read as "no financial data found", not as a dataset. */
function hasAnyFigure(row: unknown): boolean {
  if (!isObject(row)) return true; // let the schema reject it
  return Object.entries(row).some(([key, value]) => key !== "fiscalYear" && typeof value === "number");
}

/**
 * Before safeParse. `sources`: an entry whose url is not an absolute http(s) URL or whose id
 * is not 1-10 characters is dropped (a repeated id keeps its first entry), an `asOf` that is
 * not a YYYY[-MM[-DD]] date becomes null, an unknown `kind` becomes "other"; the first
 * RESEARCH_MAX_SOURCES survive. The rows citing a dropped entry get a null source and a
 * `source_unknown_id` warning (lib/ai/research-to-dataset.ts) instead of failing the run.
 * `financials`: rows with no figure are dropped. Anything else passes unchanged, for the
 * schema to judge.
 */
export function preprocessResearchOutput(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };

  if (Array.isArray(raw.sources)) {
    const seenIds = new Set<string>();
    const kinds: readonly string[] = RESEARCH_SOURCE_KINDS;
    out.sources = raw.sources
      .filter((s): s is Record<string, unknown> => isObject(s) && isAbsoluteHttpUrl(s.url) && typeof s.id === "string" && SOURCE_ID_RE.test(s.id))
      .filter((s) => {
        const id = s.id as string;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      })
      .map((s) => ({
        ...s,
        asOf: typeof s.asOf === "string" && AS_OF_RE.test(s.asOf) ? s.asOf : null,
        kind: typeof s.kind === "string" && kinds.includes(s.kind) ? s.kind : "other",
      }))
      .slice(0, RESEARCH_MAX_SOURCES);
  }

  if (Array.isArray(raw.financials)) out.financials = raw.financials.filter(hasAnyFigure);
  return out;
}

/** True when the preprocessed answer carries a `financials` array with no row left: the
 *  route answers "no financial data found", distinct from a malformed block. */
export function hasNoFinancialRows(preprocessed: unknown): boolean {
  return isObject(preprocessed) && Array.isArray(preprocessed.financials) && preprocessed.financials.length === 0;
}
