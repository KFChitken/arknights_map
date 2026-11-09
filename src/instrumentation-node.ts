import { beijingDate } from "./lib/beijing";
import { flipTheAway } from "./lib/server/away";
import { moveMingheRiders } from "./lib/server/minghe";
import { catchUpBadges } from "./lib/server/badges";
import { seedDemo } from "./lib/server/demo";
import { demoEnabled, watchEnabled } from "./lib/server/env";
import { runMigrations } from "./lib/server/migrate";
import { pruneOldActivity } from "./lib/server/retention";
import { sendReportDigest } from "./lib/server/safety";
import { note } from "./lib/server/signals";
import { recordDailyTotals } from "./lib/server/totals";
import { startWatch } from "./lib/server/watch";

const TRIES = 10;

/** A background job failed: in the log, and counted for the site's own checks (src/lib/server/watch.ts) */
const failed = (job: string, what: string) => (e: unknown) => {
  console.error(what, e);
  note("job", job);
};
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
      failed("setup", "Database setup failed. Is `docker compose up -d db mail` running?")(e);
    } else {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const prune = () => pruneOldActivity().catch(failed("prune", "Pruning old activity failed"));
prune();
setInterval(prune, DAY_MS);

// Reports that came in after today's digest go out once a day has passed
setInterval(() => sendReportDigest().catch(failed("digest", "Report digest failed")), HOUR_MS);

// 好久没来自动翻: once a day, at the first look after 04:00 Beijing time (a restart may run it again, to the same end)
let flippedOn = "";
const flipAway = () => {
  const now = Date.now();
  const day = beijingDate(now);
  if (day === flippedOn || beijingDate(now - 4 * HOUR_MS) !== day) return;
  flippedOn = day;
  flipTheAway(now).catch((e) => {
    flippedOn = "";
    failed("flip", "Flipping roaches of players away failed")(e);
  });
};
flipAway();
setInterval(flipAway, 5 * MINUTE_MS);

// 明河都尉 moves on at 04:00 Beijing time: his riders follow him to the next station, the same way (src/lib/server/minghe.ts)
let rodeOn = "";
const ride = () => {
  const now = Date.now();
  const day = beijingDate(now);
  if (day === rodeOn || beijingDate(now - 4 * HOUR_MS) !== day) return;
  rodeOn = day;
  moveMingheRiders(now).catch((e) => {
    rodeOn = "";
    failed("ride", "Moving 明河都尉's riders failed")(e);
  });
};
ride();
setInterval(ride, 5 * MINUTE_MS);

// Sitewide counts for the admin, often enough that each day's row closes within minutes of midnight
const totals = () => recordDailyTotals().catch(failed("totals", "Recording daily totals failed"));
totals();
setInterval(totals, 10 * MINUTE_MS);

// The site's own checks, which email the admins when something is wrong (on in production unless WATCH=off)
if (watchEnabled) startWatch();
