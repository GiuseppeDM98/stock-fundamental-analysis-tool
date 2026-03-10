// Singleton Prisma client for Next.js.
// In development, hot-reloads create new module instances on each reload.
// Without this singleton pattern, each reload would create a new connection,
// exhausting the SQLite connection pool quickly.
//
// Prisma 7 requires a driver adapter for SQLite. PrismaBetterSqlite3 takes
// a config object with a `url` field (the database file path).
import { PrismaClient } from "../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// DATABASE_URL format: "file:./dev.db" — strip the "file:" prefix.
const dbUrl = process.env.DATABASE_URL?.replace("file:", "") ?? "./dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl });

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
