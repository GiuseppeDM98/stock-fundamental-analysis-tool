// Prisma CLI config.
// Migrations are developed against local SQLite (DATABASE_URL).
// To apply to Turso: turso db shell <db-name> < prisma/migrations/<name>/migration.sql
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
