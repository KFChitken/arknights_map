import { seedDemo } from "./lib/server/demo";
import { demoEnabled } from "./lib/server/env";
import { runMigrations } from "./lib/server/migrate";
import { pruneOldActivity } from "./lib/server/retention";
import { sendReportDigest } from "./lib/server/safety";

const TRIES = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// The database can still be starting (first boot, or a server restart that brought the app up first)
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    await runMigrations();
    if (demoEnabled) await seedDemo();
    break;
  } catch (e) {
    if (attempt === TRIES) {
      // Keep the server up; API calls will report the problem
      console.error("Database setup failed. Is `docker compose up -d db mail` running?", e);
    } else {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const prune = () => pruneOldActivity().catch((e) => console.error("Pruning old activity failed", e));
prune();
setInterval(prune, DAY_MS);

// Reports that came in after today's digest go out once a day has passed
setInterval(() => sendReportDigest().catch((e) => console.error("Report digest failed", e)), HOUR_MS);
