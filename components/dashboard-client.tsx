"use client";

import { motion } from "framer-motion";
import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { FairValueCard } from "@/components/fair-value-card";
import { FundamentalsCharts } from "@/components/fundamentals-charts";
import { PriceSummary } from "@/components/price-summary";
import { ScenarioPanel } from "@/components/scenario-panel";
import { TickerSearch } from "@/components/ticker-search";
import { getDefaultScenarios } from "@/lib/valuation/scenario-presets";
import { FundamentalsResponse } from "@/types/fundamentals";
import { QuoteResponse } from "@/types/market";
import { ScenariosInput, ValuationResponse } from "@/types/valuation";

type LoadState = "idle" | "loading" | "success" | "error";
type UiPreferences = { compactCharts: boolean };

// Zod schemas for runtime validation of localStorage data
const scenarioSchema = z.object({
  revenueGrowthYears1to5: z.number(),
  revenueGrowthYears6to10: z.number(),
  operatingMarginTarget: z.number(),
  taxRate: z.number(),
  reinvestmentRate: z.number(),
  wacc: z.number(),
  terminalGrowth: z.number()
});

const scenarioOverridesSchema = z.object({
  bull: scenarioSchema,
  base: scenarioSchema,
  bear: scenarioSchema
});

/**
 * Safely retrieves and parses a value from localStorage.
 *
 * Returns fallback if localStorage is unavailable (SSR), key doesn't exist,
 * or parsing fails. This prevents hydration mismatches and runtime errors
 * from corrupted localStorage data.
 *
 * @param key - localStorage key to read
 * @param parser - Function to parse and validate the JSON value (e.g., Zod schema)
 * @param fallback - Default value returned on SSR or parse failure
 * @returns Parsed value or fallback
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
 * Main dashboard component orchestrating stock analysis workflow.
 *
 * Manages:
 * - Ticker search and data fetching (quote, fundamentals, valuation)
 * - DCF scenario inputs with localStorage persistence
 * - Margin of safety slider
 * - UI preferences (compact charts toggle)
 *
 * Uses SSR-safe hydration pattern to prevent client/server mismatch errors
 * when reading from localStorage.
 */
export function DashboardClient() {
  const [ticker, setTicker] = useState("AAPL");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsResponse | null>(null);
  const [valuation, setValuation] = useState<ValuationResponse | null>(null);

  const [mosPercent, setMosPercent] = useState(25);
  const [scenarios, setScenarios] = useState<ScenariosInput>(getDefaultScenarios());
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>({ compactCharts: false });
  // Tracks whether client-side hydration has completed to prevent localStorage reads during SSR
  const [isHydrated, setIsHydrated] = useState(false);

  // Refs store latest scenario values for use in async callbacks (fetchDashboardData)
  // Without refs, fetchDashboardData would close over stale state from its creation time
  const mosRef = useRef(mosPercent);
  const scenariosRef = useRef(scenarios);

  // SSR Hydration: Load persisted state from localStorage on client mount only
  // This useEffect runs once after the initial server-side render completes,
  // ensuring window.localStorage is available and preventing hydration mismatches
  useEffect(() => {
    const storedTicker = getStorageItem("sfa:lastTicker", (value) => String(value), "AAPL");
    const storedMos = getStorageItem("sfa:mosPercent", (value) => Number(value), 25);
    const storedScenarios = getStorageItem(
      "sfa:scenarioOverrides",
      (value) => scenarioOverridesSchema.parse(value),
      getDefaultScenarios()
    );
    const storedUiPreferences = getStorageItem(
      "sfa:uiPreferences",
      (value) => z.object({ compactCharts: z.boolean() }).parse(value),
      { compactCharts: false }
    );

    setTicker(storedTicker);
    setMosPercent(Number.isFinite(storedMos) ? storedMos : 25);
    setScenarios(storedScenarios);
    setUiPreferences(storedUiPreferences);
    setIsHydrated(true);
  }, []);

  // Persist ticker to localStorage whenever it changes (but only after hydration)
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:lastTicker", ticker);
  }, [ticker, isHydrated]);

  // Persist margin of safety and sync ref for async callbacks
  useEffect(() => {
    mosRef.current = mosPercent;
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:mosPercent", String(mosPercent));
  }, [mosPercent, isHydrated]);

  // Persist scenario inputs and sync ref for async callbacks
  useEffect(() => {
    scenariosRef.current = scenarios;
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:scenarioOverrides", JSON.stringify(scenarios));
  }, [scenarios, isHydrated]);

  // Persist UI preferences
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:uiPreferences", JSON.stringify(uiPreferences));
  }, [uiPreferences, isHydrated]);

  /**
   * Fetches quote, fundamentals, and valuation data for a given ticker.
   *
   * Runs three API calls in parallel for performance. Uses refs to access
   * latest scenario values instead of closing over stale state from component render.
   *
   * @param nextTicker - Stock ticker symbol to analyze
   */
  const fetchDashboardData = useCallback(
    async (nextTicker: string) => {
      setLoadState("loading");
      setErrorMessage("");

      try {
        // Parallel fetch: quote, fundamentals, and DCF valuation
        const [quoteRes, fundamentalsRes, valuationRes] = await Promise.all([
          fetch(`/api/quote/${encodeURIComponent(nextTicker)}`),
          fetch(`/api/fundamentals/${encodeURIComponent(nextTicker)}`),
          fetch(`/api/valuation/${encodeURIComponent(nextTicker)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              // Use refs to get latest values, not stale state from closure
              mosPercent: mosRef.current,
              scenarios: scenariosRef.current
            })
          })
        ]);

        const quoteData = await quoteRes.json();
        const fundamentalsData = await fundamentalsRes.json();
        const valuationData = await valuationRes.json();

        // Check each response and throw on first error
        if (!quoteRes.ok) {
          throw new Error(quoteData.error || "Unable to load quote.");
        }

        if (!fundamentalsRes.ok) {
          throw new Error(fundamentalsData.error || "Unable to load fundamentals.");
        }

        if (!valuationRes.ok) {
          throw new Error(valuationData.error || "Unable to run valuation.");
        }

        setQuote(quoteData);
        setFundamentals(fundamentalsData);
        setValuation(valuationData);
        setLoadState("success");
      } catch (error) {
        setLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unexpected error.");
      }
    },
    []
  );

  const valuationChartData = useMemo(() => {
    if (!valuation) {
      return [];
    }

    return ["bull", "base", "bear"].map((scenario) => ({
      scenario,
      currentPrice: valuation.currentPrice,
      fairValueAfterMos: valuation.scenarios[scenario as keyof typeof valuation.scenarios].fairValueAfterMos
    }));
  }, [valuation]);

  return (
    <main className="mx-auto max-w-7xl p-4 pb-10 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Stock Fundamental Analysis Tool</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Deep dive one ticker with fundamentals, scenario-based DCF, and margin-of-safety adjusted fair values.
        </p>
      </motion.header>

      <div className="space-y-4">
        {/* Warning banner and search form */}
        <DisclaimerBanner />
        <TickerSearch
          initialTicker={ticker}
          loading={loadState === "loading"}
          onSearch={(nextTicker) => {
            const normalizedTicker = nextTicker.toUpperCase();
            setTicker(normalizedTicker);
            void fetchDashboardData(normalizedTicker);
          }}
        />

        {/* DCF scenario input controls */}
        <ScenarioPanel
          scenarios={scenarios}
          mosPercent={mosPercent}
          loading={loadState === "loading"}
          onMosChange={setMosPercent}
          onReset={() => setScenarios(getDefaultScenarios())}
          onRecalculate={() => {
            void fetchDashboardData(ticker);
          }}
          onScenarioChange={(scenario, key, value) => {
            setScenarios((current) => ({
              ...current,
              [scenario]: {
                ...current[scenario],
                [key]: value
              }
            }));
          }}
        />

        {/* UI preferences toggle */}
        <div className="card flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">UI preferences</p>
          <button
            onClick={() =>
              setUiPreferences((current) => ({
                ...current,
                compactCharts: !current.compactCharts
              }))
            }
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            {uiPreferences.compactCharts ? "Disable compact charts" : "Enable compact charts"}
          </button>
        </div>

        {/* Loading state */}
        {loadState === "loading" && <div className="card text-sm text-muted">Loading market and valuation data...</div>}

        {/* Error state */}
        {loadState === "error" && (
          <div className="card border-danger/50 bg-danger/10 text-sm text-red-100">
            <p className="font-semibold">Unable to complete analysis</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        )}

        {/* Success state: render all dashboard sections */}
        {loadState === "success" && quote && fundamentals && valuation && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-4"
          >
            <PriceSummary quote={quote} />

            <div className="grid gap-4 lg:grid-cols-3">
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="bull" result={valuation.scenarios.bull} />
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="base" result={valuation.scenarios.base} />
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="bear" result={valuation.scenarios.bear} />
            </div>

            <div className="card">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Scenario fair value vs current price</p>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={valuationChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#23314f" />
                    <XAxis dataKey="scenario" stroke="#7b8ba9" />
                    <YAxis stroke="#7b8ba9" />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="currentPrice" fill="#64748b" radius={4} />
                    <Bar dataKey="fairValueAfterMos" fill="#38bdf8" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Scenario note: each fair value includes the global margin of safety slider.
              </p>
            </div>

            <FundamentalsCharts fundamentals={fundamentals} compact={uiPreferences.compactCharts} />
          </motion.div>
        )}
      </div>
    </main>
  );
}
