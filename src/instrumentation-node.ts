// first, so anything below that says something says it in Chinese (src/i18n)
import "./i18n/server";
import { rmSync } from "node:fs";
import { beijingDate } from "./lib/beijing";
import { saveAmapLoads } from "./lib/server/amapLoads";
import { saveAppCounts } from "./lib/server/appCounts";
import { flipTheAway } from "./lib/server/away";
import { morningStats, recordOnlinePeak, reportOnline } from "./lib/server/dashboard";
import { comrades, fireSongs, nightByTheFire, sleptItOff } from "./lib/server/badges";
import { moveMingheRiders, spreadStackedRiders } from "./lib/server/minghe";
import { catchUpBadges } from "./lib/server/badges";
import { seedDemo } from "./lib/server/demo";
import { demoEnabled, watchEnabled } from "./lib/server/env";
import { hearOthers } from "./lib/server/live";
import { pruneSignInMail } from "./lib/server/loginCodes";
import { startMainlandMap } from "./lib/server/mainlandMap";
import { migrationsDone, runMigrations } from "./lib/server/migrate";
import { startAdmins } from "./lib/server/admins";
import { startNotices } from "./lib/server/notices";
import { moveOutOfOffLimits } from "./lib/server/offLimits";
import { startSettings } from "./lib/server/siteSettings";
import { spreadFireStacks } from "./lib/server/talulah";
import { pruneOldActivity } from "./lib/server/retention";
import { pruneRoachChanges } from "./lib/server/roachFeed";
import { drainFile, markStarted } from "./lib/server/ready";
import { sendReportDigest } from "./lib/server/safety";
import { innMinute } from "./lib/server/si";
import { logError, note } from "./lib/server/signals";
import { saveStatCounts } from "./lib/server/stats";
import { recordDailyTotals } from "./lib/server/totals";
import { buildId, heardStart, processName, startWatch } from "./lib/server/watch";
import { hearSignals, shareSignals } from "./lib/server/watchSignals";
import { finishZones, startZones, UNFINISHED_AFTER_MS } from "./lib/server/zones";

const TRIES = 10;

/** A background job failed: in the log, and counted for the site's own checks (src/lib/server/watch.ts) */
const failed = (job: string, what: string) => (e: unknown) => {
  logError(what, e);
  note("job", job);
};
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * The live site runs the app in several processes behind Caddy, to use more than one core: one main
 * (WEB_ROLE unset) brings the database up to date and runs every job below, once; the helpers
 * (WEB_ROLE=helper) only answer requests, after the main has brought the database up to date.
 */
const helper = process.env.WEB_ROLE === "helper";

// The database can still be starting (first boot, or a server restart that brought the app up first)
let setUp = false;
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    if (!helper) {
      await runMigrations();
      if (demoEnabled) await seedDemo();
      await catchUpBadges();
    } else if (!(await migrationsDone())) throw new Error("the main process has not brought the database up to date yet");
    setUp = true;
    break;
  } catch (e) {
    if (attempt === TRIES) {
      // Keep the server up; API calls will report the problem
      failed("setup", "Database setup failed. Is `docker compose up -d db mail` running?")(e);
    } else {
      await new Promise((r) => setTimeout(r, helper ? 3000 : 1500));
    }
  }
}

// nudges from the other processes, for the pages connected to this one
await hearOthers().catch(failed("live", "Listening for the other processes' nudges failed"));

// 公告, kept in memory by every process and read before the first page asks (none, if they cannot be read)
await startNotices();

// the moderators, kept in memory by every process for the map's buttons (none, if they cannot be read)
await startAdmins();

// the places the owner drew where no roach may stand (禁放区), and the site's settings (全站变灰): kept in memory by
// every process and read before the first page asks (only the code's places and no gray, if they cannot be read)
await startZones();
await startSettings();

// which map visitors from mainland China start with (高德's, or 腾讯's once 高德's map loads ran out this month): kept in
// memory by every process and read again every minute (高德's, if it cannot be read)
await startMainlandMap();

// 高德 map loads counted by this process go into the shared count (the main's checks add theirs as they look)
if (helper) setInterval(() => saveAmapLoads().catch(failed("loads", "Saving 高德's map loads failed")), 10 * MINUTE_MS);

// 存到桌面's counts and 数据看板's, kept in memory by every process: added to the day's rows once a minute, and once
// more when it is told to stop (Next.js then waits for the requests under way before it goes, src/lib/server/appCounts.ts
// and stats.ts)
const saveCounts = () => {
  void saveAppCounts().catch(failed("counts", "Saving 存到桌面's counts failed"));
  void saveStatCounts().catch(failed("counts", "Saving 数据看板's counts failed"));
};
setInterval(saveCounts, MINUTE_MS);
process.once("SIGTERM", () => void saveCounts());

// 数据看板's 此刻在线: every process says how many signed-in players have a page open on it, once a minute; the main adds
// them up, keeping each hour's peak (src/lib/server/dashboard.ts)
const online = async () => {
  await reportOnline(processName());
  if (!helper) await recordOnlinePeak();
};
setInterval(() => online().catch(failed("online", "Counting the players online failed")), MINUTE_MS);

// the helpers tell the main's checks what they noted, and when they started (src/lib/server/watchSignals.ts)
if (helper && watchEnabled) shareSignals(processName(), buildId());

if (!helper) {

  const prune = () => pruneOldActivity().catch(failed("prune", "Pruning old activity failed"));
  prune();
  setInterval(prune, DAY_MS);

  // the roach change log (src/lib/server/roachFeed.ts) only needs its last few hours
  const pruneChanges = () => pruneRoachChanges().catch(failed("prune", "Pruning the roach change log failed"));
  pruneChanges();
  setInterval(pruneChanges, 10 * MINUTE_MS);

  // sign-in codes past their day and mail counted for more than a day: here, not on every ask for a code
  const pruneMail = () => pruneSignInMail().catch(failed("prune", "Pruning old sign-in codes and mail counts failed"));
  pruneMail();
  setInterval(pruneMail, 5 * MINUTE_MS);

  // Reports the admin has not heard of: an urgent one within half an hour of the last urgent reminder, the rest once a day
  // has passed since the day's reminder. Cheap: it only looks at open reports nobody was told of.
  setInterval(() => sendReportDigest().catch(failed("digest", "Report digest failed")), 10 * MINUTE_MS);

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
    // 火边的歌声: who sits by 塔露拉干员's fire when it is big enough, counted each morning too
    fireSongs().catch(failed("ride", "Counting 塔露拉干员's fire failed"));
    // 温暖你的战友: a night by the fire for each player with a roach there; 共患难的战友 for 30 days together
    nightByTheFire(now).catch(failed("badges", "Counting the nights by 塔露拉干员's fire failed"));
    comrades(now).catch(failed("badges", "Giving 共患难的战友 failed"));
  };
  ride();
  setInterval(ride, 5 * MINUTE_MS);
  // riders that stood on one another when the queue still ended at 2 km each get a spot of their own
  spreadStackedRiders().catch(failed("ride", "Spreading 明河都尉's stacked riders failed"));
  // roaches sitting on one another by 塔露拉干员's fire, from when each page picked its own seat, each get a seat of their own
  spreadFireStacks().catch(failed("fire", "Spreading the roaches stacked by 塔露拉干员's fire failed"));
  // roaches standing where none may (src/lib/offLimits.ts), from before the place was listed, move out: first those in
  // a place the owner drew that was left half done (the process drawing it stopped), counted on it, then any other
  finishZones()
    .catch(failed("offLimits", "Finishing the places the owner drew failed"))
    .then(() => moveOutOfOffLimits())
    .catch(failed("offLimits", "Moving roaches out of the off-limits places failed"));
  // and one drawn on a helper that stopped while this one ran on
  setInterval(
    () => finishZones(Date.now(), UNFINISHED_AFTER_MS).catch(failed("offLimits", "Finishing the places the owner drew failed")),
    10 * MINUTE_MS,
  );

  // 缘缘庄 (src/lib/server/si.ts): 祀掌柜 tells the ink roaches' owners as they get their room and leave it, once a minute;
  // a run never overlaps the one before
  let innBusy = false;
  const inn = () => {
    if (innBusy) return;
    innBusy = true;
    innMinute()
      .catch(failed("inn", "Telling 缘缘庄's check-ins and check-outs failed"))
      .finally(() => {
        innBusy = false;
      });
  };
  inn();
  setInterval(inn, MINUTE_MS);

  // 二次呼吸: drunk and left to sleep until the morning, given within minutes of waking
  const sleptOff = () => sleptItOff().catch(failed("badges", "Giving 二次呼吸 failed"));
  setInterval(sleptOff, 5 * MINUTE_MS);

  // Sitewide counts for the admin, often enough that each day's row closes within minutes of midnight
  const totals = () => recordDailyTotals().catch(failed("totals", "Recording daily totals failed"));
  totals();
  setInterval(totals, 10 * MINUTE_MS);

  // 数据看板's morning: from 05:00 Beijing time, the days before the board filled in once ever (before 06:00), then the
  // day's snapshot of how players and roaches are spread, unless today's is there (a restart takes it only if not)
  let morningBusy = false;
  const morning = () => {
    if (morningBusy) return;
    morningBusy = true;
    morningStats()
      .catch(failed("dashboard", "数据看板's morning counts failed"))
      .finally(() => {
        morningBusy = false;
      });
  };
  morning();
  setInterval(morning, 5 * MINUTE_MS);

  // The site's own checks, which email the admins when something urgent is wrong and send a digest each morning
  // (on in production unless WATCH=off), counting what the helpers noted too
  if (watchEnabled) {
    await hearSignals(heardStart).catch(failed("signals", "Listening for the helpers' signals failed"));
    startWatch();
  }
}

// Ready to answer (GET /api/ready, with the roach list once it is made): not when the database could not be set up.
// A release's note to take this process out (drainFile) was for the one before it.
rmSync(drainFile(), { force: true });
if (setUp) markStarted();
