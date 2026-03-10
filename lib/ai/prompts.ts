// Prompt construction for AI-generated investment analysis reports.
// Business logic lives here (not in the API route) per project conventions.
import type { QuoteResponse } from "@/types/market";
import type { AnalystEstimates } from "@/types/valuation";
import type { ScenarioResult } from "@/types/valuation";

/** Parameters used to enrich the AI prompt with live financial data. */
export type PromptData = {
  ticker: string;
  quote: QuoteResponse | null;
  analystEstimates: AnalystEstimates | null;
  bull: ScenarioResult;
  base: ScenarioResult;
  bear: ScenarioResult;
  mosPercent: number;
  language: string; // e.g. "English", "Italiano", "Español"
};

/**
 * System prompt that defines Claude's role, output format, and constraints.
 * Instructs the model to produce a structured Markdown report with clear sections
 * and to use web search for recent news and developments.
 */
export function buildSystemPrompt(language = "English"): string {
  return `You are a professional financial analyst writing an investment research report for a retail investor.

Your task is to produce a comprehensive, well-structured Markdown report covering the requested stock.
Use web search to find recent news, latest earnings reports, competitive developments, and any material events.

Report requirements:
- Write ENTIRELY in ${language} — every word, section header, and disclaimer must be in ${language}
- Use Markdown formatting with ## section headers and bullet points
- Be objective and balanced — present both opportunities and risks
- Cite sources when you use web search results (e.g., "According to [source]...")
- Always end with this disclaimer: "⚠️ This report is for informational purposes only and does not constitute financial advice. Always do your own research before making investment decisions."

Do not fabricate financial data. If data is unavailable, say so explicitly.
Do not write any preamble, transitional sentences, or commentary before the report (e.g. "Now I have the data…", "Let me compile…"). Start the output directly with the first ## section header.`;
}

/**
 * User prompt that injects live financial data into the analysis request.
 *
 * The DCF results are pre-computed server-side (not accepted from the client)
 * to prevent prompt injection of arbitrary price targets.
 *
 * @param data - Live quote, analyst estimates, and pre-computed DCF results
 * @returns Formatted prompt string ready to send to Claude
 */
export function buildUserPrompt(data: PromptData): string {
  const { ticker, quote, analystEstimates, bull, base, bear, mosPercent, language } = data;

  const price = quote?.regularMarketPrice?.toFixed(2) ?? "N/A";
  const currency = quote?.currency ?? "USD";
  const companyName = quote?.shortName ?? ticker;
  const marketCap = quote?.marketCap
    ? `${(quote.marketCap / 1e9).toFixed(1)}B ${currency}`
    : "N/A";

  const targetPrice = analystEstimates?.targetMeanPrice?.toFixed(2) ?? "N/A";
  const numAnalysts = analystEstimates?.numberOfAnalysts ?? "N/A";
  const opMargin = analystEstimates?.operatingMargins != null
    ? `${(analystEstimates.operatingMargins * 100).toFixed(1)}%`
    : "N/A";
  const growth5y = analystEstimates?.revenueGrowth5Year != null
    ? `${(analystEstimates.revenueGrowth5Year * 100).toFixed(1)}%`
    : "N/A";

  const fmt = (v: number) => `${currency} ${v.toFixed(2)}`;
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  return `Analyze ${companyName} (${ticker}).

## Current Market Data
- Current Price: ${price} ${currency}
- Market Cap: ${marketCap}
- Analyst Mean Price Target: ${targetPrice} ${currency} (${numAnalysts} analysts)
- Operating Margin: ${opMargin}
- 5-Year Revenue Growth Estimate: ${growth5y}

## DCF Valuation (Margin of Safety: ${mosPercent}%)
The following fair values were computed using a 10-year DCF model with Gordon Growth terminal value.
The margin of safety of ${mosPercent}% has already been applied to all price targets.

| Scenario | Fair Value (after MoS) | Upside vs Current Price |
|----------|----------------------|------------------------|
| Bull     | ${fmt(bull.fairValueAfterMos)} | ${pct(bull.upsideVsPricePercent)} |
| Base     | ${fmt(base.fairValueAfterMos)} | ${pct(base.upsideVsPricePercent)} |
| Bear     | ${fmt(bear.fairValueAfterMos)} | ${pct(bear.upsideVsPricePercent)} |

## Your Task
Please write a comprehensive investment research report with exactly these sections:

## 1. Company Overview
What the company does, its business model, revenue segments, and key markets.
Use web search to include the most up-to-date information.

## 2. Competitive Moat Analysis
Does the company have a durable competitive advantage? Analyze:
- Network effects
- Switching costs
- Cost advantages / economies of scale
- Intangible assets (brands, patents, licenses)
- Efficient scale (niche monopoly)

Rate the moat: Wide / Narrow / None, with justification.

## 3. Bull Case — Fair Value: ${fmt(bull.fairValueAfterMos)} (${pct(bull.upsideVsPricePercent)} upside)
What would need to go right for this scenario? Key assumptions and catalysts.

## 4. Base Case — Fair Value: ${fmt(base.fairValueAfterMos)} (${pct(base.upsideVsPricePercent)} upside)
The most likely scenario. Moderate growth assumptions and current trends.

## 5. Bear Case — Fair Value: ${fmt(bear.fairValueAfterMos)} (${pct(bear.upsideVsPricePercent)} upside)
What could go wrong? Key downside risks and their probability.

## 6. Key Risks
Top 3-5 risks that could derail the investment thesis.

## 7. Investment Summary
A concise synthesis: is this stock attractive at the current price of ${price} ${currency} given the margin of safety of ${mosPercent}%?
Reference the base case fair value of ${fmt(base.fairValueAfterMos)}.

---
IMPORTANT: Write the entire report in ${language}. Do not use any other language.`;
}
