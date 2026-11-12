import "server-only";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import tls from "node:tls";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { beijingDate, beijingShort } from "../beijing";
import { SITE_NAME } from "../rules";
import { levelRank, type Level } from "../siteStatus";
import { amapMapLoads, monthProgress, saveAmapLoads } from "./amapLoads";
import { db } from "./db";
import { isProd, MAIL_DAILY_LIMIT, SITE_URL, WATCH_DIGEST_HOUR, WATCH_DOORS, WATCH_EMAILS, WATCH_TLS_HOST } from "./env";
import { amapSearchToday } from "./geo";
import { sendAdminMail } from "./mail";
import { LOGIN_KINDS } from "./mailQuota";
import { mailSends, reports, watchIncidents, watchMails, watchState } from "./schema";
import { errorCode, recent, startedAt, type Signal } from "./signals";
import {
  BACKUP_STEPS,
  beijingClock,
  digestLetter,
  disk,
  gb,
  getState,
  mb,
  memory,
  pct,
  setState,
  type Incident,
} from "./watchReport";

/**
 * The site's own checks: every few minutes (startWatch, from instrumentation-node.ts) each check
 * says what is wrong right now, at one of three levels. A problem counts once it has been seen for
 * long enough, and is over once it has been gone for long enough, so a figure hovering at a line
 * makes one incident, not a mail each way (watch_incidents). Only urgent problems email the admins
 * at once (WATCH_EMAILS), and again when they are over; daily ones go into the morning's digest,
 * quiet ones are only kept for 网站状态 on the admin page (watchReport.ts). The same problem back
 * within an hour of its end is the same incident, and emails nobody. A whole site that is down
 * cannot email anyone, so .github/workflows/uptime.yml looks at /api/health from outside too.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How often the checks run */
export const WATCH_EVERY = 5 * MINUTE;
/** Emails about urgent problems and their end the checks may send in any 24 hours; the digest is apart, and none uses MAIL_DAILY_LIMIT */
export const WATCH_MAILS_PER_DAY = 10;
/** The same problem back within this long of its end opens its incident again, and emails nobody */
export const REOPEN_WITHIN = HOUR;
/** How long a problem must be gone before it is over, unless its check says otherwise */
const CLOSE_AFTER = 15 * MINUTE;
/** /api/health says no once the checks' own emails have not gone out for this long */
const MAIL_BROKEN_FOR = 30 * MINUTE;

const LOGS = "docker compose -f docker-compose.prod.yml logs";
/** web2 and web3 run on the second server (docker-compose.second.yml), with their own logs */
const LOGS_B = "cd ~/zhoupmap-b && docker compose logs";

/**
 * A problem one check sees now; key is unique within the check. urgent: emailed at once; daily: in the
 * morning's digest; quiet: only on the admin page. openAfter: rounds in a row it must be seen before it
 * counts (1 unless set); closeAfter: how long it must be gone before it is over; worst: how bad it got,
 * in words, and a figure that is higher when worse.
 */
export type Finding = {
  key: string;
  title: string;
  detail?: string;
  advice?: string;
  level: Level;
  openAfter?: number;
  closeAfter?: number;
  worst?: { text: string; score: number };
};

export type Check = {
  name: string;
  /** How far back it looks at what this process noted (signals.ts): until the process has run that long it cannot tell a problem is over */
  window?: number;
  /** Run at most this often; in between, its problems stand as they were */
  every?: number;
  /** Its findings are things that happened (a restart): never told as over */
  events?: boolean;
  /** How long its problems must be gone before they are over, unless a finding says otherwise */
  closeAfter?: number;
  /** open: whether one of its problems counts now, for a check that holds on to it until it is well clear of the line */
  run: (now: number, open: (key: string) => boolean) => Promise<Finding[]>;
};

/** A start of one of the app's processes */
type Start = { at: number; name: string; build: string };

type WatchState = {
  /** Problems seen in the last rounds that do not count yet: rounds in a row, and when first seen */
  pending: Map<string, { seen: number; first: number }>;
  /** How long each problem must be gone before it is over, as its check last said */
  closeAfter: Map<string, number>;
  lastRun: Map<string, number>;
  loaded: boolean;
  /** This process's start is in the record; the other processes' starts heard since the last round */
  started: boolean;
  heard: Start[];
  /** Since when the checks' emails have not gone out; 0 while they do */
  mailBrokenSince: number;
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
};

// on globalThis like signals.ts: /api/health (a route) reads what the checks (started at boot) found
const g = globalThis as unknown as { zhoupWatch?: WatchState };
const fresh = (): WatchState => ({
  pending: new Map(),
  closeAfter: new Map(),
  lastRun: new Map(),
  loaded: false,
  started: false,
  heard: [],
  mailBrokenSince: 0,
  running: false,
});
const state = () => (g.zhoupWatch ??= fresh());

/** For tests: start over as a new process would. */
export function forgetWatch() {
  if (g.zhoupWatch?.timer) clearInterval(g.zhoupWatch.timer);
  g.zhoupWatch = fresh();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]);
}

/** 「A ×3；B ×1」, most first */
function tally(codes: string[], name: (code: string) => string = (c) => c, top = 4) {
  const n = new Map<string, number>();
  for (const c of codes) n.set(name(c), (n.get(name(c)) ?? 0) + 1);
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([c, k]) => `${c} ×${k}`)
    .join("；");
}

/** The Beijing hour of a moment, 0–23 */
const beijingHour = (t: number) => Number(new Date(t + 8 * HOUR).toISOString().slice(11, 13));

// ---- the checks ----

async function checkDb(): Promise<Finding[]> {
  const t = Date.now();
  try {
    await withTimeout(db.execute(sql`select 1`), 5000);
  } catch (e) {
    return [
      {
        key: "down",
        level: "urgent",
        openAfter: 2,
        title: "数据库连不上",
        detail: `错误：${errorCode(e)}。网站上几乎所有操作都会失败。`,
        advice: `在服务器上看看：docker compose -f docker-compose.prod.yml ps，和 ${LOGS} --since 30m db`,
      },
    ];
  }
  const s = (Date.now() - t) / 1000;
  if (s < 2) return [];
  return [
    {
      key: "slow",
      level: "quiet",
      closeAfter: 30 * MINUTE,
      title: "数据库反应很慢",
      detail: `一次最简单的查询用了 ${s.toFixed(1)} 秒。`,
      advice: "网站会跟着变慢。看看服务器的 CPU 和内存（docker stats --no-stream）。",
      worst: { text: `最慢一次 ${s.toFixed(1)} 秒`, score: s },
    },
  ];
}

export function buildId() {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

/** Which of the app's processes this is: web, web2 or web3 on the live site (from where it keeps its roach list) */
export function processName() {
  return process.env.WEB_NAME || path.basename(process.env.FEED_STATE || "", ".json") || (process.env.WEB_ROLE === "helper" ? os.hostname() : "web");
}

/** Another process said it started (watchSignals.ts); the next round puts it in the record */
export function heardStart(s: Start) {
  state().heard.push(s);
}

/** A few processes starting again within this long of one another (a setting changed, the server restarted) are one restart */
const TOGETHER = 2 * MINUTE;

/**
 * Restarts that were not deploys: a process starting with the build it ran before. Each process says
 * when it starts (this one by itself, the others through watchSignals.ts), and the record of the last
 * day's starts lives in watch_state. Three restarts in an hour (the app crashing again and again) are
 * urgent; one is for the digest.
 */
async function checkRestart(now: number): Promise<Finding[]> {
  const w = state();
  const news: Start[] = w.heard.splice(0);
  if (!w.started) {
    w.started = true;
    news.push({ at: startedAt(), name: processName(), build: buildId() });
  }
  if (!news.length) return [];
  const kept = await getState("starts");
  let starts: (Start & { again: boolean })[] = kept ? JSON.parse(kept.value) : [];
  // before the record of starts, the build last seen running was kept alone, for the main process
  const lastBuild = (await getState("build"))?.value;
  const again: Start[] = [];
  for (const s of news) {
    const before = starts.findLast((x) => x.name === s.name)?.build ?? (s.name === "web" ? lastBuild : undefined);
    starts.push({ ...s, again: before === s.build });
    if (before === s.build) again.push(s);
  }
  starts = starts.filter((s) => now - s.at < DAY);
  await setState("starts", JSON.stringify(starts), now);
  const web = news.find((s) => s.name === "web");
  if (web) await setState("build", web.build, now);
  if (!again.length) return [];

  let restarts = 0;
  let last = -Infinity;
  for (const s of starts.filter((x) => x.again && now - x.at < HOUR).sort((a, b) => a.at - b.at)) {
    if (s.at - last > TOGETHER) restarts++;
    last = s.at;
  }
  const names = [...new Set(again.map((s) => s.name))].join("、");
  const when = beijingShort(Math.max(...again.map((s) => s.at)));
  const advice = `可能是程序崩溃后被 Docker 自动拉起，也可能是服务器重启了；如果是你自己重启或改了设置，可以不用管。查原因：${LOGS} --since 2h web；第二台上的 web2、web3：${LOGS_B} --since 2h`;
  return [
    restarts >= 3
      ? {
          key: "again",
          level: "urgent",
          title: `网站程序 1 小时里重启了 ${restarts} 次`,
          detail: `最近一次是 ${when}（${names}），版本都没变，不是部署新版本引起的。程序可能在反复崩溃。`,
          advice,
        }
      : {
          key: "again",
          level: "daily",
          title: "网站程序重启过",
          detail: `${when} ${names} 重新启动，版本没变，不是部署新版本引起的。`,
          advice,
        },
  ];
}

/**
 * Errors of all three processes (the helpers send theirs here, watchSignals.ts): a flood (100 in ten
 * minutes, or 10 in each of the last three ten minutes) is urgent; 20 in a day is for the digest,
 * with the three paths it came from most; a few at once only for the admin page.
 */
async function checkErrors(now: number): Promise<Finding[]> {
  const ten = recent("error", 10 * MINUTE, now);
  const day = recent("error", DAY, now);
  const window = (from: number) => day.filter((s) => s.at >= now - from - 10 * MINUTE && s.at < now - from).length;
  const flood = ten.length >= 100 || [0, 10 * MINUTE, 20 * MINUTE].every((from) => window(from) >= 10);
  const worst = { text: `10 分钟里最多 ${ten.length} 次`, score: ten.length };
  const advice = `访客会看到「服务器出了点问题」。看日志：${LOGS} --since 30m web；第二台上的 web2、web3：${LOGS_B} --since 30m`;
  if (flood) {
    return [
      {
        key: "many",
        level: "urgent",
        title: "网站程序大面积出错",
        detail: `10 分钟内出错 ${ten.length} 次（三个程序合计），最多的是：${tally(ten.map((s) => s.code), undefined, 3)}。很多访客现在用不了网站，可能是新版本有问题。`,
        advice,
        worst,
      },
    ];
  }
  if (day.length >= 20) {
    return [
      {
        key: "many",
        level: "daily",
        title: "网站程序这一天出错比较多",
        detail: `过去 24 小时出错 ${day.length} 次（三个程序合计），最多的是：${tally(day.map((s) => s.code), undefined, 3)}。`,
        advice,
        worst,
      },
    ];
  }
  if (ten.length >= 5) {
    return [
      {
        key: "many",
        level: "quiet",
        title: "网站程序频繁出错",
        detail: `10 分钟内出错 ${ten.length} 次，最多的是：${tally(ten.map((s) => s.code), undefined, 3)}。`,
        advice,
        worst,
      },
    ];
  }
  return [];
}

/**
 * Sign-in code emails against MAIL_DAILY_LIMIT: used up is urgent, and so is a pace that would use
 * it up within six hours (once a day); 80% is for the digest. Each holds until the count is well
 * below its line (95%, 75%), so a count going back and forth across it is one incident.
 */
async function checkQuota(now: number, open: (key: string) => boolean): Promise<Finding[]> {
  // the admin's report reminders are not counted against the limit (src/lib/server/mailQuota.ts)
  const sent = (since: number) =>
    db
      .select({ n: count() })
      .from(mailSends)
      .where(and(inArray(mailSends.kind, LOGIN_KINDS), gt(mailSends.sentAt, new Date(now - since))));
  const [{ n }] = await sent(DAY);
  const said = `过去 24 小时发了 ${n} 封，上限是 ${MAIL_DAILY_LIMIT} 封（服务器 .env 里的 MAIL_DAILY_LIMIT）。`;
  if (n >= MAIL_DAILY_LIMIT || (open("full") && n >= 0.95 * MAIL_DAILY_LIMIT)) {
    return [
      {
        key: "full",
        level: "urgent",
        title: "验证码邮件用完了",
        detail: `${said}新来的人现在收不到验证码，登录不了。`,
        advice: "要等最早发的那些满 24 小时不再算进去才会恢复。要放宽就调大 MAIL_DAILY_LIMIT 再重新部署；Resend 自己的额度在 resend.com 上看。",
      },
    ];
  }
  const [{ n: lastHour }] = await sent(HOUR);
  const hoursLeft = lastHour ? (MAIL_DAILY_LIMIT - n) / lastHour : Infinity;
  const rush = hoursLeft <= 6;
  const high = n >= 0.8 * MAIL_DAILY_LIMIT || (open("high") && n >= 0.75 * MAIL_DAILY_LIMIT);
  if (!rush && !high) return [];
  // the rush is emailed once a day at most; after that it is for the digest
  const today = beijingDate(now);
  const urgent = rush && (await getState("quotaRush"))?.value !== today;
  if (urgent) await setState("quotaRush", today, now);
  return [
    {
      key: "high",
      level: urgent ? "urgent" : "daily",
      title: rush ? "验证码邮件照现在的速度很快会用完" : "验证码邮件快用完了",
      detail: rush ? `${said}最近一小时发了 ${lastHour} 封，照这个速度大约 ${Math.max(1, Math.round(hoursLeft))} 小时后用完。` : said,
      advice: "用完以后新来的人就收不到验证码了。要放宽就调大 MAIL_DAILY_LIMIT 再重新部署。",
      worst: { text: `最多发到 ${n} 封`, score: n },
    },
  ];
}

/**
 * Sign-in code emails failing: urgent when ten or more failed in a quarter of an hour and failures
 * outnumber what went out, until for a quarter of an hour what went out outnumbers the failures;
 * one now and then, with nothing gone out since, only for the admin page.
 */
async function checkMail(now: number, open: (key: string) => boolean): Promise<Finding[]> {
  const failed = recent("mailFailed", 15 * MINUTE, now);
  const went = recent("mailSent", 15 * MINUTE, now);
  const advice =
    "多半是 Resend 那边：Key 失效、额度用完或被限流，登录 resend.com 看看。这封邮件也经 Resend 发，它要是也发不出去，外面的在线检查会提醒你。";
  if (failed.length > went.length && (failed.length >= 10 || open("failing"))) {
    return [
      {
        key: "failing",
        level: "urgent",
        title: "验证码邮件发不出去",
        detail: `最近 15 分钟失败 ${failed.length} 次（${tally(failed.map((s) => s.code))}），发出去 ${went.length} 封。新来的人收不到验证码。`,
        advice,
        worst: { text: `15 分钟里最多失败 ${failed.length} 次`, score: failed.length },
      },
    ];
  }
  const lately = recent("mailFailed", 30 * MINUTE, now);
  if (!lately.length) return [];
  // a code that went out after the last failure: mail works again
  const lastFailed = lately[lately.length - 1].at;
  if (recent("mailSent", 30 * MINUTE, now).some((s) => s.at > lastFailed)) return [];
  return [
    {
      key: "failing",
      level: "quiet",
      title: "验证码邮件偶尔发不出去",
      detail: `30 分钟内失败 ${lately.length} 次（${tally(lately.map((s) => s.code))}），之后还没有发出去过。`,
      advice,
    },
  ];
}

const REFUSED: Record<string, string> = {
  "ip-10min": "同一网络 10 分钟内太频繁",
  "ip-day": "同一网络一天内太多",
  cooldown: "同一邮箱两分钟内重复",
  "address-day": "同一邮箱一天内超过次数",
  quota: "全站邮件额度用完",
  // MAIL_SLOW_DOMAINS' own caps (src/lib/server/mailQuota.ts)
  "slow-day": "发往 Gmail 等慢邮箱的当天名额用完",
  "slow-hour": "发往 Gmail 等慢邮箱的这一小时名额用完",
  "slow-paused": "发往 Gmail 等慢邮箱的验证码暂停中",
  // of those caps, the share codes to addresses with no account may take (MAIL_SLOW_NEW_SHARE)
  "slow-new-day": "发往 Gmail 等慢邮箱、给新注册的当天名额用完",
  "slow-new-hour": "发往 Gmail 等慢邮箱、给新注册的这一小时名额用完",
  "slow-new-paused": "发往 Gmail 等慢邮箱、给新注册的验证码暂停中",
  // 登录码 (src/app/api/auth/desk-code/redeem)
  "desk-wrong": "登录码不对或者过期",
  "desk-ip": "同一网络试登录码太多次",
};

async function checkCodes(now: number): Promise<Finding[]> {
  const list = recent("codeRefused", HOUR, now);
  if (list.length < 30) return [];
  return [
    {
      key: "flood",
      level: "quiet",
      title: "有人在频繁要验证码",
      detail: `一小时内有 ${list.length} 次要验证码被拦下（${tally(list.map((s) => s.code), (c) => REFUSED[c] ?? c)}）。`,
      advice: "被拦下的不会发邮件，不花钱，也不影响其他人登录；一直这样的话可能有人在刷。",
      worst: { text: `一小时最多 ${list.length} 次`, score: list.length },
    },
  ];
}

/** The limits of the roach list (src/app/api/roaches): what each one holds back */
const BUSY_LIMITS: Record<string, string> = {
  "area:full:sid": "一个页面要新范围太勤",
  "area:full:ip": "同一网络要新范围太多",
  "area:diff:sid": "一个页面问变化太勤",
  "area:diff:ip": "同一网络问变化太多",
  "area:counts:sid": "全员隐匿的页面问总数太勤",
  "feed:full:sid": "一个页面要整份名单太勤",
  "feed:full:ip": "同一网络要整份名单太多",
  "feed:diff:sid": "一个页面问名单变化太勤",
  "feed:diff:ip": "同一网络问名单变化太多",
  "feed:visitor:ip": "同一网络的访客问总数太多",
};

/**
 * Pages held back by the roach list's limits (429, src/app/api/roaches): a page held back shows the roaches it
 * had a little longer (zoomed out, only where it was). Over 100 in 10 minutes for the digest, over 1,000 at once.
 */
async function checkBusy(now: number): Promise<Finding[]> {
  const list = recent("busy", 10 * MINUTE, now);
  if (list.length < 100) return [];
  return [
    {
      key: "busy",
      level: list.length >= 1000 ? "urgent" : "quiet",
      title: "很多页面要小强名单时被限速",
      detail: `10 分钟内有 ${list.length} 次被拦下（三个程序合计；${tally(list.map((s) => s.code), (c) => BUSY_LIMITS[c] ?? c)}）。`,
      advice: "被拦下的页面会过几秒再要，这期间地图上只显示它原来那片；一直这样的话，要么是有人在刷，要么是限制定得太紧（src/app/api/roaches/route.ts）。",
      worst: { text: `10 分钟最多 ${list.length} 次`, score: list.length },
    },
  ];
}

const PASSWORD_FAILS: Record<string, string> = {
  none: "没有这个账号或没设密码",
  paused: "暂停中还在试",
  wrong: "密码不对",
  banned: "被封的账号",
};

/** Sign-ins with a password failing (src/lib/server/passwords.ts): over 300 in an hour for the digest, over 3,000 at once */
async function checkPasswords(now: number): Promise<Finding[]> {
  const list = recent("passwordFail", HOUR, now);
  if (list.length <= 300) return [];
  return [
    {
      key: "guessing",
      level: list.length > 3000 ? "urgent" : "daily",
      title: "有人在大量试密码",
      detail: `一小时内用密码登录失败 ${list.length} 次（${tally(list.map((s) => s.code), (c) => PASSWORD_FAILS[c] ?? c)}）。`,
      advice: "每个网络 10 分钟最多试 20 次，一个账号错 5 次就暂停一阵；一直这样多，可能有人拿着别处泄露的密码在试。",
      worst: { text: `一小时最多 ${list.length} 次`, score: list.length },
    },
  ];
}

const MAPS: Record<string, string> = { amap: "高德", osm: "OSM 底图", overseas: "我们自己的海外底图" };

/** What 腾讯位置服务's status means, when it turns away the key of the place suggestions */
const TENCENT_SAYS: Record<string, string> = {
  "110": "这个网站不在 Key 的域名白名单里",
  "111": "签名验证失败",
  "112": "IP 未被授权",
  "113": "Key 没开这个功能",
  "121": "Key 今天的调用量用完了",
  "190": "Key 无效",
  "199": "Key 没开 WebServiceAPI",
  "301": "页面里没有 Key",
  "311": "Key 格式不对",
};
const MAP_TROUBLE: Record<string, string> = {
  load: "没加载出来",
  key: "Key 异常",
  slow: "一直没画出来",
  style: "样式没加载出来",
  tiles: "图块加载失败",
};

/** 「高德·Key 异常（USER_DAILY_QUERY_OVER_LIMIT）」 from 「amap:key:USER_DAILY_QUERY_OVER_LIMIT」 */
function mapTrouble(code: string) {
  const [map, what, detail] = code.split(":");
  return `${MAPS[map] ?? map}·${MAP_TROUBLE[what] ?? what}${detail ? `（${detail}）` : ""}`;
}

/**
 * 高德 saying its key is wrong or used up three times in ten minutes is for the digest; other trouble
 * (a slow phone network, a tile now and then) only for the admin page, once it adds up to ten in half
 * an hour. The server's own place search being told by 高德 that its allowance is used up is told on
 * its own, for as long as the day lasts: the map itself is fine. So are pages saying 腾讯位置服务
 * turned away the key of their place suggestions, three times in half an hour: for the digest when the
 * key is set up wrong, only for the admin page when the day's allowance ran out.
 */
async function checkMaps(now: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const search = amapSearchToday(now);
  if (search.out) {
    findings.push({
      key: "search",
      level: "quiet",
      title: "高德搜地点额度用完了",
      detail: `今天服务器向高德搜地点时被拒（${search.out}），今天不再用高德搜；明天 0 点（北京时间）再试。今天用了 ${search.used} 次，每天最多 ${search.daily} 次。`,
      advice: "地图和点地图放蟑螂不受影响；内地玩家搜地名会改用 OpenStreetMap，下个月 1 日高德额度恢复。个人账号买不了更多。",
    });
  }
  const tencent = recent("map", 30 * MINUTE, now)
    .filter((s) => s.code.startsWith("tencent:search:"))
    .map((s) => s.code.slice("tencent:search:".length));
  if (tencent.length >= 3) {
    const usedUp = tencent.filter((c) => c === "121").length * 2 > tencent.length;
    findings.push({
      key: "tencent",
      level: usedUp ? "quiet" : "daily",
      title: usedUp ? "腾讯打字提示今天的额度用完了" : "腾讯打字提示的 Key 被拒了",
      detail: `30 分钟内有 ${tencent.length} 个页面说腾讯位置服务不给打字提示：${tally(tencent, (c) => `${c}（${TENCENT_SAYS[c] ?? "其他"}）`)}。`,
      advice: usedUp
        ? "地图和搜地点不受影响：内地玩家打字时的提示改用 OpenStreetMap，明天 0 点（北京时间）腾讯的额度恢复。每天用了多少、这把 Key 分到多少，在腾讯位置服务控制台（https://lbs.qq.com/dev/console）的配额管理里看。"
        : "地图和搜地点不受影响：内地玩家打字时的提示改用 OpenStreetMap。到腾讯位置服务控制台（https://lbs.qq.com/dev/console）看这把 Key：要开 WebServiceAPI，域名白名单要有 zhoupmap.com，配额管理里要给它分「关键词输入提示」的额度。这类报告谁都能发，偶尔几次也可能是有人乱发。",
    });
  }
  const list = recent("map", 30 * MINUTE, now).filter((s) => !s.code.startsWith("amap:search:") && !s.code.startsWith("tencent:"));
  const keys = list.filter((s) => s.code.startsWith("amap:key:") && now - s.at < 10 * MINUTE);
  if (keys.length >= 3 || list.length >= 10) {
    findings.push({
      key: "failing",
      level: keys.length >= 3 ? "daily" : "quiet",
      title: "地图在访客那里加载失败",
      detail: `30 分钟内有 ${list.length} 次：${tally(list.map((s) => s.code), mapTrouble)}。`,
      advice:
        "访客那边会自动换成别的底图，但内地访客看到的就不是高德了。高德的话多半是 Key 当天的调用量用完或 Key 设置有问题，登录高德开放平台控制台看看。这类报告谁都能发，偶尔几次也可能是访客自己的网络问题。",
      worst: { text: `半小时最多 ${list.length} 次`, score: list.length },
    });
  }
  return findings;
}

/**
 * 高德's map loads this month (src/lib/server/amapLoads.ts), told once a month in the digest: when 80%
 * of the allowance is gone, or when this month's pace so far would use it up before the month ends.
 */
async function checkAmapLoads(now: number): Promise<Finding[]> {
  const { month, count } = await saveAmapLoads(now);
  const limit = amapMapLoads();
  const { gone, days } = monthProgress(now);
  // a pace means something once a couple of days have gone by
  const projected = gone >= 2 ? Math.round((count / gone) * days) : count;
  if (count < limit * 0.8 && projected <= limit) return [];
  if ((await getState("amapLoadsTold"))?.value === month) return [];
  await setState("amapLoadsTold", month, now);
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    {
      key: "loads",
      level: "daily",
      title: "高德地图加载这个月快用完了",
      detail: `这个月到现在，内地访客大约打开了 ${n(count)} 次高德地图（估算）；照这个速度，到月底大约 ${n(projected)} 次。个人账号每月 ${n(limit)} 次。`,
      advice:
        "以高德控制台为准：https://console.amap.com/dev/flow/manage 的用量详情。真用完了，内地访客打开网站会自动换成我们自己的地图（没有审图号，只能临时顶一下），下个月 1 日恢复。",
    },
  ];
}

const JOBS: Record<string, string> = {
  setup: "启动时升级数据库",
  prune: "清理 90 天前的记录",
  digest: "举报提醒邮件",
  flip: "好久没来自动翻",
  ride: "明河都尉换站",
  totals: "全站每日统计",
  live: "收听另外两个程序的消息提醒",
  signals: "收听另外两个程序的出错次数",
  loads: "保存高德地图加载次数",
  counts: "保存「存到桌面」的统计",
};

/** Background jobs that failed in the last day: the database not brought up to date at start is urgent */
async function checkJobs(now: number): Promise<Finding[]> {
  const byJob = new Map<string, Signal[]>();
  for (const s of recent("job", DAY, now)) byJob.set(s.code, [...(byJob.get(s.code) ?? []), s]);
  return [...byJob].map(([job, list]) => ({
    key: job,
    level: job === "setup" ? "urgent" : "daily",
    title: `定时任务「${JOBS[job] ?? job}」出错了`,
    detail: `过去 24 小时出错 ${list.length} 次，最近一次在 ${beijingShort(list[list.length - 1].at)}。`,
    advice: `看日志：${LOGS} --since 24h web`,
  }));
}

/**
 * Disk, memory and processor of the machine; inside Docker these read the host's own. The disk:
 * urgent at 90% or when the last three days' growth fills it within three days, for the digest at
 * 85% or within a week (a reading a day is kept to tell). Memory: urgent under 3% available for
 * two rounds, under 10% for three rounds only for the admin page; a busy processor too.
 */
async function checkMachine(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const d = disk();
  const daysToFull = await diskDaysLeft(d.usedBytes, d.free, now);
  const soon = (days: number) => daysToFull !== null && daysToFull <= days;
  if (d.used >= 0.85 || soon(7)) {
    const urgent = d.used >= 0.9 || soon(3);
    out.push({
      key: "disk",
      level: urgent ? "urgent" : "daily",
      title: "硬盘快满了",
      detail: `已用 ${pct(d.used)}，还剩 ${gb(d.free)}${daysToFull !== null ? `；照最近三天的涨法，大约 ${Math.max(1, Math.round(daysToFull))} 天后满` : ""}。`,
      advice: "满了以后数据库写不进去，网站会出错。可以在服务器上 docker image prune -f 清掉旧镜像，再看看 ~/backups。",
      worst: { text: `最多用到 ${pct(d.used)}`, score: d.used },
    });
  }
  const mem = memory();
  if (mem && mem.available < 0.1 * mem.total) {
    const urgent = mem.available < 0.03 * mem.total;
    out.push({
      key: "memory",
      level: urgent ? "urgent" : "quiet",
      openAfter: urgent ? 2 : 3,
      title: urgent ? "内存要用光了" : "内存紧张",
      detail: `只剩 ${mb(mem.available)} 可用（一共 ${gb(mem.total)}）。`,
      advice: "再满下去程序可能被系统强行停掉。看看是谁在占：docker stats --no-stream",
      worst: { text: `最少剩 ${mb(mem.available)}`, score: -mem.available },
    });
  }
  const cores = os.cpus().length || 1;
  const [, , fifteen] = os.loadavg();
  if (fifteen > 1.5 * cores) {
    out.push({
      key: "cpu",
      level: "quiet",
      openAfter: 3,
      title: "CPU 一直很忙",
      detail: `最近 15 分钟平均负载 ${fifteen.toFixed(1)}（${cores} 核）。`,
      advice: "网站可能变慢。看看是谁在占：docker stats --no-stream",
      worst: { text: `负载最高 ${fifteen.toFixed(1)}`, score: fifteen },
    });
  }
  return out;
}

/** Days until the disk is full at the last three days' growth, from a reading a day kept in watch_state; null when it is not growing */
async function diskDaysLeft(usedBytes: number, free: number, now: number) {
  const row = await getState("diskDays");
  const days: Record<string, number> = row ? JSON.parse(row.value) : {};
  const today = beijingDate(now);
  if (days[today] === undefined) {
    days[today] = usedBytes;
    for (const day of Object.keys(days).sort().slice(0, -8)) delete days[day];
    await setState("diskDays", JSON.stringify(days), now);
  }
  const then = beijingDate(now - 3 * DAY);
  const from = Object.keys(days)
    .sort()
    .find((day) => day >= then);
  if (!from || from === today) return null;
  const spanDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;
  const growth = (usedBytes - days[from]) / spanDays;
  return growth > 0 ? free / growth : null;
}

/**
 * The nightly backup (scripts/backup.sh) writes how it went into watch_state, key 'backup'. Each
 * trouble is for the digest; two nights without a backup that worked are urgent.
 */
async function checkBackup(now: number): Promise<Finding[]> {
  const row = await getState("backup");
  const how = "手动再备份一次：在服务器上运行 ~/arknights_map/scripts/backup.sh，它会把结果写进来。";
  // when a backup last worked, kept beside the latest record (which may be a failure)
  let okAt = Number((await getState("backupOk"))?.value ?? 0);
  if (row?.value.startsWith("ok ") && row.updatedAt.getTime() > okAt) {
    okAt = row.updatedAt.getTime();
    await setState("backupOk", String(okAt), now);
  }
  const since = await getState("since");
  const twoNights = now - (okAt || since?.updatedAt.getTime() || now) > 50 * HOUR;
  const level: Level = twoNights ? "urgent" : "daily";
  const none = twoNights ? `超过两天没有成功的数据库备份了${okAt ? `，最近一次成功是 ${beijingShort(okAt)}` : ""}。` : "";
  if (!row) {
    // the checks are newer than the backup script's record: give it a night first
    if (!since || now - since.updatedAt.getTime() < 30 * HOUR) return [];
    return [
      {
        key: "missing",
        level,
        title: "没看到数据库备份的记录",
        detail: `${none}检查开始 30 多个小时了，凌晨 4 点的备份一次也没记下来。`,
        advice: `看看服务器上的定时任务（crontab -l）和 ~/backups 里有没有新文件。${how}`,
      },
    ];
  }
  const [result, ...rest] = row.value.split(" ");
  const when = beijingShort(row.updatedAt.getTime());
  if (result === "failed") {
    return [{ key: "failed", level, title: "数据库备份失败了", detail: `${none}${when} 的备份停在了「${BACKUP_STEPS[rest[0]] ?? rest[0]}」这一步。`, advice: how }];
  }
  if (now - row.updatedAt.getTime() > 26 * HOUR) {
    return [{ key: "stale", level, title: "超过一天没有新的数据库备份", detail: `${none}最近一次是 ${when}。`, advice: `看看服务器上的定时任务（crontab -l）。${how}` }];
  }
  if (rest[2] === "local") {
    return [
      {
        key: "local",
        level: "daily",
        title: "数据库备份没传到腾讯云",
        detail: `${when} 的备份只存在服务器上（${rest[0]}）。`,
        advice: "备份脚本没找到 ~/.zhoupmap-cos，服务器坏了的话这份备份也会一起没。",
      },
    ];
  }
  return [];
}

/** Days left on the HTTPS certificate, asked of Caddy inside the server's own network: under 5 urgent, under 14 for the digest. */
async function checkTls(now: number): Promise<Finding[]> {
  const host = WATCH_TLS_HOST || (isProd ? "caddy" : "");
  if (!host) return [];
  const servername = new URL(SITE_URL).hostname;
  const validTo = await new Promise<number>((resolve, reject) => {
    // only the date is wanted: an expired or mismatched certificate must still be read
    const socket = tls.connect({ host, port: 443, servername, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(Date.parse(cert.valid_to));
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timed out"));
    });
  });
  const days = Math.floor((validTo - now) / DAY);
  // for the digest's figures
  await setState("tlsDays", String(days), now);
  if (!(days < 14)) return [];
  return [
    {
      key: "expiring",
      level: days < 5 ? "urgent" : "daily",
      title: days < 0 ? "HTTPS 证书过期了" : "HTTPS 证书快过期了",
      detail: days < 0 ? "浏览器会拦住访客，说网站不安全。" : `还有 ${days} 天到期。`,
      advice: `Caddy 平时会在到期前一个月左右自动续期，到现在还没续上说明续期一直失败。看日志：${LOGS} --since 24h caddy`,
    },
  ];
}

const DOOR_TRIES = 3;
const DOOR_TIMEOUT_MS = 4_000;

/** Why a way in did not answer, in words, from what Node calls it */
function doorTrouble(code: string) {
  if (code === "ECONNREFUSED") return "连接被拒绝";
  if (code === "ECONNRESET" || code === "EPIPE") return "连接被断开";
  if (code === "timeout" || code === "ETIMEDOUT") return `${DOOR_TIMEOUT_MS / 1000} 秒没有回应`;
  if (/CERT|SSL|TLS|SELF_SIGNED|ALTNAME/i.test(code)) return `证书不对（${code}）`;
  return code;
}

/** The site's /api/health asked through one way in, as a visitor coming that way: "" when the site answered */
function askThrough(door: string, servername: string): Promise<string> {
  const [host, port = "443"] = door.split(":");
  return new Promise((resolve) => {
    const req = https.request(
      { host, port: Number(port), servername, path: "/api/health", headers: { host: servername }, agent: false, timeout: DOOR_TIMEOUT_MS },
      (res) => {
        res.resume();
        // its 503 is the site's own answer (the database or the emails), which other checks tell of
        resolve(res.statusCode === 200 || res.statusCode === 503 ? "" : `HTTP ${res.statusCode}`);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "timeout" })));
    req.on("error", (e: NodeJS.ErrnoException) => resolve(doorTrouble(e.code ?? e.message)));
    req.end();
  });
}

/**
 * The other ways in (WATCH_DOORS: the second server, deploy/relay): a way in is broken when the
 * site does not answer through it three times running, which is urgent. Exported for the tests.
 */
export async function doorFindings(doors: string[], servername: string, pauseMs = 1_000, direct = ""): Promise<Finding[]> {
  const why = await Promise.all(
    doors.map(async (door) => {
      let trouble = "";
      for (let i = 0; i < DOOR_TRIES; i++) {
        if (i) await new Promise((r) => setTimeout(r, pauseMs));
        trouble = await askThrough(door, servername);
        if (!trouble) break;
      }
      return trouble;
    }),
  );
  // the site itself too busy to answer in time, not the door (2026-11-11 11:00, a load of 18): asked
  // straight through this server's own gateway as well, and then the other checks tell of it
  if (direct && why.some(Boolean) && (await askThrough(direct, servername))) return [];
  return doors.flatMap((door, i): Finding[] =>
    why[i]
      ? [
          {
            key: `down:${door}`,
            level: "urgent",
            title: "经第二台服务器打不开网站了",
            detail: `从这台经 ${door} 打开网站，连试 ${DOOR_TRIES} 次都不行：${why[i]}。从那台进来的访客现在打不开网站。`,
            advice:
              "先在 DNSPod 暂停第二台服务器的两条解析（@ 和 www），十分钟内访客都会回到这台。再看那台：腾讯云控制台里是不是还开着机，ssh zhoupmap2 'systemctl status nginx' 看转发在不在跑。",
          },
        ]
      : [],
  );
}

const checkDoors = () => {
  const gateway = WATCH_TLS_HOST || (isProd ? "caddy" : "");
  return doorFindings(WATCH_DOORS, new URL(SITE_URL).hostname, 1_000, gateway && `${gateway}:443`);
};

export const CHECKS: Check[] = [
  { name: "db", run: checkDb },
  { name: "restart", events: true, closeAfter: HOUR, run: checkRestart },
  { name: "errors", window: 10 * MINUTE, closeAfter: HOUR, run: checkErrors },
  { name: "quota", closeAfter: 30 * MINUTE, run: checkQuota },
  { name: "mail", window: 30 * MINUTE, run: checkMail },
  { name: "codes", window: HOUR, run: checkCodes },
  { name: "busy", window: 10 * MINUTE, run: checkBusy },
  { name: "passwords", window: HOUR, run: checkPasswords },
  { name: "map", window: 30 * MINUTE, run: checkMaps },
  // once a month: open for a day, so the next digest has it
  { name: "amapLoads", events: true, every: 10 * MINUTE, closeAfter: DAY, run: checkAmapLoads },
  { name: "jobs", window: DAY, run: checkJobs },
  { name: "machine", closeAfter: 30 * MINUTE, run: checkMachine },
  { name: "backup", every: 30 * MINUTE, run: checkBackup },
  { name: "tls", every: 6 * HOUR, run: checkTls },
  { name: "doors", run: checkDoors },
];

// ---- the run ----

type Send = (subject: string, text: string) => Promise<void>;

/** To WATCH_EMAILS; with nobody to email (development), into the log instead */
async function mailAdmins(subject: string, text: string) {
  if (!WATCH_EMAILS.length) return console.warn(`Watch, with no WATCH_EMAILS or ADMIN_EMAILS to email:\n${subject}\n${text}`);
  await sendAdminMail(WATCH_EMAILS, subject, text);
}

/**
 * One round of checks, the urgent email it calls for, and the morning's digest when it is due.
 * checks and send can be swapped in tests, and the digest left out. A check that fails (say, the
 * database is down) leaves its problems as they were.
 */
export async function runWatch({
  now = Date.now(),
  checks = CHECKS,
  send = mailAdmins,
  digest = true,
}: { now?: number; checks?: Check[]; send?: Send; digest?: boolean } = {}) {
  const w = state();
  // a round still going (a slow database) is not doubled
  if (w.running) return;
  w.running = true;
  try {
    await round(w, now, checks, send, digest);
  } finally {
    w.running = false;
  }
}

async function round(w: WatchState, now: number, checks: Check[], send: Send, digest: boolean) {
  if (!w.loaded) {
    try {
      await db.insert(watchState).values({ key: "since", value: "", updatedAt: new Date(now) }).onConflictDoNothing();
      w.loaded = true;
    } catch (e) {
      console.error("Watch: could not note when it began", errorCode(e));
    }
  }
  let open: Map<string, Incident>;
  try {
    open = new Map((await db.select().from(watchIncidents).where(isNull(watchIncidents.endedAt))).map((i) => [i.key, i]));
  } catch (e) {
    console.error("Watch: could not read its incidents", errorCode(e));
    return;
  }

  for (const check of checks) {
    if (check.every && now - (w.lastRun.get(check.name) ?? -Infinity) < check.every) continue;
    let found: Finding[];
    try {
      found = await withTimeout(
        check.run(now, (key) => open.has(`${check.name}.${key}`)),
        20_000,
      );
    } catch (e) {
      console.error(`Watch: the ${check.name} check failed`, errorCode(e));
      continue;
    }
    w.lastRun.set(check.name, now);
    try {
      await settle(w, check, found, open, now);
    } catch (e) {
      console.error(`Watch: could not keep what the ${check.name} check found`, errorCode(e));
    }
  }

  const events = new Set(checks.filter((c) => c.events).map((c) => c.name));
  await mailUrgent(w, now, send, events).catch((e) => console.error("Watch: could not deal with its urgent emails", errorCode(e)));
  if (digest) await mailDigest(w, now, send).catch((e) => console.error("Watch: could not deal with the digest", errorCode(e)));
  await setState("round", String(now), now).catch((e) => console.error("Watch: could not note the round", errorCode(e)));
}

/** What one check found this round, into the incidents: refreshed, counted once seen long enough, over once gone long enough */
async function settle(w: WatchState, check: Check, found: Finding[], open: Map<string, Incident>, now: number) {
  const prefix = `${check.name}.`;
  const seen = new Set<string>();
  for (const f of found) {
    const key = prefix + f.key;
    seen.add(key);
    w.closeAfter.set(key, f.closeAfter ?? check.closeAfter ?? CLOSE_AFTER);
    const had = open.get(key);
    if (had) {
      open.set(key, await refresh(had, f, now));
      continue;
    }
    const p = w.pending.get(key) ?? { seen: 0, first: now };
    p.seen++;
    if (p.seen < (f.openAfter ?? 1)) {
      w.pending.set(key, p);
      continue;
    }
    w.pending.delete(key);
    open.set(key, await openIncident(key, f, p.first, now));
  }
  // seen in a row, or not at all
  for (const key of w.pending.keys()) if (key.startsWith(prefix) && !seen.has(key)) w.pending.delete(key);
  // what this check no longer sees is over once gone long enough, and once it can see far enough back to be sure
  if (check.window && now - startedAt() < check.window) return;
  for (const [key, inc] of open) {
    if (!key.startsWith(prefix) || seen.has(key)) continue;
    if (now - inc.lastSeenAt.getTime() < (w.closeAfter.get(key) ?? check.closeAfter ?? CLOSE_AFTER)) continue;
    await db.update(watchIncidents).set({ endedAt: new Date(now) }).where(eq(watchIncidents.id, inc.id));
    open.delete(key);
  }
}

/** The latest of a problem still there: its words, the highest level it reached, and the worst it got */
function changes(had: Pick<Incident, "level" | "worstScore">, f: Finding, now: number) {
  const worse = f.worst && (had.worstScore === null || f.worst.score > had.worstScore);
  return {
    title: f.title,
    detail: f.detail ?? "",
    advice: f.advice ?? "",
    level: levelRank(f.level) > levelRank(had.level) ? f.level : had.level,
    lastSeenAt: new Date(now),
    ...(worse ? { worst: f.worst!.text, worstScore: f.worst!.score } : {}),
  };
}

async function refresh(had: Incident, f: Finding, now: number) {
  const [row] = await db.update(watchIncidents).set(changes(had, f, now)).where(eq(watchIncidents.id, had.id)).returning();
  return row ?? had;
}

/** A problem that now counts: the same one again when it ended within REOPEN_WITHIN (one more time, no email), else a new one */
async function openIncident(key: string, f: Finding, first: number, now: number) {
  const [back] = await db
    .select()
    .from(watchIncidents)
    .where(and(eq(watchIncidents.key, key), gt(watchIncidents.endedAt, new Date(now - REOPEN_WITHIN))))
    .orderBy(desc(watchIncidents.endedAt))
    .limit(1);
  if (back) {
    const [row] = await db
      .update(watchIncidents)
      .set({ ...changes(back, f, now), endedAt: null, times: sql`${watchIncidents.times} + 1` })
      .where(eq(watchIncidents.id, back.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(watchIncidents)
    .values({
      key,
      level: f.level,
      title: f.title,
      detail: f.detail ?? "",
      advice: f.advice ?? "",
      worst: f.worst?.text ?? null,
      worstScore: f.worst?.score ?? null,
      startedAt: new Date(first),
      lastSeenAt: new Date(now),
    })
    .returning();
  return row;
}

/**
 * The one email of a round: urgent problems that now count and nobody was told of, and urgent ones
 * told of that are over (but not things that happened, like a restart), none the admin said they
 * know of. At most WATCH_MAILS_PER_DAY a day; one over that is noted on the admin page and in the
 * digest, and never sent later. A send that fails is tried again the next round.
 */
async function mailUrgent(w: WatchState, now: number, send: Send, events: Set<string>) {
  const urgent = and(eq(watchIncidents.level, "urgent"), isNull(watchIncidents.ackedAt), isNull(watchIncidents.skippedAt));
  const told = await db
    .select()
    .from(watchIncidents)
    .where(and(urgent, isNull(watchIncidents.endedAt), isNull(watchIncidents.mailedAt)))
    .orderBy(asc(watchIncidents.startedAt));
  const over = (
    await db
      .select()
      .from(watchIncidents)
      .where(
        and(
          urgent,
          gt(watchIncidents.endedAt, new Date(now - DAY)),
          isNotNull(watchIncidents.mailedAt),
          isNull(watchIncidents.recoveredMailedAt),
        ),
      )
      .orderBy(asc(watchIncidents.endedAt))
  ).filter((i) => !events.has(i.key.split(".")[0]));
  if (!told.length && !over.length) return;

  const { subject, text } = urgentLetter(now, told, over);
  const at = new Date(now);
  const [{ n }] = await db
    .select({ n: count() })
    .from(watchMails)
    .where(and(inArray(watchMails.kind, ["urgent", "recovered"]), gt(watchMails.at, new Date(now - DAY))));
  if (n >= WATCH_MAILS_PER_DAY) {
    console.error("Watch: today's urgent emails are used up; not sending", [...told, ...over].map((i) => i.key).join(", "));
    await db
      .update(watchIncidents)
      .set({ skippedAt: at })
      .where(inArray(watchIncidents.id, [...told, ...over].map((i) => i.id)));
    await db.insert(watchMails).values({ at, subject, kind: "skipped" });
    return;
  }
  try {
    await send(subject, text);
  } catch (e) {
    w.mailBrokenSince ||= now;
    console.error("Watch: could not email the admins", errorCode(e));
    return;
  }
  w.mailBrokenSince = 0;
  if (told.length) await db.update(watchIncidents).set({ mailedAt: at }).where(inArray(watchIncidents.id, told.map((i) => i.id)));
  if (over.length) await db.update(watchIncidents).set({ recoveredMailedAt: at }).where(inArray(watchIncidents.id, over.map((i) => i.id)));
  await db.insert(watchMails).values({ at, subject, kind: told.length ? "urgent" : "recovered" });
}

/** Short: when it began, the figures and who it hurts, what to do, and where the rest is */
function urgentLetter(now: number, told: Incident[], over: Incident[]) {
  const more = (list: Incident[]) => (list.length > 1 ? ` 等 ${list.length} 项` : "");
  const span = (i: Incident) => `${beijingClock(i.startedAt.getTime())}–${beijingClock(i.endedAt!.getTime())}`;
  const subject = told.length
    ? `【${SITE_NAME}】要你看：${told[0].title}${more(told)}`
    : `【${SITE_NAME}】已恢复：${over[0].title}（${span(over[0])}）${more(over)}`;
  const lines = [`北京时间 ${beijingShort(now)}：`, ""];
  for (const i of told) {
    lines.push(`🔴 ${i.title}`, `   从 ${beijingShort(i.startedAt.getTime())} 开始。${i.detail}`);
    if (i.advice) lines.push(`   怎么办：${i.advice}`);
    lines.push("");
  }
  for (const i of over) lines.push(`✅ 已恢复：${i.title}（${beijingShort(i.startedAt.getTime())} 到 ${beijingShort(i.endedAt!.getTime())}）`, "");
  lines.push(
    `处理和完整记录：${SITE_URL}/admin`,
    `只有要你动手的事才马上发；好了会再说一声。不急的事在每天早上 ${WATCH_DIGEST_HOUR} 点的汇总里。`,
  );
  return { subject, text: lines.join("\n") };
}

/**
 * The morning's digest (watchReport.ts), once a Beijing day, at the first round from WATCH_DIGEST_HOUR:
 * a server that was away then sends it when it is back, a restart does not send it again, and a send
 * that fails is tried again the next round. Reports in it count as told (src/lib/server/safety.ts).
 */
async function mailDigest(w: WatchState, now: number, send: Send) {
  const today = beijingDate(now);
  if (beijingHour(now) < WATCH_DIGEST_HOUR || (await getState("digestDay"))?.value === today) return;
  const { subject, text } = await digestLetter(now);
  try {
    await send(subject, text);
  } catch (e) {
    w.mailBrokenSince ||= now;
    console.error("Watch: could not email the digest", errorCode(e));
    return;
  }
  w.mailBrokenSince = 0;
  await setState("digestDay", today, now);
  await db.insert(watchMails).values({ at: new Date(now), subject, kind: "digest" });
  await db
    .update(reports)
    .set({ notifiedAt: new Date(now) })
    .where(and(isNull(reports.notifiedAt), isNull(reports.resolvedAt)));
}

/**
 * For /api/health, which the checks from outside look at: false when the database cannot be reached,
 * when the sign-in code emails are failing (the urgent mail.failing is open), or when the checks' own
 * emails have not gone out for half an hour.
 */
export async function healthy(now = Date.now()) {
  try {
    await withTimeout(db.execute(sql`select 1`), 3000);
    const [failing] = await withTimeout(
      db
        .select({ id: watchIncidents.id })
        .from(watchIncidents)
        .where(and(eq(watchIncidents.key, "mail.failing"), eq(watchIncidents.level, "urgent"), isNull(watchIncidents.endedAt)))
        .limit(1),
      3000,
    );
    const broken = state().mailBrokenSince;
    if (failing || (broken && now - broken >= MAIL_BROKEN_FOR)) return { ok: false, why: "mail" };
  } catch {
    return { ok: false, why: "database" };
  }
  return { ok: true };
}

/** Every WATCH_EVERY, the first round a minute after the server starts. */
export function startWatch() {
  const w = state();
  if (w.timer) return;
  const round = () => void runWatch().catch((e) => console.error("Watch: a round failed", errorCode(e)));
  w.timer = setInterval(round, WATCH_EVERY);
  setTimeout(round, MINUTE);
}
