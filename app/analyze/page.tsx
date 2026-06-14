import { AnalyzeClient } from "@/components/analyze-client";

/**
 * Deep-dive analysis route (`/analyze`) — stage ③ "Decide" of the pipeline.
 *
 * Thin server component that delegates to AnalyzeClient (the AI Deep Value flow).
 * Reached via `/analyze?ticker=` from the Hub ticker box, advisor chips, compare,
 * watchlist, analyses re-run, and the portfolio exit signal.
 */
export default function AnalyzePage() {
  return <AnalyzeClient />;
}
