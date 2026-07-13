// Prompt builders for the autonomous deep-value AI analysis.
// Unlike the standard analysis, Claude here finds all financial data via web search
// and autonomously picks the valuation method — no Yahoo Finance dependency.
// Business logic lives here (not in the API route) per project conventions.

import type { AnalystAngle } from "@/types/analysis";
import type { GroundingPromptContext } from "@/lib/grounding/prompt-format";
import { formatGroundingForPrompt } from "@/lib/grounding/prompt-format";
import type { Triple } from "@/lib/report/valuation";

// "Analytical rigor" checklist injected into the Deep Value system prompt
// (between the scenario step and the output step). Each item hardens against a
// concrete failure mode surfaced by real second-opinion reviews (e.g. a stale
// quarter ignored, a superseded industrial plan cited, an author estimate passed
// off as company guidance, reported EBITDA inflated by one-offs, scenarios that
// differ only by the exit multiple, an equity value that forgets to deduct
// minority interests, a bull case that double-counts a demerger as both SOTP
// narrative and consolidated multiple, a multiple reverse-engineered from the current
// price so fair value ≈ price by construction, a net-debt/minorities bridge left
// constant across scenarios, or profitability ratios that don't reconcile with the
// income statement/balance sheet shown alongside them).
const ANALYTICAL_RIGOR_BLOCK = `## Analytical rigor — MANDATORY checks
These are non-negotiable. A valuation that fails them is not defensible.

1. **Latest results, not just annual.** Beyond annual figures, search for the company's MOST RECENT quarterly/interim results and any trading updates from the last 6–12 months. State the latest reported period and its key numbers, then stress-test the base case against it: if the latest quarter's run-rate diverges materially from the full-year figures you assume, address the gap explicitly — never silently ignore a recent deterioration or acceleration.

2. **Current guidance and plans only.** When you cite multi-year guidance or a strategic/industrial plan, verify it is the CURRENT version and give its publication date. Check whether it has been superseded by a newer plan or guidance; never build a case on a plan that has been replaced.

3. **Guidance vs. your own estimate.** Only call a figure "guidance" if it comes from a primary company source (press release, filing, earnings call) — cite the source and date. If you derive or assume a number, label it explicitly as your estimate. Never present an assumption as official guidance.

4. **Normalized earnings for multiples.** For EV/EBITDA, margin, and multiple analysis use RECURRING/normalized figures: strip out one-off items (asset disposals, insurance indemnities, impairments, litigation) and disclose them. Any headline multiple you quote must be computed on the normalized figure, not one flattered by non-recurring gains. When a BASIS RECONCILIATION block is provided below and states a basis ratio ≠ 1, the same-basis multiples given there are the ONLY ones you may apply to income-statement EBITDA. Applying the raw provider-table multiple to an income-statement figure is forbidden — it is a definitional error, not a judgment call.

5. **Differentiate scenarios on fundamentals — and reconcile them to your own sensitivity.** The three scenarios must differ primarily through operating fundamentals (revenue growth, margins, EBITDA/FCF), not merely through the exit multiple or discount rate. Identify the single assumption that drives most of the value range and disclose its sensitivity (e.g. "each +1.0x on the exit multiple = +X per share"). If the whole upside rests on one lever, say so plainly. Then reconcile each scenario's operating figure to the driver assumption of THAT scenario using the sensitivity you just stated: e.g. if you claim "$10/bbl of Brent ≈ €2–3bn of EBITDA" and the bear assumes Brent far below the base, the bear EBITDA must fall by the implied amount — a bear EBITDA that contradicts your own stated sensitivity is an internal error. Avoid stretching the multiple in the SAME direction as the operating figure across scenarios unless you justify it: co-moving both levers inflates the tails and compounds error.

6. **Base case uses the central point — and normalize to the base driver, not a stale trailing figure.** For the base case use the central/most-likely point of any guidance or estimate range — not the optimistic end — especially when recent results trend below it. Reserve the top of the range for the bull case and the bottom for the bear case. For a commodity/cyclical business, the base operating figure (EBITDA/FCF) must be RE-DERIVED at the base-case commodity/price assumption using your stated sensitivity: do NOT reuse a trailing-twelve-month figure that embeds a different point in the cycle (e.g. a TTM that includes a quarter at much higher prices) and label it "normalized" — if the base assumes $75 but TTM earned an average $90, the base figure must be marked down to the $75 level.

7. **Closest comparables, same basis, and structural discounts.** When valuing on a multiple, benchmark against the CLOSEST comparables (similar size, geography, ownership structure, free float, liquidity, index membership) — not just large global leaders that trade at a premium. Compare on the SAME basis: net debt and EBITDA for both the subject and the peers must use the same lease-accounting treatment (pre- vs post-IFRS 16) and the same EBITDA definition (reported vs adjusted/normalized). A headline "discount vs peers" computed on mismatched bases is a perimeter artifact, not a real discount — verify the basis before quoting it. Justify the target multiple against them. Assess whether any valuation discount is STRUCTURAL (controlling shareholder, thin free float, low liquidity, limited analyst coverage) — which tends to persist — versus a temporary anomaly likely to close. If your thesis depends on multiple re-rating, name the specific catalyst that would trigger it; if none is visible, temper the conclusion accordingly. **No selection bias:** do not drop the closest structural comparable merely because it lowers (or raises) the peer average — if a peer shares the very traits you cite as the cause of the subject's discount (e.g. state control, high commodity/E&P weight), it is the MOST relevant comp, not the least; include it, or justify its exclusion on grounds independent of its effect on the average. Never compare a FORWARD (NTM) multiple against a TRAILING (LTM) historical distribution. For a growing company the forward multiple is structurally lower than the trailing one, so the "discount" you would report is a measurement artifact, not a signal. When the anchors give you an LTM-equivalent of your own multiple, that is the number to compare.

8. **Complete the EV→equity bridge.** When converting enterprise value to equity, do NOT stop at EV − net debt. Subtract minority (non-controlling) interests, preferred equity and unfunded pension/decommissioning liabilities, and add associates/JVs carried at equity. This matters most when consolidated EBITDA already includes subsidiaries the company does not wholly own (third-party or private-equity stakes, JVs): that minority share of value is not shareholders', so treating EV − net debt as equity overstates fair value per share. State each bridge item you deduct, or note "not material" explicitly. **The bridge is scenario-dependent, not a constant:** net debt moves with each scenario's cash generation (a bear with low prices, a suspended buyback and maintained capex de-levers slower or re-levers — net debt RISES; a bull generates more cash — net debt falls); and minority interests move with the value of the partially-owned subsidiaries (a bull that marks the satellites to higher valuations must deduct a correspondingly HIGHER minority share — you cannot claim higher segment value AND deduct constant minorities). Never carry the same net-debt and minority figures unchanged across bull, base and bear.

9. **Method ↔ narrative coherence (no disguised sum-of-the-parts).** If your thesis leans on segment-specific value — a demerger, stake sales at segment multiples, "crystallizing" or "unlocking" the value of a division — then value the company as a genuine SUM-OF-THE-PARTS (each segment at its own appropriate multiple/method, then minus net debt and minorities), not as a single blended multiple on consolidated EBITDA. You may not narrate SOTP upside AND add it on top of a consolidated multiple that already captures the whole group: that double-counts. Pick one framework and apply it consistently.

10. **Anchor the valuation lever to something INDEPENDENT of today's price — the market-implied read is a control, never the input.** The fair value of a multiple method is dominated by one number (the multiple); of a DCF/DDM, by the key lever (WACC, terminal growth, cost of equity). That lever must be anchored to evidence that does NOT depend on the current price:
   - FIRST commit to the base-case lever justified ONLY from (a) the company's OWN historical distribution (median/percentile over 3–5y, gathered in Step 2) and (b) the closest peers with an explicit, reasoned discount/premium. Do this BEFORE, and WITHOUT reference to, the current price or the multiple the price implies.
   - It is FORBIDDEN to set the base multiple equal to — or reverse-engineer it (or the WACC/terminal growth) from — the multiple/inputs implied by the current price. That produces a fair value ≈ price by construction: a null result dressed as analysis, not a signal.
   - THEN compute the market-implied read as a separate CONTROL: back out what the price already prices in (the implied multiple on your normalized EBITDA/earnings; and for a commodity/cyclical name, the commodity price implied — which requires FIXING the multiple and holding it constant, since you cannot derive an implied commodity price from a multiple alone). Do not stop at "the market implies 5.5x and I anchor at 7.1x, therefore upside". SOLVE FOR WHAT MUST BE TRUE: at your history-anchored multiple, what EBITDA (or growth, or margin) does the current price imply? Then JUDGE whether those implied conditions are plausible. The deterministic anchors give you this number — use it. This turns the report from advocacy into investigation. Report it in the "What must be true for the current price to be right" subsection (§4). If your anchored lever and the market-implied one coincide, state it as a finding ("the market already prices my anchored multiple"), not as your method.
   - Never normalize on a trailing figure that spans a different point in the cycle than the scenario you are pricing (see check 6).

11. **Margin-of-safety adequacy.** Judge whether the applied margin of safety is adequate for the RANGE and cyclicality of the business, rather than applying it mechanically. A small MoS against a wide bull↔bear dispersion (several turns of the multiple, a commodity-driven earnings swing) offers little real protection and is cosmetic — say so plainly. Do NOT change the user's chosen MoS; only judge, in the summary, whether it is sufficient given the dispersion you computed.

12. **Internal consistency & reconciliation (final check — treat as a linter).** Before emitting the JSON, run these checks and FIX any failure rather than shipping it:
   - Every number used in your scenario calculations matches the figure cited in the corresponding narrative — no bull case that narrates one target but computes with another.
   - The profitability/quality metrics tie to the income statement and balance sheet you present: ROE ≈ net income / equity, net margin × revenue ≈ net income, ROA ≈ net income / assets. If a ratio pulled from a third-party source (e.g. a Yahoo ROE) contradicts your own tables, reconcile it or drop it — never show both a ~17% ROE and figures that imply ~6%.
   - Explain any large year-on-year balance-sheet move you show (e.g. a double-digit-% change in equity), or flag it as unverified — do not present an unexplained ~€13bn equity drop.
   - Resolve the share count to a SINGLE figure: reconcile shares issued vs. outstanding-net-of-treasury vs. ADR-equivalent, state which you use and why. An unresolved 5%+ discrepancy directly mis-scales every per-share value.
   - Use terminology precisely: a shareholding (e.g. a government's ~33% stake held via a sovereign fund) is NOT a "golden share" (a distinct legal instrument granting special veto/approval powers). Do not conflate a stake with a control mechanism.

13. **Bear validity.** If your bear-case intrinsic value sits ABOVE the current market price, your scenario set is invalid by construction: it never contemplates the possibility that the market is right. Either re-parameterize the bear until it reaches or breaks the current price, or state explicitly — and defend — that no coherent adverse scenario exists at this price.

14. **Horizon symmetry.** Bull and bear must be underwritten to the SAME year. If the bull banks a benefit that matures in 2033, the bear must be allowed to project the balance sheet to a comparable horizon. A bull with seven years to work and a bear confined to next year is not a scenario set, it is an argument.

15. **Dividend coverage.** For any stock with a dividend yield above 3%: compare the total dividend (DPS × shares) to average free cash flow over the last 3-5 years. If the payout is not covered by FCF — especially inside a capex cycle — the dividend is financed by debt. It is then a RISK to be discussed, never an element of support for the thesis.

16. **Returns vs cost of capital.** If ROIC is below WACC, a company investing at returns beneath its cost of capital deserves to trade BELOW its own historical median multiple. You may not set a base multiple at or above the historical median without naming the specific mechanism that would produce the re-rating, and stating why it is more likely than continued de-rating. Assuming mean reversion of the multiple with no named mechanism is the single heaviest assumption a valuation can carry — never leave it implicit.

17. **Second method (mandatory).** Every valuation must be cross-checked with a SECOND, structurally different method, and the delta reconciled explicitly. Pick the method the asset's own economics suggest: a regulated utility has a natural anchor in RAB (EV/RAB, or a regulated/unregulated SOTP) and — where the dividend policy is explicit and the payout is central to the thesis — a DDM. A section explaining WHY you chose your primary method is not a cross-check: a cross-check produces a second number and reconciles it to the first.

18. **Scenario probabilities.** Assign an explicit probability to bull, base and bear (summing to 1). Three scenarios without weights do not produce an expected value, so a statement like "the price is below the buy target in all scenarios" carries far less information than it appears to.
`;

// Injected only in Grounded mode (when the caller passes `grounding`) — the user has
// pasted authoritative financial data (transcribed + anchored in code, see
// lib/grounding/*) that is appended to the USER prompt via formatGroundingForPrompt.
// This block carries the RULES for using it; it is deliberately static (no
// interpolation) so it can't accidentally break Quick's byte-identical output — the
// concrete numbers (the actual market-implied multiple/percentile) live in the anchors
// section itself, formatted per-request. See docs/deep-value-grounding-spec.md §5.6/§6.1.
const GROUNDED_RULES_BLOCK = `## Grounded mode — using the user-provided data (MANDATORY)
The user has pasted authoritative financial data for this company. It has been transcribed into a structured extract and turned into deterministic anchors, both injected below in the user message. This does NOT turn off web search — it RESCOPES it:

1. **Do not search the web for historical data already provided** — financial statements, historical valuation multiples, peer multiples. Searching for them re-contaminates authoritative, human-confirmed data with the same low-quality web data this mode exists to remove.
2. **You MUST still search the web for**: (a) any results, guidance, trading update, buyback or M&A published AFTER the extract's stated coverage period — these can move net debt and share count, which the anchors below assume are current as of that period; (b) the qualitative material for the Moat, Risks and Catalysts sections, which cannot come from a balance sheet; (c) whatever the analytical-rigor checks above require (latest quarter, current guidance/plans).
3. **On conflict between web data and the pasted data on a HISTORICAL figure, the pasted data wins.** State the conflict explicitly in a short "Data conflicts" note in the report — never resolve it silently by quietly picking one number.
4. **Forward estimates are a legitimate input; analyst targets are not.** The provided forward revenue/EBITDA/EPS estimates are legitimate inputs for a fundamentals-based base case. Analyst TARGET PRICE, TARGET MULTIPLE, and RATING are NEVER a legitimate valuation anchor — even if web search surfaces them — because they are already anchored to the price/consensus; do not use them to justify your multiple or discount rate.
5. **Units.** Every monetary figure in the structured extract and the anchors below is expressed in the SAME unit (stated in the extract's \`meta.units\`) — do not apply any unit conversion, and do not assume a different scale.
6. **The deterministic anchors are FACTS, not suggestions.** Your base case's multiple (or key DCF/DDM lever) must be one of the anchor statistics below, or an explicit deviation you justify with a stated number and reason. The market-implied read is a CONTROL that reports the GAP versus your independently-anchored lever — never the source of it (rigor item 10 above).
7. **No selection bias on the provided peers.** Every peer supplied below must appear in your comparables table — you may not drop one because it is unfavorable to your thesis (rigor item 7 above).
8. **The BASIS RECONCILIATION block is binding.** It is computed in code from your own pasted data, not inferred. When it states a basis ratio, the same-basis multiples it gives are the ones to use. When it states the basis is unverifiable, you must treat every multiple-vs-EBITDA comparison as unverified and say so in the Data conflicts note.
9. **On conflict between the raw pasted text and the structured extract, the RAW TEXT wins.** The extract is a machine transcription of your data and may have erred; the paste is the source.
10. **Horizon.** The historical multiple distribution is built on TRAILING, reported-fiscal-year EBITDA. Any multiple you apply to a forward estimate lives in a different space and cannot be ranked against that distribution without the LTM-equivalent the anchors provide.
`;

// One scenario's JSON template line — the SAME contract shape for the base Deep Value
// report and every analyst lens (docs/deep-value-rigor-v2-spec.md §5.4: aligning the
// lens's JSON to this exact shape is what finally lets lib/grounding/postcheck.ts verify a
// lens, not just the base report — today it can't, since a lens only ever declared
// `fairValue`). `bridge` stays Grounded-only (mirrors the base report: there is no extract
// to check it against in Quick mode); `probability` is unconditional (rigor check 18).
function scenarioJsonLine(
  name: "bull" | "base" | "bear",
  mosPercent: number,
  grounding: GroundingPromptContext | undefined
): string {
  return grounding
    ? `  "${name}": {
    "fairValue": <buy target after ${mosPercent}% MoS>,
    "probability": <0..1 — bull+base+bear should sum to ≈1>,
    "bridge": {
      "driver": "<short label for the value driver, e.g. \\"Normalized EBITDA 2026e\\">",
      "driverValue": <driver's numeric value, SAME unit as the extract's meta.units>,
      "driverYear": <the fiscal year driverValue refers to>,
      "multiple": <the multiple you applied to driverValue — OMIT this whole key for DCF/DDM>,
      "netDebt": <THIS scenario's net debt, SAME unit as meta.units>,
      "minorities": <THIS scenario's minority interests, SAME unit as meta.units>,
      "shares": <SAME unit as sharesDiluted>,
      "intrinsicPerShare": <the fair value BEFORE the ${mosPercent}% MoS — NOT the same number as "fairValue" above unless MoS is 0>
    }
  }`
    : `  "${name}": { "fairValue": <buy target after ${mosPercent}% MoS>, "probability": <0..1 — bull+base+bear should sum to ≈1> }`;
}

// Shared top-level JSON keys for `assumptions`/`crossCheck`, reused verbatim by both the
// base report and every analyst lens. `crossCheck.bridge` is Grounded-only (mirrors
// scenarioJsonLine's own bridge — no extract to check it against in Quick mode): it lets
// lib/grounding/postcheck.ts verify the cross-check's OWN arithmetic and same-basis-ness,
// which nothing did before — added after a live run (Webuild) showed the cross-check can
// be exactly where an unverified basis mismatch surfaces even when the PRIMARY method
// (a DCF here) has no `multiple` at all for the existing basis_same gate to check.
function assumptionsCrossCheckJson(grounding: GroundingPromptContext | undefined): string {
  const crossCheckLine = grounding
    ? `  "crossCheck": {
    "method": "<a SECOND, structurally different method than the primary one — e.g. DDM, EV/RAB, SOTP>",
    "intrinsicPerShare": <BASE scenario, pre-MoS, from the second method>,
    "reconciliation": "<1-2 sentences: why the two methods diverge>",
    "bridge": {
      "driver": "<short label for the cross-check's own value driver, e.g. \\"Peer EV/EBITDA 2026e\\">",
      "driverValue": <driver's numeric value, SAME unit as the extract's meta.units>,
      "driverYear": <the fiscal year driverValue refers to>,
      "multiple": <the multiple you applied — OMIT this whole key if the cross-check method has no multiple, e.g. DDM>,
      "netDebt": <net debt used in THIS bridge, SAME unit as meta.units>,
      "minorities": <minority interests used in THIS bridge, SAME unit as meta.units>,
      "shares": <SAME unit as sharesDiluted>
    }
  }`
    : `  "crossCheck": { "method": "<a SECOND, structurally different method than the primary one — e.g. DDM, EV/RAB, SOTP>", "intrinsicPerShare": <BASE scenario, pre-MoS, from the second method>, "reconciliation": "<1-2 sentences: why the two methods diverge>" }`;
  return `  "assumptions": { "wacc": <% or null>, "roic": <% or null, on invested capital — not ROE>, "terminalGrowth": <% or null> },
${crossCheckLine}`;
}

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
export function buildDeepValueSystemPrompt({
  language = "English",
  currentDate = "",
  mosPercent = 0,
  grounding,
}: {
  language?: string;
  currentDate?: string;
  mosPercent?: number;
  // Presence alone gates GROUNDED_RULES_BLOCK — the system prompt only needs to know
  // Grounded mode is active, not the actual figures (those go in the user prompt via
  // formatGroundingForPrompt). Undefined (Quick) leaves the prompt byte-identical.
  grounding?: GroundingPromptContext;
} = {}): string {
  const dateClause = currentDate
    ? `\n**Today's date: ${currentDate}.** Use this to determine what counts as "most recent" data. Financial data from 2025 is historical — fiscal year 2025 results may or may not have been published yet; verify via web search. Do NOT assume the current year is 2025.\n`
    : "";
  const groundedRulesClause = grounding ? `\n${GROUNDED_RULES_BLOCK}\n` : "";

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
${groundedRulesClause}
## Step 3 — Compute 3 scenarios (Bull / Base / Bear)
Apply the chosen method with three scenario sets. For each scenario compute:
- Intrinsic fair value per share
- Apply a **margin of safety of ${mosPercent}%**: buy target = intrinsic value × (1 − ${mosPercent}/100)
- Upside/downside of the **buy target** vs current price (%)

**DCF**: Project 10 years of FCF, apply WACC discount, add Gordon Growth terminal value.
**DDM**: 2-stage — 10 explicit dividend years + Gordon Growth terminal. Cost of equity via CAPM.
**EV/EBITDA**: EV = EBITDA × multiple → subtract net debt → subtract minority interests, preferred equity and unfunded pension/decommissioning liabilities → add associates/JVs carried at equity → divide by shares. When consolidated EBITDA includes subsidiaries that are not wholly owned (third-party or JV stakes), the minority share of that value is not shareholders' — never treat EV − net debt as equity.
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
${scenarioJsonLine("bull", mosPercent, grounding)},
${scenarioJsonLine("base", mosPercent, grounding)},
${scenarioJsonLine("bear", mosPercent, grounding)},
${assumptionsCrossCheckJson(grounding)}
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

### Cross-check (second method)
Value the company with a SECOND, structurally different method (per rigor check 17 — not an explanation of why you picked the primary method, an actual second number) and reconcile the delta against your primary base-case intrinsic value explicitly.

## 4. Key Financial Data & Quality Metrics
Present the key data gathered in Step 2 in a structured way:
- Income and cash flow summary (last 2–3 years)
- Profitability and quality metrics (ROIC, ROE, margins, FCF conversion)
- Balance sheet health (net debt, debt/equity, current ratio)
- Historical valuation context (how current multiples compare to the 3–5 year average)

Then add a **"What must be true for the current price to be right"** subsection. Starting from the *authoritative current price*, do not stop at reporting what multiple it implies — SOLVE FOR WHAT MUST BE TRUE at your independently-anchored (history + peers) base multiple: the EBITDA/earnings level, or — for a commodity/cyclical name — the commodity price (once you FIX the multiple, per rigor check 10), that the current price would require to be correct. This is a **CONTROL, not the source of your base multiple** (rigor check 10). Then JUDGE whether those implied conditions are plausible — that judgment, not the bare gap, is the signal (e.g. "at ${language === "Italiano" ? "il prezzo corrente" : "the current price"} to be right at my Wx anchored multiple, EBITDA would need to be €Y bn, ${language === "Italiano" ? "il" : ""} Z% below/above the latest reported figure — I judge this [plausible/unlikely] because …"). If the price-implied level coincides with your anchored base, say so as a finding ("the market already prices my anchored multiple; there is little valuation edge here"), not as your method.

## 5. Bull Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target] | Probability: [probability]
What would need to go right? Key assumptions and catalysts. State the same year horizon as the bear case (rigor check 14 — horizon symmetry).

## 6. Base Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target] | Probability: [probability]
The most likely scenario. Moderate growth assumptions and current trends.

## 7. Bear Case — Intrinsic Value: [intrinsic_value] | Buy Target (−${mosPercent}% MoS): [buy_target] | Probability: [probability]
What could go wrong? Key downside risks. State explicitly whether this bear-case intrinsic value BREAKS the current market price (falls below it) — per rigor check 13, a bear that stays above the current price never contemplates the market being right. If you cannot construct a bear that breaks the price, say so and defend why no coherent adverse scenario exists at this price, rather than silently leaving the bear timid.

## 8. Key Risks
Top 3–5 risks that could derail the investment thesis.

## 9. Near-term Catalysts & Falsification Conditions
First, upcoming events or triggers (earnings releases, regulatory decisions, product launches, macro shifts) that could move the stock price materially in the next 6–12 months.
Then a distinct **"Falsification conditions"** paragraph: the specific, observable, near-term evidence that would prove THIS base-case thesis WRONG (e.g. "if the next quarter shows CFFO below €X, or the commodity settles under \$Y, or the segment margin does not recover, the base case is broken"). A catalyst is what makes you right; a falsification condition is what would make you admit you are wrong — state the latter as concrete thresholds against the next reported period, not vague risks.

## 10. Investment Summary
A concise synthesis: is this stock attractively valued at the current price? Summarize the moat rating, the base case intrinsic value, and the buy target after applying the ${mosPercent}% margin of safety. State clearly whether the current price is above or below the buy target. Then judge whether the ${mosPercent}% margin of safety is *adequate* given (a) the bull↔bear dispersion you computed and (b) the cyclicality/volatility of the business: explicitly flag when a small MoS is cosmetic relative to a wide valuation range (e.g. a 10% MoS against a bull/bear spread of several turns of the multiple offers little real protection). Do NOT change the ${mosPercent}% figure — it is the user's chosen input — only judge its adequacy.

Rules:
- Write the entire report in ${language} — every word, header, and disclaimer. Use ONLY the writing system of ${language}: never emit stray characters from another script (e.g. no CJK/Chinese/Japanese/Korean characters when the language is not one of those). If a foreign-script word slips in, replace it with its ${language} equivalent.
- Cite your sources (e.g. "According to [source]...")
- End with: "⚠️ This report is for informational purposes only and does not constitute financial advice."
- Do not write any preamble before the JSON block (no "Let me search...", "I'll start by...")`;
}

/**
 * Minimal user message — Claude sources all financial data autonomously via web search.
 *
 * @param currentDate - Today's date string injected from the server (e.g. "May 7, 2026")
 */
export function buildDeepValueUserPrompt({
  ticker,
  currentPrice,
  currency,
  language,
  currentDate = "",
  mosPercent = 0,
  grounding,
}: {
  ticker: string;
  currentPrice: number;
  currency: string;
  language: string;
  currentDate?: string;
  mosPercent?: number;
  // The Grounded data section (raw paste + extract + anchors + warnings), appended
  // after the base prompt. Undefined (Quick) appends nothing — byte-identical output.
  grounding?: GroundingPromptContext;
}): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to all fair values (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  const groundingSection = grounding ? `\n\n${formatGroundingForPrompt(grounding)}` : "";
  return `Analyze ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency} — this is the authoritative live market price. Use it as the current price for all upside/downside math; do NOT replace it with web-searched quotes, which are frequently delayed or stale.${dateClause}${mosClause}

Use web search to find the financial data, choose the appropriate valuation method, compute the fair values for bull/base/bear scenarios, and produce the report in ${language} following the required format.${groundingSection}`;
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
      "Your job is not to judge whether the thesis holds — it is to BREAK it. Construct a kill price: the specific price below which the thesis is dead, and the conditions that get there. Either build a bear scenario that breaks the current market price, or state explicitly that you cannot — which is itself the finding that no coherent adverse scenario exists at this price (see the kill price field in the JSON block below). Commit to your OWN independent bull/base/bear fair value reflecting this red-team pass — do NOT simply copy the report's values; where you disagree, your numbers should reflect that disagreement.",
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

// Structural checks shared by ALL analyst lenses, independent of persona.
// Distilled from a real external review that found the tool's three lenses each
// missed the SAME structural defects (an equity value that never deducted minority
// interests; a bull case that narrated a demerger as sum-of-the-parts while the math
// was a single consolidated multiple; a "discount vs peers" computed on mismatched
// IFRS-16 bases; a bear EBITDA inconsistent with the report's own stated sensitivity).
// Persona-specific focus areas alone did not surface these, so every lens now runs the
// same explicit structural pass. One shared block (Rule of Three), not per-lens copies.
const ANALYST_STRUCTURAL_CHECKS = `## Structural checks — always verify (regardless of your lens)
These are the defects prior reviews have repeatedly missed. Check each explicitly, even if it falls outside your persona's usual focus:
1. **EV→equity bridge is complete.** For multiple-based valuations, confirm equity = EV − net debt − minority (non-controlling) interests − preferred − unfunded pension/decommissioning + associates/JVs at equity. If the consolidated EBITDA includes subsidiaries that are NOT wholly owned (third-party or private-equity stakes, JVs), that minority share of value is not shareholders' — flag any report that treats EV − net debt as equity, and quantify the per-share overstatement.
2. **Method ↔ narrative coherence.** If the thesis leans on segment-specific value (a demerger, stake sales at segment multiples, "unlocking" a division), the math must be a genuine sum-of-the-parts with per-segment multiples — not a single blended multiple on consolidated EBITDA with the SOTP value narrated on top. Flag double-counting.
3. **Same-basis comparables.** Any peer-multiple discount/premium must compare net debt and EBITDA on the SAME basis (pre- vs post-IFRS 16, same reported/adjusted EBITDA definition) for both the subject and the peers. Flag a "discount vs peers" that may be a perimeter/definition artifact.
4. **Scenario figures vs the report's own sensitivity.** Check each scenario's operating figure against the sensitivity the report itself states (e.g. "$10/bbl of Brent ≈ €2–3bn of EBITDA"): a bear EBITDA that contradicts the bear's own commodity assumption is an internal contradiction — call it out.
5. **Anchoring & margin of safety.** Is the target multiple anchored (the company's own 3–5y distribution + closest peers with a justified discount) or hand-picked? Is the applied margin of safety adequate for the dispersion and cyclicality, or cosmetic given a wide bull↔bear range?
6. **Deterministic gates (when provided).** If the user message includes a "DETERMINISTIC GATES" section, it was computed in code from the report's own declared numbers, not your judgment. You must address every gate marked FAIL explicitly in your critique — you may not ignore it.
`;

/**
 * System prompt for one analyst-panel pass, parameterized by lens.
 *
 * @param angle - Which lens (skeptic/optimist/quality) — selects persona + focus.
 * @param language - Critique language (e.g. "English", "Italiano")
 * @param currentDate - Today's date string injected from the server
 * @param mosPercent - Margin of safety to apply to the analyst's own fair values,
 *   so its JSON buy targets are directly comparable to the base analysis's.
 * @param blindFirst - Grounded-mode-only two-phase contract (docs/deep-value-rigor-v2-spec.md
 *   §6) — never set without `grounding`. The SAME system prompt is reused across both turns
 *   (the model sees this once; only the user message differs — buildAnalystBlindUserPrompt,
 *   then buildAnalystReconcileUserPrompt), so it must describe both phases up front.
 */
export function buildAnalystSystemPrompt({
  angle = "skeptic",
  language = "English",
  currentDate = "",
  mosPercent = 0,
  grounding,
  blindFirst = false,
}: {
  angle?: AnalystAngle;
  language?: string;
  currentDate?: string;
  mosPercent?: number;
  // Presence gates GROUNDED_RULES_BLOCK, same as buildDeepValueSystemPrompt — the lens
  // reads the actual data (extract + anchors + warnings) from the user prompt via
  // formatGroundingForPrompt, re-read from Analysis.groundingJson (spec §6.4).
  grounding?: GroundingPromptContext;
  blindFirst?: boolean;
} = {}): string {
  const cfg = ANGLE_CONFIG[angle];
  const dateClause = currentDate
    ? `\n**Today's date: ${currentDate}.** Do NOT assume the current year is 2025; verify recency via web search.\n`
    : "";
  const focusList = cfg.focus.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const groundedRulesClause = grounding ? `\n${GROUNDED_RULES_BLOCK}\n` : "";
  // Skeptic-only, unconditional (a kill price doesn't require pasted data — see the
  // hardened persona above). Feeds the kill_price gate (lib/grounding/postcheck.ts).
  const killPriceLine =
    angle === "skeptic"
      ? `,\n  "killPrice": <the price below which your thesis is dead — REQUIRED; null ONLY if your critique explicitly states you could not construct one>`
      : "";

  const valuationSection = blindFirst
    ? `## Your own independent valuation (MANDATORY, TWO PHASES)
This review runs across two user messages — you will not always have the report yet.

**PHASE 1 — this message has NO report.** ${cfg.valuationFraming} Commit to it from the data and anchors given below plus web search alone, in the JSON block below, followed by a rationale of AT MOST 200 words. Do not critique anything yet (there is nothing to critique) and do not remark that the report is missing — simply commit.

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
${scenarioJsonLine("bull", mosPercent, grounding)},
${scenarioJsonLine("base", mosPercent, grounding)},
${scenarioJsonLine("bear", mosPercent, grounding)},
${assumptionsCrossCheckJson(grounding)}${killPriceLine}
}
\`\`\`

**PHASE 2 — a later message brings you the finished report.** Reconcile your Phase-1 commitment against it. For EACH scenario you may revise your Phase-1 number ONLY by citing a specific fact or arithmetic error you did NOT have in Phase 1 — "the report argues X" is NOT a reason on its own. If you have no such fact, restate your Phase-1 number unchanged. Emit the FINAL JSON — same shape as Phase 1, plus a mandatory "revisions" array (empty if you revised nothing) — followed by your critique.

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
${scenarioJsonLine("bull", mosPercent, grounding)},
${scenarioJsonLine("base", mosPercent, grounding)},
${scenarioJsonLine("bear", mosPercent, grounding)},
${assumptionsCrossCheckJson(grounding)}${killPriceLine},
  "revisions": [{ "scenario": "<bull|base|bear>", "from": <your Phase-1 fairValue for this scenario>, "to": <your Phase-2 fairValue>, "reason": "<the specific fact or arithmetic error that justifies the change — required for every entry>" }]
}
\`\`\`

Each \`fairValue\` is your intrinsic estimate AFTER applying a margin of safety of ${mosPercent}% (buy target = intrinsic × (1 − ${mosPercent}/100)) — same convention as the report under review, so the two are directly comparable.`
    : `## Your own independent valuation (MANDATORY)
${cfg.valuationFraming}

Emit it as a JSON block that MUST be the very FIRST thing you output, before any critique text:

\`\`\`json
{
  "method": "<DCF|DDM|EV/EBITDA|P/B>",
  "sector": "<sector name>",
  "currency": "<ISO currency code, e.g. USD, EUR>",
${scenarioJsonLine("bull", mosPercent, grounding)},
${scenarioJsonLine("base", mosPercent, grounding)},
${scenarioJsonLine("bear", mosPercent, grounding)},
${assumptionsCrossCheckJson(grounding)}${killPriceLine}
}
\`\`\`

Each \`fairValue\` is your intrinsic estimate AFTER applying a margin of safety of ${mosPercent}% (buy target = intrinsic × (1 − ${mosPercent}/100)) — same convention as the report under review, so the two are directly comparable. After the JSON block, write the critique.`;

  return `You are ${cfg.persona}
${dateClause}
Read the report provided in the user message and critically stress-test it. Use web search to spot-check the most load-bearing figures (revenue, margins, FCF/EBITDA, net debt, shares, growth rate, discount rate, terminal assumptions) against primary sources.

**Authoritative current price.** When the user message provides a current price, it comes from a live market-data feed and is authoritative. Do NOT flag it as wrong, "overstated", or "overvalued" on the basis of web-searched quotes — those are frequently delayed, stale, or from an intraday session and often disagree with the live price. Treat the provided price as ground truth for all "is it above/below fair value" reasoning; if a web quote differs, defer to the provided price.

**No praise.** Do NOT praise the report — no "good work", no "solid analysis", no "no serious structural errors". Your entire critique is: (a) the errors you found, (b) the single most fragile assumption, (c) the ONE number that, if wrong, changes the conclusion. A reviewer who compliments has already decided the outcome. Agreeing with the report is a valid conclusion — but even then, still state (b) and (c); agreement is not a substitute for them.

Focus your review on:
${focusList}

${ANALYST_STRUCTURAL_CHECKS}${groundedRulesClause}
${valuationSection}

Rules:
- Write the critique entirely in ${language}, using ONLY that language's writing system — never emit stray characters from another script (e.g. no CJK character dropped into a Western-language sentence). If a foreign-script word slips in, replace it with its ${language} equivalent.
- Be specific and cite sources for any figure you challenge (e.g. "According to [source]...").
- Be concise: this is a review, not a second full report. Use short sections and bullet points.
- The ONLY JSON you emit is the valuation block(s) above (two, across Phase 1 and Phase 2, in a blind-first review); do NOT restate the whole report.
- **Do not escalate prescriptiveness beyond the report you review.** Your output is a second opinion on the VALUATION: commit to your own bull/base/bear and say whether the report's fair value should be revised up or down. Do NOT issue an operational trade instruction more prescriptive than the base report — no "buy at €X", "accumulate below €Y", "sell now" when the report itself only concludes "hold". Judge the number; do not originate a trade call the report did not make.
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
export function buildAnalystUserPrompt({
  angle,
  ticker,
  reportMd,
  language,
  currentDate = "",
  currentPrice,
  currency = "",
  mosPercent = 0,
  grounding,
}: {
  angle: AnalystAngle;
  ticker: string;
  reportMd: string;
  language: string;
  currentDate?: string;
  currentPrice?: number;
  currency?: string;
  mosPercent?: number;
  // Re-read from Analysis.groundingJson by the caller (verify/route.ts), never passed in
  // the request body — see spec §6.4. `blocks` is deliberately empty here even when the
  // saved analysis has raw paste blocks: the lens's job is to judge the JUDGMENT, and the
  // anchors/extract already give it that; the extra line-item detail would triple the
  // input cost across 3 Opus xhigh passes for no proportional benefit (deliberate,
  // reversible choice — see AGENTS.md).
  grounding?: GroundingPromptContext;
}): string {
  void angle; // lens is applied in the system prompt; kept in the signature for symmetry.
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const priceClause =
    currentPrice != null
      ? ` Authoritative current price (live market feed${currentDate ? `, as of ${currentDate}` : ""}): ${currentPrice.toFixed(2)} ${currency}. Treat this as the true current price; do not override it with web-searched quotes.`
      : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to your own fair values in the JSON block (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  const groundingSection = grounding ? `\n\n${formatGroundingForPrompt(grounding)}` : "";
  return `Independently review the following Deep Value report on ${ticker}.${dateClause}${priceClause}${mosClause} Scrutinize its numbers and assumptions through your lens, spot-check key figures via web search, commit to your own bull/base/bear valuation in the JSON block, and give your verdict in ${language} following the required format.

--- REPORT UNDER REVIEW ---
${reportMd}
--- END REPORT ---${groundingSection}`;
}

/**
 * PHASE 1 user message for a blind-first analyst lens (docs/deep-value-rigor-v2-spec.md
 * §6) — everything buildAnalystUserPrompt carries EXCEPT the report. The absence of
 * `reportMd` in this signature IS the point: the lens commits to its own bull/base/bear
 * from the extract/anchors alone, before it has seen the report's conclusion, so its
 * Phase-1 number cannot anchor to it. Grounded-mode only — `grounding` is required here,
 * unlike the optional param on the Quick-mode builders above (blindFirst is never set
 * without grounding, so there is never a call site without it).
 */
export function buildAnalystBlindUserPrompt({
  ticker,
  language,
  currentDate = "",
  currentPrice,
  currency = "",
  mosPercent = 0,
  grounding,
}: {
  ticker: string;
  language: string;
  currentDate?: string;
  currentPrice?: number;
  currency?: string;
  mosPercent?: number;
  grounding: GroundingPromptContext;
}): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const priceClause =
    currentPrice != null
      ? ` Authoritative current price (live market feed${currentDate ? `, as of ${currentDate}` : ""}): ${currentPrice.toFixed(2)} ${currency}. Treat this as the true current price; do not override it with web-searched quotes.`
      : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to your fair values in the JSON block (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  return `Independently value ${ticker} — this is PHASE 1 of your review. You do NOT have the report yet; it arrives in a later message.${dateClause}${priceClause}${mosClause} Use the authoritative data below plus web search (per the rules above) to commit to your own bull/base/bear valuation in the JSON block, followed by your ≤200-word rationale, in ${language}.

${formatGroundingForPrompt(grounding)}`;
}

/**
 * PHASE 2 user message for a blind-first analyst lens (docs/deep-value-rigor-v2-spec.md
 * §6) — the finished report, plus a defensive echo of the lens's own Phase-1 commitment
 * (so it cannot "forget" it mid-reconciliation) and, when available, the deterministic
 * gates already computed against the base report's own declared bridge (the model
 * declares, the code verifies — ANALYST_STRUCTURAL_CHECKS #6). The actual anti-anchoring
 * rule ("cite a NEW fact or arithmetic error, or restate unchanged") lives in the system
 * prompt (buildAnalystSystemPrompt's blindFirst branch), not here — this only supplies data.
 */
export function buildAnalystReconcileUserPrompt({
  ticker,
  reportMd,
  language,
  currentDate = "",
  mosPercent = 0,
  blind,
  gatesText,
}: {
  ticker: string;
  reportMd: string;
  language: string;
  currentDate?: string;
  mosPercent?: number;
  // The lens's own Phase-1 commitment (buy-target scale, same unit as the JSON `fairValue`
  // fields) — echoed back so it cannot silently drift from it.
  blind: Triple;
  // Deterministic gates run against the BASE report's own declared bridge, formatted as
  // plain text — present only when the base report's JSON parsed and price/currency
  // resolved server-side. Absent (not empty) when unavailable, same convention as every
  // other optional prompt section in this module.
  gatesText?: string;
}): string {
  const dateClause = currentDate ? ` Today's date: ${currentDate}.` : "";
  const mosClause = mosPercent > 0
    ? ` Apply a margin of safety of ${mosPercent}% to your fair values in the JSON block (buy target = intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  const gatesSection = gatesText ? `\n\n${gatesText}` : "";
  return `PHASE 2 — here is the finished Deep Value report on ${ticker}.${dateClause}${mosClause} Reconcile your Phase-1 commitment against it: your own bull/base/bear buy targets were bull ${blind.bull.toFixed(2)} / base ${blind.base.toFixed(2)} / bear ${blind.bear.toFixed(2)}. You may revise a scenario ONLY by citing a specific fact or arithmetic error you did NOT have in Phase 1 — "the report argues X" is NOT a reason on its own; if you have no such fact, restate your Phase-1 number unchanged. Emit the FINAL JSON (same shape as Phase 1, plus the mandatory "revisions" array) and then your critique, in ${language}.${gatesSection}

--- REPORT UNDER REVIEW ---
${reportMd}
--- END REPORT ---`;
}
