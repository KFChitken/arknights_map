import { eq, isNotNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminCounts } from "./admin";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { sendAdminMail } from "./mail";
import { forgetMailCount, mailRoom } from "./mailQuota";
import { sendReportDigest } from "./safety";
import { mailSends, modActions, reports, users, watchMails } from "./schema";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["admin@example.com"] }));
vi.mock("./mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));

const MINUTE = 60_000;

async function fileReport(reason = "spam") {
  const [u] = await db.insert(users).values({}).returning({ id: users.id });
  await db.insert(reports).values({ targetId: u.id, reason, context: "测试", targetName: "测试" });
}

const mails = () => vi.mocked(sendAdminMail).mock.calls.map(([, subject, text]) => ({ subject, text }));

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${reports}, ${mailSends}, ${watchMails} cascade`);
  vi.mocked(sendAdminMail).mockReset();
});

describe("report reminders", () => {
  it("email the admins at once only about reports of a minor or of contact details; the rest wait for the digest", async () => {
    await sendReportDigest();
    await fileReport("name");
    await fileReport();
    await sendReportDigest();
    expect(sendAdminMail).not.toHaveBeenCalled();

    await fileReport("contact");
    await sendReportDigest();
    expect(mails()).toEqual([
      {
        subject: "舟P地图：有 1 条举报要尽快看",
        text: expect.stringContaining("留了联系方式或个人信息 1 条\n另外还有 2 条新举报：名字不合适 1 条、骚扰刷屏 1 条\n一共 3 条没处理。"),
      },
    ]);
    // listed with the checks' emails on the admin page
    expect(await db.select({ kind: watchMails.kind, subject: watchMails.subject }).from(watchMails)).toEqual([
      { kind: "report", subject: "舟P地图：有 1 条举报要尽快看" },
    ]);
  });

  it("go out on a day the login codes used up MAIL_DAILY_LIMIT, and never count against it", async () => {
    await db.insert(mailSends).values(Array.from({ length: MAIL_DAILY_LIMIT }, () => ({ kind: "login" })));
    await fileReport("minor");
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(1);

    // one login code fewer: room for one more, the reminder's row notwithstanding
    await db.execute(sql`delete from ${mailSends} where ${mailSends.id} = (select min(${mailSends.id}) from ${mailSends} where ${mailSends.kind} = 'login')`);
    forgetMailCount();
    expect(await mailRoom(new Date())).toBe(true);
  });

  it("go half an hour apart at least, and 12 a day at most", async () => {
    const t0 = Date.now();
    const at = (minutes: number) => new Date(t0 + minutes * MINUTE);
    await fileReport("minor");
    await sendReportDigest(at(0));
    expect(mails()).toHaveLength(1);

    // not again within half an hour, then at the next look after it
    await fileReport("contact");
    await sendReportDigest(at(20));
    expect(mails()).toHaveLength(1);
    await sendReportDigest(at(31));
    expect(mails()).toHaveLength(2);
    expect(mails()[1].text).toMatch(/^留了联系方式或个人信息 1 条\n/);

    // 12 in a day are all there are: 2 so far, and 10 more
    await db.insert(mailSends).values(Array.from({ length: 10 }, (_, i) => ({ kind: "report-urgent", sentAt: at(40 + i * 31) })));
    await fileReport("minor");
    await sendReportDigest(at(40 + 10 * 31));
    expect(mails()).toHaveLength(2);
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
  it("counts open reports, the urgent ones and appeals waiting, for the admin only", async () => {
    const [admin] = await db.insert(users).values({ email: "admin@example.com" }).returning();
    const [player] = await db.insert(users).values({ email: "player@example.com" }).returning();
    expect(await adminCounts(admin)).toEqual({ open: 0, urgent: 0, appeals: 0 });
    await fileReport();
    await fileReport("minor");
    await fileReport("contact");
    await db.update(reports).set({ resolvedAt: new Date() }).where(eq(reports.reason, "contact"));
    // a roach's spot reported: urgent too
    await fileReport("place");
    await db.insert(modActions).values([
      { userId: player.id, action: "warn", appeal: "错了", appealedAt: new Date() },
      { userId: player.id, action: "warn", appeal: "也错了", appealedAt: new Date(), answeredAt: new Date() },
    ]);
    expect(await adminCounts(admin)).toEqual({ open: 3, urgent: 2, appeals: 1 });
    expect(await adminCounts(player)).toBeUndefined();
    expect(await adminCounts(null)).toBeUndefined();
  });
});
