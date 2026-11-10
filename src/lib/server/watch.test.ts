import { readFileSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { asc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reportMap } from "@/app/api/health/map/route";
import { beijingDate, beijingShort } from "../beijing";
import { db } from "./db";
import { countAmapLoad, forgetAmapLoads, saveAmapLoads } from "./amapLoads";
import { forgetGeo, geoSearch } from "./geo";
import { MAIL_DAILY_LIMIT } from "./env";
import { dailyTotals, mailSends, reports, users, watchAlerts, watchIncidents, watchMails, watchState } from "./schema";
import { errorCode, forgetSignals, note, recent } from "./signals";
import {
  buildId,
  CHECKS,
  doorFindings,
  forgetWatch,
  healthy,
  heardStart,
  processName,
  runWatch,
  WATCH_MAILS_PER_DAY,
  type Check,
  type Finding,
} from "./watch";
import { ackIncident, disk, siteStatus } from "./watchReport";
import { batches, countsSince, heardMessage } from "./watchSignals";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let t0: number;
let sent: { subject: string; text: string }[];
const send = async (subject: string, text: string) => {
  sent.push({ subject, text });
};
const fails = async () => {
  throw new Error("SMTP down");
};
const check = (name: string) => CHECKS.find((c) => c.name === name)!;
/** What a check of the site's finds now, with nothing of it open */
const look = (name: string, now: number) => check(name).run(now, () => false);
/** A check that sees whatever the test says it sees */
const seeing = (name: string, findings: () => Finding[], more: Partial<Check> = {}): Check => ({ name, run: async () => findings(), ...more });
/** One round without the morning's digest */
const run = (now: number, checks: Check[], s = send) => runWatch({ now, checks, send: s, digest: false });
const incidents = () => db.select().from(watchIncidents).orderBy(asc(watchIncidents.startedAt));
const clock = (t: number) => beijingShort(t).split(" ")[1];

beforeEach(async () => {
  await db.execute(sql`truncate ${watchIncidents}, ${watchMails}, ${watchAlerts}, ${watchState}, ${mailSends}, ${dailyTotals}, ${reports}`);
  t0 = Date.now();
  // a process that has been running for two days, so every check sees far enough back
  forgetSignals(t0 - 48 * HOUR);
  forgetWatch();
  forgetAmapLoads();
  sent = [];
});

describe("the site's own checks", () => {
  it("emails an urgent problem once, says when it is over, and says nothing when it is back within the hour", async () => {
    let problems: Finding[] = [{ key: "disk", level: "urgent", title: "硬盘快满了", detail: "已用 92%，还剩 4.0 GB。", advice: "清掉旧镜像。" }];
    const checks = [seeing("machine", () => problems, { closeAfter: 30 * MINUTE })];
    await run(t0, checks);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：硬盘快满了"]);
    expect(sent[0].text).toContain(`🔴 硬盘快满了\n   从 ${beijingShort(t0)} 开始。已用 92%，还剩 4.0 GB。\n   怎么办：清掉旧镜像。`);
    expect(sent[0].text).toContain("只有要你动手的事才马上发；好了会再说一声。不急的事在每天早上 9 点的汇总里。");

    // still there: nothing new, however long
    for (const later of [5, 60, 7 * 60]) await run(t0 + later * MINUTE, checks);
    expect(sent).toHaveLength(1);

    // over once gone half an hour
    problems = [];
    await run(t0 + 7 * HOUR + 20 * MINUTE, checks);
    expect(sent).toHaveLength(1);
    const end = t0 + 7 * HOUR + 30 * MINUTE;
    await run(end, checks);
    expect(sent[1].subject).toBe(`【舟P地图】已恢复：硬盘快满了（${clock(t0)}–${clock(end)}）`);

    // back within the hour: the same incident once more, and no email either way
    problems = [{ key: "disk", level: "urgent", title: "硬盘快满了" }];
    await run(end + 40 * MINUTE, checks);
    problems = [];
    await run(end + 80 * MINUTE, checks);
    expect(sent).toHaveLength(2);
    const [disk1] = await incidents();
    expect(disk1).toMatchObject({ key: "machine.disk", times: 2, level: "urgent" });
    expect(disk1.endedAt).not.toBeNull();
  });

  it("counts a problem hovering at its line as one, and emails nothing for a quiet one", async () => {
    // memory between 9.5% and 10.5% all afternoon: low for 20 minutes, fine for 10, again and again
    let low = true;
    const memory = [
      seeing(
        "machine",
        () => (low ? [{ key: "memory", level: "quiet", openAfter: 3, title: "内存紧张", worst: { text: "最少剩 700 MB", score: -700 } }] : []),
        { closeAfter: 30 * MINUTE },
      ),
    ];
    for (let r = 0; r < 48; r++) {
      low = r % 6 < 4;
      await run(t0 + r * 5 * MINUTE, memory);
    }
    const all = await incidents();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: "machine.memory", level: "quiet", endedAt: null, worst: "最少剩 700 MB" });
    // it began with the first of the three rounds that made it count
    expect(all[0].startedAt.getTime()).toBe(t0);
    expect(sent).toEqual([]);

    // seen twice, then not: never counted
    let blips = 0;
    const blip = [seeing("machine", () => (blips++ < 2 ? [{ key: "cpu", level: "quiet", openAfter: 3, title: "CPU 一直很忙" }] : []))];
    for (let r = 0; r < 4; r++) await run(t0 + DAY + r * 5 * MINUTE, blip);
    expect(await incidents()).toHaveLength(1);
  });

  it("keeps the sign-in code count going back and forth across the limit as one incident", async () => {
    const quota = [check("quota")];
    const sends = (n: number) => db.insert(mailSends).values(Array.from({ length: n }, () => ({ sentAt: new Date(t0 - 2 * HOUR), kind: "login" })));
    const drop = (n: number) =>
      db.execute(sql`delete from ${mailSends} where ${mailSends.id} in (select ${mailSends.id} from ${mailSends} order by ${mailSends.id} limit ${n})`);
    await sends(MAIL_DAILY_LIMIT);
    await run(t0, quota);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：验证码邮件用完了"]);
    for (let r = 1; r <= 10; r++) {
      if (r % 2) await drop(1);
      else await sends(1);
      await run(t0 + r * 5 * MINUTE, quota);
    }
    expect(sent).toHaveLength(1);
    expect((await incidents()).map((i) => i.key)).toEqual(["quota.full"]);

    // well below the line for half an hour: over, and the 80% for the digest takes over
    await drop(MAIL_DAILY_LIMIT - Math.ceil(0.8 * MAIL_DAILY_LIMIT));
    await run(t0 + 55 * MINUTE, quota);
    await run(t0 + 90 * MINUTE, quota);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：验证码邮件用完了", expect.stringMatching(/^【舟P地图】已恢复：验证码邮件用完了/)]);
    expect((await incidents()).map((i) => [i.key, i.level])).toEqual([
      ["quota.full", "urgent"],
      ["quota.high", "daily"],
    ]);
  });

  it("tells once a day of a pace that would use up the sign-in codes within six hours", async () => {
    const quota = [check("quota")];
    // 40 codes in the last hour: the rest of the limit lasts well under six hours
    await db.insert(mailSends).values(Array.from({ length: 40 }, () => ({ sentAt: new Date(t0 - 10 * MINUTE), kind: "login" })));
    await run(t0, quota);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：验证码邮件照现在的速度很快会用完"]);
    expect(sent[0].text).toMatch(/最近一小时发了 40 封，照这个速度大约 \d+ 小时后用完/);
    // over, and the same pace again later that day is only for the digest
    await db.delete(mailSends);
    await run(t0 + 40 * MINUTE, quota);
    await db.insert(mailSends).values(Array.from({ length: 40 }, () => ({ sentAt: new Date(t0 + 3 * HOUR), kind: "login" })));
    const later = beijingDate(t0 + 3 * HOUR + 10 * MINUTE) === beijingDate(t0) ? t0 + 3 * HOUR + 10 * MINUTE : t0 + 41 * MINUTE;
    await run(later, quota);
    expect(sent.filter((s) => s.subject.startsWith("【舟P地图】要你看"))).toHaveLength(1);
  });

  it("sends no 「已恢复」 for a problem the admin said they know of, nor anything more about it", async () => {
    let problems: Finding[] = [{ key: "disk", level: "urgent", title: "硬盘快满了" }];
    const checks = [seeing("machine", () => problems)];
    await run(t0, checks);
    const [inc] = await incidents();
    await ackIncident(inc.id, t0 + MINUTE);
    problems = [];
    await run(t0 + 20 * MINUTE, checks);
    expect(sent).toHaveLength(1);
    expect((await incidents())[0].endedAt).not.toBeNull();
    await expect(ackIncident("not-an-id")).rejects.toThrow("没有这件事");
  });

  it(`sends at most ${WATCH_MAILS_PER_DAY} urgent emails a day, and notes the rest for the page and the digest`, async () => {
    let round = 0;
    const flapping = [seeing("machine", () => [{ key: String(round), level: "urgent", title: `问题 ${round}` }])];
    for (; round < WATCH_MAILS_PER_DAY + 5; round++) await run(t0 + round * 5 * MINUTE, flapping);
    expect(sent).toHaveLength(WATCH_MAILS_PER_DAY);
    const skipped = await db.select().from(watchMails).where(eq(watchMails.kind, "skipped"));
    expect(skipped).toHaveLength(5);
    // never sent later, when the day's emails come free
    await run(t0 + DAY + 30 * MINUTE, [seeing("machine", () => [])]);
    expect(sent.filter((s) => s.subject.includes("问题 1"))).toHaveLength(1);
    expect(sent.filter((s) => /问题 1[0-4]/.test(s.subject))).toEqual([]);
  });

  it("keeps what it found across a restart of the process, telling nothing twice", async () => {
    const checks = [seeing("machine", () => [{ key: "disk", level: "urgent", title: "硬盘快满了" }])];
    await run(t0, checks);
    forgetWatch();
    await run(t0 + 10 * MINUTE, checks);
    expect(sent).toHaveLength(1);
    expect(await incidents()).toHaveLength(1);
  });

  it("keeps a check's problems as they were when the check itself fails", async () => {
    let broken = false;
    const flaky: Check = {
      name: "db",
      run: async () => {
        if (broken) throw new Error("connection refused");
        return [{ key: "down", level: "urgent", title: "数据库连不上" }];
      },
    };
    await run(t0, [flaky]);
    broken = true;
    await run(t0 + HOUR, [flaky]);
    expect(sent).toHaveLength(1);
    expect((await incidents())[0].endedAt).toBeNull();
  });

  it("tries an email that could not go out again the next round, and says no on /api/health after half an hour of that", async () => {
    const checks = [seeing("machine", () => [{ key: "disk", level: "urgent", title: "硬盘快满了" }])];
    await run(t0, checks, fails);
    await run(t0 + 5 * MINUTE, checks, fails);
    expect(await healthy(t0 + 29 * MINUTE)).toEqual({ ok: true });
    expect(await healthy(t0 + 31 * MINUTE)).toEqual({ ok: false, why: "mail" });
    await run(t0 + 35 * MINUTE, checks);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：硬盘快满了"]);
    expect(await healthy(t0 + 36 * MINUTE)).toEqual({ ok: true });
  });

  it("carries the problems open when it goes live over, without emailing any of them again", async () => {
    await db.insert(watchAlerts).values([
      { key: "mail.failing", title: "验证码邮件发不出去", detail: "30 分钟内失败 6 次", since: new Date(t0 - HOUR), mailedAt: new Date(t0 - HOUR) },
      { key: "machine.disk", title: "硬盘快满了", since: new Date(t0 - HOUR), mailedAt: null },
    ]);
    const statement = readFileSync("drizzle/0030_watch_incidents.sql", "utf8").split("--> statement-breakpoint").pop()!;
    await db.execute(sql.raw(statement));
    await run(t0, [
      seeing("mail", () => [{ key: "failing", level: "urgent", title: "验证码邮件发不出去" }]),
      seeing("machine", () => [{ key: "disk", level: "urgent", title: "硬盘快满了" }]),
    ]);
    expect(sent).toEqual([]);
    expect((await incidents()).map((i) => [i.key, i.level, i.startedAt.getTime()]).sort()).toEqual([
      ["machine.disk", "urgent", t0 - HOUR],
      ["mail.failing", "urgent", t0 - HOUR],
    ]);
  });

  it("sends the morning's digest once a Beijing day from 9:00, again after a failure, not again after a restart", async () => {
    // 11/12 08:30 and 09:00 in Beijing
    const nine = Date.parse("2026-11-12T01:00:00Z");
    const digest = (now: number, s = send) => runWatch({ now, checks: [], send: s, digest: true });
    await digest(nine - 30 * MINUTE);
    expect(sent).toEqual([]);
    await digest(nine, fails);
    await digest(nine + 5 * MINUTE);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】每日汇总 11/12：一切正常"]);
    // all is well: only the figures and where the rest is
    expect(sent[0].text).toMatch(/^几个数：\n· 验证码邮件：过去 24 小时发了 0 封，上限 \d+ 封\n/);
    expect(sent[0].text).toContain("· 备份：还没有备份的记录");
    expect(sent[0].text).toMatch(/\n\n完整记录：http.*\/admin$/);
    forgetWatch();
    await digest(nine + 10 * MINUTE);
    expect(sent).toHaveLength(1);
    // the next morning, even late
    await digest(nine + DAY + 3 * HOUR);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】每日汇总 11/12：一切正常", "【舟P地图】每日汇总 11/13：一切正常"]);
    expect((await db.select().from(watchMails)).map((m) => m.kind)).toEqual(["digest", "digest"]);
  });

  it("puts in the digest what wants the admin, what was over by itself, the day's reports and the figures", async () => {
    const nine = Date.parse("2026-11-12T01:00:00Z");
    const at = (minutes: number) => nine + minutes * MINUTE;
    let found: Finding[] = [
      { key: "disk", level: "urgent", title: "硬盘快满了", detail: "已用 91%。", advice: "清掉旧镜像。" },
      { key: "memory", level: "quiet", title: "内存紧张", worst: { text: "最少剩 400 MB", score: -400 } },
    ];
    const checks = [seeing("machine", () => found), seeing("backup", () => [{ key: "local", level: "daily", title: "数据库备份没传到腾讯云" }])];
    await run(at(-120), checks);
    found = found.filter((f) => f.key === "disk");
    await run(at(-90), checks);
    await run(at(-60), checks);
    const [u] = await db.insert(users).values({}).returning({ id: users.id });
    await db.insert(reports).values([
      { targetId: u.id, reason: "spam", context: "测试", targetName: "测试", createdAt: new Date(at(-30)) },
      { targetId: u.id, reason: "name", context: "测试", targetName: "测试", createdAt: new Date(at(-20)), resolvedAt: new Date(at(-10)) },
    ]);
    await db.insert(dailyTotals).values({ day: "2026-11-11", activeWeek: 30, signups: 4, friendships: 2 });
    sent = [];
    await runWatch({ now: nine, checks: [], send, digest: true });
    const [d] = sent;
    expect(d.subject).toBe("【舟P地图】每日汇总 11/12：有 3 件事要你看");
    expect(d.text).toContain(
      "要你处理的：\n🔴 硬盘快满了（从 11/12 07:00 开始，已经 2 小时）\n   已用 91%。\n   怎么办：清掉旧镜像。\n🟡 数据库备份没传到腾讯云（从 11/12 07:00 开始，已经 2 小时）",
    );
    expect(d.text).toContain("过去 24 小时自己好了的：\n· 内存紧张：1 次，累计 30 分钟，最少剩 400 MB");
    expect(d.text).toContain("举报：过去 24 小时新来 2 条（名字不合适 1 条、骚扰刷屏 1 条），一共 1 条没处理。");
    expect(d.text).toContain("· 昨天：新来 4 人，新结成 2 对触须之交");
    // the reports it told of count as told
    expect(await db.$count(reports, sql`${reports.notifiedAt} is not null`)).toBe(1);
  });

  it("shows the admin page what is open, the week, the figures and the emails", async () => {
    await run(t0, [seeing("machine", () => [{ key: "disk", level: "urgent", title: "硬盘快满了" }, { key: "cpu", level: "quiet", title: "CPU 一直很忙" }])]);
    const s = await siteStatus(t0 + MINUTE);
    expect(s.lastRound).toBe(t0);
    expect(s.open.map((i) => [i.key, i.level, i.mailedAt])).toEqual([
      ["machine.disk", "urgent", t0],
      ["machine.cpu", "quiet", null],
    ]);
    expect(s.week).toHaveLength(2);
    expect(s.mails).toEqual([{ at: t0, subject: "【舟P地图】要你看：硬盘快满了", kind: "urgent" }]);
    expect(s.numbers.mailLimit).toBe(MAIL_DAILY_LIMIT);
    // nothing about anyone
    expect(JSON.stringify(s)).not.toMatch(/@|email/);
  });

  it("tells of restarts that were not deploys, and three in an hour at once, from every process", async () => {
    // the main process starting with the build it ran last time
    await db.insert(watchState).values({ key: "build", value: buildId() });
    await run(t0, [check("restart")]);
    expect((await incidents()).map((i) => [i.key, i.level, i.title])).toEqual([["restart.again", "daily", "网站程序重启过"]]);
    expect(processName()).toBe("web");

    // a helper crashing again and again: its first start says nothing, the next three in an hour do
    heardStart({ name: "web2", build: "b7", at: t0 + MINUTE });
    await run(t0 + 2 * MINUTE, [check("restart")]);
    for (const m of [20, 40, 55]) {
      heardStart({ name: "web2", build: "b7", at: t0 + m * MINUTE });
      await run(t0 + (m + 1) * MINUTE, [check("restart")]);
    }
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：网站程序 1 小时里重启了 3 次"]);
    // a new build is a deploy
    heardStart({ name: "web2", build: "b8", at: t0 + 70 * MINUTE });
    await run(t0 + 71 * MINUTE, [check("restart")]);
    expect(sent).toHaveLength(1);
  });

  it("counts errors of all three processes: a flood is urgent, a busy day is for the digest", async () => {
    for (let i = 0; i < 4; i++) note("error", "/api/world/touch PostgresError 57P01", t0 - MINUTE);
    expect(await look("errors", t0)).toEqual([]);
    note("error", "/ TypeError", t0 - MINUTE);
    expect(await look("errors", t0)).toMatchObject([
      { key: "many", level: "quiet", detail: "10 分钟内出错 5 次，最多的是：/api/world/touch PostgresError 57P01 ×4；/ TypeError ×1。" },
    ]);
    for (let i = 0; i < 15; i++) note("error", "/api/hot TypeError", t0 - 5 * HOUR);
    expect(await look("errors", t0)).toMatchObject([{ key: "many", level: "daily", detail: expect.stringMatching(/^过去 24 小时出错 20 次/) }]);
    // ten in each of the last three ten minutes
    for (const ago of [5, 15, 25]) for (let i = 0; i < 10; i++) note("error", "/api/world/me TypeError", t0 - ago * MINUTE);
    expect(await look("errors", t0)).toMatchObject([{ key: "many", level: "urgent", title: "网站程序大面积出错" }]);
  });

  it("hears what the other processes noted, and when they started", async () => {
    forgetSignals(t0 - HOUR);
    note("error", "/api/world/touch TypeError", t0 - 5 * MINUTE);
    note("error", "/api/world/touch TypeError", t0 - 5 * MINUTE);
    note("mailSent", "login", t0 - 2 * MINUTE);
    note("map", "amap:load:", t0 - MINUTE);
    const counts = countsSince(t0 - 10 * MINUTE, t0);
    expect(counts.map(([kind, code, , n]) => [kind, code, n])).toEqual([
      ["error", "/api/world/touch TypeError", 2],
      ["mailSent", "login", 1],
    ]);

    // the main process
    forgetSignals(t0 - HOUR);
    const starts: unknown[] = [];
    for (const m of batches("web2", counts)) heardMessage(JSON.stringify(m), (s) => starts.push(s));
    heardMessage(JSON.stringify({ p: "web2", start: { build: "b1", at: t0 } }), (s) => starts.push(s));
    heardMessage("not ours", (s) => starts.push(s));
    heardMessage(JSON.stringify({ p: "web3", s: [["job", "setup", t0, 5]] }), (s) => starts.push(s));
    expect(recent("error", HOUR, t0)).toHaveLength(2);
    expect(recent("mailSent", HOUR, t0)).toHaveLength(1);
    expect(recent("job", HOUR, t0)).toEqual([]);
    expect(starts).toEqual([{ name: "web2", build: "b1", at: t0 }]);
    // older ones heard late still sit in time order
    note("error", "late", t0 - 30 * MINUTE);
    expect(recent("error", HOUR, t0)[0].code).toBe("late");

    const many = Array.from({ length: 400 }, (_, i): [ "error", string, number, number ] => ["error", `/api/world/op${i} TypeError`, t0, 1]);
    const parts = batches("web2", many);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => JSON.stringify(p).length <= 8000)).toBe(true);
    expect(parts.flatMap((p) => p.s ?? [])).toHaveLength(400);
  });

  it("sees the disk filling up at the last days' pace", async () => {
    const d = disk();
    await db.insert(watchState).values({ key: "diskDays", value: JSON.stringify({ [beijingDate(t0 - 3 * DAY)]: d.usedBytes - 2 * d.free }) });
    const found = (await look("machine", t0)).find((f) => f.key === "disk");
    expect(found).toMatchObject({ level: "urgent", detail: expect.stringMatching(/照最近三天的涨法，大约 \d 天后满/) });
  });

  it("calls a problem seen in what this process noted over only once it has watched long enough", async () => {
    forgetSignals(t0);
    for (let i = 0; i < 3; i++) note("map", "amap:key:USER_DAILY_QUERY_OVER_LIMIT", t0);
    note("map", "osm:style:404", t0);
    const map = [check("map")];
    await run(t0 + MINUTE, map);
    // 高德's key trouble is for the digest, not an email
    expect(sent).toEqual([]);
    expect(await incidents()).toMatchObject([
      { key: "map.failing", level: "daily", detail: "30 分钟内有 4 次：高德·Key 异常（USER_DAILY_QUERY_OVER_LIMIT） ×3；OSM 底图·样式没加载出来（404） ×1。" },
    ]);

    // a restart forgets the reports, but half an hour must pass before it can say they stopped
    forgetWatch();
    forgetSignals(t0 + 3 * MINUTE);
    await run(t0 + 5 * MINUTE, map);
    await run(t0 + 32 * MINUTE, map);
    expect((await incidents())[0].endedAt).toBeNull();
    await run(t0 + 34 * MINUTE, map);
    expect((await incidents())[0].endedAt).not.toBeNull();
  });

  it("needs ten of the other kinds of map trouble in half an hour, and keeps them off the digest", async () => {
    for (let i = 0; i < 9; i++) note("map", "amap:slow:", t0 - 20 * MINUTE);
    expect(await look("map", t0)).toEqual([]);
    note("map", "overseas:tiles:tiles-404", t0 - MINUTE);
    expect(await look("map", t0)).toMatchObject([
      { level: "quiet", detail: "30 分钟内有 10 次：高德·一直没画出来 ×9；我们自己的海外底图·图块加载失败（tiles-404） ×1。" },
    ]);
    expect(await look("map", t0 + 11 * MINUTE)).toEqual([]);
  });

  it("counts 高德's map loads across restarts and puts 80% in the digest once a month", async () => {
    vi.stubEnv("AMAP_MAP_LOADS", "100");
    try {
      // the 15th of a Beijing month: a pace means something by then
      const mid = Date.parse("2026-11-15T04:00:00Z");
      const loads = [check("amapLoads")];
      for (let i = 0; i < 30; i++) countAmapLoad();
      await run(mid, loads);
      expect(await incidents()).toEqual([]);
      // a restart loses only what was not saved yet
      forgetWatch();
      for (let i = 0; i < 50; i++) countAmapLoad();
      expect(await saveAmapLoads(mid + 10 * MINUTE)).toEqual({ month: "2026-11", count: 80 });
      await run(mid + 20 * MINUTE, loads);
      expect(await incidents()).toMatchObject([
        { key: "amapLoads.loads", level: "daily", detail: expect.stringContaining("这个月到现在，内地访客大约打开了 80 次高德地图（估算）") },
      ]);
      // once a month, open a day so the next digest has it, and no email
      for (let i = 0; i < 30; i++) countAmapLoad();
      for (const later of [40, 60, 6 * 60 + 30]) await run(mid + later * MINUTE, loads);
      expect(await incidents()).toHaveLength(1);
      expect((await incidents())[0].endedAt).toBeNull();
      expect(sent).toEqual([]);
      // a new month starts from nothing
      expect(await saveAmapLoads(Date.parse("2026-12-01T00:00:00Z"))).toEqual({ month: "2026-12", count: 0 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tells when this month's pace would use up 高德's map loads before the month is out", async () => {
    vi.stubEnv("AMAP_MAP_LOADS", "100");
    try {
      // on the 1st a pace means nothing yet; on the 4th, 40 loads are about 340 by the month's end, though not 80% yet
      const fourth = Date.parse("2026-11-04T04:00:00Z");
      for (let i = 0; i < 20; i++) countAmapLoad();
      expect(await look("amapLoads", Date.parse("2026-11-01T06:00:00Z"))).toEqual([]);
      for (let i = 0; i < 20; i++) countAmapLoad();
      expect(await look("amapLoads", fourth)).toMatchObject([{ key: "loads", detail: expect.stringContaining("到月底大约") }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tells of 腾讯位置服务 turning away the key of the place suggestions, apart from the map failing", async () => {
    forgetSignals(t0);
    for (let i = 0; i < 2; i++) note("map", "tencent:search:121", t0 - MINUTE);
    expect(await look("map", t0)).toEqual([]);
    note("map", "tencent:search:121", t0);
    // nine other kinds of map trouble beside them are not ten
    for (let i = 0; i < 9; i++) note("map", "amap:slow:", t0);
    expect(await look("map", t0)).toEqual([
      expect.objectContaining({
        key: "tencent",
        level: "quiet",
        title: "腾讯打字提示今天的额度用完了",
        detail: "30 分钟内有 3 个页面说腾讯位置服务不给打字提示：121（Key 今天的调用量用完了） ×3。",
      }),
    ]);
    for (let i = 0; i < 4; i++) note("map", "tencent:search:110", t0);
    expect(await look("map", t0)).toMatchObject([
      {
        key: "tencent",
        level: "daily",
        title: "腾讯打字提示的 Key 被拒了",
        detail: expect.stringContaining("110（这个网站不在 Key 的域名白名单里） ×4；121（Key 今天的调用量用完了） ×3"),
      },
    ]);
    expect(await look("map", t0 + 31 * MINUTE)).toEqual([]);
  });

  it("tells of 高德 turning the server's place search away for the rest of the day, apart from the map failing", async () => {
    vi.stubEnv("AMAP_WEBSERVICE_KEY", "test-key");
    forgetGeo();
    try {
      expect(await look("map", t0)).toEqual([]);
      const used = (async (url: string) =>
        Response.json(String(url).includes("amap") ? { status: "0", info: "USER_DAILY_QUERY_OVER_LIMIT", infocode: "10044" } : [])) as unknown as typeof fetch;
      await geoSearch("202.96.128.86", { kind: "search", q: "静安寺" }, used);
      // eight slow maps beside it are not ten failed maps
      for (let i = 0; i < 8; i++) note("map", "amap:slow:", t0 - 5 * MINUTE);
      expect(await look("map", t0)).toMatchObject([
        { key: "search", level: "quiet", title: "高德搜地点额度用完了", detail: expect.stringContaining("USER_DAILY_QUERY_OVER_LIMIT") },
      ]);
      // still so an hour on: it lasts the day (Beijing's), however late the tests run
      const later = beijingDate(t0 + 60 * MINUTE) === beijingDate(t0) ? t0 + 60 * MINUTE : t0 + 1;
      expect(await look("map", later)).toMatchObject([{ key: "search" }]);
    } finally {
      vi.unstubAllEnvs();
      forgetGeo();
    }
  });

  it("counts sign-in code emails against MAIL_DAILY_LIMIT: 80% for the digest, urgent when used up", async () => {
    const sends = (n: number, at: number) =>
      db.insert(mailSends).values(Array.from({ length: n }, () => ({ sentAt: new Date(at), kind: "login" })));
    await sends(MAIL_DAILY_LIMIT, t0 - 25 * HOUR);
    const high = Math.ceil(0.8 * MAIL_DAILY_LIMIT);
    await sends(high - 1, t0 - 2 * HOUR);
    // the admin's report reminders do not count
    await db.insert(mailSends).values({ sentAt: new Date(t0 - HOUR), kind: "report-urgent" });
    expect(await look("quota", t0)).toEqual([]);
    await sends(1, t0 - 2 * HOUR);
    expect(await look("quota", t0)).toMatchObject([{ key: "high", level: "daily", title: "验证码邮件快用完了" }]);
    await sends(MAIL_DAILY_LIMIT - high, t0 - 2 * HOUR);
    expect(await look("quota", t0)).toMatchObject([
      {
        key: "full",
        level: "urgent",
        title: "验证码邮件用完了",
        detail: `过去 24 小时发了 ${MAIL_DAILY_LIMIT} 封，上限是 ${MAIL_DAILY_LIMIT} 封（服务器 .env 里的 MAIL_DAILY_LIMIT）。新来的人现在收不到验证码，登录不了。`,
      },
    ]);
  });

  it("says emails are failing at once only when many fail, and only then says no on /api/health", async () => {
    const mail = [check("mail")];
    note("mailFailed", "Error EAUTH 535", t0 - 10 * MINUTE);
    note("mailFailed", "Error EAUTH 535", t0 - 8 * MINUTE);
    expect(await look("mail", t0)).toMatchObject([{ key: "failing", level: "quiet", detail: "30 分钟内失败 2 次（Error EAUTH 535 ×2），之后还没有发出去过。" }]);
    await run(t0, mail);
    expect(sent).toEqual([]);
    expect(await healthy(t0)).toEqual({ ok: true });

    for (let i = 0; i < 8; i++) note("mailFailed", "Error ETIMEDOUT CONNECT_TIMEOUT", t0 + MINUTE);
    note("mailSent", "login", t0 + MINUTE);
    await run(t0 + 2 * MINUTE, mail);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：验证码邮件发不出去"]);
    expect(await healthy(t0 + 2 * MINUTE)).toEqual({ ok: false, why: "mail" });

    // more going out than failing for a quarter of an hour: over
    for (let i = 0; i < 12; i++) note("mailSent", "login", t0 + 20 * MINUTE);
    await run(t0 + 21 * MINUTE, mail);
    await run(t0 + 36 * MINUTE, mail);
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】要你看：验证码邮件发不出去", expect.stringMatching(/^【舟P地图】已恢复：验证码邮件发不出去/)]);
    expect(await healthy(t0 + 36 * MINUTE)).toEqual({ ok: true });
  });

  it("tells of code-request floods and failed jobs from what this process noted", async () => {
    for (let i = 0; i < 29; i++) note("codeRefused", "ip-10min", t0 - MINUTE);
    expect(await look("codes", t0)).toEqual([]);
    note("codeRefused", "quota", t0 - MINUTE);
    expect(await look("codes", t0)).toMatchObject([
      { key: "flood", level: "quiet", detail: "一小时内有 30 次要验证码被拦下（同一网络 10 分钟内太频繁 ×29；全站邮件额度用完 ×1）。" },
    ]);

    note("job", "flip", t0 - HOUR);
    note("job", "flip", t0 - MINUTE);
    note("job", "setup", t0 - MINUTE);
    expect(await look("jobs", t0)).toMatchObject([
      { key: "flip", level: "daily", title: "定时任务「好久没来自动翻」出错了" },
      { key: "setup", level: "urgent", title: "定时任务「启动时升级数据库」出错了" },
    ]);
    expect((await look("jobs", t0))[0].detail).toMatch(/^过去 24 小时出错 2 次，最近一次在 /);
  });

  it("reads how the nightly backup went from the record scripts/backup.sh writes", async () => {
    const record = (value: string, at: number) =>
      db
        .insert(watchState)
        .values({ key: "backup", value, updatedAt: new Date(at) })
        .onConflictDoUpdate({ target: watchState.key, set: { value, updatedAt: new Date(at) } });

    // no record yet: a night's grace once the checks began
    expect(await look("backup", t0)).toEqual([]);
    await db.insert(watchState).values({ key: "since", value: "", updatedAt: new Date(t0 - 31 * HOUR) });
    expect(await look("backup", t0)).toMatchObject([{ key: "missing", level: "daily" }]);

    await record("ok zhoupmap-20261109-0400.sql.gz 12M cos", t0 - 30 * HOUR);
    await record("failed upload", t0 - 2 * HOUR);
    expect((await look("backup", t0))[0]).toMatchObject({ key: "failed", level: "daily", title: "数据库备份失败了" });
    expect((await look("backup", t0))[0].detail).toContain("「上传到腾讯云 COS」");
    // a second night without a backup that worked
    expect((await look("backup", t0 + 21 * HOUR))[0]).toMatchObject({ key: "failed", level: "urgent", detail: expect.stringContaining("超过两天没有成功的数据库备份了") });
    await record("ok zhoupmap-20261109-0400.sql.gz 12M local", t0 - 2 * HOUR);
    expect(await look("backup", t0)).toMatchObject([{ key: "local", level: "daily" }]);
    await record("ok zhoupmap-20261109-0400.sql.gz 12M cos", t0 - 27 * HOUR);
    expect(await look("backup", t0)).toMatchObject([{ key: "stale", level: "daily" }]);

    // the script's own statement, as it runs on the server
    const statement = readFileSync("scripts/backup.sh", "utf8").match(/"(insert into watch_state[\s\S]*?)"/)![1];
    await db.execute(sql.raw(statement.replace("'$1'", "'ok zhoupmap-20261110-0400.sql.gz 12M cos'")));
    expect(await look("backup", Date.now())).toEqual([]);
  });

  it("finds nothing wrong with this machine's processor during the tests, and nothing to ask on a Mac", async () => {
    await expect(look("machine", t0)).resolves.toBeInstanceOf(Array);
    // no certificate to look at in development
    expect(await look("tls", t0)).toEqual([]);
    // and no other way in to ask through
    expect(await look("doors", t0)).toEqual([]);
  });

  it("tells when the site does not answer through another way in, which is urgent", async () => {
    // a port nothing listens on, so every try is refused at once
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });
    const found = await doorFindings([`127.0.0.1:${port}`], "zhoupmap.com", 0);
    expect(found.map((f) => [f.key, f.level])).toEqual([[`down:127.0.0.1:${port}`, "urgent"]]);
    expect(found[0].detail).toContain("连接被拒绝");
    expect(found[0].advice).toContain("DNSPod");
  });
});

describe("POST /api/health/map", () => {
  const post = (body: unknown) =>
    reportMap(
      new NextRequest("http://localhost/api/health/map", {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      undefined,
    );

  it("keeps which map failed and the service's short code, and nothing it does not know", async () => {
    forgetSignals(t0);
    expect((await post({ map: "amap", what: "key", detail: "USER_DAILY_QUERY_OVER_LIMIT" })).status).toBe(204);
    await post({ map: "amap", what: "load", detail: "<script>me@example.com 你好" });
    await post({ map: "elsewhere", what: "key" });
    await post({ map: "osm", what: "explode" });
    // 腾讯位置服务 only says its suggestions' key was turned away
    await post({ map: "tencent", what: "search", detail: "121" });
    await post({ map: "tencent", what: "key", detail: "121" });
    await post({ map: "amap", what: "search", detail: "121" });
    expect(recent("map", HOUR).map((s) => s.code)).toEqual(["amap:key:USER_DAILY_QUERY_OVER_LIMIT", "amap:load:scriptmeexample.com", "tencent:search:121"]);
  });
});

describe("errorCode", () => {
  it("names the database's own error inside a query's, and never the query or its values", async () => {
    const e = await db.execute(sql`select ${"not-a-uuid"}::uuid`).catch((x: unknown) => x);
    expect(errorCode(e)).toBe("DrizzleQueryError caused by PostgresError 22P02");
    const timeout = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN", timeoutType: "CONNECT_TIMEOUT" });
    expect(errorCode(timeout)).toBe("Error ETIMEDOUT CONNECT_TIMEOUT");
    expect(errorCode(new TypeError("x of undefined"))).toBe("TypeError");
  });
});
