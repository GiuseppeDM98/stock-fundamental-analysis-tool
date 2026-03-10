// Singleton Prisma client for Next.js.
// In development, hot-reloads create new module instances on each reload.
// Without this singleton pattern, each reload would create a new connection,
// exhausting the connection pool.
//
// We use @prisma/adapter-libsql (Turso) for both dev and prod:
// - Dev:  TURSO_DATABASE_URL=file:./dev.db (local SQLite via libsql protocol)
// - Prod: TURSO_DATABASE_URL=libsql://... + TURSO_AUTH_TOKEN (Turso hosted)
// This gives a single code path regardless of environment.
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// PrismaLibSql accepts the libsql Config object directly (url + optional authToken).
const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
