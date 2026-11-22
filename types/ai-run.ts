// The staged AI run (2026-10-27): every model call of a Deep Value report or of an analyst
// lens is its own HTTP request, under the 300 s a function lives on Vercel Hobby, and its
// result is written by the server as soon as it arrives. The routes answer Server-Sent
// Events instead of raw text, so the client can tell a finished phase (`done`) from one the
// platform cut (a stream that ends with neither `done` nor `error`). Modelled on the
// staged "Consulente" run of net-worth-tracker (app/api/allocation-advice/run/route.ts).
import type { AnalystResult } from "@/components/report/types";

/** Analysis.runStatus: "running" from the moment the valuation starts, "done" once the
 *  server wrote the report, "failed" when the run ended without one. Rows written before
 *  the column existed read "done" (its default). */
export type AnalysisRunStatus = "running" | "done" | "failed";

/** One request each: the valuation, and the three requests of an analyst lens. */
export type AiRunStage = "valuation" | "blind" | "reconcile" | "final";

/** The three requests of a lens, in order: the blind commitment, the critique against the
 *  report, the final numbers. */
export const LENS_PHASES = ["blind", "reconcile", "final"] as const;
export type LensPhase = (typeof LENS_PHASES)[number];

/**
 * The events of a staged run, one per `data:` line.
 * - `stage` opens every request; on the valuation it carries the row's id and the start of
 *   this attempt, so a run cut right after it is already retryable.
 * - `text` is what the reader sees (after the route's start-marker gate).
 * - `done` closes a phase whose result is persisted; the blind phase carries its commitment.
 * - `error` closes a phase that failed, with a product sentence (never the SDK's message).
 */
export type AiRunEvent =
  | { type: "stage"; stage: AiRunStage; analysisId?: string; runStartedAt?: string }
  | { type: "text"; text: string }
  | { type: "done"; analysisId?: string; blind?: AnalystResult | null; degraded?: boolean }
  | { type: "error"; error: string; retryable: boolean };
