// ResearchRun persistence: what each request of a web research collected, kept on the server
// between the three requests (lib/ai/research-parts.ts) until the dataset is saved, then
// deleted. The client only ever sends the run's id and the part it wants; it never carries a
// partial extract. Every query is scoped to the user, so another user's run reads as none.
import "server-only";
import { db } from "@/lib/db";
import { aiModelIdSchema } from "@/lib/ai/ai-preferences";
import { RESEARCH_PART_SCHEMAS } from "@/lib/ai/research-schema";
import type { ResearchPartRecord, ResearchPartRecords } from "@/lib/ai/research-parts";
import type { AiModelId } from "@/types/ai-settings";
import type { ResearchPart } from "@/types/dataset";

const DAY_MS = 86_400_000;

/** A run's identity, without its three records. */
export type ResearchRunRow = {
  id: string;
  userId: string;
  ticker: string;
  companyName: string;
  exchange: string;
  quoteCurrency: string;
  model: AiModelId;
  createdAt: Date;
};

const PART_COLUMN = { statements: "statementsJson", market: "marketJson", estimates: "estimatesJson" } as const satisfies Record<ResearchPart, string>;

/** Creates the run and drops the user's runs nobody finished in the last 24 hours: a run whose
 *  tab was closed is never resumed (a new tab starts a new research), so nothing else would. */
export async function startResearchRun(
  userId: string,
  input: { ticker: string; companyName: string; exchange: string; quoteCurrency: string; model: string }
): Promise<string> {
  await db.researchRun.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - DAY_MS) } } });
  const row = await db.researchRun.create({ data: { userId, ...input }, select: { id: true } });
  return row.id;
}

/** One part's record, or null when the column is empty, is not JSON, has neither shape of a
 *  record, or holds an output its part's schema rejects: the part is then run again, which
 *  costs a request, while a record read on trust could save a dataset the gates crash on. */
function parseRecord(part: ResearchPart, raw: string | null): ResearchPartRecord<unknown> | null {
  if (raw == null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value == null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.status === "skipped") return { status: "skipped" };
  if (record.status !== "done") return null;
  const output = RESEARCH_PART_SCHEMAS[part].safeParse(record.output);
  const numbers = ["searches", "fetches", "durationMs"].every((key) => typeof record[key] === "number");
  const seenUrls = Array.isArray(record.seenUrls) && record.seenUrls.every((url) => typeof url === "string");
  const servedBy = record.servedBy === null || typeof record.servedBy === "string";
  if (!output.success || !numbers || !seenUrls || !servedBy) return null;
  return {
    status: "done",
    output: output.data,
    seenUrls: record.seenUrls as string[],
    searches: record.searches as number,
    fetches: record.fetches as number,
    durationMs: record.durationMs as number,
    servedBy: record.servedBy as string | null,
  };
}

/** The user's run with its three records parsed, or null when missing, another user's, or
 *  saved with a model id the catalog no longer has. */
export async function readResearchRun(userId: string, runId: string): Promise<(ResearchRunRow & { records: ResearchPartRecords }) | null> {
  const row = await db.researchRun.findFirst({ where: { id: runId, userId } });
  if (!row) return null;
  const model = aiModelIdSchema.safeParse(row.model);
  if (!model.success) return null;
  const { statementsJson, marketJson, estimatesJson, ...identity } = row;
  return {
    ...identity,
    model: model.data,
    records: {
      statements: parseRecord("statements", statementsJson) as ResearchPartRecords["statements"],
      market: parseRecord("market", marketJson) as ResearchPartRecords["market"],
      estimates: parseRecord("estimates", estimatesJson) as ResearchPartRecords["estimates"],
    },
  };
}

/** Writes one part's record. @returns rows touched: 0 when the run is gone or another user's. */
export async function saveResearchPart(userId: string, runId: string, part: ResearchPart, record: ResearchPartRecord<unknown>): Promise<number> {
  const { count } = await db.researchRun.updateMany({ where: { id: runId, userId }, data: { [PART_COLUMN[part]]: JSON.stringify(record) } });
  return count;
}

/** Removes a run once its dataset is saved. */
export async function deleteResearchRun(userId: string, runId: string): Promise<void> {
  await db.researchRun.deleteMany({ where: { id: runId, userId } });
}
