import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { LiteAnalysisResult } from "@/types/watchlist";

const client = new Anthropic();

/**
 * Calls Claude with web_search to produce a JSON-only fair value estimate.
 * Returns null on parse failure — never throws, safe to use in parallel loops.
 * Retries once on transient failures.
 *
 * Used by both the watchlist cron and the compare page AI analysis endpoint.
 */
export async function analyzeTickerLite(
  ticker: string
): Promise<LiteAnalysisResult | null> {
  const currentDate = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a precise financial analyst. Your ONLY task is to determine the fair value of a stock.
You must return EXCLUSIVELY a JSON code block — no preamble, no explanation, no markdown outside the block.
Current date: ${currentDate}

VALUATION METHOD RULES — follow these exactly, no exceptions:
- Financial / Banking / Insurance / Asset Management → P/B (Price-to-Book)
- Utilities / Water / Regulated infrastructure → DDM (Dividend Discount Model)
- Energy / Oil & Gas / Materials / Mining / Chemicals → EV/EBITDA
- All other sectors (Technology, Healthcare, Consumer, Industrials, Real Estate, etc.) → DCF`;

  const userPrompt = `Analyze ${ticker}. Search for its current financials (revenue, FCF or EBITDA, net income, balance sheet, book value).
Identify the sector first, then apply the mandatory method from the system rules.
Return ONLY this JSON block:
\`\`\`json
{
  "method": "DCF",
  "sector": "Technology",
  "currency": "USD",
  "fairValues": {
    "bull": 220.0,
    "base": 180.0,
    "bear": 140.0
  }
}
\`\`\``;

  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(`[lite-analysis] ${ticker} — attempt ${attempt + 1}/2`);
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        // temperature: 0 makes method selection deterministic — same sector always
        // maps to the same valuation method regardless of which web results are found.
        temperature: 0,
        tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      console.log(`[lite-analysis] ${ticker} — stop_reason: ${response.stop_reason}, blocks: ${response.content.length}`);

      // Concatenate all text blocks — Claude may emit intermediate reasoning text
      // between tool calls before the final JSON block appears in the last text block.
      const allText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");

      if (!allText) {
        console.warn(`[lite-analysis] ${ticker} — no text blocks in response, skipping`);
        continue;
      }

      const match = allText.match(/```json\n([\s\S]*?)\n```/);
      if (!match) {
        // Log the raw text so we can see what Claude actually returned
        console.warn(`[lite-analysis] ${ticker} — JSON block not found. Raw text:\n${allText.slice(0, 500)}`);
        continue;
      }

      try {
        const parsed = JSON.parse(match[1]);
        const result: LiteAnalysisResult = {
          fairValueBull: parsed.fairValues.bull,
          fairValueBase: parsed.fairValues.base,
          fairValueBear: parsed.fairValues.bear,
          method: parsed.method,
          sector: parsed.sector,
          currency: parsed.currency,
        };
        console.log(`[lite-analysis] ${ticker} — success: base=${result.fairValueBase} ${result.currency} method=${result.method}`);
        return result;
      } catch (parseErr) {
        console.warn(`[lite-analysis] ${ticker} — JSON.parse failed: ${parseErr}\nRaw match: ${match[1]}`);
        continue;
      }
    } catch (err) {
      console.error(`[lite-analysis] ${ticker} — attempt ${attempt + 1} threw:`, err);
      if (attempt === 1) return null;
    }
  }

  console.error(`[lite-analysis] ${ticker} — all attempts exhausted, returning null`);
  return null;
}
