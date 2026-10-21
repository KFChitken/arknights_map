import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "../profile";
import { passersby, TESTERS } from "./cast";
import { LocalWorld, reachText } from "./local";
import type { World } from "./types";

// Minimal browser globals for the localStorage-backed world
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
const g = globalThis as Record<string, unknown>;
g.window = { addEventListener() {} };

const PEOPLES_SQUARE = { lng: 121.4737, lat: 31.2304 };
const tester = (id: string) => TESTERS.find((t) => t.id === id)!;

let world: LocalWorld;
beforeEach(() => {
  g.localStorage = new MemoryStorage();
  world = new LocalWorld();
});

const TOTAL = passersby().length + TESTERS.reduce((n, t) => n + t.roaches.length, 0);

/** Find the roach placed at a spot in the public list. */
async function publicAt(w: LocalWorld, at: { lng: number; lat: number }) {
  const hit = (await w.roaches()).find((r) => r.lng === at.lng && r.lat === at.lat);
  if (!hit) throw new Error(`no public roach at ${at.lng},${at.lat}`);
  return hit;
}

describe("LocalWorld", () => {
  it("starts with the testers and the passers-by, and no roach of your own", async () => {
    const me = await world.me();
    expect(me.id).toBe("me");
    expect(me.roaches).toEqual([]);
    expect((await world.roaches()).length).toBe(TOTAL);
  });

  it("shows other players' roaches where they were placed, without owner or internal id", async () => {
    const all = await world.roaches();
    for (const t of TESTERS) {
      for (const p of t.roaches) await publicAt(world, p);
    }
    for (const r of all.slice(0, 50)) expect(Object.keys(r).sort()).toEqual(["avatar", "clone", "color", "friend", "id", "lat", "lng"]);
  });

  it("lists your own roaches apart from everyone else's", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const me = await world.me();
    expect(me.roaches[0]).toMatchObject(PEOPLES_SQUARE);
    expect((await world.roaches()).some((r) => r.lng === PEOPLES_SQUARE.lng)).toBe(false);

    await world.become("t1");
    const seen = await world.roaches();
    // everyone else's roaches plus yours, minus t1's own two
    expect(seen.length).toBe(TOTAL + 1 - 2);
    expect(await publicAt(world, PEOPLES_SQUARE)).toBeDefined();
  });

  it("does not let clones point back at their main roach", async () => {
    const all = await world.roaches();
    const clones = all.filter((r) => r.clone);
    expect(clones.length).toBe(TESTERS.reduce((n, t) => n + t.roaches.length - 1, 0));
    expect(new Set(clones.map((r) => r.color))).toEqual(new Set(["white"]));
    expect(new Set(clones.map((r) => r.avatar))).toEqual(new Set(["hood"]));
    // main roaches show the look their owner picked
    expect((await publicAt(world, tester("t3").roaches[0])).avatar).toBe("imp");
    // touching two roaches of one owner gives no hint that they share an owner
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const kal = tester("t3");
    const main = await publicAt(world, kal.roaches[0]);
    const beijingClone = await publicAt(world, kal.roaches[1]);
    expect([main.clone, beijingClone.clone]).toEqual([false, true]);
    await world.touch(main.id, false);
    await expect(world.touch(beijingClone.id, false)).resolves.toEqual({ newFriend: null });
  });

  it("delivers a bold touch with the toucher's profile, and a sneaky one without", async () => {
    await world.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", drPrefix: true, games: ["arknights"] });
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const r1 = await publicAt(world, tester("t2").roaches[0]);
    await world.touch(r1.id, true);
    await expect(world.touch(r1.id, true)).rejects.toThrow("今天已经碰过");

    const r2 = await publicAt(world, tester("t1").roaches[0]);
    await world.touch(r2.id, false);

    await world.become("t2");
    const inbox2 = await world.inbox();
    expect(inbox2).toHaveLength(1);
    expect(inbox2[0]).toMatchObject({ kind: "touch", bold: true, seen: false, target: "main" });
    expect(inbox2[0].kind === "touch" && inbox2[0].from?.displayName).toBe("Dr. Breeze");

    await world.become("t1");
    const inbox1 = await world.inbox();
    expect(inbox1[0]).toMatchObject({ kind: "touch", bold: false, from: null });
  });

  it("says which of your roaches was touched, and lets you touch back once", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await world.placeRoach({ kind: "clone" }, { lng: 139.7, lat: 35.68 });
    await world.become("t1");
    const clone = await publicAt(world, { lng: 139.7, lat: 35.68 });
    await world.touch(clone.id, false);

    await world.become("me");
    const [item] = await world.inbox();
    expect(item).toMatchObject({ kind: "touch", target: "clone", replied: false });
    await world.reply(item.id, true);
    await expect(world.reply(item.id, true)).rejects.toThrow("已经碰过");
    await world.markSeen([item.id]);
    expect((await world.inbox())[0]).toMatchObject({ seen: true, replied: true });

    await world.become("t1");
    const [back] = await world.inbox();
    expect(back).toMatchObject({ kind: "touch", target: "touch", bold: true });
  });

  it("shares a UID only when its owner opted in", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await world.become("t3"); // shares UID
    await world.touch((await publicAt(world, PEOPLES_SQUARE)).id, true);
    await world.become("t1"); // does not
    await world.touch((await publicAt(world, PEOPLES_SQUARE)).id, true);
    await world.become("me");
    const items = await world.inbox();
    const froms = items.map((i) => (i.kind === "touch" ? i.from : null));
    expect(froms.find((f) => f?.displayName === "Kal")?.uid).toEqual({ arknights: "12345678" });
    expect(froms.find((f) => f?.displayName === "Dr. 阿白")?.uid).toBeUndefined();
  });

  it("sends a declaration to players with any roach within 10 km, once each, without telling where", async () => {
    await expect(world.declare({ template: "launch", game: "arknights" })).rejects.toThrow("先放下蟑螂本体");
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const { reach } = await world.declare({ template: "launch", game: "arknights" });
    expect(reach).toContain("10 公里内");
    await expect(world.declare({ template: "launch", game: "endfield" })).rejects.toThrow("歇一会儿");

    for (const id of ["t1", "t2", "t3", "t5"]) {
      await world.become(id);
      const items = await world.inbox();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: "declaration", text: "明日方舟，启动！", seen: false });
      expect(Object.keys(items[0]).sort()).toEqual(["at", "id", "kind", "replied", "seen", "text"]);
    }
    await world.become("t4"); // Beijing
    expect(await world.inbox()).toHaveLength(0);
  });

  it("only lets you declare with your own favourites and listed titles", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(world.declare({ template: "iam", character: "能天使", title: "狗" })).rejects.toThrow("厨力角色");
    await world.saveProfile({ ...EMPTY_PROFILE, games: ["arknights"], favourites: { arknights: ["能天使"], endfield: [] } });
    await expect(world.declare({ template: "iam", character: "能天使", title: "不存在的称呼" })).rejects.toThrow(
      "称呼",
    );
    await expect(world.declare({ template: "iam", character: "能天使", title: "管理员" })).rejects.toThrow("称呼");
    await world.declare({ template: "iam", character: "能天使", title: "狗" });
    await world.become("t2");
    expect((await world.inbox())[0]).toMatchObject({ text: "我是能天使的狗" });
  });

  it("caps clones, rotates public ids on moves, and takes clones back with the main roach", async () => {
    await expect(world.placeRoach({ kind: "clone" }, PEOPLES_SQUARE)).rejects.toThrow("先放下蟑螂本体");
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    for (let i = 0; i < 3; i++) await world.placeRoach({ kind: "clone" }, { lng: 100 + i, lat: 20 });
    await expect(world.placeRoach({ kind: "clone" }, { lng: 110, lat: 20 })).rejects.toThrow("最多只能放 3 只");

    await world.become("t1");
    const before = new Set((await world.roaches()).map((r) => r.id));
    await world.become("me");
    const { roaches } = await world.me();
    await world.placeRoach({ kind: "move", roachId: roaches[1].id }, { lng: 105, lat: 25 });
    await world.become("t1");
    const after = (await world.roaches()).filter((r) => !before.has(r.id));
    expect(after).toHaveLength(1);
    expect(after[0].clone).toBe(true);

    await world.become("me");
    const main = (await world.me()).roaches.find((r) => r.slot === 0)!;
    expect(await world.removeRoach(main.id)).toEqual([]);
  });

  it("validates profiles", async () => {
    const saved = await world.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "  阿米娅的狗  ",
      games: ["endfield"],
      favourites: { arknights: ["能天使"], endfield: ["佩丽卡", "不存在", "佩丽卡", "陈千语", "管理员", "莱万汀"] },
      uid: { arknights: "123", endfield: "8899" },
    });
    expect(saved.name).toBe("阿米娅的狗");
    expect(saved.favourites).toEqual({ arknights: [], endfield: ["佩丽卡", "陈千语", "管理员"] });
    expect(saved.uid).toEqual({ arknights: "", endfield: "8899" });
    await expect(world.saveProfile({ ...EMPTY_PROFILE, uid: { arknights: "", endfield: "<script>" }, games: ["endfield"] })).rejects.toThrow("UID");
    await expect(world.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: " " })).rejects.toThrow("名字");
  });

  it("lists passers-by someone touched as identities to step into", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const k = passersby().findIndex((p) => p.city === "上海");
    await world.touch((await publicAt(world, passersby()[k])).id, true);
    const ids = await world.identities();
    expect(ids.find((i) => i.group === "passerby")).toMatchObject({ id: `n${k}`, unseen: 1, note: "上海" });

    await world.become(`n${k}`);
    expect((await world.inbox())[0]).toMatchObject({ kind: "touch", bold: true });
    expect((await world.me()).roaches).toEqual([expect.objectContaining({ slot: 0, lng: passersby()[k].lng })]);
  });

  it("moves the roach placed with the first prototype into the world once", async () => {
    g.localStorage = new MemoryStorage();
    (g.localStorage as MemoryStorage).setItem("zhoup.myRoach", JSON.stringify({ lng: 2.35, lat: 48.86, color: "red", placedAt: 1 }));
    const w = new LocalWorld();
    const me = await w.me();
    expect(me.roaches).toEqual([expect.objectContaining({ slot: 0, lng: 2.35, lat: 48.86 })]);
    expect(me.profile.color).toBe("red");
    expect((g.localStorage as MemoryStorage).getItem("zhoup.myRoach")).toBeNull();
    await w.reset();
    expect((await w.me()).roaches).toEqual([]);
  });

  it("makes two players 触须之交 once both have touched each other boldly", async () => {
    await world.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const aBai = await publicAt(world, tester("t1").roaches[0]);
    expect(await world.touch(aBai.id, true)).toEqual({ newFriend: null });

    await world.become("t1");
    const [touchFromMe] = await world.inbox();
    expect(await world.reply(touchFromMe.id, true)).toEqual({ newFriend: "Breeze" });
    const [friend] = await world.friends();
    expect(friend.profile.displayName).toBe("Breeze");
    expect(friend.roaches).toHaveLength(1);
    expect(friend.roaches[0]).toMatchObject({ friend: true, clone: false, ...PEOPLES_SQUARE });

    await world.become("me");
    const items = await world.inbox();
    expect(items.find((i) => i.kind === "friend")).toMatchObject({ seen: false, from: { displayName: "Dr. 阿白" } });
    const [aBaiFriend] = await world.friends();
    // their main roach and Tokyo clone, both marked on your map
    expect(aBaiFriend.roaches.map((r) => r.clone)).toEqual([false, true]);
    const marked = (await world.roaches()).filter((r) => r.friend);
    expect(marked.map((r) => r.id).sort()).toEqual(aBaiFriend.roaches.map((r) => r.id).sort());
    expect(aBaiFriend.history).toContainEqual({ kind: "befriended", at: expect.any(Number), you: true });
    expect(aBaiFriend.history.some((e) => e.kind === "touched" && e.you && e.bold)).toBe(true);
  });

  it("does not count sneaky touches towards 触须之交", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await world.touch((await publicAt(world, tester("t2").roaches[0])).id, false);
    await world.become("t2");
    const [item] = await world.inbox();
    expect(await world.reply(item.id, true)).toEqual({ newFriend: null });
    expect(await world.friends()).toEqual([]);
  });

  it("keeps third parties anonymous in a friend's history, and can be undone", async () => {
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await world.touch((await publicAt(world, tester("t1").roaches[0])).id, true);
    await world.become("t1");
    const [item] = await world.inbox();
    await world.reply(item.id, true);
    // 阿白 also touches Kal, a stranger to you
    await world.touch((await publicAt(world, tester("t3").roaches[0])).id, false);

    await world.become("me");
    const [f] = await world.friends();
    const third = f.history.find((e) => e.kind === "touched" && !e.you);
    expect(third).toEqual({ kind: "touched", at: expect.any(Number), bold: false, you: false });
    expect(JSON.stringify(f.history)).not.toMatch(/t3|Kal/);

    await world.unfriend(f.id);
    expect(await world.friends()).toEqual([]);
    expect((await world.roaches()).some((r) => r.friend)).toBe(false);
    await world.become("t1");
    expect(await world.friends()).toEqual([]);
    // old touches no longer count; a fresh pair of bold touches is needed
    const meRoach = await publicAt(world, PEOPLES_SQUARE);
    expect(await world.touch(meRoach.id, true)).toEqual({ newFriend: null });
  });

  it("runs the radar around your main roach, counting arrivals and departures across its edge", async () => {
    expect(await world.radar()).toBeNull();
    await world.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const before = (await world.radar())!;
    expect(before.radiusKm).toBe(100);
    expect(before.roaches).toBeGreaterThan(100);
    expect(before.players).toBeLessThanOrEqual(before.roaches);
    expect(before.daily).toHaveLength(7);
    expect(before.week.arrived).toBeGreaterThan(0);
    expect(before.week.arrived).toBeGreaterThanOrEqual(before.day.arrived);

    // 小林 leaves Shanghai for Beijing; Dr. 夜莺厨 (Beijing) drops a clone in Shanghai
    await world.become("t2");
    const [xiaolin] = (await world.me()).roaches;
    await world.placeRoach({ kind: "move", roachId: xiaolin.id }, { lng: 116.4, lat: 39.9 });
    await world.become("t4");
    await world.placeRoach({ kind: "clone" }, { lng: 121.45, lat: 31.22 });
    await world.become("me");
    const after = (await world.radar())!;
    expect(after.day.left).toBe(before.day.left + 1);
    expect(after.day.arrived).toBe(before.day.arrived + 1);
    expect(after.day.clones).toBe(before.day.clones + 1);
    expect(after.daily[6].left).toBe(before.daily[6].left + 1);

    // your own moves never show up on your radar
    await world.placeRoach({ kind: "clone" }, { lng: 121.5, lat: 31.3 });
    expect((await world.radar())!.day).toEqual(after.day);
  });

  it("buckets the declaration head count", () => {
    expect(reachText(0)).toContain("暂时没有");
    expect(reachText(3)).toContain("不到 5 只");
    expect(reachText(7)).toContain("5–10 只");
    expect(reachText(49)).toContain("20–50 只");
    expect(reachText(500)).toContain("50 多只");
  });
});
