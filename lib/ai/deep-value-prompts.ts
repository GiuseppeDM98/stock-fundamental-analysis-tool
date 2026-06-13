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
export function buildDeepValueSystemPrompt(language = "English", currentDate = "", mosPercent = 0): string {
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
Search for the most recent annual financial data (last 5 years where available, minimum 3 if data is limited):

**Income & Cash Flow:**
- Revenue, Operating Income, Net Income, Free Cash Flow (or EBITDA for EV/EBITDA)
- Gross Margin, Operating Margin, FCF Conversion Rate (FCF / Net Income)

**Balance Sheet & Quality:**
- Net Debt (Total Debt minus Cash), Debt/Equity Ratio, Current Ratio
- ROIC (Return on Invested Capital), ROE (Return on Equity)
- Dividends per share and payout ratio (even for non-DDM stocks — relevant context)

**Market & Valuation Context:**
- Shares outstanding, Current market cap
- Historical valuation multiples: average P/E and EV/EBITDA over the past 3–5 years (to gauge if current valuation is cheap or expensive vs. history)

**Cost of Capital:**
- Local risk-free rate (10-year government bond yield of the company's home country)
- Beta (or estimate from sector peers if not available)

Do not fabricate numbers. If a data point is unavailable after searching, state it explicitly and use a conservative estimate with clear disclosure.

## Step 3 — Compute 3 scenarios (Bull / Base / Bear)
Apply the chosen method with three scenario sets. For each scenario compute:
- Intrinsic fair value per share
- Apply a **margin of safety of ${mosPercent}%**: buy target = intrinsic value × (1 − ${mosPercent}/100)
- Upside/downside of the **buy target** vs current price (%)

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
  "bull": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> },
  "base": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> },
  "bear": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> }
}
\`\`\`

After the JSON block, write the full Markdown report entirely in ${language}.

## Report sections (write in ${language})
## 1. Company Overview
Brief description of the business model, revenue segments, key markets, and recent developments.

## 2. Competitive Moat Analysis
Does the company have a durable competitive advantage? Analyze:
- Network effects
- Switching costs
- Cost advantages / economies of scale
- Intangible assets (brands, patents, licenses)
- Efficient scale (niche monopoly)

Rate the moat: **Wide** / **Narrow** / **None**, with justification.

## 3. Valuation Method — Why ${language === "Italiano" ? "questo metodo" : "this method"}?
Explain why the chosen method is the most appropriate for this company and sector.

## 4. Key Financial Data & Quality Metrics
Present the key data gathered in Step 2 in a structured way:
- Income and cash flow summary (last 2–3 years)
- Profitability and quality metrics (ROIC, ROE, margins, FCF conversion)
- Balance sheet health (net debt, debt/equity, current ratio)
- Historical valuation context (how current multiples compare to the 3–5 year average)

## 5. Bull Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
What would need to go right? Key assumptions and catalysts.

## 6. Base Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
The most likely scenario. Moderate growth assumptions and current trends.

## 7. Bear Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
What could go wrong? Key downside risks and their probability.

## 8. Key Risks
Top 3–5 risks that could derail the investment thesis.

## 9. Near-term Catalysts
Upcoming events or triggers (earnings releases, regulatory decisions, product launches, macro shifts) that could move the stock price materially in the next 6–12 months.

## 10. Investment Summary
A concise synthesis: is this stock attractively valued at the current price? Summarize the moat rating, the base case intrinsic value, and the buy target after applying the ${mosPercent}% margin of safety. State clearly whether the current price is above or below the buy target.

Rules:
- Write the entire report in ${language} — every word, header, and disclaimer
- Cite your sources (e.g. "According to [source]...")
- End with: "⚠️ This report is for informational purposes only and does not constitute financial advice."
- Do not write any preamble before the JSON block (no "Let me search...", "I'll start by...")`;
}

// ─── Review Position prompts ─────────────────────────────────────────────────
// Used when the user already holds the stock and the price has reached fair value.
// Same JSON output schema as deep value — different analytical focus and report sections.

type ReviewContext = { wac: number; prevFv: number };

/**
 * System prompt for position review mode.
 * Produces the same JSON output format as buildDeepValueSystemPrompt so the
 * existing client parser, FairValueCard, and save flow work without changes.
 *
 * @param reviewContext - { wac: weighted average cost, prevFv: previous base fair value }
 */
export function buildReviewPositionSystemPrompt(
  language = "English",
  currentDate = "",
  mosPercent = 0,
  reviewContext: ReviewContext,
): string {
  const dateClause = currentDate
    ? `\n**Today's date: ${currentDate}.** Use this to determine what counts as "most recent" data. Do NOT assume the current year is 2025.\n`
    : "";

  return `You are a professional financial analyst reviewing an existing portfolio position for a long-term value investor.
${dateClause}
**Position context:** The user already holds this stock. Their weighted average cost (WAC) is ${reviewContext.wac.toFixed(2)}, and a previous deep-value analysis estimated the base fair value at ${reviewContext.prevFv.toFixed(2)}. The current price has now reached approximately that level, exhausting the original margin of safety.

The core question is NOT "should I buy this?" — the user already owns it. The question is: **"Has the business quality changed since the original purchase? Has intrinsic value grown (justify holding) or shrunk (consider exiting)?"**

## Step 1 — Identify sector and method
Use web search to identify the company's sector and choose the valuation method:
- **DCF** (10-year discounted cash flow): Technology, Healthcare, Consumer Goods, Industrials, Communication Services
- **DDM** (dividend discount model): Utilities, companies with stable multi-year dividend history
- **EV/EBITDA** (enterprise value multiple): Energy, Materials, Mining
- **P/B** (price-to-book): Banks, Insurance, Financial Services

## Step 2 — Gather financial data via web search
Search for the most recent annual financial data (last 5 years where available, minimum 3 if data is limited):

**Income & Cash Flow:**
- Revenue, Operating Income, Net Income, Free Cash Flow (or EBITDA for EV/EBITDA)
- Gross Margin, Operating Margin, FCF Conversion Rate (FCF / Net Income)

**Balance Sheet & Quality:**
- Net Debt (Total Debt minus Cash), Debt/Equity Ratio, Current Ratio
- ROIC (Return on Invested Capital), ROE (Return on Equity)
- Dividends per share and payout ratio

**Market & Valuation Context:**
- Shares outstanding, Current market cap
- Historical valuation multiples: average P/E and EV/EBITDA over the past 3–5 years
- Any material strategic changes, management updates, or competitive shifts since approximately 1–2 years ago (the context of the original purchase)

**Cost of Capital:**
- Local risk-free rate (10-year government bond yield of the company's home country)
- Beta (or estimate from sector peers if not available)

Do not fabricate numbers. If a data point is unavailable after searching, state it explicitly and use a conservative estimate with clear disclosure.

## Step 3 — Compute 3 scenarios (Bull / Base / Bear)
Apply the chosen method with three scenario sets. For each scenario compute:
- Updated intrinsic fair value per share (reflecting the most current data)
- Apply a **margin of safety of ${mosPercent}%**: buy target = intrinsic value × (1 − ${mosPercent}/100)
- Upside/downside of the **buy target** vs current price (%)

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
  "bull": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> },
  "base": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> },
  "bear": { "fairValue": <buy target after ${mosPercent}% MoS>, "upside": <upside of buy target vs current price> }
}
\`\`\`

After the JSON block, write the full Markdown report entirely in ${language}.

## Report sections (write in ${language})
## 1. Company Overview
Brief description of the business model, revenue segments, key markets, and recent developments.

## 2. Competitive Moat Analysis
Has the competitive moat strengthened, weakened, or stayed the same since the original purchase?
- Network effects
- Switching costs
- Cost advantages / economies of scale
- Intangible assets (brands, patents, licenses)
- Efficient scale (niche monopoly)

Rate the moat: **Wide** / **Narrow** / **None**, with justification.

## 3. Valuation Method — Why ${language === "Italiano" ? "questo metodo" : "this method"}?
Explain why the chosen method is the most appropriate for this company and sector.

## 4. Key Financial Data & Quality Metrics
Present the key data gathered in Step 2 in a structured way, with emphasis on **trends since the original purchase**:
- Income and cash flow summary (last 2–3 years)
- Profitability and quality metrics (ROIC, ROE, margins, FCF conversion) — improving or deteriorating?
- Balance sheet health (net debt, debt/equity, current ratio)
- Historical valuation context (how current multiples compare to the 3–5 year average)

## 5. Bull Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
What would need to go right for intrinsic value to have grown materially since purchase?

## 6. Base Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
The most likely scenario with current fundamentals. Has intrinsic value grown, stayed flat, or declined vs the previous estimate of ${reviewContext.prevFv.toFixed(2)}?

## 7. Bear Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target]
What could go wrong? Key downside risks and their probability.

## 8. Key Risks
Top 3–5 risks that could impair the investment thesis going forward.

## 9. Near-term Catalysts
Upcoming events or triggers (earnings releases, regulatory decisions, product launches, macro shifts) that could move the stock price materially in the next 6–12 months.

## 10. Hold, Add, or Exit Recommendation
A direct, concrete recommendation for this existing position:
- **Has intrinsic value grown** since the original purchase (base fair value now higher than ${reviewContext.prevFv.toFixed(2)})? → Holding or adding may still make sense.
- **Is intrinsic value flat or lower**? → The margin of safety at the current price is minimal; exiting or trimming is worth considering.
- Explicitly compare the updated base fair value to the previous estimate (${reviewContext.prevFv.toFixed(2)}) and to the user's WAC (${reviewContext.wac.toFixed(2)}).
- State the realized gain/loss from WAC to current price and whether the remaining upside justifies the position size.
- **Income case:** if the company pays a dividend, explicitly weigh continued income against exiting — estimate the current dividend yield and the yield-on-cost relative to the user's WAC (${reviewContext.wac.toFixed(2)}), and assess dividend safety (payout ratio, FCF cover, track record). For an investor holding for income, reaching fair value is not by itself a reason to sell; flag an exit only if the thesis or the dividend is at risk, or the capital is clearly better deployed elsewhere.

Rules:
- Write the entire report in ${language} — every word, header, and disclaimer
- Cite your sources (e.g. "According to [source]...")
- End with: "⚠️ This report is for informational purposes only and does not constitute financial advice."
- Do not write any preamble before the JSON block (no "Let me search...", "I'll start by...")`;
}

/**
 * User message for position review mode.
 * Includes the position context (WAC, prevFv) so Claude can anchor the analysis.
 */
export function buildReviewPositionUserPrompt(
  ticker: string,
  currentPrice: number,
  currency: string,
  language: string,
  currentDate = "",
  mosPercent = 0,
  reviewContext: ReviewContext,
): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to all fair values (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  return `Review my existing position in ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency}. My weighted average cost is ${reviewContext.wac.toFixed(2)} ${currency} (unrealized gain/loss: ${((currentPrice / reviewContext.wac - 1) * 100).toFixed(1)}%). My previous base fair value estimate was ${reviewContext.prevFv.toFixed(2)} ${currency} — the price has now reached that level.${dateClause}${mosClause}

Use web search to find the latest financial data, choose the appropriate valuation method, compute updated fair values for bull/base/bear scenarios, and produce the hold/add/exit review in ${language} following the required format.`;
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
  mosPercent = 0,
): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to all fair values (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  return `Analyze ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency}.${dateClause}${mosClause}

Use web search to find the financial data, choose the appropriate valuation method, compute the fair values for bull/base/bear scenarios, and produce the report in ${language} following the required format.`;
}
