// Zod schema for the client-submitted GroundingPayload (blocks + extract) — the boundary
// validation for /api/ai/deep-value. Mirrors types/grounding.ts field-for-field; kept in
// one place so the two never silently drift apart.
import { z } from "zod";
import {
  GROUNDING_BLOCK_KINDS,
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_TOTAL_CHARS,
} from "@/types/grounding";

// Re-exported so server code that already imports the schema can take the caps from the
// same module; the canonical definitions live in types/grounding.ts (zod-free, client-safe).
export { GROUNDING_MAX_BLOCK_CHARS, GROUNDING_MAX_BLOCKS, GROUNDING_MAX_TOTAL_CHARS };

const nullableNumber = z.number().nullable();

const groundingMetaSchema = z.object({
  reportingCurrency: z.string().nullable(),
  units: z.enum(["billions", "millions", "thousands", "units"]).nullable(),
  latestPeriodLabel: z.string().nullable(),
  fiscalYearEnd: z.string().nullable(),
});

const financialsRowSchema = z.object({
  fiscalYear: z.number(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  totalEquity: nullableNumber,
  minorityInterest: nullableNumber,
  totalDebt: nullableNumber,
  cashAndEquivalents: nullableNumber,
  netDebt: nullableNumber,
  sharesDiluted: nullableNumber,
  cfo: nullableNumber,
  capex: nullableNumber,
  freeCashFlow: nullableNumber,
  dividendsPerShare: nullableNumber,
});

const multiplesRowSchema = z.object({
  fiscalYear: z.number(),
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  // Basis-reconciliation inputs — nullable + defaulted so extracts produced before these
  // fields existed still parse, with no data migration.
  marketCap: nullableNumber.default(null),
  enterpriseValue: nullableNumber.default(null),
});

const estimateRowSchema = z.object({
  fiscalYear: z.number(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
});

const peerMultiplesSchema = z.object({
  ticker: z.string(),
  companyName: z.string().nullable(),
  multiples: z.array(multiplesRowSchema),
});

const groundedFinancialsSchema = z.object({
  meta: groundingMetaSchema,
  financials: z.array(financialsRowSchema),
  multiples: z.array(multiplesRowSchema),
  estimates: z.array(estimateRowSchema),
  peers: z.array(peerMultiplesSchema),
});

const groundingBlockSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(GROUNDING_BLOCK_KINDS),
    peerTicker: z.string().optional(),
    text: z.string().min(1).max(GROUNDING_MAX_BLOCK_CHARS),
  })
  // A peer block without its ticker can't be attributed: the merge drops it (no key to
  // group under) and the prompt would label it as an anonymous peer — reject it here.
  .refine((b) => b.kind !== "peer_valuation" || (b.peerTicker?.trim().length ?? 0) > 0, {
    message: "A peer_valuation block requires a non-empty peerTicker.",
    path: ["peerTicker"],
  });

/** The client-submitted grounding payload — blocks (for the prompt's raw section) plus
 * the confirmed extract. The route recomputes stats/grid/marketImplied/warnings itself
 * from `extract` + its own authoritative `currentPrice` rather than trusting any
 * client-sent copies (single source of truth, smaller request body).
 *
 * The per-block, total and count caps bound the raw paste injected into the prompt —
 * the same limits the extraction route enforces, so a payload that could not have been
 * extracted cannot be smuggled straight into an Opus xhigh call either. */
export const groundingPayloadSchema = z.object({
  blocks: z
    .array(groundingBlockSchema)
    .max(GROUNDING_MAX_BLOCKS)
    .refine((blocks) => blocks.reduce((sum, b) => sum + b.text.length, 0) <= GROUNDING_MAX_TOTAL_CHARS, {
      message: `Total pasted content exceeds ${GROUNDING_MAX_TOTAL_CHARS} characters.`,
    }),
  extract: groundedFinancialsSchema,
});
