"use client";

type TickerSearchProps = {
  initialTicker: string;
  onSearch: (ticker: string) => void;
  loading: boolean;
};

/**
 * Ticker input form with submit button.
 *
 * Normalizes ticker input by trimming whitespace and converting to uppercase
 * to ensure consistent API requests regardless of user input formatting.
 *
 * @param initialTicker - Default value for the input field
 * @param onSearch - Callback invoked with normalized ticker on submit
 * @param loading - Disables submit button and shows loading state
 */
export function TickerSearch({ initialTicker, onSearch, loading }: TickerSearchProps) {
  return (
    <form
      className="card flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        // Normalize ticker to uppercase for consistent API requests (Yahoo Finance is case-insensitive but uppercase is convention)
        const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();

        if (ticker) {
          onSearch(ticker);
        }
      }}
    >
      <label className="flex-1">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">Ticker</span>
        <input
          name="ticker"
          defaultValue={initialTicker}
          placeholder="AAPL or ASML.AS"
          className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm outline-none ring-accent/40 transition focus:ring"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Loading..." : "Analyze"}
      </button>
    </form>
  );
}
