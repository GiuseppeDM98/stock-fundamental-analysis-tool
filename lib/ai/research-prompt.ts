// Prompt builders for the research stage (app/api/ai/research): the model collects the
// company's REPORTED financials, historical multiples, peers and forward estimates from
// primary sources, which the route turns into a FinancialDataset with a source on every row.
// Since 2026-11-22 the research is three requests (lib/ai/research-parts.ts), each with its
// own system prompt and JSON block: the statements, then the multiples and peers, then the
// estimates. The rules on sources, the three "Never", the sources list, the output and the
// format rules are the same text in all three; the task, the first source, the tool budget,
// what to collect, the units and the example change per part. Pure, no server-only.
//
// What the model does NOT get, on purpose: the share price, any position, any earlier
// estimate (the research is position-blind like the valuation, CLAUDE.md), and any pasted
// data (a paste is merged with the web dataset deterministically on the server,
// lib/datasets/merge-sources.ts, so the provenance of every row stays clean).
//
// Each example JSON below and its part's schema (RESEARCH_PART_SCHEMAS,
// lib/ai/research-schema.ts) state the same keys; __tests__/research-contract.test.ts reads
// the examples back with lastJsonFence and compares them key for key.
import { RESEARCH_MAX_PDFS, RESEARCH_PART_BUDGET } from "@/lib/ai/research-parts";
import type { ResearchPart } from "@/types/dataset";

const META_EXAMPLE = `  "meta": {
    "reportingCurrency": "EUR",
    "units": "millions",
    "latestPeriodLabel": "FY2025",
    "fiscalYearEnd": "December",
    "notes": "EBITDA is the company's adjusted EBITDA; FY2021 cash flow not published."
  }`;

const SOURCES_EXAMPLE = `  "sources": [
    {
      "id": "pr25",
      "url": "https://investors.example.com/results/fy2025-results",
      "title": "FY2025 results press release",
      "asOf": "2026-03-05",
      "kind": "press_release"
    }
  ]`;

const FINANCIALS_EXAMPLE = `  "financials": [
    {
      "fiscalYear": 2025,
      "revenue": 1000,
      "ebitda": 200,
      "ebit": 150,
      "netIncome": 100,
      "eps": 2.0,
      "sharesDiluted": 50,
      "dividendsPerShare": 1.0,
      "totalEquity": 600,
      "minorityInterest": 20,
      "totalDebt": 400,
      "cashAndEquivalents": 100,
      "netDebt": 300,
      "cfo": 180,
      "capex": -60,
      "depreciationAmortization": 50,
      "freeCashFlow": 120,
      "sourceIds": { "income": "pr25", "balance": "pr25", "cashFlow": "pr25" }
    }
  ]`;

const MULTIPLES_EXAMPLE = `  "multiples": [
    {
      "fiscalYear": 2025,
      "evEbitda": 8.0,
      "evSales": 1.6,
      "pe": 12.0,
      "pb": 2.0,
      "fcfYield": 10.0,
      "dividendYield": 4.2,
      "marketCap": 1200,
      "enterpriseValue": 1600,
      "sourceId": "pr25"
    }
  ]`;

const PEERS_EXAMPLE = `  "peers": [
    {
      "ticker": "PEER.MI",
      "companyName": "Peer Example S.p.A.",
      "multiples": [
        {
          "fiscalYear": 2025,
          "evEbitda": 7.5,
          "evSales": 1.4,
          "pe": 11.0,
          "pb": 1.8,
          "fcfYield": null,
          "dividendYield": 4.8,
          "marketCap": 900,
          "enterpriseValue": 1300,
          "sourceId": "pr25"
        }
      ]
    }
  ]`;

const ESTIMATES_EXAMPLE = `  "estimates": [
    { "fiscalYear": 2026, "revenue": 1050, "ebitda": 215, "ebit": 160, "netIncome": 108, "eps": 2.16, "sourceId": "pr25" }
  ]`;

const jsonExample = (members: string[]) => `\`\`\`json\n{\n${members.join(",\n")}\n}\n\`\`\``;

const FISCAL_YEAR_LINE = "fiscalYear is the calendar year in which the fiscal year ENDS (a March-2026 year-end is 2026):";

const PARTS_UNITS = `UNITS: the statements step already declared the reporting currency and the units (they are in the user message): every monetary value on that scale, peers included; per-share values in plain currency; yields in percentage points (4.2 = 4.2%).`;

const IR_HTML_ONLY = "1. The company's own investor-relations site: results press releases and HTML pages. Do not fetch a PDF in this step.";

const PART_NOTES_RULE = "- notes is at most 500 characters: what you could not find.";

/** What changes from one part to the next; every other line of the prompt is shared. */
const PART_TEXT: Record<
  ResearchPart,
  { task: string; scope: string; firstSource: string; collect: string; units: string; example: string; lastFormatRule: string }
> = {
  statements: {
    task: "Your ONLY job is to collect the company's REPORTED historical financial statements from primary sources and return them as structured JSON.",
    scope: "You do not value the company, do not estimate, do not fill gaps.",
    firstSource: `1. The company's own investor-relations site: results press releases and HTML pages first; annual reports / 10-K / 20-F as PDF only when the figures are not on an HTML page. Fetch at most ${RESEARCH_MAX_PDFS} PDF documents in this step (a PDF is read in full and is expensive): prefer press releases.`,
    collect: `WHAT TO COLLECT — the last 5 fiscal years (minimum 3), group/consolidated, same basis every year.
${FISCAL_YEAR_LINE}
- income statement: revenue, ebitda (prefer the company's ADJUSTED/normalized EBITDA when it
  publishes both; say which in meta.notes; when it publishes no EBITDA at all, ebitda is null —
  the server computes EBIT + D&A from your ebit and depreciationAmortization), ebit, netIncome attributable to the parent, diluted
  eps, weighted-average diluted shares (sharesDiluted), dividendsPerShare (total ordinary DPS
  declared for that fiscal year; 0 when the company paid nothing that year, null when unknown);
- balance sheet: totalEquity attributable, minorityInterest, totalDebt, cashAndEquivalents, netDebt
  (as the company reports it; if it reports only one of netDebt / debt+cash, leave the other null);
- cash flow: cfo, capex (sign as reported), depreciationAmortization (depreciation of property,
  plant, equipment and right-of-use assets plus amortization of intangibles, as a positive number;
  without impairments when the company reports them on their own line), freeCashFlow (company
  definition if published, else null).`,
    units: `UNITS: declare meta.reportingCurrency (the currency of the FILINGS — it may differ from the trading
currency) and meta.units once (one of billions, millions, thousands, units); every monetary value
on that scale, peers included; shares on the SAME scale; per-share values in plain currency;
yields in percentage points (4.2 = 4.2%).`,
    example: jsonExample([META_EXAMPLE, SOURCES_EXAMPLE, FINANCIALS_EXAMPLE]),
    lastFormatRule: "- meta.notes is at most 500 characters: the EBITDA definition used, restatements, gaps.",
  },
  market: {
    task: "Your ONLY job is to collect the company's historical valuation multiples and its peers' current multiples from primary sources and return them as structured JSON.",
    scope: "You do not value the company, do not estimate, do not fill gaps.",
    firstSource: IR_HTML_ONLY,
    collect: `WHAT TO COLLECT — valuation multiples, nothing else.
${FISCAL_YEAR_LINE}
- valuation multiples for the last 5 fiscal years: evEbitda, evSales, pe, pb, fcfYield %, dividendYield %, marketCap, enterpriseValue (only when the source gives them);
- 3–5 closest listed peers with their CURRENT multiples (same fields as above, one row each, with
  fiscalYear = the company's latest closed fiscal year).`,
    units: PARTS_UNITS,
    example: jsonExample([`  "notes": "EV/EBITDA from the provider; FY2021 not published."`, SOURCES_EXAMPLE, MULTIPLES_EXAMPLE, PEERS_EXAMPLE]),
    lastFormatRule: PART_NOTES_RULE,
  },
  estimates: {
    task: "Your ONLY job is to collect the forward estimates for the company's next two fiscal years and return them as structured JSON.",
    scope: "You do not value the company and do not make your own estimates: you collect the published ones.",
    firstSource: IR_HTML_ONLY,
    collect: `WHAT TO COLLECT — forward estimates, nothing else.
${FISCAL_YEAR_LINE}
- forward estimates for the next 2 fiscal years (revenue, ebitda, ebit, netIncome, eps) from the
  company's guidance or a consensus page — never a target price.`,
    units: PARTS_UNITS,
    example: jsonExample([`  "notes": "No consensus page found for FY2027."`, SOURCES_EXAMPLE, ESTIMATES_EXAMPLE]),
    lastFormatRule: PART_NOTES_RULE,
  },
};

/** The research system prompt of one part. `currentDate` is the server's date, the model's
 *  only source of "now" (it otherwise anchors to its training year). The same text goes to
 *  both providers: on DeepSeek a search past the stated number is still run (only the loop's
 *  rounds bound them), so the budget sentence promises an error on the fetches only. */
export function buildResearchSystemPrompt({ currentDate, part }: { currentDate: string; part: ResearchPart }): string {
  const text = PART_TEXT[part];
  const { searches, fetches } = RESEARCH_PART_BUDGET[part];
  return `You are a financial-data researcher. ${text.task}
${text.scope}
Today's date: ${currentDate} (the only source of "now"; the latest fiscal year is the latest one CLOSED before this date).

SOURCES — in this order of preference, and say which you used:
${text.firstSource}
2. Regulator filings (SEC EDGAR, the home exchange's filing service).
3. Reputable data providers ONLY for historical valuation multiples (EV/EBITDA, P/E, P/B, EV/Sales,
   yields, market cap, EV per fiscal year) when the company does not publish them.
Never use analyst target prices, ratings or target multiples. Never use a figure you have not seen
on a fetched or searched page: a number you cannot source is null.
Never compute a figure from other figures (a ratio times a total, a sum, a difference, a margin
applied to revenue): a value no source states is null, and the server does the arithmetic it
needs. The one exception is the full-year ordinary DPS as interim + final when the company states both.
Read a document with web_fetch before you take figures from it: a search snippet is not the
document. You have ${searches} searches and ${fetches} fetches in this step: stay within them (a fetch past the budget returns an error). Fetch the pages that carry the most figures (a results
press release with the full statements, a multi-year summary table) before single-figure pages.

${text.collect}

${text.units}
SOURCES LIST: at most 30 entries; every page you used gets an entry in "sources" (id ≤ 10 chars,
absolute https url, title ≤ 200 chars, asOf = the date the page states for its data as YYYY,
YYYY-MM or YYYY-MM-DD, kind = annual_report | filing | press_release | ir_page | data_provider |
other). Use the exact URL of the page you searched or fetched, not a shortened or rewritten one.
Every row names its sources: financials rows carry "sourceIds" with one id per statement (income,
balance, cashFlow); multiples/estimates/peer rows carry one "sourceId". A row whose source you
cannot name must not exist.
OUTPUT: write a short research log (which documents you fetched, which figures you could not find),
then — as the very LAST thing — one fenced JSON block (language tag json) in the shape below.
Nothing after the fence.

${text.example}

FORMAT RULES for the JSON block:
- Exactly the keys shown, in every row; a value you could not source is null, never omitted.
- Numbers are plain JSON numbers: no thousands separators, no currency signs, no strings, no
  percent signs.
- One row per fiscal year in each array, ascending or descending (the server sorts them).
${text.lastFormatRule}
- No comments inside the JSON.`;
}

type Listing = { ticker: string; companyName: string; exchange: string; quoteCurrency: string };

const listingOf = (exchange: string) => (exchange === "UNKNOWN" ? "" : `, listed on ${exchange}`);

/** The statements part's user prompt. The share price is deliberately absent (position-blind);
 *  the trading currency is given and labelled as such, because the filings may report in
 *  another one (an LSE line quoted in GBp, a Milan listing reporting in USD). */
export function buildResearchUserPrompt({ ticker, companyName, exchange, quoteCurrency }: Listing): string {
  return `Research ${companyName} (${ticker}${listingOf(exchange)}; the share trades in ${quoteCurrency}). The reporting currency may differ from the trading currency — read it from the filings and declare it in meta.reportingCurrency. Fetch the primary documents; return the JSON.`;
}

/** The user prompt of the parts after the statements: what the statements declared (currency,
 *  units, calendar), so that multiples, peers and estimates come on the same scale and for the
 *  right years. Never the price, as in the statements part.
 *  @param fiscalYears The distinct fiscal years of the statements, ascending. */
export function buildResearchPartUserPrompt({
  ticker,
  companyName,
  exchange,
  quoteCurrency,
  meta,
  fiscalYears,
}: Listing & {
  meta: { reportingCurrency: string; units: string | null; fiscalYearEnd: string | null; latestPeriodLabel: string | null };
  fiscalYears: number[];
}): string {
  return `Research ${companyName} (${ticker}${listingOf(exchange)}; the share trades in ${quoteCurrency}). The statements already collected report in ${meta.reportingCurrency}, in ${meta.units ?? "units not stated"}, fiscal year end ${meta.fiscalYearEnd ?? "not stated"}, latest period ${meta.latestPeriodLabel ?? "not stated"}, fiscal years ${fiscalYears.join(", ")}. Return the JSON.`;
}
