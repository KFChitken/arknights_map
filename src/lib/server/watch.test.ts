import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as reportMap } from "@/app/api/health/map/route";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { mailSends, watchAlerts, watchState } from "./schema";
import { errorCode, forgetSignals, note, recent } from "./signals";
import { CHECKS, forgetWatch, healthy, REMIND_AFTER, runWatch, WATCH_MAILS_PER_DAY, type Check, type Finding } from "./watch";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let t0: number;
let sent: { subject: string; text: string }[];
const send = async (subject: string, text: string) => {
  sent.push({ subject, text });
};
const check = (name: string) => CHECKS.find((c) => c.name === name)!;
/** A check that sees whatever the test says it sees */
const seeing = (name: string, findings: () => Finding[], more: Partial<Check> = {}): Check => ({ name, run: async () => findings(), ...more });

beforeEach(async () => {
  await db.execute(sql`truncate ${watchAlerts}, ${watchState}, ${mailSends}`);
  t0 = Date.now();
  // a process that has been running for two days, so every check sees far enough back
  forgetSignals(t0 - 48 * HOUR);
  forgetWatch();
  sent = [];
});

describe("the site's own checks", () => {
  it("emails a new problem once, again six hours on while it lasts, and once more when it is over", async () => {
    let problems: Finding[] = [{ key: "disk", title: "硬盘快满了", detail: "已用 90%，还剩 5.0 GB。", advice: "清掉旧镜像。" }];
    const checks = [seeing("machine", () => problems)];
    await runWatch({ now: t0, checks, send });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("【舟P地图】出问题了：硬盘快满了");
    expect(sent[0].text).toContain("⚠️ 硬盘快满了\n   已用 90%，还剩 5.0 GB。\n   清掉旧镜像。");

    await runWatch({ now: t0 + 5 * MINUTE, checks, send });
    await runWatch({ now: t0 + REMIND_AFTER - MINUTE, checks, send });
    expect(sent).toHaveLength(1);
    await runWatch({ now: t0 + REMIND_AFTER, checks, send });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("⚠️ 还没好：硬盘快满了");

    problems = [];
    await runWatch({ now: t0 + REMIND_AFTER + 5 * MINUTE, checks, send });
    expect(sent).toHaveLength(3);
    expect(sent[2].subject).toBe("【舟P地图】已解决：硬盘快满了");
    await runWatch({ now: t0 + REMIND_AFTER + 10 * MINUTE, checks, send });
    expect(sent).toHaveLength(3);
  });

  it("puts what is new in one email, and lists what it told before and is still wrong", async () => {
    let problems: Finding[] = [{ key: "disk", title: "硬盘快满了" }];
    const checks = [seeing("machine", () => problems)];
    await runWatch({ now: t0, checks, send });
    problems = [...problems, { key: "memory", title: "内存快满了" }, { key: "cpu", title: "CPU 一直很忙" }];
    await runWatch({ now: t0 + 5 * MINUTE, checks, send });
    expect(sent[1].subject).toBe("【舟P地图】出问题了：内存快满了 等 2 项");
    expect(sent[1].text).toContain("之前提醒过、还没好的：\n· 硬盘快满了");
  });

  it("remembers what it told across a restart, and tells of a restart that was not a deploy once", async () => {
    const checks = [seeing("machine", () => [{ key: "disk", title: "硬盘快满了" }]), check("restart")];
    await runWatch({ now: t0, checks, send });
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】出问题了：硬盘快满了"]);

    // the same build starting again
    forgetWatch();
    await runWatch({ now: t0 + 10 * MINUTE, checks, send });
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】出问题了：硬盘快满了", "【舟P地图】出问题了：网站程序重启过"]);
    // the problem it already told of is not told again, only listed
    expect(sent[1].text).not.toContain("⚠️ 硬盘");
    expect(sent[1].text).toContain("之前提醒过、还没好的：\n· 硬盘快满了");

    // again soon after: nothing new; and a restart is never "over"
    forgetWatch();
    await runWatch({ now: t0 + 20 * MINUTE, checks, send });
    await runWatch({ now: t0 + 25 * MINUTE, checks, send });
    await runWatch({ now: t0 + 20 * MINUTE + REMIND_AFTER, checks: [check("restart")], send });
    expect(sent.map((s) => s.subject)).toHaveLength(2);
    expect((await db.select().from(watchAlerts)).map((a) => a.key)).toEqual(["machine.disk"]);

    // a new build is a deploy
    await db.update(watchState).set({ value: "an older build" }).where(sql`key = 'build'`);
    forgetWatch();
    await runWatch({ now: t0 + 30 * MINUTE + REMIND_AFTER, checks: [check("restart")], send });
    expect(sent).toHaveLength(2);
  });

  it("keeps a check's problems as they were when the check itself fails", async () => {
    let broken = false;
    const flaky: Check = {
      name: "db",
      run: async () => {
        if (broken) throw new Error("connection refused");
        return [{ key: "slow", title: "数据库反应很慢" }];
      },
    };
    await runWatch({ now: t0, checks: [flaky], send });
    broken = true;
    await runWatch({ now: t0 + 5 * MINUTE, checks: [flaky], send });
    expect(sent).toHaveLength(1);
  });

  it(`never sends more than ${WATCH_MAILS_PER_DAY} emails a day`, async () => {
    let round = 0;
    const flapping = [seeing("machine", () => [{ key: String(round), title: `问题 ${round}` }])];
    for (; round < WATCH_MAILS_PER_DAY + 6; round++) await runWatch({ now: t0 + round * 5 * MINUTE, checks: flapping, send });
    expect(sent).toHaveLength(WATCH_MAILS_PER_DAY);
  });

  it("calls a problem seen in what this process noted over only once it has watched long enough", async () => {
    forgetSignals(t0);
    for (let i = 0; i < 2; i++) note("map", "amap:key:USER_DAILY_QUERY_OVER_LIMIT", t0);
    note("map", "osm:style:404", t0);
    const map = [check("map")];
    await runWatch({ now: t0 + MINUTE, checks: map, send });
    expect(sent).toHaveLength(0);
    // 高德's key trouble three times in ten minutes is enough
    note("map", "amap:key:USER_DAILY_QUERY_OVER_LIMIT", t0);
    await runWatch({ now: t0 + 2 * MINUTE, checks: map, send });
    expect(sent[0].subject).toBe("【舟P地图】出问题了：地图在访客那里加载失败");
    expect(sent[0].text).toContain("30 分钟内有 4 次：高德·Key 异常（USER_DAILY_QUERY_OVER_LIMIT） ×3；OSM 底图·样式没加载出来（404） ×1。");

    // a restart forgets the reports, but half an hour must pass before it can say they stopped
    forgetWatch();
    forgetSignals(t0 + 3 * MINUTE);
    await runWatch({ now: t0 + 5 * MINUTE, checks: map, send });
    await runWatch({ now: t0 + 32 * MINUTE, checks: map, send });
    expect(sent).toHaveLength(1);
    await runWatch({ now: t0 + 34 * MINUTE, checks: map, send });
    expect(sent[1].subject).toBe("【舟P地图】已解决：地图在访客那里加载失败");
  });

  it("needs ten of the other kinds of map trouble in half an hour", async () => {
    for (let i = 0; i < 9; i++) note("map", "amap:slow:", t0 - 20 * MINUTE);
    expect(await check("map").run(t0)).toEqual([]);
    note("map", "overseas:tiles:tiles-404", t0 - MINUTE);
    expect(await check("map").run(t0)).toMatchObject([{ detail: "30 分钟内有 10 次：高德·一直没画出来 ×9；我们自己的海外底图·图块加载失败（tiles-404） ×1。" }]);
    expect(await check("map").run(t0 + 11 * MINUTE)).toEqual([]);
  });

  it("counts sign-in code emails against MAIL_DAILY_LIMIT: a warning at 80%, another when used up", async () => {
    const quota = check("quota");
    const sends = (n: number, at: number) =>
      db.insert(mailSends).values(Array.from({ length: n }, () => ({ sentAt: new Date(at), kind: "login" })));
    await sends(MAIL_DAILY_LIMIT, t0 - 25 * HOUR);
    const high = Math.ceil(0.8 * MAIL_DAILY_LIMIT);
    await sends(high - 1, t0 - HOUR);
    expect(await quota.run(t0)).toEqual([]);
    await sends(1, t0 - HOUR);
    expect(await quota.run(t0)).toMatchObject([{ key: "high", title: "验证码邮件快用完了" }]);
    await sends(MAIL_DAILY_LIMIT - high, t0 - HOUR);
    expect(await quota.run(t0)).toMatchObject([
      { key: "full", title: "验证码邮件用完了", detail: `过去 24 小时发了 ${MAIL_DAILY_LIMIT} 封，上限是 ${MAIL_DAILY_LIMIT} 封（服务器 .env 里的 MAIL_DAILY_LIMIT）。` },
    ]);
  });

  it("says emails are failing until one goes out again, and so does /api/health", async () => {
    const mail = check("mail");
    note("mailFailed", "Error EAUTH 535", t0 - 10 * MINUTE);
    note("mailFailed", "Error EAUTH 535", t0 - 8 * MINUTE);
    expect(await mail.run(t0)).toMatchObject([{ key: "failing", detail: "30 分钟内失败 2 次（Error EAUTH 535 ×2）。" }]);
    expect(await healthy(t0)).toEqual({ ok: true });
    await runWatch({ now: t0, checks: [mail], send });
    expect(await healthy(t0)).toEqual({ ok: false, why: "mail" });

    note("mailSent", "login", t0 - 5 * MINUTE);
    expect(await mail.run(t0)).toEqual([]);
    await runWatch({ now: t0 + 5 * MINUTE, checks: [mail], send });
    expect(await healthy(t0 + 5 * MINUTE)).toEqual({ ok: true });
    expect(sent.map((s) => s.subject)).toEqual(["【舟P地图】出问题了：验证码邮件发不出去", "【舟P地图】已解决：验证码邮件发不出去"]);
  });

  it("says no on /api/health for an hour after its own email could not go out", async () => {
    const fails = async () => {
      throw new Error("SMTP down");
    };
    await runWatch({ now: t0, checks: [seeing("machine", () => [{ key: "disk", title: "硬盘快满了" }])], send: fails });
    expect(await healthy(t0 + 59 * MINUTE)).toEqual({ ok: false, why: "mail" });
    expect(await healthy(t0 + 61 * MINUTE)).toEqual({ ok: true });
  });

  it("tells of errors, code-request floods and failed jobs from what this process noted", async () => {
    for (let i = 0; i < 4; i++) note("error", "/api/world/touch PostgresError 57P01", t0 - MINUTE);
    expect(await check("errors").run(t0)).toEqual([]);
    note("error", "/ TypeError", t0 - MINUTE);
    expect(await check("errors").run(t0)).toMatchObject([
      { key: "many", detail: "10 分钟内出错 5 次，最多的是：/api/world/touch PostgresError 57P01 ×4；/ TypeError ×1。" },
    ]);

    for (let i = 0; i < 29; i++) note("codeRefused", "ip-10min", t0 - MINUTE);
    expect(await check("codes").run(t0)).toEqual([]);
    note("codeRefused", "quota", t0 - MINUTE);
    expect(await check("codes").run(t0)).toMatchObject([
      { key: "flood", detail: "一小时内有 30 次要验证码被拦下（同一网络 10 分钟内太频繁 ×29；全站邮件额度用完 ×1）。" },
    ]);

    note("job", "flip", t0 - HOUR);
    note("job", "flip", t0 - MINUTE);
    expect(await check("jobs").run(t0)).toMatchObject([{ key: "flip", title: "定时任务「好久没来自动翻」出错了" }]);
    expect((await check("jobs").run(t0))[0].detail).toMatch(/^过去 24 小时出错 2 次，最近一次在 /);
  });

  it("reads how the nightly backup went from the record scripts/backup.sh writes", async () => {
    const backup = check("backup");
    const record = (value: string, at: number) =>
      db
        .insert(watchState)
        .values({ key: "backup", value, updatedAt: new Date(at) })
        .onConflictDoUpdate({ target: watchState.key, set: { value, updatedAt: new Date(at) } });

    // no record yet: a night's grace once the checks began
    expect(await backup.run(t0)).toEqual([]);
    await db.insert(watchState).values({ key: "since", value: "", updatedAt: new Date(t0 - 31 * HOUR) });
    expect(await backup.run(t0)).toMatchObject([{ key: "missing" }]);

    await record("failed upload", t0 - 2 * HOUR);
    expect((await backup.run(t0))[0]).toMatchObject({ key: "failed", title: "数据库备份失败了" });
    expect((await backup.run(t0))[0].detail).toContain("「上传到腾讯云 COS」");
    await record("ok zhoupmap-20261109-0400.sql.gz 12M local", t0 - 2 * HOUR);
    expect(await backup.run(t0)).toMatchObject([{ key: "local" }]);
    await record("ok zhoupmap-20261109-0400.sql.gz 12M cos", t0 - 27 * HOUR);
    expect(await backup.run(t0)).toMatchObject([{ key: "stale" }]);

    // the script's own statement, as it runs on the server
    const statement = readFileSync("scripts/backup.sh", "utf8").match(/"(insert into watch_state[\s\S]*?)"/)![1];
    await db.execute(sql.raw(statement.replace("'$1'", "'ok zhoupmap-20261110-0400.sql.gz 12M cos'")));
    expect(await backup.run(Date.now())).toEqual([]);
  });

  it("finds nothing wrong with this machine's disk, memory or processor during the tests", async () => {
    await expect(check("machine").run(t0)).resolves.toBeInstanceOf(Array);
    // no certificate to look at in development
    expect(await check("tls").run(t0)).toEqual([]);
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
    expect(recent("map", HOUR).map((s) => s.code)).toEqual(["amap:key:USER_DAILY_QUERY_OVER_LIMIT", "amap:load:scriptmeexample.com"]);
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
