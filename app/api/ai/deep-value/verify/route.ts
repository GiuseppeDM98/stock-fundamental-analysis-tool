// POST /api/ai/deep-value/verify — one independent analyst-panel pass over a completed
// report. A fresh-context Opus pass that reviews the saved Deep Value report through one
// LENS (skeptic / optimist / quality — see `angle`): it stress-tests numbers/assumptions
// and spot-checks figures via web search. It streams a leading JSON block with the
// analyst's OWN bull/base/bear valuation (same MoS-adjusted unit as the base analysis, so
// the base + every analyst can be averaged into a consensus) followed by the plain-Markdown
// critique. The lens only swaps persona/focus in the prompt — path and streaming machinery
// are identical, so all three analysts reuse this one route.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuote } from "@/lib/yahoo-client";
import { ANALYST_ANGLES } from "@/types/analysis";
import type { GroundingPayload } from "@/types/grounding";
import {
  buildAnalystSystemPrompt,
  buildAnalystUserPrompt,
  buildAnalystBlindUserPrompt,
  buildAnalystReconcileUserPrompt,
} from "@/lib/ai/deep-value-prompts";
import { getAiClient, buildThinkingParam, buildEffortConfig, buildWebSearchTools } from "@/lib/ai/client";
import { resolveAiSettings } from "@/lib/ai/ai-preferences";
import {
  runStreamWithToolLoop,
  buildPromptCacheParam,
  DEEP_RESEARCH_MAX_TOOL_ITERATIONS,
  GROUNDED_MAX_TOOL_ITERATIONS,
  RECONCILE_MAX_TOOL_ITERATIONS,
} from "@/lib/ai/tool-loop";
import { fallbackNote } from "@/lib/ai/fallback";
import { routeErrorStatus } from "@/lib/ai/error-status";
import { AI_MODEL_IDS, AI_EFFORT_LEVELS, type AiSettings } from "@/types/ai-settings";
import { buildGroundingPromptContext, formatGatesForPrompt, type GroundingPromptContext } from "@/lib/grounding/prompt-format";
import { parseDeepValueJson, ANALYST_PHASE_MARKERS } from "@/lib/report/parse-deep-value-json";
import { pickBlindCommitment } from "@/lib/ai/blind-commitment";
import { checkValuationBridges, type BridgeCheckInput } from "@/lib/grounding/postcheck";

const DEFAULT_SETTINGS: AiSettings = { model: "claude-opus-4-8", effort: "xhigh", thinking: true };

// Doubles the wall clock of the app's longest route: the blind-first flow (grounding
// present) pays for two full turns, the second of which replays the first turn's
// thinking as input. Vercel's builder rejects any maxDuration above what the *currently
// deployed* plan allows: Hobby with Fluid Compute caps it at 300 (see SETUP.md's
// maxDuration table), so 800 (the Pro ceiling) fails to build on Hobby. A run past 300s
// is a declared limit of the project, run from localhost (2026-10-20). Bump this back to
// 800 only after upgrading to Pro.
export const maxDuration = 300;

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  reportMd: z.string().min(1).max(60000),
  language: z.string().min(1).max(30).default("English"),
  // Which analyst lens is reviewing. Defaults to "skeptic" — the original red-team pass —
  // so older clients that omit it keep their existing behavior.
  angle: z.enum(ANALYST_ANGLES as [string, ...string[]]).default("skeptic"),
  // Applied to the analyst's own fair values so its JSON buy targets match the unit
  // of the base analysis (MoS-adjusted) and they can be averaged into a consensus.
  // Overridden by the saved analysis's own mosPercent when analysisId resolves (below).
  mosPercent: z.number().min(0).max(80).default(0),
  model: z.enum(AI_MODEL_IDS).optional(),
  effort: z.enum(AI_EFFORT_LEVELS).optional(),
  thinking: z.boolean().optional(),
  // When present, grounds this lens the same way as the base analysis: the route
  // re-reads Analysis.groundingJson (never trusts a client-sent copy) rather
  // than accepting the payload in the body, which would be 100-200KB per lens.
  analysisId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    // Inject the real current date so Claude doesn't anchor to its training year.
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Fetch the authoritative live price so the reviewer treats it as ground truth
    // instead of "correcting" it with stale web-searched quotes (a real failure mode:
    // it once flagged a correct price as overstated using month-old quotes). Best-effort
    // — if the quote fails (rate limit, delisted), the review proceeds without it.
    let currentPrice: number | undefined;
    let currency = "";
    try {
      const quote = await getQuote(body.ticker);
      currentPrice = quote.regularMarketPrice;
      currency = quote.currency ?? "";
    } catch {
      // Non-fatal — omit the authoritative-price clause and let the review run.
    }

    // Ground this lens the same way as the base analysis, re-read from the DB (never
    // the request body). The saved analysis's own mosPercent is authoritative
    // once we're reading the row anyway, so it overrides whatever the client sent —
    // avoids the lens computing its fair values at a stale client-side MoS.
    let groundingContext: GroundingPromptContext | undefined;
    let effectiveMosPercent = body.mosPercent;
    // Deterministic gates already run against the BASE report's own declared bridge,
    // formatted for the RECONCILE-phase user message (ANALYST_STRUCTURAL_CHECKS #6 in
    // lib/ai/deep-value-prompts.ts — "the lens must address every FAIL explicitly").
    // Undefined when ungrounded, the base report's JSON doesn't parse, or price/currency
    // didn't resolve — the reconcile prompt simply omits the section in that case.
    let baseGatesText: string | undefined;
    if (body.analysisId) {
      const analysis = await db.analysis.findFirst({
        where: { id: body.analysisId, userId: session.user.id },
        select: { groundingJson: true, mosPercent: true, reportMd: true },
      });
      if (analysis) {
        effectiveMosPercent = analysis.mosPercent;
        if (analysis.groundingJson) {
          try {
            const payload = JSON.parse(analysis.groundingJson) as GroundingPayload;
            // Lenses get extract + anchors + warnings, never the raw paste — see the
            // doc comment on buildAnalystUserPrompt's `grounding` param for why.
            groundingContext = buildGroundingPromptContext([], payload.extract, currentPrice ?? null, currency);

            const baseResult = parseDeepValueJson(analysis.reportMd);
            if (baseResult && currentPrice != null && currency) {
              const basePostCheck = checkValuationBridges(
                baseResult as BridgeCheckInput,
                effectiveMosPercent,
                currentPrice,
                currency,
                groundingContext.extract
              );
              if (basePostCheck) baseGatesText = formatGatesForPrompt(basePostCheck.gates);
            }
          } catch {
            // Malformed/legacy groundingJson — proceed ungrounded rather than fail the review.
          }
        }
      }
    }

    // Grounded ⇒ blind-first: the lens commits blind, THEN sees the report.
    // Never true without grounding — there is no independent data to commit to otherwise.
    const blindFirst = groundingContext != null;

    const angle = body.angle as (typeof ANALYST_ANGLES)[number];
    const systemPrompt = buildAnalystSystemPrompt({
      angle,
      language: body.language,
      currentDate,
      mosPercent: effectiveMosPercent,
      grounding: groundingContext,
      blindFirst,
    });
    const isItalian = body.language === "Italiano" || body.language === "Italian";

    const aiSettings = await resolveAiSettings(
      session.user.id,
      body.model ? { model: body.model, effort: body.effort ?? DEFAULT_SETTINGS.effort, thinking: body.thinking ?? DEFAULT_SETTINGS.thinking } : undefined,
      DEFAULT_SETTINGS
    );
    const client = getAiClient(aiSettings.model);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (!blindFirst) {
            // Ungrounded — the single-turn review. Kept separate from the blind-first path
            // on purpose: without pasted data a lens has nothing to commit to blind.
            const userPrompt = buildAnalystUserPrompt({
              angle,
              ticker: body.ticker,
              reportMd: body.reportMd,
              language: body.language,
              currentDate,
              currentPrice,
              currency,
              mosPercent: effectiveMosPercent,
              grounding: groundingContext,
            });

            // Buffer text before the JSON block to suppress reasoning text Claude emits
            // between web-search tool calls; only forward once ```json is seen. Mirrors
            // the Deep Value route now that the reviewer leads with its own valuation JSON.
            let jsonBlockStarted = false;
            let preJsonBuffer = "";

            const { stopReason, hitIterationCap, servedBy } = await runStreamWithToolLoop(
              client,
              {
                model: aiSettings.model,
                // 16k was too low: with xhigh adaptive thinking + web search, the reasoning
                // tokens (which count toward max_tokens) consumed almost the whole budget
                // before the visible critique finished, so a real review truncated mid-word
                // with stop_reason "max_tokens". Matched to the Deep Value route's 64k for a
                // wide anti-truncation margin. Ceiling, not target — normal replies still
                // stop at end_turn and cost the same. Streaming, so no HTTP-timeout risk.
                max_tokens: 64000,
                thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model, aiSettings.effort),
                output_config: buildEffortConfig(aiSettings.effort),
                system: systemPrompt,
                tools: buildWebSearchTools(aiSettings.model),
                messages: [{ role: "user", content: userPrompt }],
              },
              (text) => {
                if (!jsonBlockStarted) {
                  preJsonBuffer += text;
                  const jsonIdx = preJsonBuffer.indexOf("```json");
                  if (jsonIdx !== -1) {
                    jsonBlockStarted = true;
                    controller.enqueue(new TextEncoder().encode(preJsonBuffer.slice(jsonIdx)));
                    preJsonBuffer = "";
                  }
                  // Silently discard pre-JSON reasoning text.
                } else {
                  controller.enqueue(new TextEncoder().encode(text));
                }
              },
              // Ungrounded here means groundingContext is always undefined — always the
              // heavy research cap (the rescoped GROUNDED cap only applies to the
              // blind-first branch below now).
              DEEP_RESEARCH_MAX_TOOL_ITERATIONS
            );

            // Failsafe: if the model never emitted a JSON fence (e.g. it opened straight
            // into prose), flush the buffered text so the critique is not swallowed.
            if (!jsonBlockStarted && preJsonBuffer) {
              controller.enqueue(new TextEncoder().encode(preJsonBuffer));
            }

            // Surface a hard token-cap cutoff instead of truncating silently — a clean
            // mid-word cut is indistinguishable from a normal end. Mirrors /api/ai/advisor.
            if (stopReason === "max_tokens") {
              const note = isItalian
                ? "_[Revisione troncata: raggiunto il limite di lunghezza. Riavviala per rigenerarla.]_"
                : "_[Review truncated: length limit reached. Re-run it to regenerate.]_";
              controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
            } else if (stopReason === "refusal") {
              const note = isItalian
                ? "_[Il modello ha rifiutato questa revisione. Riavviala o scegli un altro modello.]_"
                : "_[The model declined this review. Re-run it or pick another model.]_";
              controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
            } else if (hitIterationCap) {
              const note = isItalian
                ? "_[Revisione interrotta: troppi cicli di ricerca web. Riavviala per rigenerarla.]_"
                : "_[Review stopped: too many web search rounds. Re-run it to regenerate.]_";
              controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
            }
            // The server-side refusal fallback (Sonnet 5.5) wrote this review with another
            // model: name it, so the saved critique is not attributed to the requested one.
            if (servedBy) {
              controller.enqueue(new TextEncoder().encode(`\n\n${fallbackNote(aiSettings.model, servedBy, isItalian)}`));
            }
            return;
          }

          // Grounded ⇒ blind-first, two turns. Flush the phase marker
          // immediately — also flushes response headers, which matters against a timeout
          // on a route that can now legitimately run for minutes.
          controller.enqueue(new TextEncoder().encode(ANALYST_PHASE_MARKERS.blind));

          const blindUserPrompt = buildAnalystBlindUserPrompt({
            ticker: body.ticker,
            language: body.language,
            currentDate,
            currentPrice,
            currency,
            mosPercent: effectiveMosPercent,
            grounding: groundingContext!,
          });

          const turn1 = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              // Ceiling, not target: Phase 1 is a JSON block + a ≤200-word rationale, not
              // a full critique — capped below the single-phase 64k since this turn's
              // thinking gets replayed as input into turn 2 (it can't be stripped).
              max_tokens: 32000,
              thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model, aiSettings.effort),
              output_config: buildEffortConfig(aiSettings.effort),
              system: systemPrompt,
              tools: buildWebSearchTools(aiSettings.model),
              messages: [{ role: "user", content: blindUserPrompt }],
              // Writes the turn-1 prefix (system + this user message) to the prompt cache
              // so turn 2, seconds later, can read it back — unlike this app's other AI
              // calls, which never get a second hit inside the cache TTL. Turn 2 must send
              // the same param: a read only happens at a breakpoint in the current request.
              ...buildPromptCacheParam(aiSettings.model),
            },
            () => {
              // Accumulate only — never forwarded. Half of Phase 1's text would read as
              // "I don't see the report yet, so..."; it's an internal artifact until it's
              // parsed and re-emitted (relabeled) below.
            },
            GROUNDED_MAX_TOOL_ITERATIONS
          );

          // A refused Phase 1 (pre-output, or mid-stream after a partial block) is never
          // trusted as a commitment: it degrades to the single-phase review below, which
          // also lets turn 2 start without the refused transcript.
          const blindCommitment = turn1.stopReason === "refusal" ? null : pickBlindCommitment(turn1.text);

          let turn2UserPrompt: string;
          if (blindCommitment) {
            // Forward ONLY the commitment, re-fenced as ```json-blind (never ```json, which
            // would collide with the FINAL block's fence once turn 2 streams). Turn 1's
            // surrounding prose — reasoning before the block, the rationale after it —
            // stays server-side: the client strips only the fenced block, so anything
            // else would land in the visible critique and the saved *CritiqueMd.
            // Forwarding it now lets the client's blind card render while turn 2 works.
            const blindResult = blindCommitment.result;
            controller.enqueue(new TextEncoder().encode(blindCommitment.fenced));

            turn2UserPrompt = buildAnalystReconcileUserPrompt({
              ticker: body.ticker,
              reportMd: body.reportMd,
              language: body.language,
              currentDate,
              mosPercent: effectiveMosPercent,
              blind: { bear: blindResult.bear.fairValue, base: blindResult.base.fairValue, bull: blindResult.bull.fairValue },
              gatesText: baseGatesText,
            });
          } else {
            // Degraded Phase 1 (max_tokens, a refusal, prose, an unresolved pause, or
            // unparseable JSON) — don't abort and don't pay a third turn: fall through to
            // a normal single-phase review for turn 2. No blind fence is sent, so the
            // client shows no blind card and nothing is persisted as blindJson.
            turn2UserPrompt = buildAnalystUserPrompt({
              angle,
              ticker: body.ticker,
              reportMd: body.reportMd,
              language: body.language,
              currentDate,
              currentPrice,
              currency,
              mosPercent: effectiveMosPercent,
              grounding: groundingContext,
            });
          }

          controller.enqueue(new TextEncoder().encode(ANALYST_PHASE_MARKERS.reconcile));

          let jsonBlockStarted = false;
          let preJsonBuffer = "";

          const turn2 = await runStreamWithToolLoop(
            client,
            {
              model: aiSettings.model,
              max_tokens: 64000,
              thinking: buildThinkingParam(aiSettings.thinking, aiSettings.model, aiSettings.effort),
              output_config: buildEffortConfig(aiSettings.effort),
              system: systemPrompt,
              tools: buildWebSearchTools(aiSettings.model),
              // The FULL turn-1 transcript, verbatim, with the same model and tools — never
              // a stripped-down history: dropped thinking blocks or an orphaned tool_use/
              // server_tool_use block is rejected with a 400. Except after a turn-1
              // refusal: its assistant turn can be empty, which the API rejects as history,
              // and the degraded single-phase prompt above stands on its own — so turn 2
              // starts fresh instead.
              messages:
                turn1.stopReason === "refusal"
                  ? [{ role: "user", content: turn2UserPrompt }]
                  : [...turn1.messages, { role: "user", content: turn2UserPrompt }],
              // Same breakpoint as turn 1 — this is what actually lets turn 2 read the
              // cached turn-1 prefix (and caches the longer prefix for any resumed round).
              ...buildPromptCacheParam(aiSettings.model),
            },
            (text) => {
              if (!jsonBlockStarted) {
                preJsonBuffer += text;
                const jsonIdx = preJsonBuffer.indexOf("```json");
                if (jsonIdx !== -1) {
                  jsonBlockStarted = true;
                  controller.enqueue(new TextEncoder().encode(preJsonBuffer.slice(jsonIdx)));
                  preJsonBuffer = "";
                }
                // Silently discard pre-JSON reasoning text.
              } else {
                controller.enqueue(new TextEncoder().encode(text));
              }
            },
            // Reconciliation, not research — far fewer rounds needed than either
            // research cap.
            RECONCILE_MAX_TOOL_ITERATIONS
          );

          if (!jsonBlockStarted && preJsonBuffer) {
            controller.enqueue(new TextEncoder().encode(preJsonBuffer));
          }

          if (!blindCommitment) {
            const note = isItalian
              ? "_[La Fase 1 (valutazione cieca, prima di leggere il report) non si è completata: nessun impegno cieco valido è stato prodotto, quindi questa è una revisione a turno singolo senza confronto cieco-finale.]_"
              : "_[Phase 1 (the blind valuation, before reading the report) did not complete: no valid blind commitment was produced, so this is a single-phase review with no blind-vs-final comparison.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          }
          // Notes attach to turn 2 — it's the turn whose output the user
          // actually reads.
          if (turn2.stopReason === "max_tokens") {
            const note = isItalian
              ? "_[Revisione troncata: raggiunto il limite di lunghezza. Riavviala per rigenerarla.]_"
              : "_[Review truncated: length limit reached. Re-run it to regenerate.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          } else if (turn2.stopReason === "refusal") {
            const note = isItalian
              ? "_[Il modello ha rifiutato questa revisione. Riavviala o scegli un altro modello.]_"
              : "_[The model declined this review. Re-run it or pick another model.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          } else if (turn2.hitIterationCap) {
            const note = isItalian
              ? "_[Revisione interrotta: troppi cicli di ricerca web. Riavviala per rigenerarla.]_"
              : "_[Review stopped: too many web search rounds. Re-run it to regenerate.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
          }
          if (turn2.servedBy) {
            controller.enqueue(new TextEncoder().encode(`\n\n${fallbackNote(aiSettings.model, turn2.servedBy, isItalian)}`));
          }
        } catch (streamErr) {
          const msg = streamErr instanceof Error ? streamErr.message : "AI error";
          controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${msg}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    const status = routeErrorStatus(error);
    return NextResponse.json({ error: message }, { status });
  }
}
