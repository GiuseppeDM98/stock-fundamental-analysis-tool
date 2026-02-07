/**
 * Formats a number as currency with symbol and decimal places.
 *
 * Uses Intl.NumberFormat for locale-aware formatting that automatically
 * handles currency symbols, thousand separators, and decimal points.
 *
 * @param value - Numeric value to format
 * @param currency - Three-letter ISO currency code (e.g., "USD", "EUR")
 * @param locale - BCP 47 locale tag (e.g., "en-US", "de-DE")
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(value: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Formats large numbers in compact notation (K, M, B, T).
 *
 * Useful for displaying market cap and other large financial figures
 * in a space-efficient way.
 *
 * @param value - Numeric value to format
 * @param locale - BCP 47 locale tag
 * @returns Compact notation string (e.g., "1.23B", "456.78M")
 */
export function formatCompactNumber(value: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Formats a decimal as a percentage with specified precision.
 *
 * Expects decimal input (0.15 becomes "15.0%").
 *
 * @param value - Decimal value (e.g., 0.15 for 15%)
 * @param fractionDigits - Number of decimal places to show
 * @param locale - BCP 47 locale tag
 * @returns Percentage string (e.g., "15.0%")
 */
export function formatPercent(value: number, fractionDigits = 1, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}
