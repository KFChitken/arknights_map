import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { sendAdminMail } from "./mail";
import { sendReportDigest } from "./safety";
import { mailSends, reports, users } from "./schema";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["admin@example.com"] }));
vi.mock("./mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));

async function fileReport() {
  const [u] = await db.insert(users).values({}).returning({ id: users.id });
  await db.insert(reports).values({ targetId: u.id, reason: "spam", context: "测试", targetName: "测试" });
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${reports}, ${mailSends} cascade`);
  vi.mocked(sendAdminMail).mockClear();
});

describe("report digest", () => {
  it("emails the admins at most once a day, and only about reports they have not heard of", async () => {
    await sendReportDigest();
    expect(sendAdminMail).not.toHaveBeenCalled();

    await fileReport();
    await fileReport();
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAdminMail).mock.calls[0][1]).toContain("2 条新举报");

    await fileReport();
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(1);

    // a day later the one waiting goes out
    await db.update(mailSends).set({ sentAt: sql`${mailSends.sentAt} - interval '1 day 1 minute'` });
    await sendReportDigest();
    expect(sendAdminMail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendAdminMail).mock.calls[1][2]).toContain("一共 3 条没处理");
    expect(await db.$count(mailSends)).toBe(1);
  });
});
