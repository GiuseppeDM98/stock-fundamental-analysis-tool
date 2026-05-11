// Server-only: fetches dividend payment data from Borsa Italiana.
// Only works for stocks listed on Borsa Italiana (MTAA and similar MICs).
// Returns null gracefully on any network/parse failure so cron snapshots are never blocked.
import "server-only";
import { parse } from "node-html-parser";

export type DividendPayment = {
  amount: number;   // gross dividend per share (as reported by Borsa Italiana)
  currency: string; // usually "EUR"
};

// Converts YYYY-MM-DD → DD/MM/YY for matching against Borsa Italiana date cells.
// Borsa Italiana uses 2-digit year format (e.g. "22/07/26"), not 4-digit.
function toItalianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

// Parses an Italian-locale decimal string like "0,2800" or "1.234,56" to a number.
function parseItalianDecimal(raw: string): number {
  // Italian format uses . as thousands separator and , as decimal separator
  return parseFloat(raw.replace(/\./g, "").replace(",", "."));
}

/**
 * Checks Borsa Italiana for a dividend whose payment date matches `date`.
 *
 * @param isin   - 12-char ISIN (e.g. "IT0003128367")
 * @param date   - target date in YYYY-MM-DD format (typically today UTC)
 * @param mic    - Market Identifier Code; defaults to MTAA (main Italian market)
 * @returns gross dividend per share if paid today, otherwise null
 */
export async function fetchDividendPaidToday(
  isin: string,
  date: string,
  mic = "MTAA"
): Promise<DividendPayment | null> {
  const targetDate = toItalianDate(date);

  let html: string;
  try {
    const url =
      `https://www.borsaitaliana.it/borsa/quotazioni/azioni/elenco-completo-dividendi.html` +
      `?isin=${encodeURIComponent(isin)}&mic=${encodeURIComponent(mic)}&lang=it`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; portfolio-tracker/1.0)",
        "Accept-Language": "it-IT,it;q=0.9",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[dividends] Borsa Italiana returned ${res.status} for ISIN ${isin}`);
      return null;
    }

    html = await res.text();
  } catch (err) {
    console.warn(`[dividends] Network error fetching ISIN ${isin}:`, err);
    return null;
  }

  return parseDividendTable(html, targetDate, isin);
}

// Normalizes Borsa Italiana currency names to ISO 4217 codes (e.g. "EURO" → "EUR").
function normalizeCurrency(raw: string): string {
  const map: Record<string, string> = { EURO: "EUR", DOLLAR: "USD", DOLLARO: "USD", STERLINA: "GBP" };
  const upper = raw.trim().toUpperCase();
  return map[upper] ?? upper;
}

// Parses the dividend table HTML; extracted for testability.
// Borsa Italiana table structure (observed 2026-05-11):
//   Headers: Azioni | Div. Cda | Div. Ass. | Divisa | Stacco | Pagamento | Tipo Dividendo
//   Dates:   DD/MM/YY (2-digit year)
//   "Div. Ass." is the assembly-approved amount (preferred); falls back to "Div. Cda".
export function parseDividendTable(
  html: string,
  targetDate: string, // DD/MM/YY
  isin: string        // for logging only
): DividendPayment | null {
  try {
    const root = parse(html);

    // Borsa Italiana wraps the dividend table in a generic <table>.
    // Find all tables and search each for a header row that mentions "pagamento".
    const tables = root.querySelectorAll("table");

    for (const table of tables) {
      // Detect column positions from the header row to survive minor layout changes.
      const headerCells = table.querySelectorAll("thead th, thead td");
      if (headerCells.length === 0) continue;

      const headers = headerCells.map((h) => h.text.trim().toLowerCase());
      const paymentIdx = headers.findIndex((h) => h.includes("pagamento"));
      // "Div. Ass." = assembly-approved dividend (final); "Div. Cda" = board proposal
      const divAssIdx  = headers.findIndex((h) => h.includes("ass.") || h.includes("ass "));
      const divCdaIdx  = headers.findIndex((h) => h.includes("cda") || h.includes("div.") || h.startsWith("div"));
      const currencyIdx = headers.findIndex((h) => h.includes("divisa") || h.includes("valuta"));

      // Skip tables that don't look like the dividend table
      if (paymentIdx === -1) continue;
      const amountIdx = divAssIdx !== -1 ? divAssIdx : divCdaIdx;
      if (amountIdx === -1) continue;

      const rows = table.querySelectorAll("tbody tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length <= Math.max(paymentIdx, amountIdx)) continue;

        const paymentDate = cells[paymentIdx]?.text.trim();
        if (paymentDate !== targetDate) continue;

        // Prefer Div. Ass.; fall back to Div. Cda if Ass. is empty
        let amountRaw = divAssIdx !== -1 ? cells[divAssIdx]?.text.trim() : "";
        if (!amountRaw && divCdaIdx !== -1) amountRaw = cells[divCdaIdx]?.text.trim() ?? "";

        const amount = parseItalianDecimal(amountRaw);
        if (isNaN(amount) || amount <= 0) continue;

        const rawCurrency = currencyIdx !== -1 ? (cells[currencyIdx]?.text.trim() || "EUR") : "EUR";
        const currency = normalizeCurrency(rawCurrency);

        console.log(`[dividends] Found dividend for ${isin} on ${targetDate}: ${amount} ${currency}`);
        return { amount, currency };
      }
    }

    return null;
  } catch (err) {
    console.warn(`[dividends] Parse error for ISIN ${isin}:`, err);
    return null;
  }
}
