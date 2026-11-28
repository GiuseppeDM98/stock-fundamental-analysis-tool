// The deterministic summary of one ticker: which saved analysis speaks for it, what the
// price says against it, how the estimate moved, what the user holds and watches. One
// computation for every surface that sums a ticker up (the Advisor's prompt, the hub's
// recent strip), so they cannot disagree on the verdict the lists already show: every rule
// here is the one of lib/report/* (latest analysis with values, consensus first, one
// currency), only gathered. Pure — no I/O, shared by client and server.
//
// Scales: `intrinsic`, `consensus` and `analysts` are fair values (grossed up with the
// analysis's own MoS); `basis.buyTargetBase` and `watchlistBuyTarget` are buy targets.
// `distanceToBuyTargetPct` and `holding.pnlPct` are PERCENTAGES (10.2 = +10.2%), like the
// figures the lists print, not fractions.
import type { SavedAnalysis, AnalystAngle } from "@/types/analysis";
import type { EarningsConfidence } from "@/types/earnings";
import { aggregateOpenLots, type OpenLot } from "@/lib/portfolio-math";
import { sameCurrency } from "@/lib/grounding/currency";
import { isAnalysisStalePreEarnings, isFutureEarnings } from "@/lib/earnings";
import { consensusTriple, presentAnalysts } from "@/lib/report/consensus";
import { computeEvolutionChain, type Evolution } from "@/lib/report/evolution";
import {
  comparablePrice,
  currencyMismatch,
  latestAnalysisWithValues,
  verdictBasis,
  watchlistBuyTarget,
  type VerdictBasis,
} from "@/lib/report/latest-analysis";
import { isDone } from "@/lib/report/run-status";
import { getSignalStrength, type SignalStrength } from "@/lib/report/signal";
import { grossUpToIntrinsic, type Triple } from "@/lib/report/valuation";
import { getVerdict, type Verdict } from "@/lib/report/verdict";

export type TickerSummaryInput = {
  ticker: string;
  /** Newest first. Rows without the text blobs are fine: no report or critique is read. */
  analyses: SavedAnalysis[];
  /** The live quote, in its own currency; null when it could not be fetched. */
  price: number | null;
  currency: string | null;
  /** The open lots of the ticker. */
  positions: OpenLot[];
  /** The lots' currency, null when they mix currencies (then no P&L). */
  positionCurrency: string | null;
  /** The watchlist item's MoS, a FRACTION (0.25), unlike Analysis.mosPercent. */
  watchlistItem: { mosPercent: number } | null;
  earnings: { nextEarningsDate: string | null; confidence: EarningsConfidence; fetchedAt: string } | null;
  dividendsReceivedEur: number | null;
};

export type TickerSummary = {
  ticker: string;
  /** The newest finished analysis with a full triple: the one every figure below reads. */
  latest: SavedAnalysis | null;
  /** Finished analyses only: a run in progress or cut is not an analysis. */
  analysisCount: number;
  basis: VerdictBasis | null;
  intrinsic: Triple | null;
  consensus: Triple | null;
  analysts: { angle: AnalystAngle; triple: Triple }[];
  /** The quote as given, shown even when it cannot be compared. */
  price: number | null;
  currency: string | null;
  /** A price is there but in another currency than the analysis: no verdict, distance or
   *  signal, and the reader is told why. */
  currencyMismatch: boolean;
  verdict: Verdict | null;
  distanceToBuyTargetPct: number | null;
  signal: SignalStrength | null;
  /** One step per adjacent pair of finished saves, newest step first. */
  evolution: Evolution[];
  holding: { totalShares: number; weightedAvgCost: number; pnlPct: number | null } | null;
  watchlistBuyTarget: number | null;
  earnings: TickerSummaryInput["earnings"];
  dividendsReceivedEur: number | null;
  /** The latest analysis likely predates the last earnings release. */
  staleForEarnings: boolean;
};

function grossUpTriple(t: Triple, mosFraction: number): Triple {
  return {
    bear: grossUpToIntrinsic(t.bear, mosFraction),
    base: grossUpToIntrinsic(t.base, mosFraction),
    bull: grossUpToIntrinsic(t.bull, mosFraction),
  };
}

export function buildTickerSummary(input: TickerSummaryInput): TickerSummary {
  // Unfinished runs leave before any count: a caller that forgot the filter must not see a
  // cut run in analysisCount or as a step of the evolution.
  const analyses = input.analyses.filter(isDone);
  const latest = latestAnalysisWithValues(analyses);
  const basis = latest ? verdictBasis(latest) : null;
  const mos = (latest?.mosPercent ?? 0) / 100;

  const intrinsic = latest
    ? grossUpTriple({ bear: latest.fairValueBear!, base: latest.fairValueBase!, bull: latest.fairValueBull! }, mos)
    : null;
  const consensusBuyTarget = latest ? consensusTriple(latest) : null;
  const analysts = latest
    ? presentAnalysts(latest).map(({ angle, triple }) => ({ angle, triple: grossUpTriple(triple, mos) }))
    : [];

  // The price only in the analysis's own currency: a GBp quote against GBP values is off by
  // a factor of 100, so on a mismatch the three reads below stay null.
  const comparable = latest ? comparablePrice(input.price, input.currency, latest) : null;
  const weighable = comparable != null && basis != null && intrinsic != null;

  const lots = aggregateOpenLots(input.positions);
  const holding = lots
    ? {
        ...lots,
        // A P&L only on a price in the lots' own currency, never converted.
        pnlPct:
          input.price != null && lots.weightedAvgCost > 0 && sameCurrency(input.currency, input.positionCurrency)
            ? ((input.price - lots.weightedAvgCost) / lots.weightedAvgCost) * 100
            : null,
      }
    : null;

  return {
    ticker: input.ticker,
    latest,
    analysisCount: analyses.length,
    basis,
    intrinsic,
    consensus: consensusBuyTarget ? grossUpTriple(consensusBuyTarget, mos) : null,
    analysts,
    price: input.price,
    currency: input.currency,
    currencyMismatch: latest != null && currencyMismatch(input.price, input.currency, latest),
    verdict: weighable ? getVerdict(comparable, basis.buyTargetBase, basis.intrinsicBase) : null,
    distanceToBuyTargetPct: weighable ? ((comparable - basis.buyTargetBase) / basis.buyTargetBase) * 100 : null,
    // The same triple the /analyses ruler weighs: the model's own cone around the verdict's base.
    signal: weighable
      ? getSignalStrength(comparable, { bear: intrinsic.bear, base: basis.intrinsicBase, bull: intrinsic.bull })
      : null,
    evolution: computeEvolutionChain(analyses),
    holding,
    watchlistBuyTarget: latest && input.watchlistItem ? watchlistBuyTarget(latest, input.watchlistItem.mosPercent) : null,
    earnings: input.earnings,
    dividendsReceivedEur: input.dividendsReceivedEur,
    staleForEarnings: latest != null && isAnalysisStalePreEarnings(latest.createdAt, input.earnings?.nextEarningsDate ?? null),
  };
}

const n2 = (v: number) => v.toFixed(2);
const triple = (t: Triple) => `${n2(t.bear)}/${n2(t.base)}/${n2(t.bull)}`;
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function holdingPart(holding: TickerSummary["holding"]): string | null {
  if (!holding) return null;
  const pnl = holding.pnlPct == null ? "" : ` (${holding.pnlPct >= 0 ? "+" : ""}${holding.pnlPct.toFixed(1)}%)`;
  return `held ${holding.totalShares} sh @ ${n2(holding.weightedAvgCost)}${pnl}`;
}

/**
 * One line per ticker for the Advisor's system prompt. Every figure is computed in code
 * from saved analyses and the live quote: the model reads a verdict, it does not derive
 * one. Parts with nothing to say are left out (no price: no verdict, signal or P&L; a past
 * or missing earnings date; no watchlist item), and a ticker with no valued analysis reads
 * "no valuation" — it still has a line when the user holds it.
 */
export function formatTickerSummaryForPrompt(s: TickerSummary): string {
  const count = counted(s.analysisCount, "analysis", "analyses");
  if (!s.latest || !s.intrinsic || !s.basis) {
    return [`- ${s.ticker} [no valuation, ${count}]`, holdingPart(s.holding)].filter(Boolean).join(" · ");
  }

  // UTC, so the same row reads the same date on the server and in a test.
  const saved = new Date(s.latest.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const tag = [s.latest.valuationMethod, count, `saved ${saved}`].filter(Boolean).join(", ");

  const mos = s.latest.mosPercent ?? 0;
  const parts: string[] = [];
  if (mos > 0) {
    // Stored values are buy targets: both scales are named, so a fair value is never read
    // as an entry price.
    const buyTargets = { bear: s.latest.fairValueBear!, base: s.latest.fairValueBase!, bull: s.latest.fairValueBull! };
    parts.push(`intrinsic bear/base/bull ${triple(s.intrinsic)}`, `buy target (−${mos}%) ${triple(buyTargets)}`);
  } else {
    parts.push(`fair value bear/base/bull ${triple(s.intrinsic)}`);
  }
  if (s.consensus) parts.push(`consensus base ${n2(s.consensus.base)} (${counted(s.analysts.length, "lens", "lenses")})`);
  if (s.verdict) parts.push(`verdict ${s.verdict.toUpperCase()} (${s.basis.source})`);
  if (s.signal) parts.push(`signal ${s.signal}`);
  if (s.price != null) {
    const note = s.currencyMismatch ? ` (analysis in ${s.latest.currency ?? "an unknown currency"}: no verdict)` : "";
    parts.push(`price ${n2(s.price)} ${s.currency ?? ""}`.trimEnd() + note);
  }
  if (s.earnings?.nextEarningsDate && isFutureEarnings(s.earnings.nextEarningsDate)) {
    parts.push(`next earnings ${s.earnings.nextEarningsDate.slice(0, 10)} (${s.earnings.confidence})`);
  }
  if (s.watchlistBuyTarget != null) parts.push(`watchlist target ${n2(s.watchlistBuyTarget)}`);
  const held = holdingPart(s.holding);
  if (held) parts.push(held);

  return `- ${s.ticker} [${tag}] ${parts.join(" · ")}`;
}
