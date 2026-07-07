import { Resend } from "resend";

// Lazily initialized — avoids throwing during build when the env var is absent.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// One watched ticker, priced against the user's latest saved Deep Value analysis. All
// fair-value fields are on the intrinsic scale; `adjustedBase` is the base buy target
// (intrinsic base discounted by the watchlist item's own MoS). Reviewer + consensus fields
// are null when the analysis has no red-team Analyst Review.
export interface DigestItem {
  ticker: string;
  companyName: string;
  method: string;
  currency: string;
  // Analysis intrinsic fair values
  fairValueBear: number;
  fairValueBase: number;
  fairValueBull: number;
  // Reviewer (red-team) intrinsic fair values — null when no review
  reviewFairValueBear: number | null;
  reviewFairValueBase: number | null;
  reviewFairValueBull: number | null;
  // Consensus = per-scenario mean of analysis + reviewer — null when no review
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
// reviewer and consensus lines. `emphasize` styles the consensus row.
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
  const hasReviewer =
    item.reviewFairValueBear !== null &&
    item.reviewFairValueBase !== null &&
    item.reviewFairValueBull !== null;
  const hasConsensus =
    item.consensusBear !== null && item.consensusBase !== null && item.consensusBull !== null;

  const priceStr = item.currentPrice !== null ? formatPrice(item.currentPrice, item.currency) : "—";

  const underNote =
    item.status === "under"
      ? `<p style="margin:10px 0 0;padding:8px 10px;background:rgba(16,185,129,0.12);border-radius:8px;color:${C.emerald};font-size:12px;">
           ⚠ Il prezzo è sotto il buy target base — potenziale opportunità di acquisto.
         </p>`
      : "";

  const reviewerRow = hasReviewer
    ? fvRow("Revisore", item.reviewFairValueBear!, item.reviewFairValueBase!, item.reviewFairValueBull!, item.currency)
    : "";
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
          ${reviewerRow}
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
 * Sends the daily watchlist digest email for one user via Resend.
 * Each ticker is a card: live price + distance to the base buy target (with an under-target
 * note when applicable), a bear/base/bull table for the analysis, the red-team reviewer and
 * their consensus (when a review exists), the MoS-adjusted buy target, and the source
 * analysis date. Native currency is used per ticker — no forced EUR conversion.
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
