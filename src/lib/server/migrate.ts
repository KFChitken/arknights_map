import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db";

const folder = () => path.join(process.cwd(), "drizzle");

export async function runMigrations() {
  await migrate(db, { migrationsFolder: folder() });
}

/** Whether every migration this build has is in the database: what a helper process waits for (instrumentation-node.ts) */
export async function migrationsDone() {
  const journal = JSON.parse(readFileSync(path.join(folder(), "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  try {
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return Number(rows[0]?.n ?? 0) >= journal.entries.length;
  } catch {
    // no migrations table yet
    return false;
  }
}
