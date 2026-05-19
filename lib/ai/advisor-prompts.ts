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

export type AdvisorContext = {
  positions: PositionSnippet[];
  analyses: AnalysisSnippet[];
  currentDate: string;
  language: string;
};

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
  const { positions, analyses, currentDate, language } = ctx;

  const portfolioSection =
    positions.length > 0
      ? positions.map(formatPosition).join("\n")
      : "  (no positions yet)";

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

PREVIOUSLY SAVED DEEP VALUE ANALYSES (most recent per ticker):
${analysesSection}

IMPORTANT RULES:
1. When you recommend a specific stock ticker to investigate further, always wrap it in double square brackets, e.g. [[ENI.MI]] or [[AAPL]]. This lets the user launch a Deep Value analysis with one click. Only wrap actual tickers — not company names.
2. You have access to web search. Use it to find current financial data, recent news, or stock ideas when needed.
3. Be concise and specific. Use the portfolio and analysis data above to give personalised answers — don't give generic investing advice.
4. Fair values in the analysis history are point-in-time estimates. Acknowledge if they are old (> 3 months).
5. For Italian stocks, tickers end in .MI (e.g. ENI.MI, ENEL.MI, UCG.MI). For US stocks, use plain tickers (AAPL, MSFT).`;
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
- Be direct and specific. Avoid generic statements.

DISCOVERY FOCUS AREAS (adapt based on user's request):
- Quality compounders: ROIC > 12%, consistent revenue/FCF growth, durable competitive moat
- Value setups: trading below historical average multiples with a clear catalyst
- Dividend growers: payout sustainability (FCF coverage > 1.5×), ≥5yr track record of dividend increases
- Sector opportunities: specific industries with compelling risk/reward at the current macro setup

IMPORTANT: For Italian stocks, tickers end in .MI (e.g. ENI.MI, ENEL.MI). For US stocks, use plain tickers (AAPL, MSFT). For other exchanges, use the appropriate suffix.`;
}
