import { seedDemo } from "./lib/server/demo";
import { demoEnabled } from "./lib/server/env";
import { runMigrations } from "./lib/server/migrate";

try {
  await runMigrations();
  if (demoEnabled) await seedDemo();
} catch (e) {
  // Keep the server up; API calls will report the problem
  console.error("Database setup failed. Is `docker compose up -d db mail` running?", e);
}
