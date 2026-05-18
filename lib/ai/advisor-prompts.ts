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
    const bear = a.fairValueBear.toFixed(2);
    const base = a.fairValueBase.toFixed(2);
    const bull = a.fairValueBull.toFixed(2);
    parts.push(`Bear ${bear} / Base ${base} / Bull ${bull}`);
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
