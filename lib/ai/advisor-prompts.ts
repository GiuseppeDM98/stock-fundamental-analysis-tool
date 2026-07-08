// Prompt builders for the AI Portfolio Advisor chat feature.
// The advisor receives a snapshot of the user's portfolio and saved analyses
// as context, enabling cross-portfolio reasoning and stock discovery.

// Only the fields actually used in the prompt — avoids a full Position/SavedAnalysis import.
type PositionSnippet = {
  ticker: string;
  companyName: string;
  shares: number;
  purchasePrice: number;
  currency: string;
};

type AnalysisSnippet = {
  ticker: string;
  companyName: string;
  fairValueBull?: number | null;
  fairValueBase?: number | null;
  fairValueBear?: number | null;
  valuationMethod?: string | null;
  priceAtAnalysis?: number | null;
  mosPercent?: number | null;
  createdAt: string;
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
  analyses: AnalysisSnippet[];
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
- The LIVE PRICES block (when present) is the single source of truth for the current price of an owned ticker. Never state a current/last price from memory or from a web-searched quote that conflicts with it.
- "price at analysis" values in the analysis history are HISTORICAL — the price when the analysis was saved. Never quote them as the current price.
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

/** Summarise one saved analysis into a compact line for the system prompt. */
function formatAnalysis(a: AnalysisSnippet): string {
  const parts: string[] = [`- ${a.ticker} (${a.companyName})`];
  if (a.valuationMethod) parts.push(`[${a.valuationMethod}]`);
  if (a.fairValueBear != null && a.fairValueBase != null && a.fairValueBull != null) {
    const mos = a.mosPercent ?? 0;
    if (mos > 0) {
      // Stored values are MoS-adjusted buy targets: intrinsic = stored / (1 - mos/100).
      // Expose both so the AI correctly distinguishes fair value from entry target.
      const divisor = 1 - mos / 100;
      const intrinsicBear = (a.fairValueBear / divisor).toFixed(2);
      const intrinsicBase = (a.fairValueBase / divisor).toFixed(2);
      const intrinsicBull = (a.fairValueBull / divisor).toFixed(2);
      parts.push(`Intrinsic Bear ${intrinsicBear} / Base ${intrinsicBase} / Bull ${intrinsicBull}`);
      parts.push(`Buy Target (-${mos}%) Bear ${a.fairValueBear.toFixed(2)} / Base ${a.fairValueBase.toFixed(2)} / Bull ${a.fairValueBull.toFixed(2)}`);
    } else {
      parts.push(`Fair Value Bear ${a.fairValueBear.toFixed(2)} / Base ${a.fairValueBase.toFixed(2)} / Bull ${a.fairValueBull.toFixed(2)}`);
    }
  }
  if (a.priceAtAnalysis != null) {
    parts.push(`price at analysis: ${a.priceAtAnalysis.toFixed(2)}`);
  }
  const date = new Date(a.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  parts.push(`(saved ${date})`);
  return parts.join(" · ");
}

export function buildAdvisorSystemPrompt(ctx: AdvisorContext): string {
  const { positions, analyses, livePrices, currentDate, language } = ctx;

  const portfolioSection =
    positions.length > 0
      ? positions.map(formatPosition).join("\n")
      : "  (no positions yet)";

  const livePricesSection =
    livePrices.length > 0
      ? livePrices.map(formatLivePrice).join("\n")
      : "  (no live prices available — verify current prices via web search)";

  // Deduplicate analyses by ticker: keep only the most recent per ticker.
  const latestByTicker = new Map<string, AnalysisSnippet>();
  for (const a of analyses) {
    const existing = latestByTicker.get(a.ticker);
    if (!existing || new Date(a.createdAt) > new Date(existing.createdAt)) {
      latestByTicker.set(a.ticker, a);
    }
  }
  const analysesSection =
    latestByTicker.size > 0
      ? [...latestByTicker.values()].map(formatAnalysis).join("\n")
      : "  (no saved analyses yet)";

  return `You are a value investing advisor assistant. Today is ${currentDate}.
Respond in ${language}.

You have full context of the user's investment portfolio and their previously saved AI-generated deep value analyses. Use this data to give personalised, insightful answers.

USER'S PORTFOLIO (${positions.length} position${positions.length !== 1 ? "s" : ""}):
${portfolioSection}

LIVE PRICES (authoritative — current market, as of ${currentDate}):
${livePricesSection}

PREVIOUSLY SAVED DEEP VALUE ANALYSES (most recent per ticker):
${analysesSection}

${GROUNDING_RULES_BLOCK}

IMPORTANT RULES:
1. When you recommend a specific stock ticker to investigate further, always wrap it in double square brackets, e.g. [[ENI.MI]] or [[AAPL]]. This lets the user launch a Deep Value analysis with one click. Only wrap actual tickers — not company names.
2. You have access to web search. Use it to find current financial data, recent news, or stock ideas when needed.
3. Be concise and specific. Use the portfolio and analysis data above to give personalised answers — don't give generic investing advice.
4. Fair values in the analysis history are point-in-time estimates. Acknowledge if they are old (> 3 months).
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

IMPORTANT: For Italian stocks, tickers end in .MI (e.g. ENI.MI, ENEL.MI). For US stocks, use plain tickers (AAPL, MSFT). For other exchanges, use the appropriate suffix.`;
}
