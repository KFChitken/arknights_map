import "server-only";
import { readFileSync, statfsSync } from "node:fs";
import os from "node:os";
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { beijingDate, beijingMidnight, beijingShort } from "../beijing";
import { siteName } from "../rules";
import { asLevel, lasted, LEVEL_MARK, levelRank, mainlandWords, type IncidentView, type SiteNumbers, type SiteStatus } from "../siteStatus";
import { amapMapLoads, saveAmapLoads } from "./amapLoads";
import { db } from "./db";
import { MAIL_DAILY_LIMIT, MAINLAND_MAP, SITE_URL } from "./env";
import { HttpError } from "./http";
import { LOGIN_KINDS } from "./mailQuota";
import { amapOutNow, mainlandMap } from "./mainlandMap";
import { byReason } from "./safety";
import { dailyTotals, mailSends, reports, sessions, watchIncidents, watchMails, watchState } from "./schema";

/**
 * What the site's own checks (watch.ts) have to say beyond an urgent email: the morning's digest,
 * 网站状态 on the admin page, and the figures both give. Kept apart from watch.ts, which uses it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Incident = typeof watchIncidents.$inferSelect;

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

/** The Beijing time of day, 「22:04」 */
export const beijingClock = (t: number) => beijingShort(t).split(" ")[1];

/** The machine's memory; inside Docker this reads the host's own. null where there is no /proc (a Mac in development) */
export function memory() {
  try {
    const info = readFileSync("/proc/meminfo", "utf8");
    const kb = (name: string) => Number(info.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1] ?? NaN) * 1024;
    const total = kb("MemTotal");
    const available = kb("MemAvailable");
    return Number.isFinite(total) && Number.isFinite(available) ? { total, available } : null;
  } catch {
    return null;
  }
}

/** The disk the app's files are on: the share used, the bytes free and used */
export function disk() {
  const d = statfsSync("/");
  const usedBytes = (d.blocks - d.bfree) * d.bsize;
  return { used: (d.blocks - d.bfree) / (d.blocks - d.bfree + d.bavail), free: d.bavail * d.bsize, usedBytes };
}

export async function getState(key: string) {
  const [row] = await db.select().from(watchState).where(eq(watchState.key, key)).limit(1);
  return row;
}

export async function setState(key: string, value: string, now: number) {
  const at = new Date(now);
  await db.insert(watchState).values({ key, value, updatedAt: at }).onConflictDoUpdate({ target: watchState.key, set: { value, updatedAt: at } });
}

export const BACKUP_STEPS: Record<string, string> = { dump: "导出数据库", upload: "上传到腾讯云 COS", tidy: "清理旧备份" };

/** The latest backup in words, from the record scripts/backup.sh writes into watch_state */
function backupWords(row: { value: string; updatedAt: Date } | undefined) {
  if (!row) return "还没有备份的记录";
  const [result, ...rest] = row.value.split(" ");
  const when = beijingShort(row.updatedAt.getTime());
  if (result === "failed") return `${when} 的备份失败了，停在「${BACKUP_STEPS[rest[0]] ?? rest[0]}」这一步`;
  return `${when} 备份成功${rest[1] ? `（${rest[1]}）` : ""}，${rest[2] === "local" ? "但只存在服务器上，没传到腾讯云" : "已传到腾讯云"}`;
}

/** The figures of the digest and of 网站状态 */
export async function siteNumbers(now = Date.now()): Promise<SiteNumbers> {
  // every sign-in code, to the slow mail services too: the ones MAIL_DAILY_LIMIT counts
  const [{ n }] = await db
    .select({ n: count() })
    .from(mailSends)
    .where(and(inArray(mailSends.kind, LOGIN_KINDS), gt(mailSends.sentAt, new Date(now - DAY))));
  let space: SiteNumbers["disk"] = null;
  try {
    const d = disk();
    space = { used: d.used, free: d.free };
  } catch {
    // no such disk to ask about
  }
  const tls = await getState("tlsDays");
  const { count: loads } = await saveAmapLoads(now);
  const [yesterday] = await db.select().from(dailyTotals).where(eq(dailyTotals.day, beijingDate(now - DAY))).limit(1);
  // yesterday's sign-ins by how, to see what passwords and 登录码 save in mail (one ended since is not counted)
  const logins = await db
    .select({ method: sessions.method, n: count() })
    .from(sessions)
    .where(and(gte(sessions.createdAt, new Date(beijingMidnight(beijingDate(now - DAY)))), lt(sessions.createdAt, new Date(beijingMidnight(beijingDate(now))))))
    .groupBy(sessions.method);
  return {
    logins: Object.fromEntries(logins.map((r) => [r.method, r.n])),
    loginMails: n,
    mailLimit: MAIL_DAILY_LIMIT,
    disk: space,
    memory: memory(),
    load: { fifteen: os.loadavg()[2], cores: os.cpus().length || 1 },
    backup: backupWords(await getState("backup")),
    tlsDays: tls ? Number(tls.value) : null,
    amap: { count: loads, limit: amapMapLoads(), home: mainlandMap(now), set: MAINLAND_MAP === "auto" ? null : MAINLAND_MAP, out: amapOutNow(now) },
    yesterday: yesterday ? { signups: yesterday.signups, friendships: yesterday.friendships } : null,
  };
}

const ms = (d: Date | null) => d?.getTime() ?? null;

export const viewOf = (i: Incident): IncidentView => ({
  id: i.id,
  key: i.key,
  level: asLevel(i.level),
  title: i.title,
  detail: i.detail,
  advice: i.advice,
  worst: i.worst,
  startedAt: i.startedAt.getTime(),
  lastSeenAt: i.lastSeenAt.getTime(),
  endedAt: ms(i.endedAt),
  times: i.times,
  mailedAt: ms(i.mailedAt),
  recoveredMailedAt: ms(i.recoveredMailedAt),
  skippedAt: ms(i.skippedAt),
  ackedAt: ms(i.ackedAt),
});

/** The most pressing first, then the oldest */
const byPressing = (a: Incident, b: Incident) => levelRank(b.level) - levelRank(a.level) || a.startedAt.getTime() - b.startedAt.getTime();

/**
 * The morning's digest, sent even when all is well, so a day without one says the site or its mail is
 * broken: what wants the admin (urgent and daily problems still open), what was over by itself in the
 * last day (one line a kind), the reports, a few figures, and the admin page.
 */
export async function digestLetter(now: number) {
  const rows = await db
    .select()
    .from(watchIncidents)
    .where(or(isNull(watchIncidents.endedAt), gt(watchIncidents.endedAt, new Date(now - DAY))));
  const wanted = rows.filter((i) => !i.endedAt && levelRank(i.level) >= 1).sort(byPressing);
  const over = new Map<string, Incident[]>();
  for (const i of rows.filter((r) => r.endedAt).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    over.set(i.key, [...(over.get(i.key) ?? []), i]);
  }
  const fresh = await db.select({ reason: reports.reason }).from(reports).where(gt(reports.createdAt, new Date(now - DAY)));
  const [{ open }] = await db.select({ open: count() }).from(reports).where(isNull(reports.resolvedAt));
  const lastDigest = (await getState("digestDay"))?.updatedAt ?? new Date(now - DAY);
  const [{ skipped }] = await db
    .select({ skipped: count() })
    .from(watchMails)
    .where(and(eq(watchMails.kind, "skipped"), gt(watchMails.at, lastDigest)));
  const numbers = await siteNumbers(now);

  const things = wanted.length + (open ? 1 : 0);
  const day = beijingShort(now).split(" ")[0];
  const subject = `【${siteName()}】每日汇总 ${day}：${things ? `有 ${things} 件事要你看` : "一切正常"}`;
  const lines: string[] = [];
  if (wanted.length) {
    lines.push("要你处理的：");
    for (const i of wanted) {
      const acked = i.ackedAt ? `；你 ${beijingShort(i.ackedAt.getTime())} 已经知道了` : "";
      lines.push(`${LEVEL_MARK[asLevel(i.level)]} ${i.title}（从 ${beijingShort(i.startedAt.getTime())} 开始，已经 ${lasted(now - i.startedAt.getTime())}${acked}）`);
      if (i.detail) lines.push(`   ${i.detail}`);
      if (i.advice) lines.push(`   怎么办：${i.advice}`);
    }
    lines.push("");
  }
  if (skipped) lines.push(`有 ${skipped} 封紧急邮件因为超过当天的上限没发，都记在管理页上。`, "");
  if (over.size) {
    lines.push("过去 24 小时自己好了的：");
    for (const list of over.values()) {
      const times = list.reduce((n, i) => n + i.times, 0);
      const total = list.reduce((n, i) => n + (i.endedAt!.getTime() - i.startedAt.getTime()), 0);
      const worst = list.filter((i) => i.worst).sort((a, b) => (b.worstScore ?? 0) - (a.worstScore ?? 0))[0]?.worst;
      lines.push(`· ${list[list.length - 1].title}：${times} 次，累计 ${lasted(total)}${worst ? `，${worst}` : ""}`);
    }
    lines.push("");
  }
  if (fresh.length || open) {
    const reasons = fresh.length ? `（${byReason(fresh)}）` : "";
    lines.push(`举报：过去 24 小时新来 ${fresh.length} 条${reasons}，一共 ${open} 条没处理。${open ? `打开 ${SITE_URL}/admin 处理。` : ""}`, "");
  }
  lines.push("几个数：", ...numberLines(numbers), "", `完整记录：${SITE_URL}/admin`);
  return { subject, text: lines.join("\n") };
}

function numberLines(n: SiteNumbers) {
  const lines = [`· 验证码邮件：过去 24 小时发了 ${n.loginMails} 封，上限 ${n.mailLimit} 封`];
  if (n.disk) lines.push(`· 硬盘：用了 ${pct(n.disk.used)}，还剩 ${gb(n.disk.free)}`);
  lines.push(`· 备份：${n.backup}`);
  lines.push(`· 证书：${n.tlsDays === null ? "这里不查（只在服务器上查）" : n.tlsDays < 0 ? "已经过期" : `还有 ${n.tlsDays} 天`}`);
  lines.push(`· 高德地图：这个月大约打开了 ${n.amap.count.toLocaleString("en-US")} 次，上限 ${n.amap.limit.toLocaleString("en-US")} 次；${mainlandWords(n.amap)}`);
  if (n.yesterday) lines.push(`· 昨天：新来 ${n.yesterday.signups} 人，新结成 ${n.yesterday.friendships} 对触须之交`);
  if (n.logins) {
    const l = n.logins;
    lines.push(`· 昨天登录：验证码 ${l.code ?? 0} 次、密码 ${l.password ?? 0} 次、登录码 ${l.desk ?? 0} 次`);
  }
  return lines;
}

/** 网站状态 on the admin page */
export async function siteStatus(now = Date.now()): Promise<SiteStatus> {
  const weekAgo = new Date(now - 7 * DAY);
  const rows = await db
    .select()
    .from(watchIncidents)
    .where(or(isNull(watchIncidents.endedAt), gt(watchIncidents.startedAt, weekAgo), gt(watchIncidents.endedAt, weekAgo)))
    .orderBy(desc(watchIncidents.startedAt))
    .limit(1000);
  const round = await getState("round");
  const mails = await db.select().from(watchMails).orderBy(desc(watchMails.at), desc(watchMails.id)).limit(20);
  return {
    now,
    lastRound: round ? Number(round.value) : null,
    open: rows
      .filter((i) => !i.endedAt)
      .sort(byPressing)
      .map(viewOf),
    week: rows.map(viewOf),
    numbers: await siteNumbers(now),
    mails: mails.map((m) => ({ at: m.at.getTime(), subject: m.subject, kind: m.kind })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The admin's 「知道了」: no more emails about it, 「已恢复」 included; it still ends by itself */
export async function ackIncident(id: string, now = Date.now()) {
  if (!UUID.test(String(id))) throw new HttpError(400, "没有这件事。");
  await db
    .update(watchIncidents)
    .set({ ackedAt: new Date(now) })
    .where(and(eq(watchIncidents.id, id), isNull(watchIncidents.ackedAt)));
}
