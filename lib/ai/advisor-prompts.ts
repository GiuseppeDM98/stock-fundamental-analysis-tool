// Prompt builders for the AI Portfolio Advisor chat feature.
// The advisor receives a snapshot of the user's portfolio and one deterministic summary
// line per ticker (lib/stocks/ticker-summary.ts) as context, enabling cross-portfolio
// reasoning and stock discovery.
import { formatTickerSummaryForPrompt, type TickerSummary } from "@/lib/stocks/ticker-summary";

// Only the fields actually used in the prompt — avoids a full Position import.
type PositionSnippet = {
  ticker: string;
  companyName: string;
  shares: number;
  purchasePrice: number;
  currency: string;
};

// A live, authoritative market price for one ticker, fetched server-side just
// before the prompt is built. Injected as ground truth so the model reports the
// real current price instead of a stale web-searched or remembered quote.
type LivePrice = {
  ticker: string;
  price: number;
  currency: string;
  changePercent?: number;
};

export type AdvisorContext = {
  positions: PositionSnippet[];
  // One per ticker the user analysed or holds, already computed in code: the model reads
  // a verdict here, it never derives one from raw fair values (2026-11-28; before, it got
  // every saved analysis with base columns only, and no lens, consensus or watchlist target).
  summaries: TickerSummary[];
  livePrices: LivePrice[];
  currentDate: string;
  language: string;
};

// Shared grounding rules injected into BOTH advisor modes. They exist because the
// advisor once reported a stale price (2.28 vs a real 2.16) and invented a dated
// causal narrative for a price move. The fix is twofold: anchor current prices to
// the authoritative LIVE PRICES block, and forbid presenting any unverified
// cause/event as fact.
const GROUNDING_RULES_BLOCK = `GROUNDING RULES (mandatory):
- The LIVE PRICES block (when present) is the single source of truth for the current price of every ticker it lists. Never state a current/last price from memory or from a web-searched quote that conflicts with it.
- Fair values, buy targets and consensus figures in TICKER SUMMARIES are point-in-time estimates dated by their "saved" date; only the "price" there is current.
- Before attributing a price move to a cause, or citing any recent event, news, guidance, or earnings release, verify it via web search and give the date. If you cannot verify it, state that the driver is UNCONFIRMED — do not invent a plausible-sounding narrative.
- Separate verified facts (cite the date/source) from your own inference. Never present speculation or a "market reconstruction" as established fact.
- When the user asks about adding to, holding, or exiting a position, first read the current price from LIVE PRICES and search for material recent news before advising.`;

/** Summarise one live price into a compact authoritative line. */
function formatLivePrice(lp: LivePrice): string {
  const base = `- ${lp.ticker}: ${lp.price.toFixed(2)} ${lp.currency}`;
  if (lp.changePercent == null) return base;
  const sign = lp.changePercent >= 0 ? "+" : "";
  return `${base} (today ${sign}${lp.changePercent.toFixed(2)}%)`;
}

/** Summarise one position into a compact line for the system prompt. */
function formatPosition(p: PositionSnippet): string {
  const shares = p.shares;
  const price = p.purchasePrice.toFixed(2);
  const currency = p.currency;
  const ticker = p.ticker;
  const name = p.companyName;
  return `- ${ticker} (${name}): ${shares} shares @ ${price} ${currency}`;
}

export function buildAdvisorSystemPrompt(ctx: AdvisorContext): string {
  const { positions, summaries, livePrices, currentDate, language } = ctx;

  const portfolioSection =
    positions.length > 0
      ? positions.map(formatPosition).join("\n")
      : "  (no positions yet)";

  const livePricesSection =
    livePrices.length > 0
      ? livePrices.map(formatLivePrice).join("\n")
      : "  (no live prices available — verify current prices via web search)";

  const summariesSection =
    summaries.length > 0
      ? summaries.map(formatTickerSummaryForPrompt).join("\n")
      : "  (no saved analyses yet)";

  return `You are a value investing advisor assistant. Today is ${currentDate}.
Respond in ${language}.

You have full context of the user's investment portfolio and a summary of their saved AI-generated deep value analyses, one line per ticker. Use this data to give personalised, insightful answers.

USER'S PORTFOLIO (${positions.length} position${positions.length !== 1 ? "s" : ""}):
${portfolioSection}

LIVE PRICES (authoritative — current market, as of ${currentDate}):
${livePricesSection}

TICKER SUMMARIES (deterministic, from saved analyses):
${summariesSection}
How to read a line: every figure is computed in code from the user's latest saved analysis with values and the live price — quote it as given, do not recompute it. "verdict" is BUY (price at or below the buy target), WATCH (between the buy target and fair value) or OVER (above fair value), measured on the consensus of the analyst lenses when any ran, else on the analysis alone. "signal low" means the verdict sits inside the model's own bull-bear range: treat it as no clear call. "watchlist target" is the user's own entry price for that ticker. A line without a verdict has no comparable live price.

${GROUNDING_RULES_BLOCK}

RULES:
1. When you recommend a specific stock ticker to investigate further, always wrap it in double square brackets, e.g. [[ENI.MI]] or [[AAPL]]. This lets the user launch a Deep Value analysis with one click. Only wrap actual tickers — not company names.
2. You have access to web search. Use it to find current financial data, recent news, or stock ideas when needed.
3. Be concise and specific. Use the portfolio and analysis data above to give personalised answers — don't give generic investing advice.
4. Fair values in the ticker summaries are point-in-time estimates. Acknowledge if they are old (> 3 months).
5. For Italian stocks, tickers end in .MI (e.g. ENI.MI, ENEL.MI, UCG.MI). For US stocks, use plain tickers (AAPL, MSFT).
6. Before recommending any ticker, verify via web search that it is CURRENTLY listed and actively traded as of ${currentDate}. Never suggest a company that has been delisted, acquired, taken private, merged away, or had trading suspended — your training data may still list it as active when it is not. If a candidate turns out to be no longer publicly tradable, drop it and pick another.`;
}

export function buildAdvisorUserPrompt(message: string): string {
  return message;
}

export type DiscoveryContext = {
  currentDate: string;
  language: string;
};

export function buildDiscoverySystemPrompt(ctx: DiscoveryContext): string {
  const { currentDate, language } = ctx;
  return `You are a value investing research assistant specialised in stock discovery. Today is ${currentDate}.
Respond in ${language}.

Your role is to surface high-quality investment candidates based on the user's criteria. You have no information about the user's existing portfolio — focus entirely on finding new ideas.

HOW TO RESPOND:
- Suggest 3–5 concrete stock tickers with a clear, brief investment thesis for each.
- For each candidate: state the key quality metric (ROIC, ROE, or gross margin), the valuation setup (cheap vs fair vs expensive), and one key risk.
- When you mention a specific ticker the user should investigate, wrap it in double square brackets, e.g. [[AAPL]] or [[ENI.MI]]. This creates a clickable link for deep-value analysis.
- Use web search to find current data: recent P/E or EV/EBITDA multiples, ROIC, analyst consensus, and any material recent news.
- Before proposing any ticker, verify via web search that it is CURRENTLY listed and actively traded as of ${currentDate}. Never suggest a company that has been delisted, acquired, taken private, merged away, or had trading suspended — your training data may still list it as active when it is not. If a candidate is no longer publicly tradable, drop it and pick another.
- Be direct and specific. Avoid generic statements.

${GROUNDING_RULES_BLOCK}

DISCOVERY FOCUS AREAS (adapt based on user's request):
- Quality compounders: ROIC > 12%, consistent revenue/FCF growth, durable competitive moat
- Value setups: trading below historical average multiples with a clear catalyst
- Dividend growers: payout sustainability (FCF coverage > 1.5×), ≥5yr track record of dividend increases
- Sector opportunities: specific industries with compelling risk/reward at the current macro setup

TICKER FORMAT: For Italian stocks, tickers end in .MI (e.g. ENI.MI, ENEL.MI). For US stocks, use plain tickers (AAPL, MSFT). For other exchanges, use the appropriate suffix.`;
}
