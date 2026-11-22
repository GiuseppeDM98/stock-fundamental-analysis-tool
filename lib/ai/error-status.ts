import Anthropic from "@anthropic-ai/sdk";
import { AnalysisRunConflict, AnalysisRunGone } from "@/lib/analysis-run-errors";

/** The HTTP status an AI route answers for an error caught before its response started.
 *
 * 503 (retry later) for throttling and overload: the SDK's typed errors for the AI
 * provider — Anthropic or DeepSeek, both reached through this SDK — and the Yahoo
 * adapter's own rate-limit error (`lib/yahoo-client.ts`), which is a plain `Error` with
 * that phrase. Everything else is 400. The SDK classes replace a match on the message
 * text for the provider's errors, which depended on how the provider worded its 429
 * (DeepSeek's wording is not Anthropic's) and never caught a 5xx/529 overload. */
export function routeErrorStatus(error: unknown): number {
  return isBusy(error) ? 503 : 400;
}

function isBusy(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return true;
  const message = error instanceof Error ? error.message : "";
  return message.toLowerCase().includes("rate limit");
}

/** A run that ended badly without throwing (lib/ai/run-outcome.ts). */
type FailedRunEnd = { kind: "failed"; reason: "empty" | "refusal" | "max_tokens" | "no_valuation" };

function isFailedRunEnd(value: unknown): value is FailedRunEnd {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "failed";
}

const RUN_ERROR_TEXT = {
  busy: {
    en: "The AI provider is busy right now. Retry in a few minutes.",
    it: "Il fornitore AI è occupato in questo momento. Riprova fra qualche minuto.",
  },
  network: {
    en: "The connection to the AI provider dropped. Retry.",
    it: "La connessione con il fornitore AI si è interrotta. Riprova.",
  },
  refusal: {
    en: "The model declined this request. Retry with another model.",
    it: "Il modello ha rifiutato questa richiesta. Riprova con un altro modello.",
  },
  truncated: {
    en: "The answer was cut before its end: retry.",
    it: "La risposta si è interrotta prima della fine: riprova.",
  },
  empty: {
    en: "The model returned no answer: retry.",
    it: "Il modello non ha risposto: riprova.",
  },
  no_valuation: {
    en: "The valuation came back without a complete bull/base/bear: retry.",
    it: "La valutazione è arrivata senza la terna completa: riprova.",
  },
  gone: {
    en: "This analysis was deleted.",
    it: "Questa analisi è stata eliminata.",
  },
  dataset: {
    en: "The dataset of this analysis is no longer available. Run a new analysis.",
    it: "Il dataset di questa analisi non è più disponibile. Rilancia un'analisi nuova.",
  },
  other: {
    en: "The run stopped because of an error. Retry.",
    it: "La corsa si è interrotta per un errore. Riprova.",
  },
} as const;

function runErrorClass(err: unknown): keyof typeof RUN_ERROR_TEXT {
  if (isFailedRunEnd(err)) {
    if (err.reason === "refusal") return "refusal";
    if (err.reason === "max_tokens") return "truncated";
    return err.reason === "no_valuation" ? "no_valuation" : "empty";
  }
  if (err instanceof AnalysisRunGone) return "gone";
  if (err instanceof AnalysisRunConflict && err.message === "dataset no longer available") return "dataset";
  if (isBusy(err)) return "busy";
  if (err instanceof Anthropic.APIConnectionError) return "network";
  return "other";
}

/**
 * The sentence a staged run shows and stores (`Analysis.runError`) for a failure: fixed per
 * class, in the report's language (English unless it is Italian), never the SDK's message —
 * which can carry a request id or an internal detail, and reads as gibberish on screen. The
 * raw error goes to the server log instead (`[ai-run] … failed`).
 *
 * @param err - A thrown error, or the `failed` end of lib/ai/run-outcome.ts.
 * @param language - The run's report language ("Italiano"/"Italian" → Italian).
 */
export function runErrorMessage(err: unknown, language: string | null | undefined): string {
  const it = language === "Italiano" || language === "Italian";
  const text = RUN_ERROR_TEXT[runErrorClass(err)];
  return it ? text.it : text.en;
}

/** Whether "Retry" is worth offering: no for a request the provider rejects as such (bad
 *  request, auth, permission), a refusal and a row that is gone; yes for throttling, an
 *  outage, a dropped connection, a truncation and anything unexpected. */
export function isRetryableRunError(err: unknown): boolean {
  if (isFailedRunEnd(err)) return err.reason !== "refusal";
  if (err instanceof AnalysisRunGone || err instanceof AnalysisRunConflict) return false;
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return false;
  }
  return true;
}
