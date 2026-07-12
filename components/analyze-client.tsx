"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { PriceSummary } from "@/components/price-summary";
import { TickerSearch } from "@/components/ticker-search";
import DeepValuePanel from "@/components/deep-value-panel";
import { GroundingInput } from "@/components/grounding-input";
import { useLanguage } from "@/context/language-context";
import { QuoteResponse } from "@/types/market";
import type { GroundingPayload } from "@/types/grounding";

type LoadState = "idle" | "loading" | "success" | "error";

/**
 * Safely retrieves and parses a value from localStorage.
 *
 * Returns fallback if localStorage is unavailable (SSR), the key is missing,
 * or parsing fails — preventing hydration mismatches and crashes from corrupted data.
 */
function getStorageItem<T>(key: string, parser: (value: unknown) => T, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return parser(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

/**
 * Deep-dive analysis page (route `/analyze`).
 *
 * Loads a single ticker's live quote, then hands off to the AI Deep Value panel —
 * which sources its own financials via web search and autonomously picks the
 * valuation method (DCF/DDM/EV-EBITDA/P/B). The legacy Yahoo-data valuation engine
 * and scenario tuning were removed: Deep Value is now the only analysis path, so
 * this component only needs the quote (price header + Deep Value reference price)
 * plus a margin-of-safety control.
 *
 * Uses the SSR-safe hydration guard to read localStorage and the `?ticker=` URL
 * param (set by advisor chips, watchlist, analyses re-run, and the
 * portfolio exit signal) only on the client. The analysis is always
 * position-blind — no portfolio position or prior estimate is ever passed to the
 * Deep Value panel, so the valuation stays independent (hold/exit reasoning lives
 * in the Advisor; estimate evolution is a deterministic diff on /analyses).
 */
export function AnalyzeClient() {
  const { t } = useLanguage();
  const [ticker, setTicker] = useState("AAPL");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [mosPercent, setMosPercent] = useState(25);
  // Lifted from GroundingInput so a later session can thread it into the Deep Value
  // POST body — not consumed yet (still Quick-only), see docs/deep-value-grounding-spec.md.
  const [grounding, setGrounding] = useState<GroundingPayload | null>(null);
  // Tracks whether client-side hydration has completed to prevent localStorage reads during SSR
  const [isHydrated, setIsHydrated] = useState(false);

  // Holds a ticker from ?ticker= URL param so the post-hydration effect can auto-fetch it
  const urlTickerRef = useRef<string | null>(null);
  // Latest MoS for use inside the async fetch callback (avoids a stale closure)
  const mosRef = useRef(mosPercent);

  // SSR hydration: read URL params + persisted state on client mount only.
  useEffect(() => {
    // ?ticker= (from re-run, advisor chip, watchlist, or exit signal) takes precedence
    // over localStorage. It's the only param this page reads — the analysis is always
    // position-blind, so no WAC/prevFv is accepted from the URL.
    const urlParam = new URLSearchParams(window.location.search).get("ticker");
    if (urlParam) {
      urlTickerRef.current = urlParam.toUpperCase();
      window.history.replaceState({}, "", window.location.pathname);
    }

    const storedTicker = urlTickerRef.current ?? getStorageItem("sfa:lastTicker", (value) => String(value), "AAPL");
    const storedMos = getStorageItem("sfa:mosPercent", (value) => Number(value), 25);
    setTicker(storedTicker);
    setMosPercent(Number.isFinite(storedMos) ? storedMos : 25);
    setIsHydrated(true);
  }, []);

  // Persist ticker to localStorage whenever it changes (after hydration only)
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    // getStorageItem JSON.parses on read, so the stored value must be valid JSON.
    // A bare string like "MSFT" isn't — without stringify the read always threw and
    // fell back to the default (AAPL), so the last ticker never actually persisted.
    window.localStorage.setItem("sfa:lastTicker", JSON.stringify(ticker));
  }, [ticker, isHydrated]);

  // Persist margin of safety and keep the ref in sync for the async fetch callback
  useEffect(() => {
    mosRef.current = mosPercent;
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:mosPercent", String(mosPercent));
  }, [mosPercent, isHydrated]);

  /**
   * Fetches the live quote for a ticker. Deep Value sources its own financials,
   * so the quote (price + name + currency) is all this page needs.
   *
   * @param nextTicker - Stock ticker symbol to load
   */
  const fetchQuote = useCallback(async (nextTicker: string) => {
    setLoadState("loading");
    setErrorMessage("");

    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(nextTicker)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to load quote.");
      }
      setQuote(data);
      setLoadState("success");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unexpected error.");
    }
  }, []);

  // Auto-fetch when opened via ?ticker= URL param (advisor chip, watchlist, re-run, exit signal)
  useEffect(() => {
    if (isHydrated && urlTickerRef.current) {
      void fetchQuote(urlTickerRef.current);
    }
  }, [isHydrated, fetchQuote]);

  return (
    <main className="mx-auto max-w-7xl p-4 pb-10 sm:p-6 lg:p-8">
      {/* Page header — app chrome, excluded from the PDF export (window.print) */}
      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-5 print:hidden">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("appTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">{t("appSubtitle")}</p>
      </motion.header>

      <div className="space-y-4">
        {/* Disclaimer and search form — app chrome, hidden in the PDF export */}
        <div className="print:hidden">
          <DisclaimerBanner />
        </div>
        <div className="print:hidden">
          <TickerSearch
            initialTicker={ticker}
            loading={loadState === "loading"}
            onSearch={(nextTicker) => {
              const normalizedTicker = nextTicker.toUpperCase();
              setTicker(normalizedTicker);
              void fetchQuote(normalizedTicker);
            }}
          />
        </div>

        {/* Loading state */}
        {loadState === "loading" && <div className="card text-sm text-muted">{t("loadingAnalysis")}</div>}

        {/* Error state */}
        {loadState === "error" && (
          <div className="card border-danger/50 bg-danger/10 text-sm text-red-100">
            <p className="font-semibold">{t("errorUnableAnalysis")}</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        )}

        {/* Success state: price header, margin-of-safety control, and the AI Deep Value panel */}
        {loadState === "success" && quote && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-4"
          >
            {/* Price header + MoS control are app chrome — the report shell below
                carries its own masthead, so both are excluded from the PDF export. */}
            <div className="print:hidden">
              <PriceSummary quote={quote} />
            </div>

            {/* Margin of safety — applied to the Deep Value buy targets */}
            <div className="card print:hidden">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
                  {t("marginOfSafety")} {mosPercent}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={5}
                  value={mosPercent}
                  onChange={(e) => setMosPercent(parseInt(e.target.value, 10))}
                  className="w-full accent-sky-500"
                />
              </label>
            </div>

            <GroundingInput ticker={ticker} value={grounding} onChange={setGrounding} />

            <DeepValuePanel
              ticker={ticker}
              companyName={quote.shortName}
              mosPercent={mosPercent}
              currentPrice={quote.regularMarketPrice}
            />
          </motion.div>
        )}
      </div>
    </main>
  );
}
