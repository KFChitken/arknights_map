import "server-only";
import { readFileSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { count, eq, gt, sql } from "drizzle-orm";
import { beijingShort } from "../beijing";
import { SITE_NAME } from "../rules";
import { db } from "./db";
import { isProd, MAIL_DAILY_LIMIT, SITE_URL, WATCH_EMAILS, WATCH_TLS_HOST } from "./env";
import { sendAdminMail } from "./mail";
import { mailSends, watchAlerts, watchState } from "./schema";
import { errorCode, recent, startedAt, type Signal } from "./signals";

/**
 * The site's own checks: every few minutes (startWatch, from instrumentation-node.ts) each
 * check says what is wrong right now, and the admins get one email about what is new, what
 * is still wrong six hours after they were told, and what is over. A whole site that is down
 * cannot email anyone, so .github/workflows/uptime.yml looks at /api/health from outside too.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How often the checks run */
export const WATCH_EVERY = 5 * MINUTE;
/** A problem still there is mentioned again this long after the last email about it */
export const REMIND_AFTER = 6 * HOUR;
/** Emails the checks may send in any 24 hours, apart from MAIL_DAILY_LIMIT (they never use it up) */
export const WATCH_MAILS_PER_DAY = 24;

const LOGS = "docker compose -f docker-compose.prod.yml logs";

/** A problem one check sees now; key is unique within the check */
export type Finding = { key: string; title: string; detail?: string; advice?: string };

export type Check = {
  name: string;
  /** How far back it looks at what this process noted (signals.ts): until the process has run that long it cannot tell a problem is over */
  window?: number;
  /** Run at most this often; in between, its problems stand as they were */
  every?: number;
  /** Its findings are things that happened (a restart): told once, then dropped quietly after REMIND_AFTER, never "over" */
  events?: boolean;
  run: (now: number) => Promise<Finding[]>;
};

type Alert = { key: string; title: string; detail: string; advice: string; since: number; mailedAt: number | null };

type WatchState = {
  alerts: Map<string, Alert>;
  loaded: boolean;
  lastRun: Map<string, number>;
  mails: number[];
  /** The last time an email of the checks could not be sent */
  mailBrokenAt: number;
  buildChecked: boolean;
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
};

// on globalThis like signals.ts: /api/health (a route) reads what the checks (started at boot) found
const g = globalThis as unknown as { zhoupWatch?: WatchState };
const fresh = (): WatchState => ({
  alerts: new Map(),
  loaded: false,
  lastRun: new Map(),
  mails: [],
  mailBrokenAt: 0,
  buildChecked: false,
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

const pct = (x: number) => `${Math.round(x * 100)}%`;
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

async function getState(key: string) {
  const [row] = await db.select().from(watchState).where(eq(watchState.key, key)).limit(1);
  return row;
}

async function setState(key: string, value: string, now: number) {
  const at = new Date(now);
  await db.insert(watchState).values({ key, value, updatedAt: at }).onConflictDoUpdate({ target: watchState.key, set: { value, updatedAt: at } });
}

// ---- the checks ----

async function checkDb(): Promise<Finding[]> {
  const t = Date.now();
  try {
    await withTimeout(db.execute(sql`select 1`), 5000);
  } catch (e) {
    return [
      {
        key: "down",
        title: "数据库连不上",
        detail: `错误：${errorCode(e)}。`,
        advice: `网站上几乎所有操作都会失败。在服务器上看看：docker compose -f docker-compose.prod.yml ps，和 ${LOGS} --since 30m db`,
      },
    ];
  }
  const s = (Date.now() - t) / 1000;
  if (s < 2) return [];
  return [{ key: "slow", title: "数据库反应很慢", detail: `一次最简单的查询用了 ${s.toFixed(1)} 秒。`, advice: "网站会跟着变慢。看看服务器的 CPU 和内存（docker stats --no-stream）。" }];
}

function buildId() {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

/** Once per process: the same build as last time means a restart that was not a deploy. */
async function checkRestart(now: number): Promise<Finding[]> {
  const w = state();
  if (w.buildChecked) return [];
  const build = buildId();
  const last = await getState("build");
  await setState("build", build, now);
  w.buildChecked = true;
  if (last?.value !== build) return [];
  return [
    {
      key: "again",
      title: "网站程序重启过",
      detail: `${beijingShort(startedAt())} 重新启动，版本没变，不是部署新版本引起的。`,
      advice: `可能是程序崩溃后被 Docker 自动拉起，也可能是服务器重启了；如果是你自己重启或重新部署的，可以不用管。查原因：${LOGS} --since 2h web`,
    },
  ];
}

async function checkErrors(now: number): Promise<Finding[]> {
  const list = recent("error", 10 * MINUTE, now);
  if (list.length < 5) return [];
  return [
    {
      key: "many",
      title: "网站程序频繁出错",
      detail: `10 分钟内出错 ${list.length} 次，最多的是：${tally(list.map((s) => s.code), undefined, 3)}。`,
      advice: `访客会看到「服务器出了点问题」。看日志：${LOGS} --since 30m web`,
    },
  ];
}

async function checkQuota(now: number): Promise<Finding[]> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(mailSends)
    .where(gt(mailSends.sentAt, new Date(now - DAY)));
  const said = `过去 24 小时发了 ${n} 封，上限是 ${MAIL_DAILY_LIMIT} 封（服务器 .env 里的 MAIL_DAILY_LIMIT）。`;
  if (n >= MAIL_DAILY_LIMIT) {
    return [
      {
        key: "full",
        title: "验证码邮件用完了",
        detail: said,
        advice: "新来的人现在收不到验证码，登录不了，要等最早发的那些满 24 小时不再算进去才会恢复。要放宽就调大 MAIL_DAILY_LIMIT 再重新部署；Resend 自己的额度在 resend.com 上看。",
      },
    ];
  }
  if (n >= 0.8 * MAIL_DAILY_LIMIT) {
    return [{ key: "high", title: "验证码邮件快用完了", detail: said, advice: "用完以后新来的人就收不到验证码了。要放宽就调大 MAIL_DAILY_LIMIT 再重新部署。" }];
  }
  return [];
}

async function checkMail(now: number): Promise<Finding[]> {
  const failed = recent("mailFailed", 30 * MINUTE, now);
  if (!failed.length) return [];
  // a code that went out after the last failure: mail works again
  const lastFailed = failed[failed.length - 1].at;
  if (recent("mailSent", 30 * MINUTE, now).some((s) => s.at > lastFailed)) return [];
  return [
    {
      key: "failing",
      title: "验证码邮件发不出去",
      detail: `30 分钟内失败 ${failed.length} 次（${tally(failed.map((s) => s.code))}）。`,
      advice:
        "新来的人收不到验证码。多半是 Resend 那边：Key 失效、额度用完或被限流，登录 resend.com 看看。这封邮件也经 Resend 发，它要是也发不出去，GitHub 的在线检查会提醒你。",
    },
  ];
}

const REFUSED: Record<string, string> = {
  "ip-10min": "同一网络 10 分钟内太频繁",
  "ip-day": "同一网络一天内太多",
  cooldown: "同一邮箱一分钟内重复",
  "address-day": "同一邮箱一天内超过次数",
  quota: "全站邮件额度用完",
};

async function checkCodes(now: number): Promise<Finding[]> {
  const list = recent("codeRefused", HOUR, now);
  if (list.length < 30) return [];
  return [
    {
      key: "flood",
      title: "有人在频繁要验证码",
      detail: `一小时内有 ${list.length} 次要验证码被拦下（${tally(list.map((s) => s.code), (c) => REFUSED[c] ?? c)}）。`,
      advice: "被拦下的不会发邮件，不花钱，也不影响其他人登录；一直这样的话可能有人在刷。",
    },
  ];
}

const MAPS: Record<string, string> = { amap: "高德", osm: "OSM 底图", overseas: "我们自己的海外底图" };
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
 * 高德 saying its key is wrong or used up is clear enough three times in ten minutes; other
 * trouble (a slow phone network, a tile now and then) only when it adds up to ten in half an hour.
 */
async function checkMaps(now: number): Promise<Finding[]> {
  const list = recent("map", 30 * MINUTE, now);
  const keys = list.filter((s) => s.code.startsWith("amap:key:") && now - s.at < 10 * MINUTE);
  if (keys.length < 3 && list.length < 10) return [];
  return [
    {
      key: "failing",
      title: "地图在访客那里加载失败",
      detail: `30 分钟内有 ${list.length} 次：${tally(list.map((s) => s.code), mapTrouble)}。`,
      advice:
        "访客那边会自动换成别的底图，但内地访客看到的就不是高德了。高德的话多半是 Key 当天的调用量用完或 Key 设置有问题，登录高德开放平台控制台看看。这类报告谁都能发，偶尔几次也可能是访客自己的网络问题。",
    },
  ];
}

const JOBS: Record<string, string> = {
  setup: "启动时升级数据库",
  prune: "清理 90 天前的记录",
  digest: "举报日报邮件",
  flip: "好久没来自动翻",
  ride: "明河都尉换站",
  totals: "全站每日统计",
};

async function checkJobs(now: number): Promise<Finding[]> {
  const byJob = new Map<string, Signal[]>();
  for (const s of recent("job", DAY, now)) byJob.set(s.code, [...(byJob.get(s.code) ?? []), s]);
  return [...byJob].map(([job, list]) => ({
    key: job,
    title: `定时任务「${JOBS[job] ?? job}」出错了`,
    detail: `过去 24 小时出错 ${list.length} 次，最近一次在 ${beijingShort(list[list.length - 1].at)}。`,
    advice: `看日志：${LOGS} --since 24h web`,
  }));
}

function memory() {
  try {
    const info = readFileSync("/proc/meminfo", "utf8");
    const kb = (name: string) => Number(info.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1] ?? NaN) * 1024;
    const total = kb("MemTotal");
    const available = kb("MemAvailable");
    return Number.isFinite(total) && Number.isFinite(available) ? { total, available } : null;
  } catch {
    // not Linux (a Mac in development): no such file
    return null;
  }
}

/** Disk, memory and processor of the machine; inside Docker these read the host's own. */
async function checkMachine(): Promise<Finding[]> {
  const out: Finding[] = [];
  const disk = statfsSync("/");
  const used = (disk.blocks - disk.bfree) / (disk.blocks - disk.bfree + disk.bavail);
  if (used >= 0.85) {
    out.push({
      key: "disk",
      title: "硬盘快满了",
      detail: `已用 ${pct(used)}，还剩 ${gb(disk.bavail * disk.bsize)}。`,
      advice: "满了以后数据库写不进去，网站会出错。可以在服务器上 docker image prune -f 清掉旧镜像，再看看 ~/backups。",
    });
  }
  const mem = memory();
  if (mem && mem.available < 0.1 * mem.total) {
    out.push({
      key: "memory",
      title: "内存快满了",
      detail: `只剩 ${mb(mem.available)} 可用（一共 ${gb(mem.total)}）。`,
      advice: "再满下去程序可能被系统强行停掉。看看是谁在占：docker stats --no-stream",
    });
  }
  const cores = os.cpus().length || 1;
  const [, , fifteen] = os.loadavg();
  if (fifteen > 1.5 * cores) {
    out.push({
      key: "cpu",
      title: "CPU 一直很忙",
      detail: `最近 15 分钟平均负载 ${fifteen.toFixed(1)}（${cores} 核）。`,
      advice: "网站可能变慢。看看是谁在占：docker stats --no-stream",
    });
  }
  return out;
}

const BACKUP_STEPS: Record<string, string> = { dump: "导出数据库", upload: "上传到腾讯云 COS", tidy: "清理旧备份" };

/** The nightly backup (scripts/backup.sh) writes how it went into watch_state, key 'backup'. */
async function checkBackup(now: number): Promise<Finding[]> {
  const row = await getState("backup");
  const how = "手动再备份一次：在服务器上运行 ~/arknights_map/scripts/backup.sh，它会把结果写进来。";
  if (!row) {
    // the checks are newer than the backup script's record: give it a night first
    const since = await getState("since");
    if (!since || now - since.updatedAt.getTime() < 30 * HOUR) return [];
    return [{ key: "missing", title: "没看到数据库备份的记录", detail: "检查开始 30 多个小时了，凌晨 4 点的备份一次也没记下来。", advice: `看看服务器上的定时任务（crontab -l）和 ~/backups 里有没有新文件。${how}` }];
  }
  const [result, ...rest] = row.value.split(" ");
  const when = beijingShort(row.updatedAt.getTime());
  if (result === "failed") {
    return [{ key: "failed", title: "数据库备份失败了", detail: `${when} 的备份停在了「${BACKUP_STEPS[rest[0]] ?? rest[0]}」这一步。`, advice: how }];
  }
  if (now - row.updatedAt.getTime() > 26 * HOUR) {
    return [{ key: "stale", title: "超过一天没有新的数据库备份", detail: `最近一次是 ${when}。`, advice: `看看服务器上的定时任务（crontab -l）。${how}` }];
  }
  if (rest[2] === "local") {
    return [
      {
        key: "local",
        title: "数据库备份没传到腾讯云",
        detail: `${when} 的备份只存在服务器上（${rest[0]}）。`,
        advice: "备份脚本没找到 ~/.zhoupmap-cos，服务器坏了的话这份备份也会一起没。",
      },
    ];
  }
  return [];
}

/** Days left on the HTTPS certificate, asked of Caddy inside the server's own network. */
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
  if (!(days < 14)) return [];
  return [
    {
      key: "expiring",
      title: days < 0 ? "HTTPS 证书过期了" : "HTTPS 证书快过期了",
      detail: days < 0 ? "浏览器会拦住访客，说网站不安全。" : `还有 ${days} 天到期。`,
      advice: `Caddy 平时会在到期前一个月左右自动续期，到现在还没续上说明续期一直失败。看日志：${LOGS} --since 24h caddy`,
    },
  ];
}

export const CHECKS: Check[] = [
  { name: "db", run: checkDb },
  { name: "restart", events: true, run: checkRestart },
  { name: "errors", window: 10 * MINUTE, run: checkErrors },
  { name: "quota", run: checkQuota },
  { name: "mail", window: 30 * MINUTE, run: checkMail },
  { name: "codes", window: HOUR, run: checkCodes },
  { name: "map", window: 30 * MINUTE, run: checkMaps },
  { name: "jobs", window: DAY, run: checkJobs },
  { name: "machine", run: checkMachine },
  { name: "backup", every: 30 * MINUTE, run: checkBackup },
  { name: "tls", every: 6 * HOUR, run: checkTls },
];

// ---- the run ----

/** The alerts as the database last had them, merged under what this process already knows. */
async function load(w: WatchState) {
  const rows = await db.select().from(watchAlerts);
  for (const r of rows) {
    const mine = w.alerts.get(r.key);
    const mailedAt = r.mailedAt?.getTime() ?? null;
    if (!mine) w.alerts.set(r.key, { key: r.key, title: r.title, detail: r.detail, advice: "", since: r.since.getTime(), mailedAt });
    else if (mailedAt && (mine.mailedAt ?? 0) < mailedAt) mine.mailedAt = mailedAt;
  }
  const mails = await getState("mails");
  if (mails) for (const t of mails.value.split(",").map(Number)) if (t && !w.mails.includes(t)) w.mails.push(t);
  w.loaded = true;
}

async function save(w: WatchState, now: number) {
  await db.transaction(async (tx) => {
    await tx.delete(watchAlerts);
    const rows = [...w.alerts.values()].map((a) => ({
      key: a.key,
      title: a.title,
      detail: a.detail,
      since: new Date(a.since),
      mailedAt: a.mailedAt ? new Date(a.mailedAt) : null,
    }));
    if (rows.length) await tx.insert(watchAlerts).values(rows);
  });
  await setState("mails", w.mails.join(","), now);
}

type Told = Alert & { what: "new" | "still" | "over" };

function letter(now: number, told: Told[], others: Alert[]) {
  const problems = told.filter((t) => t.what !== "over");
  const over = told.filter((t) => t.what === "over");
  const lead = problems[0] ?? over[0];
  const n = problems.length || over.length;
  const subject = `【${SITE_NAME}】${problems.length ? "出问题了" : "已解决"}：${lead.title}${n > 1 ? ` 等 ${n} 项` : ""}`;
  const lines = [`北京时间 ${beijingShort(now)} 的自动检查：`, ""];
  for (const t of problems) {
    lines.push(t.what === "new" ? `⚠️ ${t.title}` : `⚠️ 还没好：${t.title}（从 ${beijingShort(t.since)} 开始）`);
    if (t.detail) lines.push(`   ${t.detail}`);
    if (t.advice) lines.push(`   ${t.advice}`);
    lines.push("");
  }
  for (const t of over) lines.push(`✅ 已解决：${t.title}（${beijingShort(t.since)} 到 ${beijingShort(now)}）`, "");
  if (others.length) {
    lines.push("之前提醒过、还没好的：");
    for (const a of others) lines.push(`· ${a.title}（从 ${beijingShort(a.since)} 开始）`);
    lines.push("");
  }
  lines.push(`—— ${SITE_NAME}每 5 分钟自己检查一次；同一个问题 6 小时内只提醒一次，解决了会再说一声。`);
  return { subject, text: lines.join("\n") };
}

/** To WATCH_EMAILS; with nobody to email (development), into the log instead */
async function mailAdmins(subject: string, text: string) {
  if (!WATCH_EMAILS.length) return console.warn(`Watch, with no WATCH_EMAILS or ADMIN_EMAILS to email:\n${subject}\n${text}`);
  await sendAdminMail(WATCH_EMAILS, subject, text);
}

/**
 * One round of checks, and the email it calls for. checks and send can be swapped in tests.
 * A check that fails (say, the database is down) leaves its problems as they were.
 */
export async function runWatch({
  now = Date.now(),
  checks = CHECKS,
  send = mailAdmins,
}: { now?: number; checks?: Check[]; send?: (subject: string, text: string) => Promise<void> } = {}) {
  const w = state();
  // a round still going (a slow database) is not doubled
  if (w.running) return [];
  w.running = true;
  try {
    return await round(w, now, checks, send);
  } finally {
    w.running = false;
  }
}

async function round(w: WatchState, now: number, checks: Check[], send: (subject: string, text: string) => Promise<void>) {
  if (!w.loaded) {
    try {
      await load(w);
      await db.insert(watchState).values({ key: "since", value: "", updatedAt: new Date(now) }).onConflictDoNothing();
    } catch (e) {
      console.error("Watch: could not read its alerts", errorCode(e));
    }
  }

  const told: Told[] = [];
  for (const check of checks) {
    if (check.every && now - (w.lastRun.get(check.name) ?? -Infinity) < check.every) continue;
    let found: Finding[];
    try {
      found = await withTimeout(check.run(now), 20_000);
    } catch (e) {
      console.error(`Watch: the ${check.name} check failed`, errorCode(e));
      continue;
    }
    w.lastRun.set(check.name, now);
    const seen = new Set<string>();
    for (const f of found) {
      const key = `${check.name}.${f.key}`;
      seen.add(key);
      const had = w.alerts.get(key);
      if (!had) {
        const a: Alert = { key, title: f.title, detail: f.detail ?? "", advice: f.advice ?? "", since: now, mailedAt: null };
        w.alerts.set(key, a);
        told.push({ ...a, what: "new" });
        continue;
      }
      Object.assign(had, { title: f.title, detail: f.detail ?? "", advice: f.advice ?? "" });
      if (had.mailedAt === null) told.push({ ...had, what: "new" });
      else if (!check.events && now - had.mailedAt >= REMIND_AFTER) told.push({ ...had, what: "still" });
    }
    // what this check no longer sees is over, once it can see far enough back to be sure
    const sure = !check.window || now - startedAt() >= check.window;
    for (const a of [...w.alerts.values()]) {
      if (!a.key.startsWith(`${check.name}.`) || seen.has(a.key)) continue;
      if (check.events) {
        // kept a while, so the same thing happening again soon is not told twice; told late if the email failed
        if (now - (a.mailedAt ?? a.since) >= REMIND_AFTER) w.alerts.delete(a.key);
        else if (a.mailedAt === null) told.push({ ...a, what: "new" });
      } else if (sure) {
        w.alerts.delete(a.key);
        if (a.mailedAt !== null) told.push({ ...a, what: "over" });
      }
    }
  }

  if (told.length) {
    w.mails = w.mails.filter((t) => now - t < DAY);
    if (w.mails.length >= WATCH_MAILS_PER_DAY) {
      console.error("Watch: today's emails are used up; not sending", told.map((t) => t.key).join(", "));
    } else {
      const toldKeys = new Set(told.map((t) => t.key));
      const events = new Set(checks.filter((c) => c.events).map((c) => c.name));
      const others = [...w.alerts.values()].filter(
        (a) => !toldKeys.has(a.key) && a.mailedAt !== null && !events.has(a.key.split(".")[0]),
      );
      const { subject, text } = letter(now, told, others);
      try {
        await send(subject, text);
        w.mails.push(now);
        for (const t of told) {
          const a = w.alerts.get(t.key);
          if (a) a.mailedAt = now;
        }
      } catch (e) {
        w.mailBrokenAt = now;
        console.error("Watch: could not email the admins", errorCode(e));
      }
    }
  }

  try {
    await save(w, now);
  } catch (e) {
    console.error("Watch: could not save its alerts", errorCode(e));
  }
  return told;
}

/**
 * For /api/health, which GitHub looks at from outside: false when the database cannot be
 * reached, or the checks' own emails (and the sign-in codes) cannot go out.
 */
export async function healthy(now = Date.now()) {
  try {
    await withTimeout(db.execute(sql`select 1`), 3000);
  } catch {
    return { ok: false, why: "database" };
  }
  const w = state();
  if (now - w.mailBrokenAt < HOUR || w.alerts.has("mail.failing")) return { ok: false, why: "mail" };
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
