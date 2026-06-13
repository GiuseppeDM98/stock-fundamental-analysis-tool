import { AnalyzeClient } from "@/components/analyze-client";

/**
 * Root route (`/`) — delegates to the analyzer for now.
 *
 * Replaced by the adaptive Hub home in the next step; the deep-dive lives at `/analyze`.
 */
export default function HomePage() {
  return <AnalyzeClient />;
}
