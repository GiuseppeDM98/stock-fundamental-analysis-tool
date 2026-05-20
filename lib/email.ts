import { Resend } from "resend";

// Lazily initialized — avoids throwing during build when the env var is absent.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export interface DigestItem {
  ticker: string;
  companyName: string;
  method: string;
  currency: string;
  fairValueBear: number;
  fairValueBase: number;
  fairValueBull: number;
  currentPrice: number | null;
  mosPercent: number;
  // fairValueBase × (1 - mosPercent)
  adjustedBase: number;
  // (adjustedBase - currentPrice) / currentPrice — null when price unknown
  upside: number | null;
  status: "under" | "over" | "unknown";
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function statusBadge(status: DigestItem["status"]): string {
  if (status === "under") {
    return `<span style="background:#10b981;color:#022c22;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Sotto FV</span>`;
  }
  if (status === "over") {
    return `<span style="background:#f43f5e;color:#fff0f3;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Sopra FV</span>`;
  }
  return `<span style="color:#7b8ba9;">—</span>`;
}

function upsideCell(upside: number | null): string {
  if (upside === null) return `<span style="color:#7b8ba9;">—</span>`;
  const pct = (upside * 100).toFixed(1);
  const color = upside >= 0 ? "#10b981" : "#f43f5e";
  return `<span style="color:${color};font-weight:600;">${upside >= 0 ? "+" : ""}${pct}%</span>`;
}

function buildRow(item: DigestItem): string {
  const priceStr = item.currentPrice !== null ? formatPrice(item.currentPrice, item.currency) : "—";
  const adjBaseStr = formatPrice(item.adjustedBase, item.currency);
  const bearStr = formatPrice(item.fairValueBear, item.currency);
  const bullStr = formatPrice(item.fairValueBull, item.currency);

  return `
    <tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:10px 0;color:#e2e8f0;font-weight:600;">${item.ticker}<br><span style="color:#7b8ba9;font-size:11px;font-weight:400;">${item.companyName}</span></td>
      <td style="padding:10px 8px;text-align:right;color:#94a3b8;">${bearStr}</td>
      <td style="padding:10px 8px;text-align:right;color:#e2e8f0;font-weight:700;">${adjBaseStr}<br><span style="color:#7b8ba9;font-size:10px;font-weight:400;">MoS −${(item.mosPercent * 100).toFixed(0)}%</span></td>
      <td style="padding:10px 8px;text-align:right;color:#94a3b8;">${bullStr}</td>
      <td style="padding:10px 8px;text-align:right;color:#e2e8f0;">${priceStr}</td>
      <td style="padding:10px 8px;text-align:right;">${upsideCell(item.upside)}</td>
      <td style="padding:10px 0 10px 8px;text-align:right;">${statusBadge(item.status)}</td>
    </tr>`;
}

function buildMethodFooter(items: DigestItem[]): string {
  return items
    .map((i) => `<span style="color:#94a3b8;">${i.ticker}</span> → ${i.method}`)
    .join(" &nbsp;·&nbsp; ");
}

/**
 * Sends the watchlist digest email for one user via Resend.
 * Each row shows bear/base(MoS-adjusted)/bull fair values, current price, upside, and status.
 * Native currency is used per row — no forced EUR conversion.
 */
export async function sendWatchlistDigest(params: {
  to: string;
  runDate: string;
  items: DigestItem[];
}): Promise<void> {
  const { to, runDate, items } = params;

  const rows = items.map(buildRow).join("");
  const methodFooter = buildMethodFooter(items);

  const html = `
    <div style="background:#0a101f;color:#e2e8f0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;">
      <h1 style="color:#38bdf8;font-size:20px;margin:0 0 4px;letter-spacing:-0.01em;">Watchlist Update</h1>
      <p style="color:#7b8ba9;font-size:13px;margin:0 0 28px;">${runDate}</p>

      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #1e293b;">
            <th style="text-align:left;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 0 8px;font-weight:500;">Ticker</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 8px 8px;font-weight:500;">Bear</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 8px 8px;font-weight:500;">Base (−MoS%)</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 8px 8px;font-weight:500;">Bull</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 8px 8px;font-weight:500;">Prezzo</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 8px 8px;font-weight:500;">Upside</th>
            <th style="text-align:right;color:#7b8ba9;font-size:11px;text-transform:uppercase;letter-spacing:0.075em;padding:0 0 8px;font-weight:500;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <p style="color:#7b8ba9;font-size:11px;margin-top:28px;line-height:1.6;">
        Report automatico generato dalla tua watchlist.<br>
        Non costituisce consulenza finanziaria.<br>
        <span style="color:#475569;">Metodo: ${methodFooter}</span>
      </p>
    </div>`;

  await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "watchlist@resend.dev",
    to,
    subject: `Watchlist Update — ${items.length} ${items.length === 1 ? "titolo analizzato" : "titoli analizzati"} (${runDate})`,
    html,
  });
}
