import { Resend } from "resend";
import type { AnalystAngle } from "@/types/analysis";
import type { EarningsConfidence } from "@/types/earnings";

// Lazily initialized — avoids throwing during build when the env var is absent.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Italian display names for the analyst lenses (the digest is Italian-only).
const ANALYST_LABEL_IT: Record<AnalystAngle, string> = {
  skeptic: "Scettico",
  optimist: "Rialzista",
  quality: "Qualità",
};

// One watched ticker, priced against the user's latest saved Deep Value analysis. All
// fair-value fields are on the intrinsic scale; `adjustedBase` is the base buy target
// (intrinsic base discounted by the watchlist item's own MoS). The analyst opinions +
// consensus are empty/null when no analyst-panel pass has run on the analysis.
export interface DigestItem {
  ticker: string;
  companyName: string;
  method: string;
  currency: string;
  // Analysis intrinsic fair values
  fairValueBear: number;
  fairValueBase: number;
  fairValueBull: number;
  // Independent analyst-panel opinions on the intrinsic scale — one entry per lens that
  // has run (empty when none).
  analysts: { angle: AnalystAngle; bear: number; base: number; bull: number }[];
  // Consensus = per-scenario mean of the analysis + every analyst — null when none ran
  consensusBear: number | null;
  consensusBase: number | null;
  consensusBull: number | null;
  currentPrice: number | null;
  // Watchlist item MoS (fraction) and the resulting base buy target
  mosPercent: number;
  adjustedBase: number;
  // (adjustedBase - currentPrice) / currentPrice — null when price unknown
  upside: number | null;
  status: "under" | "over" | "unknown";
  // ISO timestamp of the analysis the values come from
  analysisDate: string;
  // User's open-position holding for this ticker, aggregated across all open lots —
  // null when the user holds no open position. WAC is assumed to share `currency`
  // (same ticker, same instrument).
  holdingShares: number | null;
  holdingWeightedAvgCost: number | null;
  // Next-earnings date from the user's stored EarningsEstimate (AI-sourced, on-demand —
  // the cron never runs the lookup itself). Null when the user never fetched it for this
  // ticker. The AI only ever persists a *future* date or null, so a stored date that has
  // since passed means the user hasn't refreshed it since the report — that's what lets
  // the digest show "days ago" without a separate "last earnings" field.
  nextEarningsDate: string | null;
  earningsConfidence: EarningsConfidence | null;
}

// ─── Ledger palette (inline for email clients) ────────────────────────────────
const C = {
  bg: "#0a101f",
  card: "#121a2b",
  border: "#1e293b",
  text: "#e2e8f0",
  muted: "#7b8ba9",
  faint: "#475569",
  accent: "#38bdf8",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
};

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole calendar days between today and `dateIso` — positive = future, negative = past.
// Compares at day granularity (both sides zeroed to midnight) so "today" reads as 0
// regardless of the time-of-day the cron happens to run at.
function daysUntil(dateIso: string): number {
  const target = new Date(dateIso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

// Next/last-earnings line, shown only when the user has fetched an estimate for this
// ticker. Three cases: today, N days from now (future, still the "next" report), or N
// days ago (the stored date has already passed — a nudge to refresh, since the AI never
// persists a past date, only a future one that later became stale).
function earningsNote(item: DigestItem): string {
  if (!item.nextEarningsDate) return "";
  const days = daysUntil(item.nextEarningsDate);
  const approx = item.earningsConfidence !== "confirmed" ? "~" : "";
  let text: string;
  if (days === 0) {
    text = "📅 Risultati finanziari oggi";
  } else if (days > 0) {
    text = `📅 Mancano ${approx}${days} ${days === 1 ? "giorno" : "giorni"} ai prossimi risultati`;
  } else {
    const ago = Math.abs(days);
    text = `📅 Sono passati ${ago} ${ago === 1 ? "giorno" : "giorni"} dai risultati attesi — aggiorna la data`;
  }
  return `<div style="margin-top:6px;font-size:12px;color:${C.muted};">${text}</div>`;
}

function statusBadge(status: DigestItem["status"]): string {
  if (status === "under") {
    return `<span style="background:${C.emerald};color:#022c22;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Sotto buy target</span>`;
  }
  if (status === "over") {
    return `<span style="background:${C.rose};color:#fff0f3;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Sopra buy target</span>`;
  }
  return `<span style="color:${C.muted};">—</span>`;
}

// The price's distance from the base buy target — the actionable number. Negative = below
// target (an opportunity), positive = still above target.
function priceVsTargetCell(item: DigestItem): string {
  if (item.currentPrice === null) return `<span style="color:${C.muted};">—</span>`;
  const dist = ((item.currentPrice - item.adjustedBase) / item.adjustedBase) * 100;
  const below = dist <= 0;
  const color = below ? C.emerald : C.amber;
  const word = below ? "sotto" : "sopra";
  return `<span style="color:${color};font-weight:600;">${Math.abs(dist).toFixed(1)}% ${word} il buy target</span>`;
}

// One row of the per-ticker valuation table (Bear / Base / Bull), used for the analysis,
// each analyst and the consensus line. `emphasize` styles the consensus row.
function fvRow(label: string, bear: number, base: number, bull: number, currency: string, emphasize = false): string {
  const labelColor = emphasize ? C.accent : C.muted;
  const valColor = emphasize ? C.text : "#94a3b8";
  const weight = emphasize ? "600" : "400";
  return `
    <tr>
      <td style="padding:4px 0;color:${labelColor};font-size:11px;font-weight:600;">${label}</td>
      <td style="padding:4px 8px;text-align:right;color:${valColor};font-weight:${weight};">${formatPrice(bear, currency)}</td>
      <td style="padding:4px 8px;text-align:right;color:${valColor};font-weight:${weight};">${formatPrice(base, currency)}</td>
      <td style="padding:4px 0 4px 8px;text-align:right;color:${valColor};font-weight:${weight};">${formatPrice(bull, currency)}</td>
    </tr>`;
}

// A single ticker card: header + price/target line + optional under-target note + a
// valuation table (analysis, reviewer, consensus when present) + the buy target + footer.
function buildCard(item: DigestItem): string {
  const hasConsensus =
    item.consensusBear !== null && item.consensusBase !== null && item.consensusBull !== null;

  const priceStr = item.currentPrice !== null ? formatPrice(item.currentPrice, item.currency) : "—";

  const hasPosition = item.holdingShares !== null && item.holdingWeightedAvgCost !== null;
  const pnlPercent =
    hasPosition && item.currentPrice !== null
      ? ((item.currentPrice - item.holdingWeightedAvgCost!) / item.holdingWeightedAvgCost!) * 100
      : null;

  // Shown whenever the user already holds this ticker, regardless of buy-target status —
  // live P&L context is useful even when the price is currently above the buy target.
  const positionLine = hasPosition
    ? `<div style="margin-top:6px;font-size:12px;color:${C.muted};">
         In portafoglio: <span style="color:${C.text};">${item.holdingShares}</span> az. · PMC ${formatPrice(item.holdingWeightedAvgCost!, item.currency)}
         ${pnlPercent !== null ? `· <span style="color:${pnlPercent >= 0 ? C.emerald : C.rose};font-weight:600;">${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%</span>` : ""}
       </div>`
    : "";

  // Framing differs when the user already holds the ticker: an under-target price on an
  // existing position is a "top up" decision, not a fresh "buying opportunity".
  const underNote =
    item.status === "under"
      ? `<p style="margin:10px 0 0;padding:8px 10px;background:rgba(16,185,129,0.12);border-radius:8px;color:${C.emerald};font-size:12px;">
           ⚠ Il prezzo è sotto il buy target base — ${hasPosition ? "valuta se incrementare la posizione." : "potenziale opportunità di acquisto."}
         </p>`
      : "";

  const analystRows = item.analysts
    .map((a) => fvRow(ANALYST_LABEL_IT[a.angle], a.bear, a.base, a.bull, item.currency))
    .join("");
  const consensusRow = hasConsensus
    ? fvRow("Consenso", item.consensusBear!, item.consensusBase!, item.consensusBull!, item.currency, true)
    : "";

  // Tables (not flexbox) for the two justified rows — Outlook and several webmail clients
  // don't support flex; a two-cell table is the portable layout primitive for email.
  return `
    <div style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:18px 20px;margin:0 0 14px;">
      <table role="presentation" width="100%" style="border-collapse:collapse;">
        <tr>
          <td style="text-align:left;vertical-align:middle;">
            <span style="color:${C.accent};font-weight:700;font-size:15px;">${item.ticker}</span>
            <span style="color:${C.muted};font-size:12px;">&nbsp; ${item.companyName}</span>
          </td>
          <td style="text-align:right;vertical-align:middle;white-space:nowrap;">${statusBadge(item.status)}</td>
        </tr>
      </table>

      <div style="margin-top:8px;font-size:13px;color:${C.text};">
        <span style="font-weight:600;">${priceStr}</span>
        &nbsp;·&nbsp; ${priceVsTargetCell(item)}
      </div>

      ${positionLine}

      ${earningsNote(item)}

      ${underNote}

      <table style="width:100%;border-collapse:collapse;margin-top:14px;">
        <thead>
          <tr>
            <th style="text-align:left;color:${C.faint};font-size:10px;text-transform:uppercase;letter-spacing:0.075em;font-weight:500;padding-bottom:4px;"></th>
            <th style="text-align:right;color:${C.faint};font-size:10px;text-transform:uppercase;letter-spacing:0.075em;font-weight:500;padding:0 8px 4px;">Bear</th>
            <th style="text-align:right;color:${C.faint};font-size:10px;text-transform:uppercase;letter-spacing:0.075em;font-weight:500;padding:0 8px 4px;">Base</th>
            <th style="text-align:right;color:${C.faint};font-size:10px;text-transform:uppercase;letter-spacing:0.075em;font-weight:500;padding:0 0 4px 8px;">Bull</th>
          </tr>
        </thead>
        <tbody>
          ${fvRow("Analisi", item.fairValueBear, item.fairValueBase, item.fairValueBull, item.currency)}
          ${analystRows}
          ${consensusRow}
        </tbody>
      </table>

      <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:12px;border-top:1px solid ${C.border};">
        <tr>
          <td style="text-align:left;vertical-align:middle;padding-top:10px;font-size:11px;color:${C.muted};">
            Buy target (base −${(item.mosPercent * 100).toFixed(0)}%):
            <span style="color:${C.accent};font-weight:700;">${formatPrice(item.adjustedBase, item.currency)}</span>
          </td>
          <td style="text-align:right;vertical-align:middle;padding-top:10px;font-size:11px;color:${C.faint};white-space:nowrap;">${item.method} · ${formatDate(item.analysisDate)}</td>
        </tr>
      </table>
    </div>`;
}

/**
 * Sends the watchlist digest email for one user via Resend (weekdays only, see
 * app/api/cron/watchlist-analysis).
 * Each ticker is a card: live price + distance to the base buy target (with an under-target
 * note when applicable), an open-position line when held, a next/last-earnings note when the
 * user has fetched one, a bear/base/bull table for the analysis, each analyst-panel lens and
 * their consensus (when present), the MoS-adjusted buy target, and the source analysis date.
 * Native currency is used per ticker — no forced EUR conversion.
 */
export async function sendWatchlistDigest(params: {
  to: string;
  runDate: string;
  items: DigestItem[];
}): Promise<void> {
  const { to, runDate, items } = params;

  const cards = items.map(buildCard).join("");

  const html = `
    <div style="background:${C.bg};color:${C.text};font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;">
      <h1 style="color:${C.accent};font-size:20px;margin:0 0 4px;letter-spacing:-0.01em;">Watchlist — aggiornamento giornaliero</h1>
      <p style="color:${C.muted};font-size:13px;margin:0 0 24px;">${runDate}</p>

      ${cards}

      <p style="color:${C.muted};font-size:11px;margin-top:24px;line-height:1.6;">
        Valori dalla tua ultima analisi Deep Value salvata per ciascun titolo, riprezzati sul prezzo attuale.<br>
        Il buy target è il fair value base scontato del tuo margine di sicurezza.<br>
        Non costituisce consulenza finanziaria.
      </p>
    </div>`;

  await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "watchlist@resend.dev",
    to,
    subject: `Watchlist — ${items.length} ${items.length === 1 ? "titolo" : "titoli"} (${runDate})`,
    html,
  });
}
