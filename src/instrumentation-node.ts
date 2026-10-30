import { beijingDate } from "./lib/beijing";
import { flipTheAway } from "./lib/server/away";
import { catchUpBadges } from "./lib/server/badges";
import { seedDemo } from "./lib/server/demo";
import { demoEnabled } from "./lib/server/env";
import { runMigrations } from "./lib/server/migrate";
import { pruneOldActivity } from "./lib/server/retention";
import { sendReportDigest } from "./lib/server/safety";
import { recordDailyTotals } from "./lib/server/totals";

const TRIES = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// The database can still be starting (first boot, or a server restart that brought the app up first)
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    await runMigrations();
    if (demoEnabled) await seedDemo();
    await catchUpBadges();
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

// 好久没来自动翻: once a day, at the first look after 04:00 Beijing time (a restart may run it again, to the same end)
let flippedOn = "";
const flipAway = () => {
  const now = Date.now();
  const day = beijingDate(now);
  if (day === flippedOn || beijingDate(now - 4 * HOUR_MS) !== day) return;
  flippedOn = day;
  flipTheAway(now).catch((e) => {
    flippedOn = "";
    console.error("Flipping roaches of players away failed", e);
  });
};
flipAway();
setInterval(flipAway, 5 * MINUTE_MS);

// Sitewide counts for the admin, often enough that each day's row closes within minutes of midnight
const totals = () => recordDailyTotals().catch((e) => console.error("Recording daily totals failed", e));
totals();
setInterval(totals, 10 * MINUTE_MS);
