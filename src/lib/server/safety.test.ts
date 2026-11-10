import { eq, isNotNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminCounts } from "./admin";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { sendAdminMail } from "./mail";
import { mailRoom } from "./mailQuota";
import { sendReportDigest } from "./safety";
import { mailSends, reports, users } from "./schema";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["admin@example.com"] }));
vi.mock("./mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));

const MINUTE = 60_000;

async function fileReport(reason = "spam") {
  const [u] = await db.insert(users).values({}).returning({ id: users.id });
  await db.insert(reports).values({ targetId: u.id, reason, context: "测试", targetName: "测试" });
}

const mails = () => vi.mocked(sendAdminMail).mock.calls.map(([, subject, text]) => ({ subject, text }));

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${reports}, ${mailSends} cascade`);
  vi.mocked(sendAdminMail).mockReset();
});

describe("report reminders", () => {
  it("email the admins once a day, and only about reports they have not heard of", async () => {
    await sendReportDigest();
    expect(sendAdminMail).not.toHaveBeenCalled();

    await fileReport("name");
    await fileReport();
    await sendReportDigest();
    expect(mails()).toEqual([
      { subject: "舟P地图有 2 条新举报", text: expect.stringContaining("有 2 条新举报等你处理（一共 2 条没处理）。\n名字不合适 1 条、骚扰刷屏 1 条") },
    ]);

    await fileReport();
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(1);

    // a day later the one waiting goes out
    await sendReportDigest(new Date(Date.now() + 24 * 60 * MINUTE + MINUTE));
    expect(sendAdminMail).toHaveBeenCalledTimes(2);
    expect(mails()[1].text).toContain("一共 3 条没处理");
  });

  it("go out on a day the login codes used up MAIL_DAILY_LIMIT, and never count against it", async () => {
    await db.insert(mailSends).values(Array.from({ length: MAIL_DAILY_LIMIT }, () => ({ kind: "login" })));
    await fileReport();
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(1);

    // one login code fewer: room for one more, the reminder's row notwithstanding
    await db.execute(sql`delete from ${mailSends} where ${mailSends.id} = (select min(${mailSends.id}) from ${mailSends} where ${mailSends.kind} = 'login')`);
    expect(await db.transaction((tx) => mailRoom(tx, new Date()))).toBe(true);
  });

  it("send an urgent one on top for minors and contact details, half an hour apart and 12 a day at most", async () => {
    const t0 = Date.now();
    const at = (minutes: number) => new Date(t0 + minutes * MINUTE);
    await fileReport();
    await sendReportDigest(at(0));
    expect(mails()).toHaveLength(1);

    // the day's reminder went out: an urgent report still does, with what else came meanwhile
    await fileReport("name");
    await fileReport("minor");
    await sendReportDigest(at(1));
    expect(mails()[1]).toEqual({
      subject: "舟P地图：有 1 条举报要尽快看",
      text: expect.stringContaining("可能未成年 1 条\n另外还有 1 条新举报：名字不合适 1 条\n一共 3 条没处理。"),
    });

    // not again within half an hour, then at the next look after it
    await fileReport("contact");
    await sendReportDigest(at(20));
    expect(mails()).toHaveLength(2);
    await sendReportDigest(at(31));
    expect(mails()).toHaveLength(3);
    expect(mails()[2].text).toMatch(/^留了联系方式或个人信息 1 条\n/);

    // 12 urgent ones in a day are all there are: 2 so far, and 10 more
    await db.insert(mailSends).values(Array.from({ length: 10 }, (_, i) => ({ kind: "report-urgent", sentAt: at(40 + i * 31) })));
    await fileReport("minor");
    await sendReportDigest(at(40 + 10 * 31));
    expect(mails()).toHaveLength(3);
  });

  it("make the first of a day the day's reminder too, so a plain one does not follow straight after", async () => {
    const t0 = Date.now();
    await fileReport("contact");
    await sendReportDigest(new Date(t0));
    expect(mails()[0].subject).toBe("舟P地图：有 1 条举报要尽快看");
    await fileReport();
    await sendReportDigest(new Date(t0 + 5 * MINUTE));
    expect(mails()).toHaveLength(1);
    expect((await db.select({ kind: mailSends.kind }).from(mailSends)).map((m) => m.kind).sort()).toEqual(["report", "report-urgent"]);
  });

  it("try again later when the email could not go out", async () => {
    vi.mocked(sendAdminMail).mockRejectedValueOnce(new Error("mail server down"));
    await fileReport("minor");
    await expect(sendReportDigest()).rejects.toThrow("mail server down");
    expect(await db.$count(mailSends)).toBe(0);
    expect(await db.$count(reports, isNotNull(reports.notifiedAt))).toBe(0);

    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(2);
    expect(await db.$count(reports, isNotNull(reports.notifiedAt))).toBe(1);
  });
});

describe("the admin's corner of the map", () => {
  it("counts open reports and the urgent ones for the admin only", async () => {
    const [admin] = await db.insert(users).values({ email: "admin@example.com" }).returning();
    const [player] = await db.insert(users).values({ email: "player@example.com" }).returning();
    expect(await adminCounts(admin)).toEqual({ open: 0, urgent: 0 });
    await fileReport();
    await fileReport("minor");
    await fileReport("contact");
    await db.update(reports).set({ resolvedAt: new Date() }).where(eq(reports.reason, "contact"));
    expect(await adminCounts(admin)).toEqual({ open: 2, urgent: 1 });
    expect(await adminCounts(player)).toBeUndefined();
    expect(await adminCounts(null)).toBeUndefined();
  });
});
