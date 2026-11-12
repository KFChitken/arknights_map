import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZONE_RADIUS_WRONG } from "../adminConsole";
import { AMIYA_AT } from "../amiya";
import { distanceKm } from "../geo";
import { ROUTE } from "../minghe";
import { isOffLimits, OFF_LIMITS, offLimitsMessage, setExtraOffLimits } from "../offLimits";
import { EMPTY_PROFILE } from "../profile";
import { FIRE_AT } from "../talulah";
import type { LngLat } from "../types";
import type { Actor } from "./admins";
import { db, pg } from "./db";
import { hearOthers } from "./live";
import { pruneOldActivity } from "./retention";
import { adminLog, modActions, moves, offLimitsAreas, roaches, staffNotes, users, visits } from "./schema";
import { OFF_LIMITS_WORDS } from "./staffNotes";
import * as world from "./world";
import { drawZone, finishZones, liftZone, listZones, loadZones, previewZone, UNFINISHED_AFTER_MS, zoneMovesDone, zoneSpot } from "./zones";

// Runs against the database named in vitest.config.mts, which is wiped before every test

/** 人民公园, Chengdu: no place of the code's near, 明河都尉's 成都 station 2 km off */
const PARK = { lng: 104.0657, lat: 30.6595 };
const TOKYO = { lng: 139.7, lat: 35.68 };
const DAY = 86_400_000;

const metres = (a: LngLat, b: LngLat) => distanceKm(a, b) * 1000;
/** A spot m metres east of p */
const east = (p: LngLat, m: number) => ({ lng: p.lng + m / (111_320 * Math.cos((p.lat * Math.PI) / 180)), lat: p.lat });

/** A player who ticked everything, with a name, a main roach where given */
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

/** A roach standing somewhere, put there behind the rules' back */
async function standing(userId: string, slot: number, at: LngLat, more: Partial<typeof roaches.$inferInsert> = {}) {
  const [r] = await db.insert(roaches).values({ userId, slot, lng: at.lng, lat: at.lat, ...more }).returning();
  return r;
}

const roachOf = async (id: string) => (await db.select().from(roaches).where(eq(roaches.id, id)))[0];
const notesOf = async (userId: string) => (await db.select().from(staffNotes).where(eq(staffNotes.userId, userId))).map((n) => [n.kind, n.reason]);
const mainOf = async (userId: string) => (await world.me(userId))!.roaches.find((r) => r.slot === 0)!;
const zoneRows = () => db.select().from(offLimitsAreas);

/** The owner, as the 管理台 knows them */
async function theOwner(): Promise<Actor> {
  return { id: await player("owner@example.com", east(PARK, 50)), alias: "站长", role: "owner" };
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  setExtraOffLimits([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  setExtraOffLimits([]);
});

describe("圈禁放区", () => {
  it("moves the roaches inside just outside, sends visiting clones home, leaves 明河都尉's riders, and tells each owner once", async () => {
    const boss = await theOwner();
    const a = await player("a@example.com", PARK);
    const aClone = await standing(a, 1, TOKYO);
    const c = await player("c@example.com", east(PARK, -120));
    // B's clone visits C's roach, from Tokyo
    const b = await player("b@example.com", TOKYO);
    const bClone = await standing(b, 1, east(PARK, -110));
    const cMain = await mainOf(c);
    await db.insert(visits).values({ roachId: bClone.id, guestId: b, hostId: c, hostRoachId: cMain.id, fromLng: TOKYO.lng + 0.01, fromLat: TOKYO.lat });
    // a rider of 明河都尉's stopping here today
    const r = await player("r@example.com");
    const rider = await standing(r, 0, east(PARK, 30), { rideSince: new Date(), rideStartDay: 1, rideDay: 1, rideFromLng: TOKYO.lng, rideFromLat: TOKYO.lat });
    const before = {
      a: await mainOf(a),
      boss: await mainOf(boss.id),
      movesLeft: (await world.me(a))!.movesLeft,
      moves: (await db.select().from(moves)).length,
    };

    const drawn = await drawZone(boss, { lng: PARK.lng, lat: PARK.lat, radiusM: 500, label: "  人民公园（有人举报）  " });
    expect(drawn).toEqual({ id: expect.any(String), done: true, count: 5, moved: 3, home: 1, owners: 4 });

    // A's, C's and the owner's own main roaches: just outside, 60 to 300 m past the edge, under new public ids
    for (const id of [before.a.id, cMain.id, before.boss.id]) {
      const now = await roachOf(id);
      expect(isOffLimits(now)).toBe(false);
      expect(metres(now, PARK)).toBeGreaterThan(500);
      expect(metres(now, PARK)).toBeLessThan(500 + 320);
    }
    expect((await roachOf(before.a.id)).publicId).not.toBe(before.a.publicId);
    // B's clone went home; A's clone far away and the rider stay as they were
    expect(metres(await roachOf(bClone.id), { lng: TOKYO.lng + 0.01, lat: TOKYO.lat })).toBeLessThan(1);
    expect(await db.select().from(visits)).toEqual([]);
    expect(await roachOf(aClone.id)).toEqual(aClone);
    expect(await roachOf(rider.id)).toEqual(rider);
    // not the players' own moves, and no yellow card for anyone: one 站长通知 each, the owner's own too
    expect(await db.select().from(moves)).toHaveLength(before.moves);
    expect((await world.me(a))!.movesLeft).toBe(before.movesLeft);
    expect(await db.select().from(modActions)).toEqual([]);
    for (const id of [a, c, boss.id]) expect(await notesOf(id)).toEqual([["offLimits", "moved"]]);
    expect(await notesOf(b)).toEqual([["offLimits", "home"]]);
    expect((await world.inbox(b)).find((i) => i.kind === "staff")).toMatchObject({ text: OFF_LIMITS_WORDS.home });
    expect(await notesOf(r)).toEqual([]);

    // counted on its row, its label as written, and in the 操作记录
    const [row] = await zoneRows();
    expect(row).toMatchObject({ label: "人民公园（有人举报）", radiusM: 500, createdBy: boss.id, moved: 3, sentHome: 1, liftedAt: null });
    expect(row.movedAt).not.toBeNull();
    expect((await db.select().from(adminLog)).map((l) => [l.what, l.detail])).toEqual([["act.zone", "人民公园（有人举报） · 半径 500 米 · 挪走 4 只"]]);

    // nobody may put a roach in, nor move one in, and it counts nothing
    await expect(world.placeRoach(a, { kind: "clone" }, PARK)).rejects.toThrow(offLimitsMessage());
    await expect(world.placeRoach(a, { kind: "move", roachId: before.a.id }, east(PARK, 100))).rejects.toThrow(offLimitsMessage());
    expect((await world.me(a))!.movesLeft).toBe(before.movesLeft);
    // right outside is fine
    await world.placeRoach(a, { kind: "clone" }, east(PARK, 520));
  });

  it("asks again before moving more than 300, keeping nothing till then, and says when the moving goes on after the answer", async () => {
    const boss = await theOwner();
    const ids = (await db.execute(sql`insert into users (email) select 'u' || i || '@example.com' from generate_series(1, 61) i returning id`)) as unknown as { id: string }[];
    await db.execute(sql`
      insert into roaches (user_id, slot, lng, lat)
      select u.id, s, ${PARK.lng} + (s - 2) * 0.0005, ${PARK.lat} + 0.0001 * ((row_number() over ()) % 7)
      from users u cross join generate_series(0, 4) s
      where u.id in (${sql.join(ids.map((u) => sql`${u.id}::uuid`), sql`, `)})`);
    const circle = { lng: PARK.lng, lat: PARK.lat, radiusM: 400 };

    // the owner's own counted in too, however many
    expect(await previewZone(circle)).toEqual({ count: 306, owners: 62, warnings: [] });
    expect(await drawZone(boss, { ...circle, label: "很多" })).toEqual({ needSure: true, count: 306 });
    expect(await zoneRows()).toEqual([]);
    expect(await db.select().from(adminLog)).toEqual([]);

    const drawn = await drawZone(boss, { ...circle, label: "很多", sure: true }, Date.now(), 0);
    expect(drawn).toEqual({ id: expect.any(String), done: false, count: 306, moved: 0, home: 0, owners: 0 });
    expect((await db.select().from(adminLog)).map((l) => l.detail)).toEqual(["很多 · 半径 400 米 · 正在挪 306 只"]);
    // listed as moving until it is done
    expect((await listZones()).live).toMatchObject([{ done: false }]);
    await zoneMovesDone();
    expect((await listZones()).live).toMatchObject([{ done: true, moved: 306, sentHome: 0 }]);
    expect(await previewZone(circle)).toMatchObject({ count: 0, owners: 0 });
  });

  it("takes only a whole radius from 30 to 3000 m, a place, and a few words on what and why", async () => {
    const boss = await theOwner();
    const ok = { lng: PARK.lng, lat: PARK.lat, radiusM: 200, label: "这里" };
    for (const radiusM of [29, 3001, 200.5, "200", null]) {
      await expect(drawZone(boss, { ...ok, radiusM })).rejects.toMatchObject({ status: 400, message: ZONE_RADIUS_WRONG });
      await expect(previewZone({ ...ok, radiusM })).rejects.toMatchObject({ status: 400, message: ZONE_RADIUS_WRONG });
    }
    for (const label of ["", "   ", null, 7, "字".repeat(81)]) await expect(drawZone(boss, { ...ok, label })).rejects.toMatchObject({ status: 400 });
    for (const where of [{ lng: undefined }, { lat: "30" }, { lng: 181 }, { lat: 89 }]) {
      await expect(drawZone(boss, { ...ok, ...where })).rejects.toMatchObject({ status: 400 });
    }
    expect(await zoneRows()).toEqual([]);
    // 80 characters, counted as characters
    await drawZone(boss, { ...ok, label: "😀".repeat(80) });
    expect(await zoneRows()).toHaveLength(1);
  });

  it("tells the owner of 阿米娅, the fire and 明河都尉's stations in a circle or near its edge", async () => {
    const words = async (at: LngLat, radiusM: number) => (await previewZone({ ...at, radiusM })).warnings;
    expect(await words(AMIYA_AT, 30)).toEqual(["圈里有阿米娅向导，她附近就不能放蟑螂了。"]);
    expect(await words(FIRE_AT, 30)).toEqual(["圈里有塔露拉干员的篝火，蟑螂就不能坐到火边了。"]);
    expect(await words(ROUTE[0].at, 30)).toEqual(["圈里有明河都尉的一个站点。圈好以后，坐车到这一站的蟑螂下车时会放到圈外。"]);
    // within 300 m of the edge, or not
    expect(await words(east(FIRE_AT, 1000), 800)).toHaveLength(1);
    expect(await words(east(FIRE_AT, 1000), 600)).toEqual([]);
    expect(await words(PARK, 500)).toEqual([]);
  });

  it("lists and shows a place with nothing of anyone's, and lifts it: roaches may stand there again, and those moved stay out", async () => {
    const boss = await theOwner();
    const a = await player("a@example.com", PARK);
    const { id } = (await drawZone(boss, { lng: PARK.lng, lat: PARK.lat, radiusM: 300, label: "公园东门，住户来信说有人一直往这放" })) as { id: string };
    const moved = await mainOf(a);

    const list = await listZones();
    expect(list).toEqual({
      live: [
        { id, label: "公园东门，住户来信说有人一直往这放", radiusM: 300, by: "站长", at: expect.any(Number), moved: 2, sentHome: 0, done: true, liftedAt: null },
      ],
      lifted: [],
      inCode: OFF_LIMITS.length,
    });
    // nothing in the answers about who or where: the circle's middle only when asked for one, which is logged
    expect(JSON.stringify(list)).not.toContain(a);
    expect(JSON.stringify(list)).not.toContain(String(PARK.lng));
    expect(JSON.stringify(await previewZone({ ...PARK, radiusM: 300 }))).not.toContain(a);
    expect(await zoneSpot(boss, { id })).toEqual({ id, lng: PARK.lng, lat: PARK.lat, radiusM: 300, label: "公园东门，住户来信说有人一直往这放", lifted: false });

    await liftZone(boss, { id });
    expect(isOffLimits(PARK)).toBe(false);
    await world.placeRoach(a, { kind: "clone" }, PARK);
    expect(await mainOf(a)).toEqual(moved);
    expect(await liftZone(boss, { id }).catch((e) => [e.status, e.message])).toEqual([400, "这一处已经解除了。"]);
    expect(await liftZone(boss, { id: "nope" }).catch((e) => e.status)).toBe(404);
    const after = await listZones();
    expect(after.live).toEqual([]);
    expect(after.lifted).toMatchObject([{ id, liftedAt: expect.any(Number) }]);
    expect((await zoneSpot(boss, { id })).lifted).toBe(true);
    expect((await db.select().from(adminLog).orderBy(adminLog.id)).map((l) => [l.what, l.detail])).toEqual([
      ["act.zone", "公园东门，住户来信说有人一直往这放 · 半径 300 米 · 挪走 2 只"],
      ["view.zone", "公园东门，住户来信说有人一直往这放"],
      ["act.zoneLift", "公园东门，住户来信说有人一直往这放 · 半径 300 米"],
      ["view.zone", "公园东门，住户来信说有人一直往这放"],
    ]);

    // a year after it was lifted, it goes
    await pruneOldActivity(Date.now() + 364 * DAY);
    expect(await zoneRows()).toHaveLength(1);
    await pruneOldActivity(Date.now() + 366 * DAY);
    expect(await zoneRows()).toEqual([]);
  });

  it("finishes, as the main process starts, a place whose moving out was left undone", async () => {
    const boss = await theOwner();
    const a = await player("a@example.com", PARK);
    // drawn on a process that stopped before it moved anyone; another drawn just now, still moving elsewhere
    await db.insert(offLimitsAreas).values({ lng: PARK.lng, lat: PARK.lat, radiusM: 200, label: "停了", createdBy: boss.id, createdAt: new Date(Date.now() - 20 * 60_000) });
    await db.insert(offLimitsAreas).values({ lng: TOKYO.lng, lat: TOKYO.lat, radiusM: 200, label: "刚圈", createdBy: boss.id });
    await standing(a, 1, TOKYO);

    expect(await finishZones(Date.now(), UNFINISHED_AFTER_MS)).toBe(1);
    expect(isOffLimits(await mainOf(a))).toBe(false);
    expect(Object.fromEntries((await zoneRows()).map((z) => [z.label, [z.moved, z.movedAt !== null]]))).toEqual({ 停了: [2, true], 刚圈: [0, false] });
    // as it starts, every one left undone
    expect(await finishZones()).toBe(1);
    expect(Object.fromEntries((await zoneRows()).map((z) => [z.label, [z.moved, z.movedAt !== null]]))).toEqual({ 停了: [2, true], 刚圈: [1, true] });
    expect(await finishZones()).toBe(0);
  });

  // last: it leaves this process listening to the others
  it("is known to every process at once: another one's word is heard here", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await hearOthers();
    const a = await player("a@example.com", TOKYO);

    // drawn on another process, which says so
    const [row] = await db.insert(offLimitsAreas).values({ lng: PARK.lng, lat: PARK.lat, radiusM: 200, label: "别的进程圈的" }).returning();
    expect(isOffLimits(PARK)).toBe(false);
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "zones" }));
    await vi.waitFor(() => expect(isOffLimits(PARK)).toBe(true));
    await expect(world.placeRoach(a, { kind: "clone" }, PARK)).rejects.toThrow(offLimitsMessage());

    // and lifted there
    await db.update(offLimitsAreas).set({ liftedAt: new Date() }).where(eq(offLimitsAreas.id, row.id));
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "zones" }));
    await vi.waitFor(() => expect(isOffLimits(PARK)).toBe(false));
    await world.placeRoach(a, { kind: "clone" }, PARK);
    await loadZones();
  });
});
