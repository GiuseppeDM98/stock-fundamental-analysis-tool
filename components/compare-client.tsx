"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/context/language-context";
import { CompareTickerInput } from "@/components/compare-ticker-input";
import { CompareTable, type TickerCompareState } from "@/components/compare-table";
import type { LiteAnalysisResult } from "@/types/watchlist";

type Props = {
  initialTickers: string[];
};

type SavedRow = {
  ticker: string;
  fairValueBull: number;
  fairValueBase: number;
  fairValueBear: number;
  method: string;
  sector: string;
  currency: string;
  analyzedAt: string;
};

function updateUrl(tickers: string[]) {
  const url =
    tickers.length > 0
      ? `${window.location.pathname}?tickers=${tickers.join(",")}`
      : window.location.pathname;
  window.history.replaceState({}, "", url);
}

function makeIdleItems(tickers: string[]): TickerCompareState[] {
  return tickers.map((ticker) => ({
    ticker,
    status: "idle",
    result: null,
    currentPrice: null,
    analyzedAt: null,
  }));
}

function savedRowToItem(
  ticker: string,
  saved: SavedRow | undefined
): TickerCompareState {
  if (!saved) {
    return { ticker, status: "idle", result: null, currentPrice: null, analyzedAt: null };
  }
  return {
    ticker,
    status: "ready",
    result: {
      fairValueBull: saved.fairValueBull,
      fairValueBase: saved.fairValueBase,
      fairValueBear: saved.fairValueBear,
      method: saved.method,
      sector: saved.sector,
      currency: saved.currency,
    },
    currentPrice: null,
    analyzedAt: saved.analyzedAt,
  };
}

export function CompareClient({ initialTickers }: Props) {
  const { t } = useLanguage();
  const { data: session } = useSession();
  // Track userId so the load-saved effect fires only once per login, not on
  // every render that produces a new session object reference.
  const userId = session?.user?.id ?? null;

  const [tickers, setTickers] = useState<string[]>(initialTickers);
  const [items, setItems] = useState<TickerCompareState[]>(() =>
    makeIdleItems(initialTickers)
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(
    initialTickers.length > 0
  );
  const [mosPercent, setMosPercent] = useState(0);
  const [watchedTickers, setWatchedTickers] = useState<string[]>([]);

  // Guard so the initial DB load runs exactly once after userId is known
  const loadedForUser = useRef<string | null>(null);

  // Fetch watched tickers once session is known
  useEffect(() => {
    if (!userId) return;
    fetch("/api/watchlist")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: { ticker: string }[] }) => {
        setWatchedTickers(data.items.map((i) => i.ticker));
      })
      .catch(() => {});
  }, [userId]);

  // Keep URL in sync whenever tickers list changes
  useEffect(() => {
    updateUrl(tickers);
  }, [tickers]);

  const fetchPrice = useCallback(async (ticker: string): Promise<number | null> => {
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.regularMarketPrice === "number"
        ? data.regularMarketPrice
        : null;
    } catch {
      return null;
    }
  }, []);

  const fetchAndMergePrices = useCallback(
    async (targetTickers: string[]) => {
      const entries = await Promise.all(
        targetTickers.map(async (ticker) => ({
          ticker,
          price: await fetchPrice(ticker),
        }))
      );
      const priceMap = Object.fromEntries(
        entries.map(({ ticker, price }) => [ticker, price])
      );
      setItems((prev) =>
        prev.map((item) =>
          item.ticker in priceMap
            ? { ...item, currentPrice: priceMap[item.ticker] ?? null }
            : item
        )
      );
    },
    [fetchPrice]
  );

  // Load saved DB results once, right after the user's session becomes known.
  useEffect(() => {
    if (!userId || tickers.length === 0) {
      setIsLoadingSaved(false);
      return;
    }
    // Already loaded for this user — don't re-fetch on unrelated re-renders
    if (loadedForUser.current === userId) return;
    loadedForUser.current = userId;

    setIsLoadingSaved(true);
    fetch(`/api/compare/results?tickers=${tickers.join(",")}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((data: { results: SavedRow[] }) => {
        const byTicker = Object.fromEntries(
          data.results.map((r) => [r.ticker, r])
        );
        setItems(tickers.map((ticker) => savedRowToItem(ticker, byTicker[ticker])));

        const withResults = data.results.map((r) => r.ticker);
        if (withResults.length > 0) void fetchAndMergePrices(withResults);
      })
      .finally(() => setIsLoadingSaved(false));
  }, [userId, tickers, fetchAndMergePrices]);

  function addTicker(ticker: string) {
    if (tickers.includes(ticker) || tickers.length >= 5) return;
    setTickers((prev) => [...prev, ticker]);

    if (userId) {
      fetch(`/api/compare/results?tickers=${ticker}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results: SavedRow[] }) => {
          const item = savedRowToItem(ticker, data.results[0]);
          setItems((prev) => [...prev, item]);
          if (item.status === "ready") void fetchAndMergePrices([ticker]);
        })
        .catch(() => {
          setItems((prev) => [
            ...prev,
            { ticker, status: "idle", result: null, currentPrice: null, analyzedAt: null },
          ]);
        });
    } else {
      setItems((prev) => [
        ...prev,
        { ticker, status: "idle", result: null, currentPrice: null, analyzedAt: null },
      ]);
    }
  }

  function removeTicker(ticker: string) {
    setTickers((prev) => prev.filter((t) => t !== ticker));
    setItems((prev) => prev.filter((item) => item.ticker !== ticker));
  }

  async function runAnalysis() {
    if (tickers.length === 0 || isRunning) return;
    setIsRunning(true);

    setItems(
      tickers.map((ticker) => ({
        ticker,
        status: "loading",
        result: null,
        currentPrice: null,
        analyzedAt: null,
      }))
    );

    const now = new Date().toISOString();

    const [analyzeRes, ...priceResults] = await Promise.allSettled([
      fetch("/api/compare/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      }),
      ...tickers.map((ticker) => fetchPrice(ticker)),
    ]);

    const prices: (number | null)[] = priceResults.map((r) =>
      r.status === "fulfilled" ? (r.value as number | null) : null
    );

    let aiResults: { ticker: string; result: LiteAnalysisResult | null }[] =
      tickers.map((ticker) => ({ ticker, result: null }));

    if (analyzeRes.status === "fulfilled" && analyzeRes.value.ok) {
      try {
        const data = await analyzeRes.value.json();
        if (Array.isArray(data.results)) aiResults = data.results;
      } catch {
        // leave as all-null → error state per ticker
      }
    }

    setItems(
      tickers.map((ticker, idx) => {
        const ai = aiResults.find((r) => r.ticker === ticker);
        return {
          ticker,
          status: ai?.result ? "ready" : "error",
          result: ai?.result ?? null,
          currentPrice: prices[idx] ?? null,
          analyzedAt: ai?.result ? now : null,
        };
      })
    );

    setIsRunning(false);
  }

  async function handleWatch(ticker: string) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, companyName: ticker, mosPercent: 0.2 }),
    });
    if (res.ok || res.status === 409) {
      setWatchedTickers((prev) => prev.includes(ticker) ? prev : [...prev, ticker]);
    } else {
      throw new Error("Failed to add to watchlist");
    }
  }

  const isEmpty = tickers.length === 0;
  const hasAnyResult = items.some((i) => i.result !== null);
  const canRun = tickers.length > 0 && !isRunning && !!session;

  const runBtnLabel = isRunning
    ? t("compareRunning")
    : hasAnyResult
    ? t("compareRefreshAll")
    : t("compareRunAnalysis");

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">
          {t("comparePageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("comparePageDesc")}</p>
      </div>

      {/* Ticker input + MoS slider + run button */}
      <div className="card flex flex-wrap items-center gap-4">
        <CompareTickerInput
          tickers={tickers}
          onAdd={addTicker}
          onRemove={removeTicker}
          disabled={isRunning || isLoadingSaved}
        />

        {/* MoS slider — only shown when there are tickers */}
        {!isEmpty && (
          <div className="flex items-center gap-2 text-sm">
            <label className="whitespace-nowrap text-muted">
              {t("marginOfSafety")}
            </label>
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={mosPercent}
              onChange={(e) => setMosPercent(Number(e.target.value))}
              className="w-28 accent-sky-400"
            />
            <span className="w-8 text-right font-semibold text-slate-200">
              {mosPercent}%
            </span>
          </div>
        )}

        {tickers.length > 0 && (
          <button
            onClick={runAnalysis}
            disabled={!canRun}
            className="ml-auto rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runBtnLabel}
          </button>
        )}
      </div>

      {!session && tickers.length > 0 && (
        <p className="text-sm text-amber-400">
          Accedi per eseguire l&apos;analisi AI.
        </p>
      )}

      {isEmpty && (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <p className="font-medium text-slate-200">{t("compareEmpty")}</p>
          <p className="text-sm text-muted">{t("compareEmptyHint")}</p>
        </div>
      )}

      {isLoadingSaved && !isEmpty && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Caricamento analisi salvate…
        </div>
      )}

      {!isEmpty && !isLoadingSaved && (
        <CompareTable
          items={items}
          mosPercent={mosPercent}
          watchedTickers={watchedTickers}
          onWatch={session ? handleWatch : undefined}
        />
      )}

      {!isEmpty && (
        <p className="text-xs text-muted/70">{t("compareAiNote")}</p>
      )}
    </div>
  );
}
