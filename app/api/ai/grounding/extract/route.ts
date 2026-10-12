// POST /api/ai/grounding/extract — transcribes the user's pasted financial-statement
// blocks into structured JSON (Sonnet 5.5, tools: [] — pure transcription, not judgment;
// the ONLY call site in the whole Grounded feature with web search off), merges them,
// and computes the deterministic anchors so the client can render a verifiable preview
// before spending a 30-60s Deep Value run on possibly-mistranscribed data.
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
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_TOTAL_CHARS,
  type GroundingBlockKind,
  type GroundingMeta,
  type FiscalYearFinancials,
  type FiscalYearMultiples,
  type ForwardEstimate,
} from "@/types/grounding";
import { buildGroundingExtractSystemPrompt, buildGroundingExtractUserPrompt } from "@/lib/ai/grounding-extract-prompt";
import { EXTRACTION_SCHEMA_BY_KIND } from "@/lib/ai/grounding-extract-schema";
import { getAiClient, buildThinkingParam, buildEffortConfig } from "@/lib/ai/client";
import { runStreamWithToolLoop } from "@/lib/ai/tool-loop";
import { routeErrorStatus } from "@/lib/ai/error-status";
import type { AiSettings } from "@/types/ai-settings";
import { mergeExtractedBlocks, type BlockExtractResult } from "@/lib/grounding/merge";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied, computeImpliedExpectations } from "@/lib/grounding/anchors";
import { computeBasisReconciliation } from "@/lib/grounding/basis";
import { buildBlockFailureWarnings, buildMarketImpliedWarnings } from "@/lib/grounding-warnings";

// Extraction is pure transcription, so it is pinned to Sonnet 5.5 at medium effort and
// deliberately ignores the user's global AI default: an Opus xhigh default would run once
// per pasted block, in parallel, for no gain in transcription accuracy.
const EXTRACT_AI_SETTINGS: AiSettings = { model: "claude-sonnet-5-5", effort: "medium", thinking: true };

// The caps are shared with the client editor and the deep-value payload schema; enforced
// again here since the client is never trusted (validate at the system boundary).
const blockSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(GROUNDING_BLOCK_KINDS),
    peerTicker: z.string().min(1).max(20).optional(),
    text: z.string().min(1).max(GROUNDING_MAX_BLOCK_CHARS),
  })
  .refine((b) => b.kind !== "peer_valuation" || !!b.peerTicker, {
    message: "peerTicker is required for peer_valuation blocks.",
  });

const requestSchema = z
  .object({
    ticker: z.string().min(1).max(20),
    blocks: z.array(blockSchema).min(1).max(GROUNDING_MAX_BLOCKS),
  })
  .refine((body) => body.blocks.reduce((sum, b) => sum + b.text.length, 0) <= GROUNDING_MAX_TOTAL_CHARS, {
    message: `Total pasted content exceeds ${GROUNDING_MAX_TOTAL_CHARS.toLocaleString()} characters.`,
  });

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
  const { stopReason } = await runStreamWithToolLoop(
    client,
    {
      model: aiSettings.model,
      // Adaptive thinking counts toward this budget even for a "pure transcription" call
      // (AGENTS.md gotcha) — 16k occasionally let the model's reasoning eat enough of the
      // budget to truncate the closing ```json fence mid-object, causing an intermittent
      // (non-deterministic, retry-doesn't-fix-it) JSON.parse failure on an otherwise valid
      // paste. Matched to the Deep Value routes' ceiling — a cap, not a target.
      max_tokens: 64000,
      thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model, aiSettings.effort),
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

  // Sonnet 5.5's safety classifiers can decline with HTTP 200 and no text (after the
  // server-side fallback has retried what it can): name it, so the block's warning
  // doesn't read as a malformed paste.
  if (stopReason === "refusal") throw new Error(`Block ${block.id}: the model declined to transcribe this block.`);

  const match = allText.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) {
    throw new Error(
      stopReason === "max_tokens"
        ? `Block ${block.id}: the AI response hit the length limit before the JSON block closed.`
        : `Block ${block.id}: no JSON block in the AI response.`
    );
  }

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
    const aiSettings = EXTRACT_AI_SETTINGS;
    const client = getAiClient(aiSettings.model);

    const settled = await Promise.allSettled(body.blocks.map((block) => extractBlock(client, aiSettings, block)));

    const results: BlockExtractResult[] = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const failureWarnings = buildBlockFailureWarnings(settled);

    // A total wipeout means there's nothing usable to return — the model's fault, not
    // the client's, mirroring the earnings route's "invalid shape → 502" mapping.
    if (results.length === 0) {
      return NextResponse.json({ error: "AI could not extract any of the pasted blocks." }, { status: 502 });
    }

    const { extract, warnings: mergeWarnings } = mergeExtractedBlocks(results);
    // The basis reconciliation is a property of the PASTE alone (extract.financials +
    // extract.multiples) — computable before any price is known, and needed by every
    // anchor below to keep multiples on the same accounting basis. Compute it once,
    // thread it everywhere.
    const basis = computeBasisReconciliation(extract);
    const reconciliationWarnings = checkReconciliation(extract, basis);

    const stats = computeMultipleStats(extract.multiples);
    const grid = computeValuationGrid(extract, basis);

    // Best-effort live price for the market-implied control — a quote failure (rate
    // limit, delisted) must not fail the whole extraction; it just leaves the
    // price-implied read absent, same as a currency mismatch would.
    let marketImplied = null as ReturnType<typeof computeMarketImplied>;
    let impliedExpectations = null as ReturnType<typeof computeImpliedExpectations>;
    let anchorWarnings: ReturnType<typeof buildMarketImpliedWarnings> = [];
    try {
      const quote = await getQuote(body.ticker);
      marketImplied = computeMarketImplied(quote.regularMarketPrice, quote.currency, extract, basis);
      impliedExpectations = computeImpliedExpectations(quote.regularMarketPrice, quote.currency, extract, basis);
      anchorWarnings = buildMarketImpliedWarnings(extract, quote.currency, marketImplied);
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
    const status = routeErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
