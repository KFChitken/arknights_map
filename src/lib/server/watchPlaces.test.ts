import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isOffLimits, setExtraOffLimits } from "../offLimits";
import { EMPTY_PROFILE } from "../profile";
import type { LngLat } from "../types";
import { openCases, reportedPlaces, settleCase } from "./admin";
import type { Actor } from "./admins";
import { db } from "./db";
import { sendAdminMail } from "./mail";
import { sendReportDigest } from "./safety";
import { mailSends, moves, offLimitsAreas, reports, roaches, staffNotes, users, watchMails } from "./schema";
import { setWatchAreas, watchMarksDone, WATCH_QUIET_DAYS } from "./watchPlaces";
import * as world from "./world";
import { drawZone, liftZone, listZones, loadZones } from "./zones";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["admin@example.com"] }));
vi.mock("./mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));

// Runs against the database named in vitest.config.mts, which is wiped before every test

/** A made-up spot by a park in Chengdu, and spots m metres east of it */
const SPOT = { lng: 104.0657, lat: 30.6595 };
const east = (p: LngLat, m: number) => ({ lng: p.lng + m / (111_320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat });
const TOKYO = { lng: 139.7, lat: 35.68 };
const DAY = 86_400_000;

async function player(email: string, at?: LngLat) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  await world.saveProfile(u.id, { ...EMPTY_PROFILE, anonymous: false, name: email.split("@")[0], drPrefix: true });
  if (at) await world.placeRoach(u.id, { kind: "main" }, at);
  return u.id;
}
async function theOwner(): Promise<Actor> {
  return { id: await player("owner@example.com", TOKYO), alias: "站长", role: "owner" };
}
const marks = () => db.select().from(reports).where(isNull(reports.reporterId));
const mainOf = async (userId: string) => (await world.me(userId))!.roaches.find((r) => r.slot === 0)!;
/** Move a player's main roach, past the day's limit on moves */
const moveMain = async (userId: string, to: LngLat) => {
  await db.delete(moves).where(eq(moves.userId, userId));
  await world.placeRoach(userId, { kind: "move", roachId: (await mainOf(userId)).id }, to);
};
/** A 提醒区 round SPOT, drawn by the owner */
const watchHere = async (owner: Actor, radiusM = 200) => {
  const drawn = await drawZone(owner, { lng: SPOT.lng, lat: SPOT.lat, radiusM, label: "测试用的提醒区，一个编出来的地方", watch: true });
  return drawn as Extract<typeof drawn, { id: string }>;
};

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${reports}, ${offLimitsAreas}, ${mailSends}, ${watchMails} cascade`);
  setExtraOffLimits([]);
  setWatchAreas([]);
  vi.mocked(sendAdminMail).mockReset();
});

afterAll(() => {
  setExtraOffLimits([]);
  setWatchAreas([]);
});

describe("提醒区", () => {
  it("moves nobody as it is drawn, and reports each roach inside once, by the site", async () => {
    const owner = await theOwner();
    const a = await player("a@example.com", SPOT);
    const b = await player("b@example.com", TOKYO);
    await world.placeRoach(b, { kind: "clone" }, east(SPOT, 80));
    const far = await player("far@example.com", east(SPOT, 600));
    const before = await db.select().from(roaches);

    const drawn = await watchHere(owner);
    expect(drawn).toMatchObject({ done: true, count: 2, moved: 0, home: 0, watch: true, marked: 2 });
    // nobody moved, nobody told, and roaches may still be put there
    expect(await db.select().from(roaches)).toEqual(expect.arrayContaining(before));
    expect(await db.select().from(staffNotes)).toEqual([]);
    expect(isOffLimits(SPOT)).toBe(false);
    const got = await marks();
    expect(got.map((r) => [r.targetId, r.reason, r.watchAreaId, r.roachSlot]).sort()).toEqual(
      [
        [a, "place", drawn.id, 0],
        [b, "place", drawn.id, 1],
      ].sort(),
    );
    expect(got.find((r) => r.targetId === a)!.context).toBe("自动标记：放进了提醒区「测试用的提醒区，一个编出来的地方」（本体）");
    expect(got.some((r) => r.targetId === far)).toBe(false);
    // listed apart, with how often it reported
    const list = await listZones();
    expect(list.live.map((z) => [z.watch, z.marked, z.done])).toEqual([[true, 2, true]]);
  });

  it("lets a roach be put or moved in as anywhere, reports it after, once while open, not again for a while once handled", async () => {
    const owner = await theOwner();
    const { id } = await watchHere(owner);
    const a = await player("a@example.com", east(SPOT, 900));
    expect(await marks()).toEqual([]);

    // moved in: it stands where it was put, and the site reports it
    await moveMain(a, east(SPOT, 50));
    await watchMarksDone();
    expect((await mainOf(a)).lng).toBeCloseTo(east(SPOT, 50).lng, 9);
    expect((await marks()).map((r) => [r.reason, r.watchAreaId])).toEqual([["place", id]]);
    // moved again inside: still the one open report
    await moveMain(a, east(SPOT, -50));
    await watchMarksDone();
    expect(await marks()).toHaveLength(1);

    // handled: not again for WATCH_QUIET_DAYS
    await db.update(reports).set({ resolvedAt: new Date(), resolution: "dismissed" });
    await moveMain(a, east(SPOT, 900));
    await moveMain(a, east(SPOT, 30));
    await watchMarksDone();
    expect(await marks()).toHaveLength(1);
    await db.update(reports).set({ resolvedAt: new Date(Date.now() - (WATCH_QUIET_DAYS + 1) * DAY) });
    await moveMain(a, east(SPOT, -30));
    await watchMarksDone();
    expect(await marks()).toHaveLength(2);

    // a new clone outside: nothing; lifted: nothing more
    await world.placeRoach(a, { kind: "clone" }, east(SPOT, 900));
    await watchMarksDone();
    expect(await marks()).toHaveLength(2);
    await liftZone(owner, { id });
    await loadZones();
    await world.placeRoach(a, { kind: "clone" }, east(SPOT, 10));
    await watchMarksDone();
    expect(await marks()).toHaveLength(2);
  });

  it("emails the admins as an urgent report, shows in 待处理 as the site's, and settling it tells no player", async () => {
    const owner = await theOwner();
    await watchHere(owner);
    const a = await player("a@example.com", east(SPOT, 20));
    await watchMarksDone();
    await sendReportDigest();
    expect(vi.mocked(sendAdminMail).mock.calls.map(([, subject]) => subject)).toEqual([expect.stringContaining("要尽快看")]);

    const page = await openCases({}, Date.now(), owner);
    const theCase = page.cases.find((c) => c.kind === "roach" && c.reports.some((r) => r.watch !== undefined))!;
    expect(theCase).toMatchObject({ reporters: 0, reports: [{ reason: "place", reporter: null, watch: "测试用的提醒区，一个编出来的地方" }] });
    expect((await reportedPlaces(Date.now(), owner)).map((p) => [p.reporters, p.watch])).toEqual([[0, "测试用的提醒区，一个编出来的地方"]]);

    await settleCase(theCase.caseId, "dismiss", { by: owner });
    expect(await db.select().from(reports).where(and(isNull(reports.resolvedAt), eq(reports.targetId, a)))).toEqual([]);
    // no reporter to tell, and nobody's reports counted
    expect((await db.select().from(staffNotes)).filter((n) => n.kind === "reporter")).toEqual([]);
    expect((await db.select().from(users)).every((u) => u.reportsUpheld === 0 && u.reportsDismissed === 0)).toBe(true);
  });

  it("keeps 禁放区 as they were: refused, and counted apart from 提醒区", async () => {
    const owner = await theOwner();
    await watchHere(owner);
    const blocked = await drawZone(owner, { lng: TOKYO.lng + 0.5, lat: TOKYO.lat, radiusM: 100, label: "测试用的禁放区" });
    expect(blocked).toMatchObject({ done: true, moved: 0 });
    expect(isOffLimits({ lng: TOKYO.lng + 0.5, lat: TOKYO.lat })).toBe(true);
    expect(isOffLimits(SPOT)).toBe(false);
    const list = await listZones();
    expect(list.live.map((z) => z.watch).sort()).toEqual([false, true]);
  });
});
