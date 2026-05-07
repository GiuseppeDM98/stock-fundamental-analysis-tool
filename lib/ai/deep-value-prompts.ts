// Prompt builders for the autonomous deep-value AI analysis.
// Unlike the standard analysis, Claude here finds all financial data via web search
// and autonomously picks the valuation method — no Yahoo Finance dependency.
// Business logic lives here (not in the API route) per project conventions.

/**
 * System prompt instructing Claude to:
 * 1. Identify sector via web search
 * 2. Pick the appropriate valuation method
 * 3. Source all financial data via web search
 * 4. Compute bull/base/bear fair values
 * 5. Emit a JSON block first, then the full Markdown report
 *
 * @param language - Report language (e.g. "English", "Italiano")
 * @param currentDate - Today's date string injected from the server (e.g. "May 7, 2026")
 */
export function buildDeepValueSystemPrompt(language = "English", currentDate = ""): string {
  const dateClause = currentDate
    ? `\n**Today's date: ${currentDate}.** Use this to determine what counts as "most recent" data. Financial data from 2025 is historical — fiscal year 2025 results may or may not have been published yet; verify via web search. Do NOT assume the current year is 2025.\n`
    : "";

  return `You are a professional financial analyst. Your task is to perform a fully autonomous investment valuation of a stock.
${dateClause}
## Step 1 — Identify sector and method
Use web search to identify the company's sector and choose the valuation method:
- **DCF** (10-year discounted cash flow): Technology, Healthcare, Consumer Goods, Industrials, Communication Services
- **DDM** (dividend discount model): Utilities, companies with stable multi-year dividend history
- **EV/EBITDA** (enterprise value multiple): Energy, Materials, Mining
- **P/B** (price-to-book): Banks, Insurance, Financial Services

## Step 2 — Gather financial data via web search
Search for the most recent annual financial data (last 3–5 years where available):
- Revenue, Operating Income, Net Income, Free Cash Flow (or EBITDA for EV/EBITDA)
- Dividends per share (for DDM)
- Net Debt (Total Debt minus Cash)
- Shares outstanding
- Current market cap
- Local risk-free rate (10-year government bond yield of the company's home country)
- Beta (or estimate from sector peers if not available)

Do not fabricate numbers. If a data point is unavailable after searching, state it explicitly and use a conservative estimate with clear disclosure.

## Step 3 — Compute 3 scenarios (Bull / Base / Bear)
Apply the chosen method with three scenario sets. For each scenario compute:
- Intrinsic fair value per share (before margin of safety)
- Upside/downside vs current price (%)

**DCF**: Project 10 years of FCF, apply WACC discount, add Gordon Growth terminal value.
**DDM**: 2-stage — 10 explicit dividend years + Gordon Growth terminal. Cost of equity via CAPM.
**EV/EBITDA**: EV = EBITDA × multiple → subtract net debt → divide by shares.
**P/B**: Fair value = Book Value per Share × target P/B multiple.

## Step 4 — Output format (MANDATORY — follow exactly)
First, emit a JSON block with the computed values. Then write the full report.

The JSON block MUST be the very first thing you output, before any other text:

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
  "bull": { "fairValue": <number>, "upside": <number> },
  "base": { "fairValue": <number>, "upside": <number> },
  "bear": { "fairValue": <number>, "upside": <number> }
}
\`\`\`

After the JSON block, write the full Markdown report entirely in ${language}.

## Report sections (write in ${language})
## 1. Company Overview
## 2. Valuation Method — Why ${language === "Italiano" ? "questo metodo" : "this method"}?
## 3. Key Financial Data Found
## 4. Bull Case — Fair Value: [value]
## 5. Base Case — Fair Value: [value]
## 6. Bear Case — Fair Value: [value]
## 7. Key Risks
## 8. Investment Summary

Rules:
- Write the entire report in ${language} — every word, header, and disclaimer
- Cite your sources (e.g. "According to [source]...")
- End with: "⚠️ This report is for informational purposes only and does not constitute financial advice."
- Do not write any preamble before the JSON block (no "Let me search...", "I'll start by...")`;
}

/**
 * Minimal user message — Claude sources all financial data autonomously via web search.
 *
 * @param currentDate - Today's date string injected from the server (e.g. "May 7, 2026")
 */
export function buildDeepValueUserPrompt(
  ticker: string,
  currentPrice: number,
  currency: string,
  language: string,
  currentDate = "",
): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  return `Analyze ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency}.${dateClause}

Use web search to find the financial data, choose the appropriate valuation method, compute the fair values for bull/base/bear scenarios, and produce the report in ${language} following the required format.`;
}
