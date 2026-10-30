// POST /api/ai/research — the research stage: the model collects the company's reported
// financials and historical multiples from primary sources (web search + web fetch) and
// writes them as one JSON block; the route validates it, verifies every cited URL against
// the run's transcript, builds a FinancialDataset with a web source on every row, saves it
// (origin "web") and answers with the dataset and the deterministic reads of its preview.
//
// One request, no stream to the client: the answer is a dataset, not prose, so nothing is
// worth showing before the JSON parses. Position-blind like the valuation: the prompt gets
// the company's name, exchange and trading currency, never the price.
//
// Model (2026-10-18): the user's provider decides (researchAiSettings) — Sonnet 5.5 at high
// on Anthropic, the user's DeepSeek model at high on DeepSeek, whose search and fetch run
// client-side on DeepSeek's Search/Fetch APIs with the same fetch cap applied by the loop.
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { tickerSchema } from "@/lib/ticker";
import { aiModelIdSchema, researchAiSettings } from "@/lib/ai/ai-preferences";
import { buildEffortConfig, buildResearchTools, buildThinkingParam, getAiClient } from "@/lib/ai/client";
import { buildPromptCacheParam, DEEP_RESEARCH_MAX_TOOL_ITERATIONS, runStreamWithToolLoop } from "@/lib/ai/tool-loop";
import { RESEARCH_MAX_FETCHES } from "@/lib/ai/web-search-tool";
import { routeErrorStatus } from "@/lib/ai/error-status";
import { buildResearchSystemPrompt, buildResearchUserPrompt } from "@/lib/ai/research-prompt";
import { hasNoFinancialRows, preprocessResearchOutput, researchOutputSchema } from "@/lib/ai/research-schema";
import { collectSeenUrls } from "@/lib/ai/transcript-urls";
import { researchToDataset } from "@/lib/ai/research-to-dataset";
import { lastJsonFence } from "@/lib/report/parse-deep-value-json";
import { computeDatasetAnchors } from "@/lib/datasets/anchors-bundle";
import { DATASET_WARNING_CODES } from "@/lib/datasets/parse";
import { getFinancialDataset, saveFinancialDataset } from "@/lib/datasets/store";
import { AI_EFFORT_LEVELS, AI_MODEL_CATALOG } from "@/types/ai-settings";
import type { ResearchMeta, ResearchResponse } from "@/types/dataset";

// Hobby's ceiling, as on the other AI routes (SETUP.md's maxDuration table). The research is
// ONE request: a run that needs more than 300 s is cut on the deployment and runs from
// localhost. Measured on 2026-10-30 (durationMs in the log): 245-390 s on Sonnet 5.5,
// 405-796 s on DeepSeek V4 Pro (doc/guide/valutazione.md § 5.3).
export const maxDuration = 300;

const requestSchema = z.object({
  ticker: tickerSchema,
  // The same optional override as /api/ai/deep-value's model/effort/thinking, nested: only
  // the body carries it (/deep-value, tests); /analyze has no research selector of its own.
  aiSettings: z
    .object({
      model: aiModelIdSchema.optional(),
      effort: z.enum(AI_EFFORT_LEVELS).optional(),
      thinking: z.boolean().optional(),
    })
    .optional(),
});

const keptCodes: readonly string[] = DATASET_WARNING_CODES;

function fail(error: string, status = 502): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** The last turn's blocks as "type[:name]", comma-separated: what the model was doing. */
function lastTurnShape(messages: { content: unknown }[]): string {
  const content = messages[messages.length - 1]?.content;
  if (!Array.isArray(content)) return typeof content;
  return content.map((b: { type: string; name?: string }) => (b.name ? `${b.type}:${b.name}` : b.type)).join(",");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const quote = await getQuote(body.ticker);
    const settings = await researchAiSettings(session.user.id, body.aiSettings);
    const provider = AI_MODEL_CATALOG[settings.model].provider;
    const keyPresent = provider === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.DEEPSEEK_API_KEY;
    if (!keyPresent) {
      return fail(provider === "anthropic" ? "research requires the Anthropic API key" : "research requires the DeepSeek API key", 503);
    }

    const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const startedAt = Date.now();
    const result = await runStreamWithToolLoop(
      getAiClient(settings.model),
      {
        model: settings.model,
        // Streaming, so the ceiling cannot hit an HTTP timeout; thinking and the tool rounds'
        // reasoning count toward it. A cap, not a target.
        max_tokens: 64000,
        thinking: buildThinkingParam(true, settings.model, settings.effort),
        output_config: buildEffortConfig(settings.effort),
        system: buildResearchSystemPrompt({ currentDate }),
        tools: buildResearchTools(settings.model),
        messages: [
          {
            role: "user",
            content: buildResearchUserPrompt({ ticker: body.ticker, companyName: quote.shortName, exchange: quote.exchange, quoteCurrency: quote.currency }),
          },
        ],
        // Each resume after a pause_turn re-sends the whole transcript, fetched pages
        // included: the cache makes it pay only the new tokens (Anthropic only, empty on DeepSeek).
        ...buildPromptCacheParam(settings.model),
      },
      () => {},
      DEEP_RESEARCH_MAX_TOOL_ITERATIONS,
      { fetchBudget: RESEARCH_MAX_FETCHES }
    );
    const durationMs = Date.now() - startedAt;
    const seen = collectSeenUrls(result.messages);
    console.log(
      `[research] ${body.ticker} ${settings.model} ${durationMs}ms stop=${result.stopReason} cap=${result.hitIterationCap} ` +
        `searches=${seen.searches} fetches=${seen.fetches} seenUrls=${seen.urls.size} blocksByCaller=${JSON.stringify(seen.blocksByCaller)}`
    );

    // A run that did not end its turn leaves its last blocks in the log, by type and name
    // only: the one way to tell later what the model was doing when it stopped.
    if (result.stopReason !== "end_turn") console.warn(`[research] ${body.ticker} stopped on ${result.stopReason}; last turn: ${lastTurnShape(result.messages)}`);

    if (result.hitIterationCap) return fail("Research ran out of research rounds");
    if (result.stopReason === "max_tokens") return fail("Research truncated: the length limit was reached");
    if (result.stopReason === "refusal") return fail("Research refused by the model");
    // Seen once on Sonnet 5.5 (2026-10-30, 1 of the 5 Claude runs): the turn ended on
    // "tool_use" with only server tools declared, after 7 searches and 7 fetches and no JSON.
    // Nothing in the transcript can be answered, so the run is a failure to retry, not an
    // invalid dataset.
    if (result.stopReason === "tool_use") return fail("Research stopped on a tool call: run it again");

    const fence = lastJsonFence(result.text);
    let raw: unknown;
    try {
      raw = fence == null ? undefined : JSON.parse(fence);
    } catch {
      raw = undefined;
    }
    const preprocessed = preprocessResearchOutput(raw);
    if (hasNoFinancialRows(preprocessed)) return fail("No financial data found");
    const parsed = researchOutputSchema.safeParse(preprocessed);
    if (!parsed.success) return fail("Research returned an invalid dataset");

    const { extract, unverified, warnings: researchWarnings } = researchToDataset(parsed.data, seen.urls);
    if (extract.financials.length === 0) return fail("No financial data found");

    const research: ResearchMeta = {
      model: settings.model,
      servedBy: result.servedBy,
      effort: settings.effort,
      searches: seen.searches,
      fetches: seen.fetches,
      durationMs,
      unverifiedSources: unverified,
      notes: parsed.data.meta.notes,
    };
    const datasetId = await saveFinancialDataset(session.user.id, {
      ticker: body.ticker,
      origin: "web",
      dataset: extract,
      blocks: null,
      warnings: researchWarnings.filter((w) => keptCodes.includes(w.code)),
      research,
    });
    // Read back what was stored: the answer is the row as every later reader will see it,
    // and a row that would not parse is caught here instead of at the next reuse.
    const stored = await getFinancialDataset(session.user.id, datasetId);
    if (!stored) return fail("Research dataset could not be read back", 500);

    const anchors = computeDatasetAnchors(stored.dataset, { price: quote.regularMarketPrice, currency: quote.currency });
    const response: ResearchResponse = {
      datasetId,
      dataset: stored.dataset,
      basis: anchors.basis,
      stats: anchors.stats,
      grid: anchors.grid,
      marketImplied: anchors.marketImplied,
      impliedExpectations: anchors.impliedExpectations,
      warnings: [...stored.warnings, ...anchors.warnings],
      research,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
    return NextResponse.json({ error: message }, { status: routeErrorStatus(error) });
  }
}
