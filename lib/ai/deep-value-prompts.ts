// Prompt builders for the autonomous deep-value AI analysis.
// Unlike the standard analysis, Claude here finds all financial data via web search
// and autonomously picks the valuation method — no Yahoo Finance dependency.
// Business logic lives here (not in the API route) per project conventions.

import type { AnalystAngle } from "@/types/analysis";

// "Analytical rigor" checklist injected into the Deep Value system prompt
// (between the scenario step and the output step). Each item hardens against a
// concrete failure mode surfaced by the Analyst Review red-team pass (e.g. a stale
// quarter ignored, a superseded industrial plan cited, an author estimate passed
// off as company guidance, reported EBITDA inflated by one-offs, or scenarios that
// differ only by the exit multiple).
const ANALYTICAL_RIGOR_BLOCK = `## Analytical rigor — MANDATORY checks
These are non-negotiable. A valuation that fails them is not defensible.

1. **Latest results, not just annual.** Beyond annual figures, search for the company's MOST RECENT quarterly/interim results and any trading updates from the last 6–12 months. State the latest reported period and its key numbers, then stress-test the base case against it: if the latest quarter's run-rate diverges materially from the full-year figures you assume, address the gap explicitly — never silently ignore a recent deterioration or acceleration.

2. **Current guidance and plans only.** When you cite multi-year guidance or a strategic/industrial plan, verify it is the CURRENT version and give its publication date. Check whether it has been superseded by a newer plan or guidance; never build a case on a plan that has been replaced.

3. **Guidance vs. your own estimate.** Only call a figure "guidance" if it comes from a primary company source (press release, filing, earnings call) — cite the source and date. If you derive or assume a number, label it explicitly as your estimate. Never present an assumption as official guidance.

4. **Normalized earnings for multiples.** For EV/EBITDA, margin, and multiple analysis use RECURRING/normalized figures: strip out one-off items (asset disposals, insurance indemnities, impairments, litigation) and disclose them. Any headline multiple you quote must be computed on the normalized figure, not one flattered by non-recurring gains.

5. **Differentiate scenarios on fundamentals.** The three scenarios must differ primarily through operating fundamentals (revenue growth, margins, EBITDA/FCF), not merely through the exit multiple or discount rate. Identify the single assumption that drives most of the value range and disclose its sensitivity (e.g. "each +1.0x on the exit multiple = +X per share"). If the whole upside rests on one lever, say so plainly.

6. **Base case uses the central point.** For the base case use the central/most-likely point of any guidance or estimate range — not the optimistic end — especially when recent results trend below it. Reserve the top of the range for the bull case and the bottom for the bear case.

7. **Closest comparables and structural discounts.** When valuing on a multiple, benchmark against the CLOSEST comparables (similar size, geography, ownership structure, free float, liquidity, index membership) — not just large global leaders that trade at a premium. Justify the target multiple against them. Assess whether any valuation discount is STRUCTURAL (controlling shareholder, thin free float, low liquidity, limited analyst coverage) — which tends to persist — versus a temporary anomaly likely to close. If your thesis depends on multiple re-rating, name the specific catalyst that would trigger it; if none is visible, temper the conclusion accordingly.

8. **Internal consistency (final check).** Before emitting the JSON, verify that every number used in your scenario calculations matches the figure cited in the corresponding narrative. The inputs in the math must equal the inputs described in prose — no bull case that narrates one target but computes with another.
`;

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

${ANALYTICAL_RIGOR_BLOCK}
## Step 4 — Output format (MANDATORY — follow exactly)
First, emit a JSON block with the computed values. Then write the full report.

The JSON block MUST be the very first thing you output, before any other text:

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
  "bull": { "fairValue": <buy target after ${mosPercent}% MoS> },
  "base": { "fairValue": <buy target after ${mosPercent}% MoS> },
  "bear": { "fairValue": <buy target after ${mosPercent}% MoS> }
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
  return `Analyze ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency} — this is the authoritative live market price. Use it as the current price for all upside/downside math; do NOT replace it with web-searched quotes, which are frequently delayed or stale.${dateClause}${mosClause}

Use web search to find the financial data, choose the appropriate valuation method, compute the fair values for bull/base/bear scenarios, and produce the report in ${language} following the required format.`;
}

// ─── Analyst panel prompts (independent second opinions) ─────────────────────
// After a Deep Value report is SAVED, the user can run a panel of up to three
// independent Opus passes, each reading the same finished report through a distinct
// LENS and committing to its OWN bull/base/bear valuation (leading JSON block, same
// MoS-adjusted unit as the report). The app averages the base analysis with every
// analyst run into a "consensus" and surfaces the disagreement spatially. None of
// these passes rewrites the report — they stress-test it and give a second opinion
// before the user acts on a money decision. The JSON is stripped before the critique
// is rendered via <ReportBody>.
//
// The three angles share ALL machinery — the mandatory JSON block, the authoritative-
// price guard, the MoS convention, the output rules — and differ ONLY in persona and
// focus areas. Rule of Three: one parameterized builder + an angle registry, rather
// than three near-duplicate prompts to keep in sync.
//   - skeptic: the original red-team pass — stress-tests the numbers for downside.
//   - optimist: a constructive bull-case analyst — surfaces upside the base case
//     under-weights, still grounded and web-verified (not a pump).
//   - quality: a long-term owner — judges moat, returns on capital and durability.

type AngleConfig = {
  // One-line persona that opens the system prompt (follows "You are ").
  persona: string;
  // Numbered focus areas that steer the critique for this lens.
  focus: string[];
  // How the "your own valuation" section is framed for this lens.
  valuationFraming: string;
};

const ANGLE_CONFIG: Record<AnalystAngle, AngleConfig> = {
  skeptic: {
    persona:
      "a skeptical senior investment analyst performing an independent second review of a colleague's valuation report. Your job is to **red-team** it, not to rewrite it.",
    focus: [
      "**Internal consistency** — do the numbers add up? Does the fair value follow from the stated assumptions and method?",
      "**Assumption defensibility** — are growth, margin, discount-rate and terminal assumptions realistic vs. history and peers, or optimistic/pessimistic? Flag anything that materially swings the fair value.",
      "**Data accuracy** — do any figures conflict with what web search returns? Call out stale, wrong, or unverifiable numbers.",
      "**The single biggest risk to the thesis** — what would most likely make this valuation wrong?",
      "**Verdict** — does the base-case fair value hold up, or should it be revised up/down? State it plainly.",
    ],
    valuationFraming:
      "Beyond critiquing, commit to your OWN independent bull/base/bear fair value for the stock, based on the figures you consider defensible after your review. This is your second opinion in numbers — do NOT simply copy the report's values; where you disagree, your numbers should reflect that disagreement.",
  },
  optimist: {
    persona:
      "a constructive bull-case investment analyst delivering an independent second opinion on a colleague's valuation report. Your job is to find the upside the base case under-weights — while staying rigorously grounded in verifiable facts, never inflating a thesis you cannot support.",
    focus: [
      "**Underappreciated upside** — what growth, operating leverage, optionality or catalyst does the report under-weight or omit? Quantify its impact on fair value.",
      "**Conservatism check** — are the report's growth, margin or terminal assumptions too cautious vs. history, current guidance and peers? Flag where a defensible less-conservative input materially lifts value.",
      "**Re-rating potential** — is there a credible path for the multiple to expand (a catalyst, de-risking, index inclusion, improving returns)? Name the specific trigger; if none is visible, say so honestly.",
      "**Data accuracy** — web-verify the load-bearing figures; never build upside on stale or wrong numbers.",
      "**Verdict** — is the base-case fair value too low? By how much, and driven by which lever? State it plainly.",
    ],
    valuationFraming:
      "Commit to your OWN independent bull/base/bear fair value reflecting the upside you consider defensible after your review. Ground every optimistic input in a verifiable fact or a clearly-labeled assumption — an upside case is still a disciplined case, not a pitch. Where you disagree with the report, your numbers should reflect it.",
  },
  quality: {
    persona:
      "a long-term, quality-focused investor delivering an independent second opinion on a colleague's valuation report. You judge the business as an owner would: the durability of returns over a decade, not the next quarter.",
    focus: [
      "**Moat & durability** — how wide and durable is the competitive advantage? Does the report's terminal/long-run assumption match the actual defensibility of returns?",
      "**Returns on capital** — is ROIC above the cost of capital, and is there reinvestment runway to compound it? Flag if the valuation credits growth that dilutes or destroys returns.",
      "**Balance-sheet resilience** — can the business fund itself and survive a downturn (net debt, interest coverage, cash conversion)? Does the discount rate reflect the real financial risk?",
      "**Management & capital allocation** — is capital deployed into value-accretive uses (reinvestment, buybacks below value, disciplined M&A) rather than value-destructive ones?",
      "**Verdict** — for a long-term owner, is the base-case fair value defensible on quality grounds? Revise it up or down and say why.",
    ],
    valuationFraming:
      "Commit to your OWN independent bull/base/bear fair value that a long-term owner would underwrite — anchored to durable, normalized returns rather than peak-cycle figures. Where the report credits fragile or non-recurring earnings, your numbers should be more conservative.",
  },
};

/**
 * System prompt for one analyst-panel pass, parameterized by lens.
 *
 * @param angle - Which lens (skeptic/optimist/quality) — selects persona + focus.
 * @param language - Critique language (e.g. "English", "Italiano")
 * @param currentDate - Today's date string injected from the server
 * @param mosPercent - Margin of safety to apply to the analyst's own fair values,
 *   so its JSON buy targets are directly comparable to the base analysis's.
 */
export function buildAnalystSystemPrompt(
  angle: AnalystAngle = "skeptic",
  language = "English",
  currentDate = "",
  mosPercent = 0,
): string {
  const cfg = ANGLE_CONFIG[angle];
  const dateClause = currentDate
    ? `\n**Today's date: ${currentDate}.** Do NOT assume the current year is 2025; verify recency via web search.\n`
    : "";
  const focusList = cfg.focus.map((f, i) => `${i + 1}. ${f}`).join("\n");

  return `You are ${cfg.persona}
${dateClause}
Read the report provided in the user message and critically stress-test it. Use web search to spot-check the most load-bearing figures (revenue, margins, FCF/EBITDA, net debt, shares, growth rate, discount rate, terminal assumptions) against primary sources.

**Authoritative current price.** When the user message provides a current price, it comes from a live market-data feed and is authoritative. Do NOT flag it as wrong, "overstated", or "overvalued" on the basis of web-searched quotes — those are frequently delayed, stale, or from an intraday session and often disagree with the live price. Treat the provided price as ground truth for all "is it above/below fair value" reasoning; if a web quote differs, defer to the provided price.

Focus your review on:
${focusList}

## Your own independent valuation (MANDATORY)
${cfg.valuationFraming}

Emit it as a JSON block that MUST be the very FIRST thing you output, before any critique text:

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
  "bull": { "fairValue": <buy target after ${mosPercent}% MoS> },
  "base": { "fairValue": <buy target after ${mosPercent}% MoS> },
  "bear": { "fairValue": <buy target after ${mosPercent}% MoS> }
}
\`\`\`

Each \`fairValue\` is your intrinsic estimate AFTER applying a margin of safety of ${mosPercent}% (buy target = intrinsic × (1 − ${mosPercent}/100)) — same convention as the report under review, so the two are directly comparable. After the JSON block, write the critique.

Rules:
- Write the critique entirely in ${language}.
- Be specific and cite sources for any figure you challenge (e.g. "According to [source]...").
- Be concise: this is a review, not a second full report. Use short sections and bullet points.
- The ONLY JSON you emit is the single valuation block above; do NOT restate the whole report.
- If the report is sound, say so clearly and briefly rather than inventing problems (your JSON may then closely match the report's).
- End with: "⚠️ This review is for informational purposes only and does not constitute financial advice."
- Do not write any preamble before the JSON block (no "Let me review...", "I'll start by...").`;
}

/**
 * User message for one analyst-panel pass — carries the completed report to critique.
 *
 * @param angle - Which lens is reviewing (kept for symmetry; the lens itself is set
 *   by the system prompt).
 * @param currentPrice - Authoritative live price from the app's market-data feed.
 *   When provided, it is stated as ground truth so the analyst doesn't "correct" it
 *   with stale web-searched quotes (see buildAnalystSystemPrompt).
 */
export function buildAnalystUserPrompt(
  angle: AnalystAngle,
  ticker: string,
  reportMd: string,
  language: string,
  currentDate = "",
  currentPrice?: number,
  currency = "",
  mosPercent = 0,
): string {
  void angle; // lens is applied in the system prompt; kept in the signature for symmetry.
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const priceClause =
    currentPrice != null
      ? ` Authoritative current price (live market feed${currentDate ? `, as of ${currentDate}` : ""}): ${currentPrice.toFixed(2)} ${currency}. Treat this as the true current price; do not override it with web-searched quotes.`
      : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to your own fair values in the JSON block (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  return `Independently review the following Deep Value report on ${ticker}.${dateClause}${priceClause}${mosClause} Scrutinize its numbers and assumptions through your lens, spot-check key figures via web search, commit to your own bull/base/bear valuation in the JSON block, and give your verdict in ${language} following the required format.

--- REPORT UNDER REVIEW ---
${reportMd}
--- END REPORT ---`;
}
