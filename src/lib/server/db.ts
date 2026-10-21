import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DATABASE_URL, isProd } from "./env";
import * as schema from "./schema";

// Reuse one pool across dev hot reloads
const g = globalThis as unknown as { pg?: postgres.Sql };
const client = g.pg ?? postgres(DATABASE_URL, { max: 10, onnotice: () => {} });
if (!isProd) g.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
