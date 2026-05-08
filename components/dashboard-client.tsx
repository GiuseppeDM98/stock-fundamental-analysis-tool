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
import { DdmScenarioPanel } from "@/components/ddm-scenario-panel";
import { EvEbitdaScenarioPanel } from "@/components/ev-ebitda-scenario-panel";
import { FairValueCard } from "@/components/fair-value-card";
import { FundamentalsCharts } from "@/components/fundamentals-charts";
import { PriceSummary } from "@/components/price-summary";
import { ScenarioPanel } from "@/components/scenario-panel";
import { TickerSearch } from "@/components/ticker-search";
import AiAnalysisPanel from "@/components/ai-analysis-panel";
import DeepValuePanel from "@/components/deep-value-panel";
import { ValuationMetricsCards } from "@/components/valuation-metrics-cards";
import { getDefaultDdmScenarios, getCompanyDdmScenarios, getDefaultEvEbitdaScenarios, getCompanyEvEbitdaScenarios, getDefaultScenarios } from "@/lib/valuation/scenario-presets";
import { detectSector, getRecommendedMethod } from "@/lib/valuation/sector";
import { FundamentalsResponse } from "@/types/fundamentals";
import { QuoteResponse } from "@/types/market";
import { AnalystEstimates, AnalystEstimatesResponse, DdmScenariosInput, EvEbitdaScenariosInput, ScenariosInput, ValuationResponse } from "@/types/valuation";

type LoadState = "idle" | "loading" | "success" | "error";
type ScenarioSource = "smart" | "generic" | "custom";

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

const ddmScenarioSchema = z.object({
  dividendGrowthRate: z.number(),
  costOfEquity: z.number(),
  terminalGrowthRate: z.number(),
});

const ddmScenarioOverridesSchema = z.object({
  bull: ddmScenarioSchema,
  base: ddmScenarioSchema,
  bear: ddmScenarioSchema,
});

const evEbitdaScenarioSchema = z.object({ targetMultiple: z.number() });
const evEbitdaScenarioOverridesSchema = z.object({
  bull: evEbitdaScenarioSchema,
  base: evEbitdaScenarioSchema,
  bear: evEbitdaScenarioSchema,
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
 * - Ticker search and data fetching (quote, fundamentals, valuation, analyst estimates)
 * - Company-specific smart scenario defaults auto-populated on ticker search
 * - DCF scenario inputs with localStorage persistence
 * - Margin of safety slider
 * - UI preferences (compact charts toggle)
 *
 * On ticker search, the dashboard fetches analyst estimates and fundamentals to
 * compute company-specific scenarios (smart defaults). These replace generic presets
 * so the DCF valuation reflects the actual company's margins, growth, and reinvestment.
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
  const [analystEstimates, setAnalystEstimates] = useState<AnalystEstimates | null>(null);

  // Smart scenarios computed from company data — used as the "reset smart" target
  const [smartScenarios, setSmartScenarios] = useState<ScenariosInput | null>(null);

  const [mosPercent, setMosPercent] = useState(25);
  const [scenarios, setScenarios] = useState<ScenariosInput>(getDefaultScenarios());
  const [ddmScenarios, setDdmScenarios] = useState<DdmScenariosInput>(getDefaultDdmScenarios());
  const [smartDdmScenarios, setSmartDdmScenarios] = useState<DdmScenariosInput | null>(null);
  const [evEbitdaScenarios, setEvEbitdaScenarios] = useState<EvEbitdaScenariosInput>(getDefaultEvEbitdaScenarios());
  const [smartEvEbitdaScenarios, setSmartEvEbitdaScenarios] = useState<EvEbitdaScenariosInput | null>(null);
  // Tracks the origin of the current scenario values for the UI indicator
  const [scenarioSource, setScenarioSource] = useState<ScenarioSource>("generic");
  const [ddmScenarioSource, setDdmScenarioSource] = useState<ScenarioSource>("generic");
  const [evEbitdaScenarioSource, setEvEbitdaScenarioSource] = useState<ScenarioSource>("generic");
  // Tracks whether client-side hydration has completed to prevent localStorage reads during SSR
  const [isHydrated, setIsHydrated] = useState(false);

  // Refs store latest scenario values for use in async callbacks (fetchDashboardData)
  // Without refs, fetchDashboardData would close over stale state from its creation time
  const mosRef = useRef(mosPercent);
  const scenariosRef = useRef(scenarios);
  const ddmScenariosRef = useRef(ddmScenarios);
  const evEbitdaScenariosRef = useRef(evEbitdaScenarios);
  // Holds a ticker from ?ticker= URL param so the post-hydration effect can auto-fetch it
  const urlTickerRef = useRef<string | null>(null);

  // SSR Hydration: Load persisted state from localStorage on client mount only
  // This useEffect runs once after the initial server-side render completes,
  // ensuring window.localStorage is available and preventing hydration mismatches
  useEffect(() => {
    // ?ticker= URL param (from Re-run button) takes precedence over localStorage
    const urlParam = new URLSearchParams(window.location.search).get("ticker");
    if (urlParam) {
      urlTickerRef.current = urlParam.toUpperCase();
      window.history.replaceState({}, "", window.location.pathname);
    }

    const storedTicker = urlTickerRef.current ?? getStorageItem("sfa:lastTicker", (value) => String(value), "AAPL");
    const storedMos = getStorageItem("sfa:mosPercent", (value) => Number(value), 25);
    const storedScenarios = getStorageItem(
      "sfa:scenarioOverrides",
      (value) => scenarioOverridesSchema.parse(value),
      getDefaultScenarios()
    );
    const storedDdmScenarios = getStorageItem(
      "sfa:ddmScenarioOverrides",
      (value) => ddmScenarioOverridesSchema.parse(value),
      getDefaultDdmScenarios()
    );
    const storedEvEbitdaScenarios = getStorageItem(
      "sfa:evEbitdaScenarioOverrides",
      (value) => evEbitdaScenarioOverridesSchema.parse(value),
      getDefaultEvEbitdaScenarios()
    );
    setTicker(storedTicker);
    setMosPercent(Number.isFinite(storedMos) ? storedMos : 25);
    setScenarios(storedScenarios);
    setDdmScenarios(storedDdmScenarios);
    setEvEbitdaScenarios(storedEvEbitdaScenarios);
    setIsHydrated(true);
  }, []);

  // Persist ticker to localStorage whenever it changes (but only after hydration)
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:lastTicker", ticker);
  }, [ticker, isHydrated]);

  // Auto-fetch when the page was opened via ?ticker= URL param (e.g. Re-run button)
  useEffect(() => {
    if (isHydrated && urlTickerRef.current) {
      void fetchDashboardData(urlTickerRef.current, true);
    }
  // fetchDashboardData is stable (useCallback with no deps that change on hydration)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

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

  // Persist DDM scenario inputs and sync ref for async callbacks
  useEffect(() => {
    ddmScenariosRef.current = ddmScenarios;
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:ddmScenarioOverrides", JSON.stringify(ddmScenarios));
  }, [ddmScenarios, isHydrated]);

  // Persist EV/EBITDA scenario inputs and sync ref for async callbacks
  useEffect(() => {
    evEbitdaScenariosRef.current = evEbitdaScenarios;
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem("sfa:evEbitdaScenarioOverrides", JSON.stringify(evEbitdaScenarios));
  }, [evEbitdaScenarios, isHydrated]);

  /**
   * Fetch smart scenario defaults for a ticker from analyst estimates API.
   *
   * Called before the main data fetch so scenarios are populated with company-specific
   * values before the DCF valuation runs. If this call fails (e.g., no analyst coverage),
   * we silently keep the current scenarios — the valuation will still run with whatever
   * scenarios are active.
   */
  const fetchSmartScenarios = useCallback(async (nextTicker: string): Promise<ScenariosInput | null> => {
    try {
      const res = await fetch(`/api/analyst-estimates/${encodeURIComponent(nextTicker)}`);
      if (!res.ok) return null;

      const data: AnalystEstimatesResponse = await res.json();
      setAnalystEstimates(data.analystEstimates);
      setSmartScenarios(data.smartScenarios);

      // Compute smart DDM defaults from dividendRate + beta (available from analystEstimates)
      const ddmSmart = getCompanyDdmScenarios(data.analystEstimates);
      setSmartDdmScenarios(ddmSmart);
      setDdmScenarios(ddmSmart);
      setDdmScenarioSource("smart");
      ddmScenariosRef.current = ddmSmart;

      // Compute smart EV/EBITDA defaults from current evEbitda ratio
      const evEbitdaSmart = getCompanyEvEbitdaScenarios(data.analystEstimates);
      setSmartEvEbitdaScenarios(evEbitdaSmart);
      setEvEbitdaScenarios(evEbitdaSmart);
      setEvEbitdaScenarioSource("smart");
      evEbitdaScenariosRef.current = evEbitdaSmart;

      return data.smartScenarios;
    } catch {
      return null;
    }
  }, []);

  /**
   * Fetches quote, fundamentals, and valuation data for a given ticker.
   *
   * First fetches smart scenarios from analyst estimates, then runs the main
   * data fetch with the updated scenarios. Uses refs to access latest scenario
   * values instead of closing over stale state from component render.
   *
   * @param nextTicker - Stock ticker symbol to analyze
   * @param useSmartDefaults - Whether to auto-populate scenarios from company data
   */
  const fetchDashboardData = useCallback(
    async (nextTicker: string, useSmartDefaults = true) => {
      setLoadState("loading");
      setErrorMessage("");

      try {
        // Fetch smart scenarios first so they're used in the valuation request
        let activeScenarios = scenariosRef.current;
        if (useSmartDefaults) {
          const smart = await fetchSmartScenarios(nextTicker);
          if (smart) {
            activeScenarios = smart;
            setScenarios(smart);
            setScenarioSource("smart");
            scenariosRef.current = smart;
          }
        }

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
              mosPercent: mosRef.current,
              scenarios: activeScenarios,
              ddmScenarios: ddmScenariosRef.current,
              evEbitdaScenarios: evEbitdaScenariosRef.current,
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
    [fetchSmartScenarios]
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
            // New ticker search: fetch smart defaults and use them for valuation
            void fetchDashboardData(normalizedTicker, true);
          }}
        />

        {/* Scenario input controls — DDM for Utilities, EV/EBITDA for Energy/Materials, DCF otherwise */}
        {valuation?.valuationMethod === "ev-ebitda" ? (
          <EvEbitdaScenarioPanel
            scenarios={evEbitdaScenarios}
            mosPercent={mosPercent}
            ebitda={fundamentals?.ebitda ?? null}
            currentEvEbitda={fundamentals?.ratios?.evEbitda ?? null}
            scenarioSource={evEbitdaScenarioSource}
            loading={loadState === "loading"}
            onMosChange={setMosPercent}
            onResetSmart={() => {
              if (smartEvEbitdaScenarios) {
                setEvEbitdaScenarios(smartEvEbitdaScenarios);
                setEvEbitdaScenarioSource("smart");
              }
            }}
            onResetGeneric={() => {
              setEvEbitdaScenarios(getDefaultEvEbitdaScenarios());
              setEvEbitdaScenarioSource("generic");
            }}
            onRecalculate={() => void fetchDashboardData(ticker, false)}
            onScenarioChange={(scenario, key, value) => {
              setEvEbitdaScenarios((current) => ({
                ...current,
                [scenario]: { ...current[scenario], [key]: value }
              }));
              setEvEbitdaScenarioSource("custom");
            }}
          />
        ) : valuation?.valuationMethod === "ddm" ? (
          <DdmScenarioPanel
            scenarios={ddmScenarios}
            mosPercent={mosPercent}
            dividendRate={fundamentals?.dividendRate ?? null}
            scenarioSource={ddmScenarioSource}
            loading={loadState === "loading"}
            onMosChange={setMosPercent}
            onResetSmart={() => {
              if (smartDdmScenarios) {
                setDdmScenarios(smartDdmScenarios);
                setDdmScenarioSource("smart");
              }
            }}
            onResetGeneric={() => {
              setDdmScenarios(getDefaultDdmScenarios());
              setDdmScenarioSource("generic");
            }}
            onRecalculate={() => void fetchDashboardData(ticker, false)}
            onScenarioChange={(scenario, key, value) => {
              setDdmScenarios((current) => ({
                ...current,
                [scenario]: { ...current[scenario], [key]: value }
              }));
              setDdmScenarioSource("custom");
            }}
          />
        ) : (
          <ScenarioPanel
            scenarios={scenarios}
            mosPercent={mosPercent}
            analystEstimates={analystEstimates}
            scenarioSource={scenarioSource}
            loading={loadState === "loading"}
            onMosChange={setMosPercent}
            onResetSmart={() => {
              if (smartScenarios) {
                setScenarios(smartScenarios);
                setScenarioSource("smart");
              }
            }}
            onResetGeneric={() => {
              setScenarios(getDefaultScenarios());
              setScenarioSource("generic");
            }}
            onRecalculate={() => void fetchDashboardData(ticker, false)}
            onScenarioChange={(scenario, key, value) => {
              setScenarios((current) => ({
                ...current,
                [scenario]: { ...current[scenario], [key]: value }
              }));
              setScenarioSource("custom");
            }}
          />
        )}

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
            <PriceSummary quote={quote} sector={fundamentals.sector} industry={fundamentals.industry} />

            <div className="grid gap-4 lg:grid-cols-3">
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="bull" result={valuation.scenarios.bull} />
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="base" result={valuation.scenarios.base} />
              <FairValueCard currency={quote.currency} currentPrice={quote.regularMarketPrice} scenario="bear" result={valuation.scenarios.bear} />
            </div>

            {valuation.valuationMethod === "dcf" && fundamentals.sector && !getRecommendedMethod(detectSector(fundamentals.sector)).isDcfAppropriate && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-yellow-200">
                <span className="font-semibold">Nota:</span> Per il settore <strong>{fundamentals.sector}</strong>, il DCF potrebbe non essere il metodo di valutazione più appropriato. Metodo consigliato: <strong>{getRecommendedMethod(detectSector(fundamentals.sector)).label}</strong>.
              </div>
            )}

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

            <ValuationMetricsCards quote={quote} fundamentals={fundamentals} />

            <FundamentalsCharts fundamentals={fundamentals} />

            <AiAnalysisPanel
              ticker={ticker}
              mosPercent={mosPercent}
              scenarios={scenarios}
              companyName={quote.shortName}
              valuation={valuation}
            />

            <DeepValuePanel
              ticker={ticker}
              companyName={quote.shortName}
              mosPercent={mosPercent}
            />
          </motion.div>
        )}
      </div>
    </main>
  );
}
