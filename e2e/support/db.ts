/**
 * Read-only access to the isolated e2e database from inside a spec, so assertions check the
 * real rows and not only what the page shows (WORKFLOW.md §2, obligation 4).
 *
 * Uses @libsql/client directly rather than the generated Prisma client: the generated client
 * is ESM-only (`import.meta`) and Playwright loads specs as CommonJS, and a spec only needs
 * a handful of plain SELECTs. The URL goes through the same `file:` guard as everything else.
 */
import { createClient, type Client, type InValue } from "@libsql/client";
import { E2E_DB_URL, assertIsolatedDatabaseUrl } from "./env";

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    assertIsolatedDatabaseUrl(E2E_DB_URL, "e2e db helper");
    client = createClient({ url: E2E_DB_URL });
  }
  return client;
}

/** All rows of a parameterised SELECT, as plain objects keyed by column name. */
export async function queryAll<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  const result = await getClient().execute({ sql, args });
  return result.rows.map((row) => ({ ...row }) as T);
}

/** The first row of a SELECT, or null. */
export async function queryOne<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await queryAll<T>(sql, args);
  return rows[0] ?? null;
}

/** COUNT(*) helper — `sql` must select a single column aliased `n`. */
export async function count(sql: string, args: InValue[] = []): Promise<number> {
  const row = await queryOne<{ n: number | bigint }>(sql, args);
  return Number(row?.n ?? 0);
}
