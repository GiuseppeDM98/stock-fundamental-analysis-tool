// The domain errors of a staged run (2026-10-27), thrown by lib/analyses-store.ts and
// mapped to HTTP or to an SSE `error` by the routes. Pure (no Prisma), so the error-status
// module can name them without importing the database.

/** The row does not exist or is another user's: a 404 that never says which. */
export class AnalysisRunNotFound extends Error {
  constructor() {
    super("analysis not found");
    this.name = "AnalysisRunNotFound";
  }
}

/** The row cannot be (re)run now: "run already finished", "run still in progress",
 *  "dataset no longer available". The message is the route's 409 body. */
export class AnalysisRunConflict extends Error {
  constructor(message: "run already finished" | "run still in progress" | "dataset no longer available") {
    super(message);
    this.name = "AnalysisRunConflict";
  }
}

/** A write of the run's end touched no row: the row was deleted during the run, or a newer
 *  retry took it over. The phase ends quietly, never retried. */
export class AnalysisRunGone extends Error {
  constructor() {
    super("analysis deleted or taken over during the run");
    this.name = "AnalysisRunGone";
  }
}
