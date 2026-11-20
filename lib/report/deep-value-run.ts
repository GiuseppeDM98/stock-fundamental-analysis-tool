// The inputs a live Deep Value run was generated with, frozen when Generate is pressed.
//
// The /analyze page keeps every input editable after a run finishes: the user can edit or
// re-confirm or replace the financial dataset, move the MoS slider, or the quote can refresh.
// Reading those live props after the run paired the finished report with inputs it was
// never generated from — the checks card on another extract, or the watchlist item at
// another MoS than the one the fair values were computed at. Everything that describes the
// run on the page reads this snapshot instead; the saved row is written by the server
// (app/api/ai/deep-value), from the inputs it received.
import type { GroundedFinancials } from "@/types/grounding";

export type DeepValueRunInputs = {
  ticker: string;
  companyName: string;
  mosPercent: number;
  // The authoritative price shown when the run started (the checks card's price).
  currentPrice: number | null;
  currency: string | null;
  // The confirmed dataset the run was built on (every run has one); null on a retry
  // started from a row, whose dataset the server reads itself.
  dataset: { id: string; extract: GroundedFinancials } | null;
  // The report language the run was asked for (frozen at Generate, like the rest).
  language: string;
};
