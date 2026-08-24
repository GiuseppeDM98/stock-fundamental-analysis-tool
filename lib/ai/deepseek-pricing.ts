// DeepSeek adopted peak/off-peak pricing on 2026-08-16 (confirmed against
// https://api-docs.deepseek.com/quick_start/pricing/ on 2026-08-24) — off-peak prices
// are 50% of peak, applied to all billing items. Peak windows are fixed in UTC
// (01:00–04:00 and 06:00–10:00, Mon–Fri); this converts them to a display timezone
// (DST-aware) so the UI can show the user's local peak hours instead of raw UTC. Pure —
// no server-only import, safe to use in a client component.
const PEAK_WINDOWS_UTC = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 },
] as const;

export function isDeepSeekPeakHour(date: Date = new Date()): boolean {
  const utcDay = date.getUTCDay(); // 0 = Sunday, 6 = Saturday — peak windows are Mon–Fri only
  if (utcDay === 0 || utcDay === 6) return false;
  const utcHour = date.getUTCHours();
  return PEAK_WINDOWS_UTC.some((w) => utcHour >= w.startHour && utcHour < w.endHour);
}

/** Formats today's peak windows in the given IANA timezone (default Europe/Rome),
 * e.g. ["03:00–06:00", "08:00–12:00"] in CEST. Handles CET/CEST automatically since it
 * re-derives from actual Date objects rather than a hardcoded UTC offset. */
export function formatDeepSeekPeakWindows(
  timeZone: string = "Europe/Rome",
  referenceDate: Date = new Date()
): string[] {
  const formatter = new Intl.DateTimeFormat("it-IT", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // avoids the "24:00" midnight quirk some engines produce with hour12: false
  });

  function localTimeAtUtcHour(hour: number): string {
    const d = new Date(
      Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate(),
        hour
      )
    );
    return formatter.format(d);
  }

  return PEAK_WINDOWS_UTC.map(
    (w) => `${localTimeAtUtcHour(w.startHour)}–${localTimeAtUtcHour(w.endHour)}`
  );
}
