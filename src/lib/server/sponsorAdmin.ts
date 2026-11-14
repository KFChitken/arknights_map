import "server-only";
import { eq } from "drizzle-orm";
import { isMonth, monthWords, parseYuan, SPONSOR_NOTE_MAX, SPONSOR_YUAN_MAX, sponsorLink, yuan } from "../sponsor";
import { logAdmin, type Actor } from "./admins";
import { db } from "./db";
import { HttpError } from "./http";
import { sponsorMonths, sponsorSettings } from "./schema";
import { forgetSponsor, sponsorForAdmin } from "./sponsor";

/**
 * 支持舟P地图 in the 管理台 (src/components/admin/Sponsor.tsx), the owner's alone: the switch and the links,
 * what starting the site cost, and each month's accounts. Each step answers with all of it as it now stands
 * (sponsorForAdmin), and goes into the 操作记录 when it changed something.
 */

/** What a sum the owner typed has to be, after the name of the box */
const SUM = `要填 0 到 ${SPONSOR_YUAN_MAX.toLocaleString("zh-CN")} 之间的数，最多两位小数，比如 1234 或 32.5。`;

const fields = (input: unknown) => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});

const note = (input: unknown) => {
  const s = String(input ?? "").trim();
  if (s.length > SPONSOR_NOTE_MAX) throw new HttpError(400, `「花在哪」最多 ${SPONSOR_NOTE_MAX} 个字。`);
  return s;
};

async function logged(by: Actor | null, detail: string, now: number) {
  if (by) await logAdmin(by, "act", "act.sponsor", { detail }, now);
}

/** The switch and the links: { enabled, afdian, kofi } */
export async function saveSponsorSettings(input: unknown, by: Actor | null = null, now = Date.now()) {
  const f = fields(input);
  const enabled = f.enabled === true;
  const afdian = sponsorLink(f.afdian);
  const kofi = sponsorLink(f.kofi);
  if (afdian === null) throw new HttpError(400, "爱发电链接要是 https:// 开头的完整网址。");
  if (kofi === null) throw new HttpError(400, "Ko-fi 链接要是 https:// 开头的完整网址。");
  if (enabled && !afdian) throw new HttpError(400, "先填好爱发电链接，再打开入口。");
  const [was] = await db.select().from(sponsorSettings).where(eq(sponsorSettings.id, 1)).limit(1);
  const set = { enabled, afdian, kofi, updatedAt: new Date(now) };
  await db
    .insert(sponsorSettings)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: sponsorSettings.id, set });
  forgetSponsor();
  const done = [
    enabled !== (was?.enabled ?? false) ? (enabled ? "打开了赞助入口" : "关掉了赞助入口") : "",
    afdian !== (was?.afdian ?? "") || kofi !== (was?.kofi ?? "") ? "改了赞助链接" : "",
  ].filter(Boolean);
  if (done.length) await logged(by, done.join("，"), now);
  return sponsorForAdmin();
}

/** What starting the site cost, and what it went on: { spent (yuan, as typed), note }; 0 takes it off /support */
export async function saveSponsorStartup(input: unknown, by: Actor | null = null, now = Date.now()) {
  const f = fields(input);
  const spent = parseYuan(f.spent);
  if (spent === null) throw new HttpError(400, `「开站花了」${SUM}`);
  const set = { startupFen: spent, startupNote: note(f.note), updatedAt: new Date(now) };
  await db
    .insert(sponsorSettings)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: sponsorSettings.id, set });
  forgetSponsor();
  await logged(by, spent ? `开站花费记成 ${yuan(spent)}` : "去掉了开站花费", now);
  return sponsorForAdmin();
}

/** A month's accounts, entered or changed: { month: "2026-11", spent, received (yuan, as typed), note } */
export async function saveSponsorMonth(input: unknown, by: Actor | null = null, now = Date.now()) {
  const f = fields(input);
  if (!isMonth(f.month)) throw new HttpError(400, "月份要写成 2026-11 这样。");
  const spent = parseYuan(f.spent);
  const received = parseYuan(f.received);
  if (spent === null) throw new HttpError(400, `「花了」${SUM}`);
  if (received === null) throw new HttpError(400, `「收到」${SUM}`);
  const set = { spentFen: spent, receivedFen: received, note: note(f.note), updatedAt: new Date(now) };
  const [was] = await db.select({ month: sponsorMonths.month }).from(sponsorMonths).where(eq(sponsorMonths.month, f.month)).limit(1);
  await db
    .insert(sponsorMonths)
    .values({ month: f.month, ...set })
    .onConflictDoUpdate({ target: sponsorMonths.month, set });
  forgetSponsor();
  await logged(by, `${was ? "改了" : "记了"} ${monthWords(f.month)}的账：花了 ${yuan(spent)}，收到 ${yuan(received)}`, now);
  return sponsorForAdmin();
}

/** A month entered by mistake */
export async function removeSponsorMonth(month: unknown, by: Actor | null = null, now = Date.now()) {
  const gone = isMonth(month)
    ? await db.delete(sponsorMonths).where(eq(sponsorMonths.month, month)).returning({ month: sponsorMonths.month })
    : [];
  if (!gone.length) throw new HttpError(400, "没有这个月的账。");
  forgetSponsor();
  await logged(by, `删了 ${monthWords(gone[0].month)}的账`, now);
  return sponsorForAdmin();
}
