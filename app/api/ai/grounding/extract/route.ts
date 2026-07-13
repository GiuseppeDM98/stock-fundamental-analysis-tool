// POST /api/ai/grounding/extract — transcribes the user's pasted financial-statement
// blocks into structured JSON (Sonnet 5, tools: [] — pure transcription, not judgment;
// the ONLY call site in the whole Grounded feature with web search off, see
// docs/deep-value-grounding-spec.md §5.6/§6.2), merges them, and computes the
// deterministic anchors so the client can render a verifiable preview before spending a
// 30-60s Deep Value run on possibly-mistranscribed data.
//
// One extraction call PER BLOCK, in parallel (Promise.allSettled) — a failed block
// raises a `block_extract_failed` warning instead of sinking the whole request; only a
// total wipeout (zero blocks extracted) fails the request (502, mirroring the earnings
// route's "invalid shape → the model's fault, not the client's").
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import {
  GROUNDING_BLOCK_KINDS,
  type GroundingBlockKind,
  type GroundingMeta,
  type FiscalYearFinancials,
  type FiscalYearMultiples,
  type ForwardEstimate,
} from "@/types/grounding";
import { buildGroundingExtractSystemPrompt, buildGroundingExtractUserPrompt } from "@/lib/ai/grounding-extract-prompt";
import { getAiClient, buildThinkingParam, buildEffortConfig } from "@/lib/ai/client";
import { resolveAiSettings } from "@/lib/ai/ai-preferences";
import { runStreamWithToolLoop } from "@/lib/ai/tool-loop";
import type { AiSettings } from "@/types/ai-settings";
import { mergeExtractedBlocks, type BlockExtractResult } from "@/lib/grounding/merge";
import { checkReconciliation, type ReconciliationWarning } from "@/lib/grounding/reconcile";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied, computeImpliedExpectations } from "@/lib/grounding/anchors";
import { computeBasisReconciliation } from "@/lib/grounding/basis";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-sonnet-5", effort: "medium", thinking: true };

// Mirrors the UI caps in components/grounding-input.tsx — enforced again here since the
// client is never trusted (DEVELOPMENT_GUIDELINES: validate at the system boundary).
const MAX_BLOCK_CHARS = 40000;
const MAX_TOTAL_CHARS = 200000;

const blockSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(GROUNDING_BLOCK_KINDS),
    peerTicker: z.string().min(1).max(20).optional(),
    text: z.string().min(1).max(MAX_BLOCK_CHARS),
  })
  .refine((b) => b.kind !== "peer_valuation" || !!b.peerTicker, {
    message: "peerTicker is required for peer_valuation blocks.",
  });

const requestSchema = z
  .object({
    ticker: z.string().min(1).max(20),
    blocks: z.array(blockSchema).min(1),
  })
  .refine((body) => body.blocks.reduce((sum, b) => sum + b.text.length, 0) <= MAX_TOTAL_CHARS, {
    message: `Total pasted content exceeds ${MAX_TOTAL_CHARS.toLocaleString()} characters.`,
  });

// ─── Per-kind extraction schemas — kept field-for-field in sync with the JSON examples
// in lib/ai/grounding-extract-prompt.ts's KIND_CONFIG. Narrow on purpose: a model call
// for an "income_statement" block literally cannot return a totalDebt value — fewer
// degrees of freedom, less hallucination risk (spec §6.2). ───────────────────────────
const nullableNumber = z.number().nullable();

const metaSchema = z.object({
  reportingCurrency: z.string().min(1).max(10).nullable(),
  units: z.enum(["billions", "millions", "thousands", "units"]).nullable(),
  latestPeriodLabel: z.string().min(1).max(40).nullable(),
  fiscalYearEnd: z.string().min(1).max(40).nullable(),
});

const incomeStatementRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  sharesDiluted: nullableNumber,
  dividendsPerShare: nullableNumber,
});

const balanceSheetRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
  totalEquity: nullableNumber,
  minorityInterest: nullableNumber,
  totalDebt: nullableNumber,
  cashAndEquivalents: nullableNumber,
  netDebt: nullableNumber,
});

const cashFlowRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
  cfo: nullableNumber,
  capex: nullableNumber,
  freeCashFlow: nullableNumber,
});

const multiplesRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  // Basis-reconciliation inputs (spec §2.1) — transcribed only when the paste has its
  // own Market Cap / Enterprise Value column; never computed from other columns (see
  // buildGroundingExtractSystemPrompt's added instruction). Defaulted so older-shaped
  // model output missing the key still parses.
  marketCap: nullableNumber.default(null),
  enterpriseValue: nullableNumber.default(null),
});

const estimateRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
});

// Full FiscalYearFinancials shape — only used by "other", which can't be scoped to one
// statement type. Every field is required-but-nullable so a row is never partially
// shaped (mergeExtractedBlocks depends on that — see lib/grounding/merge.ts).
const fullFinancialsRowSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(2100),
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

const EXTRACTION_SCHEMA_BY_KIND: Record<GroundingBlockKind, z.ZodTypeAny> = {
  income_statement: z.object({ meta: metaSchema, rows: z.array(incomeStatementRowSchema) }),
  balance_sheet: z.object({ meta: metaSchema, rows: z.array(balanceSheetRowSchema) }),
  cash_flow: z.object({ meta: metaSchema, rows: z.array(cashFlowRowSchema) }),
  valuation_multiples: z.object({ meta: metaSchema, rows: z.array(multiplesRowSchema) }),
  estimates: z.object({ meta: metaSchema, rows: z.array(estimateRowSchema) }),
  peer_valuation: z.object({ meta: metaSchema, companyName: z.string().nullable(), rows: z.array(multiplesRowSchema) }),
  other: z.object({
    meta: metaSchema,
    financials: z.array(fullFinancialsRowSchema).optional(),
    multiples: z.array(multiplesRowSchema).optional(),
    estimates: z.array(estimateRowSchema).optional(),
  }),
};

/** Pads a subset row (income/balance/cash-flow, whichever fields that kind's schema
 * asked for) out to the full FiscalYearFinancials shape — nulls for every field the
 * block's kind doesn't cover. Required by mergeExtractedBlocks (lib/grounding/merge.ts),
 * which merges rows from different block kinds by key and expects every row fully shaped. */
function toFullFinancialsRow(row: Record<string, unknown> & { fiscalYear: number }): FiscalYearFinancials {
  return {
    fiscalYear: row.fiscalYear,
    revenue: (row.revenue as number | null) ?? null,
    ebitda: (row.ebitda as number | null) ?? null,
    ebit: (row.ebit as number | null) ?? null,
    netIncome: (row.netIncome as number | null) ?? null,
    eps: (row.eps as number | null) ?? null,
    totalEquity: (row.totalEquity as number | null) ?? null,
    minorityInterest: (row.minorityInterest as number | null) ?? null,
    totalDebt: (row.totalDebt as number | null) ?? null,
    cashAndEquivalents: (row.cashAndEquivalents as number | null) ?? null,
    netDebt: (row.netDebt as number | null) ?? null,
    sharesDiluted: (row.sharesDiluted as number | null) ?? null,
    cfo: (row.cfo as number | null) ?? null,
    capex: (row.capex as number | null) ?? null,
    freeCashFlow: (row.freeCashFlow as number | null) ?? null,
    dividendsPerShare: (row.dividendsPerShare as number | null) ?? null,
  };
}

function toBlockExtractResult(kind: GroundingBlockKind, peerTicker: string | undefined, data: unknown): BlockExtractResult {
  switch (kind) {
    case "income_statement":
    case "balance_sheet":
    case "cash_flow": {
      const d = data as { meta: Partial<GroundingMeta>; rows: (Record<string, unknown> & { fiscalYear: number })[] };
      return { kind, meta: d.meta, financials: d.rows.map(toFullFinancialsRow) };
    }
    case "valuation_multiples": {
      const d = data as { meta: Partial<GroundingMeta>; rows: FiscalYearMultiples[] };
      return { kind, meta: d.meta, multiples: d.rows };
    }
    case "estimates": {
      const d = data as { meta: Partial<GroundingMeta>; rows: ForwardEstimate[] };
      return { kind, meta: d.meta, estimates: d.rows };
    }
    case "peer_valuation": {
      const d = data as { meta: Partial<GroundingMeta>; companyName: string | null; rows: FiscalYearMultiples[] };
      return { kind, peerTicker, peerCompanyName: d.companyName, meta: d.meta, multiples: d.rows };
    }
    case "other": {
      const d = data as {
        meta: Partial<GroundingMeta>;
        financials?: FiscalYearFinancials[];
        multiples?: FiscalYearMultiples[];
        estimates?: ForwardEstimate[];
      };
      return { kind, meta: d.meta, financials: d.financials, multiples: d.multiples, estimates: d.estimates };
    }
  }
}

/** Runs one block's extraction call and returns its merge-ready result. Throws on any
 * failure (no fence found, malformed JSON, schema mismatch) — the caller wraps every
 * block in Promise.allSettled so one bad paste doesn't sink the others. */
async function extractBlock(
  client: Anthropic,
  aiSettings: AiSettings,
  block: { id: string; kind: GroundingBlockKind; peerTicker?: string; text: string }
): Promise<BlockExtractResult> {
  // STREAMING, not client.messages.create() — the Anthropic API requires streaming above
  // a max_tokens threshold on non-streaming calls (to avoid very long synchronous HTTP
  // connections) and rejects the request outright otherwise. Discovered live: raising
  // max_tokens to 64000 here (to fix an intermittent truncation — see below) on the
  // previous non-streaming call made EVERY block fail at once, uniformly, since the
  // rejection happens before any generation starts. Nothing is forwarded to the client —
  // `onTextDelta` just accumulates locally, same shape as the non-streaming `response`
  // used to have, so the parsing logic below is unchanged.
  let allText = "";
  await runStreamWithToolLoop(
    client,
    {
      model: aiSettings.model,
      // Adaptive thinking counts toward this budget even for a "pure transcription" call
      // (AGENTS.md gotcha) — 16k occasionally let the model's reasoning eat enough of the
      // budget to truncate the closing ```json fence mid-object, causing an intermittent
      // (non-deterministic, retry-doesn't-fix-it) JSON.parse failure on an otherwise valid
      // paste. Matched to the Deep Value routes' ceiling — a cap, not a target.
      max_tokens: 64000,
      thinking: buildThinkingParam(aiSettings.thinking),
      output_config: buildEffortConfig(aiSettings.effort),
      system: buildGroundingExtractSystemPrompt({ kind: block.kind }),
      tools: [], // pure transcription — see the module doc comment above
      messages: [
        {
          role: "user",
          content: buildGroundingExtractUserPrompt({ kind: block.kind, text: block.text, peerTicker: block.peerTicker }),
        },
      ],
    },
    (text) => {
      allText += text;
    }
  );

  const match = allText.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error(`Block ${block.id}: no JSON block in the AI response.`);

  const raw = JSON.parse(match[1]); // throws on malformed JSON — caller treats it as a failed block
  const parsed = EXTRACTION_SCHEMA_BY_KIND[block.kind].safeParse(raw);
  if (!parsed.success) throw new Error(`Block ${block.id}: AI returned an invalid shape.`);

  return toBlockExtractResult(block.kind, block.peerTicker, parsed.data);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const aiSettings = await resolveAiSettings(session.user.id, undefined, DEFAULT_SETTINGS);
    const client = getAiClient(aiSettings.model);

    const settled = await Promise.allSettled(body.blocks.map((block) => extractBlock(client, aiSettings, block)));

    const results: BlockExtractResult[] = [];
    const failureWarnings: ReconciliationWarning[] = [];
    settled.forEach((s, index) => {
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        // detail carries the 1-based block position — a language-invariant token, same
        // spirit as the numeric details elsewhere (t() has no interpolation, see
        // lib/grounding/reconcile.ts's i18n note).
        failureWarnings.push({ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: `#${index + 1}` });
      }
    });

    // A total wipeout means there's nothing usable to return — the model's fault, not
    // the client's, mirroring the earnings route's "invalid shape → 502" mapping.
    if (results.length === 0) {
      return NextResponse.json({ error: "AI could not extract any of the pasted blocks." }, { status: 502 });
    }

    const { extract, warnings: mergeWarnings } = mergeExtractedBlocks(results);
    // The basis reconciliation is a property of the PASTE alone (extract.financials +
    // extract.multiples) — computable before any price is known, and needed by every
    // anchor below (spec §1/§2). Compute it once, thread it everywhere.
    const basis = computeBasisReconciliation(extract);
    const reconciliationWarnings = checkReconciliation(extract, basis);

    const stats = computeMultipleStats(extract.multiples);
    const grid = computeValuationGrid(extract, basis);

    // Best-effort live price for the market-implied control — a quote failure (rate
    // limit, delisted) must not fail the whole extraction; it just leaves the
    // price-implied read absent, same as a currency mismatch would.
    let marketImplied = null as ReturnType<typeof computeMarketImplied>;
    let impliedExpectations = null as ReturnType<typeof computeImpliedExpectations>;
    const anchorWarnings: ReconciliationWarning[] = [];
    try {
      const quote = await getQuote(body.ticker);
      marketImplied = computeMarketImplied(quote.regularMarketPrice, quote.currency, extract, basis);
      impliedExpectations = computeImpliedExpectations(quote.regularMarketPrice, quote.currency, extract, basis);

      // computeMarketImplied returns null silently on three distinct conditions (see
      // lib/grounding/anchors.ts) — replicate its own branching order here so the
      // warning we surface always matches the actual reason, never guessed.
      if (!marketImplied) {
        const currencyOk = !!extract.meta.reportingCurrency && extract.meta.reportingCurrency === quote.currency;
        if (!currencyOk) {
          anchorWarnings.push({
            code: "currency_mismatch",
            severity: "warn",
            fiscalYear: null,
            detail: `${extract.meta.reportingCurrency ?? "?"} vs ${quote.currency}`,
          });
        } else {
          const latestFy = extract.financials[extract.financials.length - 1];
          const hasBridgeInputs =
            !!latestFy && latestFy.ebitda != null && latestFy.netDebt != null && latestFy.minorityInterest != null && latestFy.sharesDiluted != null;
          if (!hasBridgeInputs) {
            anchorWarnings.push({
              code: "missing_bridge_inputs",
              severity: "info",
              fiscalYear: latestFy?.fiscalYear ?? null,
              detail: "",
            });
          } else {
            anchorWarnings.push({ code: "no_multiples", severity: "info", fiscalYear: null, detail: "" });
          }
        }
      }
    } catch {
      // Non-fatal — omit the market-implied read and its warning entirely.
    }

    return NextResponse.json({
      extract,
      basis,
      stats,
      grid,
      marketImplied,
      impliedExpectations,
      warnings: [...failureWarnings, ...mergeWarnings, ...reconciliationWarnings, ...anchorWarnings],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed.";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
