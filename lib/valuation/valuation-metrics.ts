/**
 * Computes "payback" valuation metrics that express price as years of earnings/FCF.
 *
 * These reframe classic multiples (P/E, P/FCF) in plain language: "at today's price,
 * you'd need X years of net income to buy back the whole company." Easier to grasp
 * for non-finance readers than abstract ratio numbers.
 *
 * Each metric also includes a trend direction comparing the latest annual value
 * against the prior year's — so users can see whether the underlying fundamental
 * is improving or deteriorating, independently of price moves.
 */

import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import { formatPercent } from "@/lib/format";

export type TrendDirection = "up" | "down" | "flat";

export type ValuationMetric = {
  label: string;
  value: string;
  /** null when only one year of annual data is available — no trend can be computed */
  trend: TrendDirection | null;
  /** Explains why value is "N/A" when applicable */
  tooltip?: string;
  /** Educational content shown in the clickable info popover */
  info: {
    description: string;
    howToRead: string;
  };
};

/**
 * Returns trend direction for an improving-is-higher metric (e.g. netIncome, FCF).
 * Uses ±5% as the "flat" band to filter out noise.
 *
 * @param current - Latest annual value
 * @param prior - Prior annual value (undefined if only one year exists)
 */
function trendDirection(
  current: number,
  prior: number | undefined
): TrendDirection | null {
  // Not enough data to compute a trend
  if (prior === undefined) return null;
  // Avoid division by zero when prior is exactly 0
  if (prior === 0) return null;

  const delta = (current - prior) / Math.abs(prior);
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "flat";
}

/**
 * Computes the four payback/yield metrics from quote and fundamentals data.
 *
 * Depends on annual[] being sorted oldest-first (as returned by the API).
 * If marketCap is null, all four metrics return "N/A" — this happens for some
 * non-US tickers where Yahoo doesn't provide the field.
 */
export function computeValuationMetrics(
  quote: QuoteResponse,
  fundamentals: FundamentalsResponse
): ValuationMetric[] {
  const { annual, ratios } = fundamentals;
  const marketCap = quote.marketCap;

  // Shared N/A sentinel when market cap is unavailable
  if (!marketCap || annual.length === 0) {
    const tooltip = !marketCap ? "Market cap non disponibile" : "Dati storici non disponibili";
    return [
      { label: "Anni di Utili", value: "N/A", trend: null, tooltip, info: { description: "Quanti anni di utile netto servirebbero per ripagare la market cap (= P/E).", howToRead: "Valori bassi indicano un prezzo contenuto rispetto agli utili." } },
      { label: "Anni di FCF", value: "N/A", trend: null, tooltip, info: { description: "Quanti anni di Free Cash Flow servirebbero per ripagare la market cap (= P/FCF).", howToRead: "Più affidabile del P/E perché il FCF è meno manipolabile contabilmente." } },
      { label: "FCF Yield", value: "N/A", trend: null, tooltip, info: { description: "Free Cash Flow / Market Cap × 100. Inverso del P/FCF.", howToRead: "Confrontalo con il rendimento del BTP/Treasury 10Y." } },
      { label: "Earnings Yield", value: "N/A", trend: null, tooltip, info: { description: "Utile Netto / Market Cap × 100. Inverso del P/E.", howToRead: "Se supera il tasso risk-free, stai pagando l'azienda meno di un'obbligazione governativa." } },
    ];
  }

  const latest = annual[annual.length - 1];
  const prior = annual.length >= 2 ? annual[annual.length - 2] : undefined;

  // ── Anni di Utili (= P/E reframed as years) ──────────────────────────────
  // Prefer ratios.pe (TTM-based, more accurate than dividing by one annual year)
  // but fall back to marketCap / latestNetIncome when ratios.pe is missing.
  let anniUtiliValue: string;
  let anniUtiliTooltip: string | undefined;
  const peFromRatios = ratios.pe !== null && ratios.pe !== undefined && ratios.pe > 0 ? ratios.pe : null;
  if (peFromRatios !== null) {
    anniUtiliValue = `${peFromRatios.toFixed(1)}x`;
  } else if (latest.netIncome > 0) {
    anniUtiliValue = `${(marketCap / latest.netIncome).toFixed(1)}x`;
  } else {
    anniUtiliValue = "N/A";
    anniUtiliTooltip = "Richiede utile netto positivo";
  }
  const niTrend = trendDirection(latest.netIncome, prior?.netIncome);

  // ── Anni di FCF (= Price/FCF ratio) ──────────────────────────────────────
  let anniFcfValue: string;
  let anniFcfTooltip: string | undefined;
  if (latest.fcf > 0) {
    anniFcfValue = `${(marketCap / latest.fcf).toFixed(1)}x`;
  } else {
    anniFcfValue = "N/A";
    anniFcfTooltip = "Richiede FCF positivo";
  }
  const fcfTrend = trendDirection(latest.fcf, prior?.fcf);

  // ── FCF Yield = FCF / marketCap ───────────────────────────────────────────
  // formatPercent expects a decimal (0.05 → "5.00%")
  let fcfYieldValue: string;
  let fcfYieldTooltip: string | undefined;
  if (latest.fcf > 0) {
    fcfYieldValue = formatPercent(latest.fcf / marketCap, 2);
  } else {
    fcfYieldValue = "N/A";
    fcfYieldTooltip = "Richiede FCF positivo";
  }

  // ── Earnings Yield = netIncome / marketCap ────────────────────────────────
  let earningsYieldValue: string;
  let earningsYieldTooltip: string | undefined;
  if (latest.netIncome > 0) {
    earningsYieldValue = formatPercent(latest.netIncome / marketCap, 2);
  } else {
    earningsYieldValue = "N/A";
    earningsYieldTooltip = "Richiede utile netto positivo";
  }

  return [
    {
      label: "Anni di Utili",
      value: anniUtiliValue,
      trend: anniUtiliValue !== "N/A" ? niTrend : null,
      tooltip: anniUtiliTooltip,
      info: {
        description:
          "Quanti anni di utile netto (dopo le tasse) servirebbero, al ritmo attuale, per ripagare l'intera capitalizzazione di mercato. È il classico rapporto P/E (Prezzo / Utile) riformulato in linguaggio naturale.",
        howToRead:
          "Valori bassi (es. 10–15x) indicano un prezzo contenuto rispetto agli utili. Valori molto alti (>40x) implicano aspettative di crescita elevate già prezzate. Settori maturi tendono ad avere multipli più bassi di quelli tecnologici o in forte crescita.",
      },
    },
    {
      label: "Anni di FCF",
      value: anniFcfValue,
      trend: anniFcfValue !== "N/A" ? fcfTrend : null,
      tooltip: anniFcfTooltip,
      info: {
        description:
          "Quanti anni di Free Cash Flow (cassa generata dopo capex) servirebbero per ripagare la market cap. È il rapporto Prezzo / FCF, considerato più affidabile del P/E perché il FCF è più difficile da manipolare contabilmente degli utili.",
        howToRead:
          "Sotto 20x è spesso considerato ragionevole; sopra 30–35x implica una forte scommessa sulla crescita futura. Se Anni di FCF è molto più alto di Anni di Utili, l'azienda converte poco dell'utile contabile in vera cassa (attenzione a capex elevati o working capital che assorbe liquidità).",
      },
    },
    {
      label: "FCF Yield",
      value: fcfYieldValue,
      trend: fcfYieldValue !== "N/A" ? fcfTrend : null,
      tooltip: fcfYieldTooltip,
      info: {
        description:
          "Quanto Free Cash Flow l'azienda genera ogni anno rispetto alla sua capitalizzazione di mercato, espresso in percentuale. È l'inverso del P/FCF: FCF / Market Cap × 100.",
        howToRead:
          "Più è alto, meglio è. Puoi confrontarlo con il rendimento del BTP/Treasury 10Y: se l'FCF Yield è superiore al tasso privo di rischio, l'azienda sta generando più cassa di quanto offrirebbero i titoli di stato. Un FCF Yield >5% è spesso considerato interessante per chi cerca valore.",
      },
    },
    {
      label: "Earnings Yield",
      value: earningsYieldValue,
      trend: earningsYieldValue !== "N/A" ? niTrend : null,
      tooltip: earningsYieldTooltip,
      info: {
        description:
          "Quanto utile netto l'azienda genera ogni anno rispetto alla sua capitalizzazione di mercato, espresso in percentuale. È l'inverso del P/E: Utile Netto / Market Cap × 100.",
        howToRead:
          "Più è alto, meglio è. Come l'FCF Yield, è direttamente confrontabile con il rendimento dei titoli di stato: se è superiore al tasso risk-free, stai pagando l'azienda meno di quanto rende un'obbligazione governativa. Benjamin Graham usava questa metrica per filtrare le azioni sottovalutate.",
      },
    },
  ];
}
