import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminRoute } from "@/app/api/admin/[op]/route";
import { GET as sponsorRoute } from "@/app/api/sponsor/route";
import { LANG_HEADER } from "@/i18n/lang";
import { monthOf } from "../sponsor";
import { setBadge } from "./admin";
import { loadMods } from "./admins";
import { wear } from "./badges";
import { db } from "./db";
import { forgetHits } from "./rateLimit";
import { adminLog, admins, sessions, sponsorMonths, sponsorSettings, users } from "./schema";
import { forgetSponsor, KEEP_MS, sponsorCard, sponsorForAdmin, sponsorLedger, sponsorMe, sponsorOpen } from "./sponsor";
import { removeSponsorMonth, saveSponsorMonth, saveSponsorSettings, saveSponsorStartup } from "./sponsorAdmin";
import { totpCode, totpStep } from "./totp";
import { cardsOf, me, userById } from "./world";

// the routes read their cookie as any page does; here, the one this test signed in with
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
vi.mock("./mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));
vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

const LINK = "https://ifdian.net/a/someone";
const THIS_MONTH = monthOf();
const DAY = 86_400_000;

/** A player signed in on this device from now on */
async function signIn(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("base64url");
  await db.insert(sessions).values({ id, userId: u.id, expiresAt: new Date(Date.now() + 20 * DAY) });
  jar.token = token;
  return u;
}

async function admin(op: string, ...args: unknown[]) {
  const res = await adminRoute(
    new NextRequest(`http://localhost/api/admin/${op}`, {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }),
    { params: Promise.resolve({ op }) },
  );
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } };
}

/** The owner, with an authenticator set up and this device let in */
async function owner() {
  const u = await signIn("owner@example.com");
  const start = await admin("setupStart");
  const secret = String((start.body.result as { secret: string }).secret).replace(/\s/g, "");
  expect((await admin("setupConfirm", { code: totpCode(secret, totpStep(Date.now())) })).status).toBe(200);
  return u;
}

async function card(english = false) {
  const res = await sponsorRoute(new NextRequest("http://localhost/api/sponsor", { headers: english ? { [LANG_HEADER]: "en" } : {} }), undefined);
  return { status: res.status, cache: res.headers.get("cache-control"), body: (await res.json()) as { sponsor: Record<string, unknown> | null } };
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sponsorSettings}, ${sponsorMonths} cascade`);
  await loadMods();
  jar.token = null;
  forgetSponsor();
  forgetHits();
  // shown to everyone, as the tests below the first describe switch it
  vi.stubEnv("SPONSOR", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("支持舟P地图", () => {
  it("is off until the owner switches it on with an 爱发电 link", async () => {
    expect(await sponsorCard(null)).toBeNull();
    expect(await sponsorLedger(null)).toBeNull();
    expect(await sponsorForAdmin()).toEqual({
      enabled: false,
      afdian: "",
      kofi: "",
      shows: false,
      mode: "on",
      startup: { spent: 0, note: "", repaid: 0 },
      months: [],
    });
    expect((await card()).body).toEqual({ sponsor: null });

    await expect(saveSponsorSettings({ enabled: true, afdian: "" })).rejects.toThrow("先填好爱发电链接");
    // a link alone, switched off, is kept and shows nothing
    await saveSponsorSettings({ enabled: false, afdian: LINK });
    expect(await sponsorCard(null)).toBeNull();

    await saveSponsorSettings({ enabled: true, afdian: ` ${LINK} ` });
    expect(await sponsorCard(null)).toEqual({ afdian: LINK, kofi: null, month: null, repaying: false, looks: [] });
    expect(await sponsorForAdmin()).toMatchObject({ enabled: true, afdian: LINK, kofi: "", shows: true });
    expect(await db.$count(sponsorSettings)).toBe(1);

    // switched off again: gone at once
    await saveSponsorSettings({ enabled: false, afdian: LINK });
    expect(await sponsorCard(null)).toBeNull();
  });

  it("takes only plain https links, and a Ko-fi one besides when given", async () => {
    for (const bad of ["javascript:alert(1)", "http://ifdian.net/a/x", "ifdian.net/a/x", 42]) {
      await expect(saveSponsorSettings({ enabled: false, afdian: bad })).rejects.toThrow("爱发电链接要是 https://");
    }
    await expect(saveSponsorSettings({ enabled: false, afdian: LINK, kofi: "data:text/html,hi" })).rejects.toThrow("Ko-fi 链接");
    await saveSponsorSettings({ enabled: true, afdian: LINK, kofi: "https://ko-fi.com/someone" });
    expect(await sponsorCard(null)).toMatchObject({ afdian: LINK, kofi: "https://ko-fi.com/someone" });
    // anything but true leaves it off
    await saveSponsorSettings({ enabled: "yes", afdian: LINK });
    expect(await sponsorCard(null)).toBeNull();
  });

  it("keeps each month's accounts, changed or taken away by the month, and checks what is typed", async () => {
    await saveSponsorSettings({ enabled: true, afdian: LINK });
    await saveSponsorMonth({ month: "2026-10", spent: "1,500", received: "0", note: "  腾讯云一台  " });
    await saveSponsorMonth({ month: THIS_MONTH, spent: "2000", received: "320.5", note: "" });
    expect((await sponsorCard(null))?.month).toEqual({
      month: THIS_MONTH,
      spent: 200_000,
      received: 32_050,
      note: "",
      carried: 0,
      balance: -167_950,
      repaid: 0,
      current: true,
    });
    // entered again: changed, not added
    await saveSponsorMonth({ month: "2026-10", spent: "1500", received: "1800", note: "腾讯云一台" });
    const ledger = await sponsorLedger(null);
    expect(ledger?.months.map((m) => [m.month, m.carried, m.balance, m.note])).toEqual([
      [THIS_MONTH, 30_000, -137_950, ""],
      ["2026-10", 0, 30_000, "腾讯云一台"],
    ]);
    expect(ledger?.card.month).toMatchObject({ carried: 30_000 });

    for (const [bad, error] of [
      [{ month: "2026-13", spent: 1, received: 1 }, "月份要写成"],
      [{ month: "2026-11", spent: "-1", received: 1 }, "「花了」要填"],
      [{ month: "2026-11", spent: 1, received: "1.234" }, "「收到」要填"],
      [{ month: "2026-11", spent: 1, received: 1, note: "字".repeat(101) }, "最多 100 个字"],
    ] as const) {
      await expect(saveSponsorMonth(bad)).rejects.toThrow(error);
    }

    await removeSponsorMonth("2026-10");
    await expect(removeSponsorMonth("2026-10")).rejects.toThrow("没有这个月的账");
    await expect(removeSponsorMonth("'; drop table users; --")).rejects.toThrow("没有这个月的账");
    expect((await sponsorForAdmin()).months.map((m) => m.month)).toEqual([THIS_MONTH]);
  });

  it("pays back what starting the site cost from what the months leave over, before they carry it", async () => {
    // kept before anything else is, and the entry stays off
    await saveSponsorStartup({ spent: "100", note: "" });
    expect(await sponsorForAdmin()).toMatchObject({ enabled: false, afdian: "", shows: false, startup: { spent: 10_000, note: "", repaid: 0 } });
    expect(await sponsorLedger(null)).toBeNull();

    await saveSponsorSettings({ enabled: true, afdian: LINK });
    await saveSponsorStartup({ spent: "¥1,460", note: "  域名、服务器升级  " });
    expect((await sponsorLedger(null))?.startup).toEqual({ spent: 146_000, note: "域名、服务器升级", repaid: 0 });
    expect(await sponsorCard(null)).toMatchObject({ repaying: true });

    // it is no month: one that only pays its bills pays nothing of it back
    await saveSponsorMonth({ month: THIS_MONTH, spent: "3000", received: "3000" });
    expect((await sponsorCard(null))?.month).toMatchObject({ carried: 0, balance: 0, repaid: 0 });
    expect((await sponsorLedger(null))?.months.map((m) => m.month)).toEqual([THIS_MONTH]);

    // what a month leaves over goes there first, and only what is left after that is carried
    await saveSponsorMonth({ month: "2025-06", spent: "1000", received: "2000" });
    await saveSponsorMonth({ month: THIS_MONTH, spent: "3000", received: "3800" });
    const paid = await sponsorLedger(null);
    expect(paid?.months.map((m) => [m.month, m.carried, m.balance, m.repaid])).toEqual([
      [THIS_MONTH, 0, 80_000, 46_000],
      ["2025-06", 0, 100_000, 100_000],
    ]);
    expect(paid?.startup).toEqual({ spent: 146_000, note: "域名、服务器升级", repaid: 146_000 });
    expect(paid?.card).toMatchObject({ repaying: false, month: { month: THIS_MONTH, repaid: 46_000 } });

    // the switch and the links leave it alone, and it leaves them alone
    await saveSponsorSettings({ enabled: true, afdian: LINK, kofi: "https://ko-fi.com/someone" });
    expect((await sponsorForAdmin()).startup).toEqual({ spent: 146_000, note: "域名、服务器升级", repaid: 146_000 });
    await saveSponsorStartup({ spent: "1500", note: "域名" });
    expect(await sponsorForAdmin()).toMatchObject({
      enabled: true,
      afdian: LINK,
      kofi: "https://ko-fi.com/someone",
      startup: { spent: 150_000, note: "域名", repaid: 150_000 },
    });

    for (const [bad, error] of [
      [{ spent: "-1" }, "「开站花了」要填"],
      [{ spent: "" }, "「开站花了」要填"],
      [{ spent: "1", note: "字".repeat(101) }, "最多 100 个字"],
    ] as const) {
      await expect(saveSponsorStartup(bad)).rejects.toThrow(error);
    }
    expect((await sponsorForAdmin()).startup.spent).toBe(150_000);

    // 0 takes it off /support, and what was left over is carried instead
    await saveSponsorStartup({ spent: "0", note: "" });
    expect((await sponsorLedger(null))?.startup).toBeNull();
    expect(await sponsorCard(null)).toMatchObject({ repaying: false, month: { carried: 100_000, balance: 180_000, repaid: 0 } });
  });

  it("gives players a copy read at most every KEEP_MS, and the owner's own changes at once", async () => {
    const now = Date.now();
    await saveSponsorSettings({ enabled: true, afdian: LINK });
    expect(await sponsorCard(null, now)).not.toBeNull();
    // switched off by another process: this one sees it once its copy is old
    await db.update(sponsorSettings).set({ enabled: false });
    expect(await sponsorCard(null, now + KEEP_MS - 1)).not.toBeNull();
    expect(await sponsorCard(null, now + KEEP_MS)).toBeNull();
  });

  it("answers anyone with the card, only a signed-in player with their own email, and the English site never", async () => {
    await saveSponsorSettings({ enabled: true, afdian: LINK });
    const visitor = await card();
    expect(visitor).toMatchObject({ status: 200, cache: "private, no-store", body: { sponsor: { afdian: LINK, email: null } } });

    await signIn("me@example.com");
    expect((await card()).body.sponsor).toMatchObject({ afdian: LINK, email: "me@example.com" });
    // 爱发电 is only in Chinese: the English site has no entry for now
    expect(await card(true)).toMatchObject({ status: 200, cache: "private, no-store", body: { sponsor: null } });

    // and nothing at all while it is off, signed in or not
    await saveSponsorSettings({ enabled: false, afdian: LINK });
    expect((await card()).body).toEqual({ sponsor: null });
  });

  it("is kept in the 管理台 by the owner, each step in the 操作记录, and no one else may", async () => {
    await signIn("someone@example.com");
    for (const op of ["sponsor", "saveSponsor", "saveSponsorStartup", "saveSponsorMonth", "removeSponsorMonth"]) {
      expect((await admin(op, { enabled: true, afdian: LINK })).status, op).toBe(404);
    }
    expect(await sponsorCard(null)).toBeNull();

    const boss = await owner();
    expect((await admin("sponsor")).body.result).toMatchObject({ enabled: false, shows: false });
    expect((await admin("saveSponsor", { enabled: true, afdian: "" })).body).toMatchObject({ error: "先填好爱发电链接，再打开入口。" });
    expect((await admin("saveSponsor", { enabled: true, afdian: LINK, kofi: "" })).body.result).toMatchObject({ enabled: true, shows: true });
    // saved again as it is: nothing changed, nothing logged
    await admin("saveSponsor", { enabled: true, afdian: LINK, kofi: "" });
    expect((await admin("saveSponsorStartup", { spent: "1460", note: "域名" })).body.result).toMatchObject({
      startup: { spent: 146_000, note: "域名" },
    });
    expect((await admin("saveSponsorMonth", { month: "2026-11", spent: "100", received: "25" })).body.result).toMatchObject({
      months: [{ month: "2026-11", spent: 10_000, received: 2_500 }],
    });
    await admin("saveSponsorMonth", { month: "2026-11", spent: "100", received: "30" });
    expect((await admin("removeSponsorMonth", "2026-11")).body.result).toMatchObject({ months: [] });
    await admin("saveSponsor", { enabled: false, afdian: LINK, kofi: "https://ko-fi.com/someone" });

    const lines = await db
      .select({ detail: adminLog.detail })
      .from(adminLog)
      .where(and(eq(adminLog.actorId, boss.id), eq(adminLog.what, "act.sponsor")))
      .orderBy(adminLog.id);
    expect(lines.map((l) => l.detail)).toEqual([
      "打开了赞助入口，改了赞助链接",
      "开站花费记成 ¥1,460",
      "记了 2026 年 11 月的账：花了 ¥100，收到 ¥25",
      "改了 2026 年 11 月的账：花了 ¥100，收到 ¥30",
      "删了 2026 年 11 月的账",
      "关掉了赞助入口，改了赞助链接",
    ]);
  });
});

describe("whom SPONSOR shows 支持舟P地图 to", () => {
  /** A player made a moderator, as the 管理台 does */
  async function mod(email: string) {
    const u = await signIn(email);
    await db.insert(admins).values({ userId: u.id, role: "mod", alias: "小管" });
    await loadMods();
    return u;
  }

  it("is everyone when on, the 站长 and the admins when admins, and nobody when off", async () => {
    const boss = await signIn("owner@example.com");
    const helper = await mod("mod@example.com");
    const someone = await signIn("someone@example.com");
    const all = [boss, helper, someone, null];

    expect(all.map((u) => sponsorOpen(u))).toEqual([true, true, true, true]);
    vi.stubEnv("SPONSOR", "admins");
    expect(all.map((u) => sponsorOpen(u))).toEqual([true, true, false, false]);
    vi.stubEnv("SPONSOR", "off");
    expect(all.map((u) => sponsorOpen(u))).toEqual([false, false, false, false]);
    vi.stubEnv("SPONSOR", "");
    expect(sponsorOpen(boss)).toBe(false);
  });

  it("lists 鸭爵 among the thanks only to those DUCK shows him to", async () => {
    const boss = await signIn("owner@example.com");
    const helper = await mod("mod@example.com");
    const someone = await signIn("someone@example.com");
    await saveSponsorSettings({ enabled: true, afdian: LINK });
    const looks = async () => Promise.all([boss, helper, someone, null].map(async (u) => (await sponsorCard(u))?.looks));
    expect(await looks()).toEqual([[], [], [], []]);
    vi.stubEnv("DUCK", "admins");
    expect(await looks()).toEqual([["duck"], ["duck"], [], []]);
    vi.stubEnv("DUCK", "on");
    expect(await looks()).toEqual([["duck"], ["duck"], ["duck"], ["duck"]]);
  });

  it("draws 鸭爵 on cards between the 站长 and the admins alone while DUCK is admins", async () => {
    const boss = await signIn("owner@example.com");
    const helper = await mod("mod@example.com");
    const someone = await signIn("someone@example.com");
    // all three in him, as the database keeps him whatever DUCK says (someone, say, from a 服务器饲养员 once theirs)
    await db.update(users).set({ avatar: "duck" }).where(inArray(users.id, [boss.id, helper.id, someone.id]));
    const people = await Promise.all([boss, helper, someone].map(async (u) => (await userById(u.id))!));
    const seen = async () =>
      Promise.all([boss, helper, someone, null].map(async (v) => [...(await cardsOf(people, v?.id ?? null)).values()].map((c) => c.avatar)));
    const hoods = ["hood", "hood", "hood"];
    expect(await seen()).toEqual([hoods, hoods, hoods, hoods]);
    // the 站长 (known by the email alone) and the admin see each other in him; one in him who is no admin is the hood to all
    vi.stubEnv("DUCK", "admins");
    expect(await seen()).toEqual([["duck", "duck", "hood"], ["duck", "duck", "hood"], hoods, hoods]);
    vi.stubEnv("DUCK", "on");
    const ducks = ["duck", "duck", "duck"];
    expect(await seen()).toEqual([ducks, ducks, ducks, ducks]);
  });

  it("answers the card and /support as if nothing were there to anyone it is not shown to, and tells the owner whom it is shown to", async () => {
    const someone = await signIn("someone@example.com");
    const boss = await owner();
    const bossToken = jar.token;
    expect((await admin("saveSponsor", { enabled: true, afdian: LINK, kofi: "" })).status).toBe(200);

    vi.stubEnv("SPONSOR", "admins");
    expect((await admin("sponsor")).body.result).toMatchObject({ shows: true, mode: "admins" });
    expect((await card()).body.sponsor).toMatchObject({ afdian: LINK, email: "owner@example.com" });
    expect(await sponsorLedger(boss)).not.toBeNull();
    // a player, signed in, and a visitor
    expect(await sponsorLedger(someone)).toBeNull();
    expect(await sponsorLedger(null)).toBeNull();
    jar.token = null;
    expect((await card()).body).toEqual({ sponsor: null });

    vi.stubEnv("SPONSOR", "off");
    jar.token = bossToken;
    expect((await card()).body).toEqual({ sponsor: null });
    expect(await sponsorLedger(boss)).toBeNull();
    // what the owner keeps stays, whichever it is
    expect((await admin("sponsor")).body.result).toMatchObject({ enabled: true, afdian: LINK, shows: true, mode: "off" });

    vi.stubEnv("SPONSOR", "on");
    expect(await sponsorLedger(someone)).not.toBeNull();
    jar.token = null;
    expect((await card()).body.sponsor).toMatchObject({ afdian: LINK, email: null });
  });

  it("puts its button on the map for those it is shown to, only while the owner has it on with an 爱发电 link", async () => {
    const someone = await signIn("someone@example.com");
    const boss = await owner();
    const button = async (u: { id: string }) => (await me(u.id))?.sponsor;

    expect([await button(boss), await button(someone)]).toEqual([undefined, undefined]);
    expect((await admin("saveSponsor", { enabled: true, afdian: LINK, kofi: "" })).status).toBe(200);
    expect([await button(boss), await button(someone)]).toEqual([true, true]);
    vi.stubEnv("SPONSOR", "admins");
    expect([await button(boss), await button(someone)]).toEqual([true, undefined]);
    vi.stubEnv("SPONSOR", "off");
    expect([await button(boss), await button(someone)]).toEqual([undefined, undefined]);

    vi.stubEnv("SPONSOR", "on");
    expect((await admin("saveSponsor", { enabled: false, afdian: LINK, kofi: "" })).status).toBe(200);
    expect([await button(boss), await button(someone)]).toEqual([undefined, undefined]);
    // a settings read that fails leaves the button out, not the player's page
    expect((await admin("saveSponsor", { enabled: true, afdian: LINK, kofi: "" })).status).toBe(200);
    forgetSponsor();
    const read = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("down");
    });
    expect(await sponsorMe(someone)).toBeUndefined();
    read.mockRestore();
    forgetSponsor();
    expect(await button(someone)).toBe(true);
  });

  it("shows the thanks only to those it is shown to, on anyone's card and on their own, and gives them only to them", async () => {
    const boss = await signIn("owner@example.com");
    const helper = await mod("mod@example.com");
    const someone = await signIn("someone@example.com");
    const ids = (badges: { id: string }[] | undefined) => (badges ?? []).map((b) => b.id);
    const bossCard = async (viewer: string | null) => (await cardsOf([(await userById(boss.id))!], viewer)).get(boss.id);

    vi.stubEnv("SPONSOR", "admins");
    await setBadge("owner@example.com", "feeder", true);
    await expect(setBadge("someone@example.com", "feeder", true)).rejects.toThrow("SPONSOR 是 admins");
    expect(await wear(boss.id, "feeder")).toBe(true);
    for (const viewer of [boss.id, helper.id]) expect(await bossCard(viewer)).toMatchObject({ worn: "feeder" });
    expect(ids((await bossCard(helper.id))?.badges)).toContain("feeder");
    for (const viewer of [someone.id, null]) {
      const shown = await bossCard(viewer);
      expect(ids(shown?.badges)).not.toContain("feeder");
      expect(shown?.worn).toBeNull();
    }
    expect(ids((await me(boss.id))?.badges)).toContain("feeder");

    // off: nobody sees them, the one who holds them neither, and they are given to no one
    vi.stubEnv("SPONSOR", "off");
    expect(ids((await bossCard(helper.id))?.badges)).not.toContain("feeder");
    const mine = await me(boss.id);
    expect(ids(mine?.badges)).not.toContain("feeder");
    expect(mine?.wornBadge).toBeNull();
    await expect(setBadge("owner@example.com", "volt", true)).rejects.toThrow("SPONSOR 是 off");

    // on: everyone, visitors too, and given to anyone; taken back whichever it is
    vi.stubEnv("SPONSOR", "on");
    for (const viewer of [someone.id, null]) expect(await bossCard(viewer)).toMatchObject({ worn: "feeder" });
    await setBadge("someone@example.com", "feeder", true);
    expect(ids((await me(someone.id))?.badges)).toContain("feeder");
    vi.stubEnv("SPONSOR", "off");
    await setBadge("someone@example.com", "feeder", false);
    await setBadge("owner@example.com", "feeder", false);
  });
});
