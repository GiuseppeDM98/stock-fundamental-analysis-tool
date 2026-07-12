/**
 * Prompt builders for the Grounded Deep Value extraction endpoint (Sonnet 5, no web
 * search — pure transcription, not judgment). One call per pasted block, scoped by
 * `GroundingBlockKind` so the model only ever attempts the fields relevant to that
 * block's statement type — narrower schema, fewer degrees of freedom, less hallucination
 * risk (docs/deep-value-grounding-spec.md §6.2).
 *
 * KEEP THE JSON EXAMPLE BELOW IN SYNC, FIELD-FOR-FIELD, WITH THE ZOD SCHEMA in
 * app/api/ai/grounding/extract/route.ts — the pair together IS the output contract
 * (spec §6.2: "il JSON di esempio nel prompt deve stare in corrispondenza 1:1 con lo
 * schema Zod"). Plain string builders (no server-only): imported by that route only.
 */
import type { GroundingBlockKind } from "@/types/grounding";

type KindConfig = {
  // English label used only inside the LLM prompt (not user-facing — the UI's own
  // labels go through t(), see components/grounding-input.tsx).
  label: string;
  // Bullet list of exactly which fields to extract for this block kind.
  instructions: string;
  // Fenced-JSON example — must match the kind's Zod schema in the extract route field-for-field.
  example: string;
};

const KIND_CONFIG: Record<GroundingBlockKind, KindConfig> = {
  income_statement: {
    label: "income statement",
    instructions: `For this INCOME STATEMENT block, extract one row per fiscal year with ONLY these fields:
- revenue, ebitda, ebit, netIncome (attributable to the parent company)
- eps (diluted, per share)
- sharesDiluted — the weighted-average diluted share count, on the SAME scale as the monetary values (see UNIT NOTE)
- dividendsPerShare
Do NOT extract balance-sheet or cash-flow fields here (no totalEquity, netDebt, cfo, etc.) — those come from other blocks.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "rows": [
    { "fiscalYear": 2025, "revenue": 93727, "ebitda": 14700, "ebit": 6200, "netIncome": 4765, "eps": 1.51, "sharesDiluted": 3150, "dividendsPerShare": 0.94 }
  ]
}`,
  },
  balance_sheet: {
    label: "balance sheet",
    instructions: `For this BALANCE SHEET block, extract one row per fiscal year (or as-of date) with ONLY these fields:
- totalEquity (attributable to the parent company)
- minorityInterest — non-controlling interests (NCI); this is the single most commonly missed field, look carefully
- totalDebt, cashAndEquivalents, netDebt
Do NOT extract income-statement or cash-flow fields here.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "rows": [
    { "fiscalYear": 2025, "totalEquity": 45200, "minorityInterest": 3200, "totalDebt": 20100, "cashAndEquivalents": 8600, "netDebt": 11500 }
  ]
}`,
  },
  cash_flow: {
    label: "cash flow statement",
    instructions: `For this CASH FLOW block, extract one row per fiscal year with ONLY these fields:
- cfo — cash flow from operations
- capex — capital expenditure (preserve the sign as shown in the source; often negative)
- freeCashFlow
Do NOT extract income-statement or balance-sheet fields here.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "rows": [
    { "fiscalYear": 2025, "cfo": 12800, "capex": -8200, "freeCashFlow": 4600 }
  ]
}`,
  },
  valuation_multiples: {
    label: "historical valuation multiples",
    instructions: `For this HISTORICAL MULTIPLES block, extract one row per fiscal year with ONLY these fields:
- evEbitda, evSales, pe, pb
- fcfYield, dividendYield — as PERCENTAGES (e.g. 6.2 for 6.2%, not 0.062)`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "rows": [
    { "fiscalYear": 2025, "evEbitda": 3.8, "evSales": 0.6, "pe": 9.2, "pb": 0.9, "fcfYield": 8.1, "dividendYield": 6.2 }
  ]
}`,
  },
  estimates: {
    label: "forward estimates",
    instructions: `For this FORWARD ESTIMATES block, extract one row per FUTURE fiscal year with ONLY these fields:
- revenue, ebitda, ebit, netIncome, eps
Do NOT extract or infer a target price, target multiple, or analyst rating — those are deliberately out of scope for this feature, even if the pasted text contains them. If the text is only a target-price/rating table with no operating estimates, return an empty rows array.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "rows": [
    { "fiscalYear": 2026, "revenue": 95000, "ebitda": 15100, "ebit": 6500, "netIncome": 4900, "eps": 1.58 }
  ]
}`,
  },
  peer_valuation: {
    label: "peer valuation",
    instructions: `For this PEER block, extract:
- companyName — the peer's full company name, if stated (null if not)
- rows — one row per fiscal year (or a single "current"/TTM row) with ONLY: evEbitda, evSales, pe, pb, fcfYield, dividendYield (percentages)
The peer's ticker is already known from context — do not try to extract it.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "companyName": "Shell plc",
  "rows": [
    { "fiscalYear": 2025, "evEbitda": 4.1, "evSales": null, "pe": 10.1, "pb": 1.2, "fcfYield": null, "dividendYield": 4.0 }
  ]
}`,
  },
  other: {
    label: "financial data",
    instructions: `This block didn't fit one of the specific categories. Extract whatever you can find into the appropriate array(s) — "financials" (income/balance/cash-flow fields, full shape below), "multiples" (valuation multiples), "estimates" (forward operating estimates). OMIT an entire array if the text has nothing for it (do not emit an empty array). Every row you DO include must state EVERY field of its shape — null for anything not present, never omit a key.`,
    example: `{
  "meta": { "reportingCurrency": "EUR", "units": "millions", "latestPeriodLabel": "FY2025", "fiscalYearEnd": "December" },
  "financials": [
    { "fiscalYear": 2025, "revenue": 93727, "ebitda": 14700, "ebit": 6200, "netIncome": 4765, "eps": 1.51, "totalEquity": 45200, "minorityInterest": 3200, "totalDebt": 20100, "cashAndEquivalents": 8600, "netDebt": 11500, "sharesDiluted": 3150, "cfo": 12800, "capex": -8200, "freeCashFlow": 4600, "dividendsPerShare": 0.94 }
  ],
  "multiples": [
    { "fiscalYear": 2025, "evEbitda": 3.8, "evSales": 0.6, "pe": 9.2, "pb": 0.9, "fcfYield": 8.1, "dividendYield": 6.2 }
  ],
  "estimates": [
    { "fiscalYear": 2026, "revenue": 95000, "ebitda": 15100, "ebit": 6500, "netIncome": 4900, "eps": 1.58 }
  ]
}`,
  },
};

/**
 * System prompt for one block's extraction call. Transcription only — the model must
 * not calculate, infer, or complete missing values (that discretion is exactly what the
 * rest of the Grounded feature exists to remove from the valuation, so it can't be
 * allowed to creep back in at the transcription step).
 */
export function buildGroundingExtractSystemPrompt({ kind }: { kind: GroundingBlockKind }): string {
  const cfg = KIND_CONFIG[kind];
  return `You are a financial-data transcription assistant. Your ONLY job is to transcribe the pasted ${cfg.label} table below into structured JSON — you do NOT calculate, infer, estimate, or complete missing values.

RULES (mandatory):
- Transcribe ONLY what is explicitly present in the text. If a value is not stated, output null — never estimate, infer, or carry a value forward from another year.
- Do NOT perform any arithmetic (no computing ratios, no summing, no unit conversion) — copy the numbers as given in the source.
- UNIT NOTE (critical): infer meta.units — the paste's reporting scale ("billions" | "millions" | "thousands" | "units") — from the table's headers/footnotes, and report EVERY monetary value on that SAME scale. Share counts MUST be on the SAME scale as the monetary values too: if units is "millions", a share count of 3.15 billion shares is reported as 3150 — not 3150000000 and not 3.15.
- meta.reportingCurrency is the currency the table is denominated in (e.g. "EUR", "USD") — infer from a header/footnote symbol or label; null if genuinely unclear.
- meta.latestPeriodLabel is the most recent period covered by THIS block (e.g. "FY2025" or "Q1 2026"). meta.fiscalYearEnd is the month the fiscal year ends (e.g. "December"), if stated.
- Preserve the sign shown in the source (e.g. capex is often shown as a negative outflow) — don't force a sign convention.
- Only include rows for fiscal years actually present in the text — never fabricate a year.

${cfg.instructions}

OUTPUT — return ONLY this JSON block, with no prose before or after:
\`\`\`json
${cfg.example}
\`\`\`
`;
}

/** User message carrying the raw pasted text for one block. */
export function buildGroundingExtractUserPrompt({
  kind,
  text,
  peerTicker,
}: {
  kind: GroundingBlockKind;
  text: string;
  peerTicker?: string;
}): string {
  const cfg = KIND_CONFIG[kind];
  const peerClause = kind === "peer_valuation" && peerTicker ? ` This table is for the peer company with ticker ${peerTicker}.` : "";
  return `Transcribe the following pasted ${cfg.label} table into the required JSON.${peerClause}

--- PASTED TEXT ---
${text}
--- END PASTED TEXT ---`;
}
