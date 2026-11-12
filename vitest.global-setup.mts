import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** The server tests wipe this database, so it must never be the one `npm run dev` uses. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://roach:roach@localhost:5432/roach_test";

/** Creates the test database if needed and brings it to the latest migration. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must name a database ending in _test, got "${name}"`);

  const admin = postgres({ ...connection(url), database: "postgres", max: 1, onnotice: () => {} });
  try {
    const [found] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!found) await admin.unsafe(`create database "${name}"`);
  } catch (e) {
    throw new Error(`Cannot reach Postgres for the tests. Is \`docker compose up -d db\` running?\n${e}`);
  } finally {
    await admin.end();
  }

  const client = postgres(url.href, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
}

function connection(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
