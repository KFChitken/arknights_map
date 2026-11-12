import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROFILE } from "../profile";
import { overviewCell, type Area } from "../world/area";
import { unpackRoaches } from "../world/packed";
import type { AreaUpdate, MapRoach, RoachFeedUpdate } from "../world/types";
import { db } from "./db";
import {
  compressedArea,
  resetRoachFeed,
  roachArea,
  roachByFeedId,
  roachCounts,
  roachFeed,
  roachFeedSettled,
  stopRoachFeed,
  type FeedForm,
} from "./roachFeed";
import { users } from "./schema";
import * as world from "./world";

const SHANGHAI = { lng: 121.47, lat: 31.23 };
const TOKYO = { lng: 139.7, lat: 35.68 };
const BEIJING = { lng: 116.4, lat: 39.9 };
const T0 = 1_900_000_000_000;
const MINUTE = 60_000;

type Answer = { v: string; roaches?: MapRoach[]; changed?: MapRoach[]; removed?: string[] };

async function ask(since: string | null, now: number, form: FeedForm = 1): Promise<Answer> {
  return JSON.parse((await roachFeed(since, now, form)).json);
}

/** Ask once to start a rebuild that is due, let it finish, then ask again. */
async function askAfterRebuild(since: string | null, now: number, form: FeedForm = 1) {
  await roachFeed(since, now, form);
  await roachFeedSettled();
  return ask(since, now, form);
}

/** A roach put straight into the table, with the public id given */
async function roachWithId(userId: string, slot: number, publicId: string, at = SHANGHAI) {
  await db.execute(sql`insert into roaches (user_id, slot, lng, lat, public_id) values (${userId}, ${slot}, ${at.lng}, ${at.lat}, ${publicId})`);
}

async function player(email: string) {
  const [u] = await db
    .insert(users)
    .values({ email, policyAcceptedAt: new Date(), crossBorderAcceptedAt: new Date(), publicPlaceAcceptedAt: new Date() })
    .returning({ id: users.id });
  return u.id;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  resetRoachFeed();
});

describe("roach feed", () => {
  it("gives everyone the same whole snapshot, without owners, compressed once", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);

    const first = await roachFeed(null, T0);
    expect(first.kind).toBe("full");
    expect(first.kind === "full" && gunzipSync(first.gzip).toString()).toBe(first.json);
    const snap: Answer = JSON.parse(first.json);
    expect(snap.roaches).toHaveLength(2);
    for (const r of snap.roaches!) expect(Object.keys(r).sort()).toEqual(["avatar", "clone", "color", "id", "lat", "lng"]);
    expect(snap.roaches!.map((r) => r.id)).toEqual(snap.roaches!.map((r) => r.id).sort());
    // a clone looks like every other clone
    expect(snap.roaches!.find((r) => r.clone)).toMatchObject({ avatar: "hood", color: "white" });
    // nothing new
    expect(await ask(snap.v, T0 + 1000)).toEqual({ v: snap.v });
  });

  it("packs the whole snapshot for pages that ask, to the same roaches, places to about a metre", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, { lng: 121.473712345, lat: 31.230416789 });
    await world.placeRoach(a, { kind: "clone" }, TOKYO);

    const list = await roachFeed(null, T0);
    const packed = await roachFeed(null, T0, 2);
    expect(packed.kind).toBe("full");
    expect(packed.kind === "full" && gunzipSync(packed.gzip).toString()).toBe(packed.json);
    const snap: Answer = JSON.parse(list.json);
    const pack: RoachFeedUpdate = JSON.parse(packed.json);
    expect(pack.v).toBe(snap.v);
    expect(pack.roaches).toBeUndefined();
    const back = unpackRoaches(pack.packed!).sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(back).toEqual(snap.roaches);
    expect(snap.roaches!.find((r) => !r.clone)).toMatchObject({ lng: 121.47371, lat: 31.23042 });
    // a page holding the version still gets only what changed, the same either way
    expect(await roachFeed(snap.v, T0 + 1000, 2)).toEqual(await roachFeed(snap.v, T0 + 1000));
  });

  it("gives the short form with each roach under the first four bytes of its public id, in brotli too", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, { lng: 121.473712345, lat: 31.230416789 });
    await world.placeRoach(a, { kind: "clone" }, TOKYO);

    const list: Answer = JSON.parse((await roachFeed(null, T0)).json);
    const short = await roachFeed(null, T0, 3);
    expect(short.kind === "full" && brotliDecompressSync(short.br!).toString()).toBe(short.json);
    expect(short.kind === "full" && gunzipSync(short.gzip).toString()).toBe(short.json);
    const pack: RoachFeedUpdate = JSON.parse(short.json);
    expect(pack.v).toBe(list.v);
    expect(pack.packed!.w).toBe(4);
    const back = unpackRoaches(pack.packed!).sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(back).toEqual(list.roaches!.map((r) => ({ ...r, id: r.id.slice(0, 8) })));
    // the old forms are only made when asked for, and the short one comes in about a quarter of the room
    expect(short.json.length).toBeLessThan((await roachFeed(null, T0, 2)).json.length);
  });

  it("sends what changed in short ids to a page of the short form", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const start = await ask(null, T0, 3);
    const [main] = (await world.me(a))!.roaches;
    await world.placeRoach(a, { kind: "move", roachId: main.id }, TOKYO);
    const moved = await askAfterRebuild(start.v, T0 + 11_000, 3);
    const [now] = (await world.me(a))!.roaches;
    expect(moved.removed).toEqual([main.publicId.slice(0, 8)]);
    expect(moved.changed).toMatchObject([{ id: now.publicId.slice(0, 8), ...TOKYO }]);
    // the same change, in whole ids, for a page of an older form
    expect(await ask(start.v, T0 + 11_000)).toMatchObject({ removed: [main.publicId], changed: [{ id: now.publicId }] });
  });

  it("gives two roaches whose public ids start alike their whole ids, also when that comes about later", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await roachWithId(a, 0, "aaaaaaaa-0000-4000-8000-000000000001");
    await roachWithId(a, 1, "bbbbbbbb-0000-4000-8000-000000000001", TOKYO);
    const start = await ask(null, T0, 3);
    const ids = (s: Answer) => s.roaches ?? unpackRoaches((s as RoachFeedUpdate).packed!).map((r) => r.id).sort();
    expect(ids(start)).toEqual(["aaaaaaaa", "bbbbbbbb"]);

    // b's roach starts like a's: both go by their whole ids, under which a page finds them again
    await roachWithId(b, 0, "aaaaaaaa-ffff-4000-8000-000000000002", BEIJING);
    const later = await askAfterRebuild(start.v, T0 + 6 * MINUTE, 3);
    expect(later.removed).toEqual(["aaaaaaaa"]);
    expect(later.changed!.map((r) => r.id)).toEqual(["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-ffff-4000-8000-000000000002"]);
    expect(ids(await ask(null, T0 + 6 * MINUTE, 3)).sort()).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-ffff-4000-8000-000000000002",
      "bbbbbbbb",
    ]);
    // a page that still says "aaaaaaaa" names two roaches: none, until it hears; a whole id still names one
    expect(await roachByFeedId("aaaaaaaa")).toBeNull();
    expect((await roachByFeedId("bbbbbbbb"))?.publicId).toBe("bbbbbbbb-0000-4000-8000-000000000001");
    expect((await roachByFeedId("aaaaaaaa-ffff-4000-8000-000000000002"))?.userId).toBe(b);
    expect((await roachByFeedId("aaaaaaaa", b))?.userId).toBe(b);
    expect(await roachByFeedId("aaaa")).toBeNull();

    // and once b's roach is gone, a's goes by its short id again
    await db.execute(sql`delete from roaches where user_id = ${b}`);
    const after = await askAfterRebuild(later.v, T0 + 12 * MINUTE, 3);
    expect(after.removed).toEqual(["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-ffff-4000-8000-000000000002"]);
    expect(after.changed!.map((r) => r.id)).toEqual(["aaaaaaaa"]);
  });

  it("sends only what changed since the version a page holds", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const start = await ask(null, T0);
    const [main] = (await world.me(a))!.roaches;

    // a move gives the roach a new public id; the snapshot catches up within the rebuild window
    await world.placeRoach(a, { kind: "move", roachId: main.id }, TOKYO);
    expect(await ask(start.v, T0 + 2000)).toEqual({ v: start.v });
    const moved = await askAfterRebuild(start.v, T0 + 11_000);
    expect(moved.v).not.toBe(start.v);
    expect(moved.removed).toEqual([main.publicId]);
    expect(moved.changed!.map((r) => [r.lng, r.lat])).toEqual([[TOKYO.lng, TOKYO.lat]]);

    // a new look shows up under the same id
    await world.saveProfile(a, { ...EMPTY_PROFILE, avatar: "imp", color: "red" });
    const restyled = await askAfterRebuild(moved.v, T0 + 22_000);
    expect(restyled.removed).toEqual([]);
    expect(restyled.changed).toMatchObject([{ id: moved.changed![0].id, avatar: "imp", color: "red" }]);

    // a page two versions behind gets both changes as one set, sorted by id
    const b = await player("b@example.com");
    await world.placeRoach(b, { kind: "main" }, BEIJING);
    const caughtUp = await askAfterRebuild(moved.v, T0 + 33_000);
    expect(caughtUp.changed!.map((r) => r.id)).toEqual(caughtUp.changed!.map((r) => r.id).sort());
    expect(caughtUp.changed).toHaveLength(2);
    expect(caughtUp.removed).toEqual([]);
    expect(Object.keys(caughtUp).sort()).toEqual(["changed", "removed", "v"]);
  });

  it("sends the whole snapshot again to a page from before a restart or too far behind", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const start = await ask(null, T0);
    expect((await ask("0000.1", T0 + 1000)).roaches).toHaveLength(1);

    const [main] = (await world.me(a))!.roaches;
    await world.placeRoach(a, { kind: "move", roachId: main.id }, TOKYO);
    await askAfterRebuild(start.v, T0 + 11_000);
    // an hour later the changes still reach back to the start
    const later = (await world.me(a))!.roaches[0];
    await world.placeRoach(a, { kind: "move", roachId: later.id }, BEIJING);
    expect((await askAfterRebuild(start.v, T0 + 60 * MINUTE)).changed).toMatchObject([BEIJING]);
    // four hours later they no longer do
    const last = (await world.me(a))!.roaches[0];
    await world.placeRoach(a, { kind: "move", roachId: last.id }, SHANGHAI);
    const far = await askAfterRebuild(start.v, T0 + 4 * 60 * MINUTE);
    expect(far.roaches).toHaveLength(1);
    expect(far.roaches![0]).toMatchObject(SHANGHAI);
  });

  describe("across a restart", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "feed-"));
      process.env.FEED_STATE = join(dir, "web.json");
      resetRoachFeed();
    });
    afterEach(() => {
      delete process.env.FEED_STATE;
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("takes up where the process before left off, so its pages get only what changed meanwhile", async () => {
      const a = await player("a@example.com");
      await world.placeRoach(a, { kind: "main" }, SHANGHAI);
      const start = await ask(null, T0, 3);
      const [main] = (await world.me(a))!.roaches;
      await world.placeRoach(a, { kind: "move", roachId: main.id }, TOKYO);
      const moved = await askAfterRebuild(start.v, T0 + 11_000, 3);
      // told to stop: written down, and no new versions meanwhile
      stopRoachFeed();
      const b = await player("b@example.com");
      await world.placeRoach(b, { kind: "main" }, BEIJING);
      expect(await askAfterRebuild(moved.v, T0 + 22_000, 3)).toEqual({ v: moved.v });

      // the next process, with a change made while none was running
      resetRoachFeed(T0 + 30_000);
      const [now] = (await world.me(a))!.roaches;
      await world.placeRoach(a, { kind: "move", roachId: now.id }, SHANGHAI);
      const back = await ask(moved.v, T0 + 40_000, 3);
      expect(back.v.split(".")[0]).toBe(moved.v.split(".")[0]);
      expect(back.removed).toEqual([now.publicId.slice(0, 8)]);
      expect(back.changed!.map((r) => [r.lng, r.lat]).sort()).toEqual([
        [BEIJING.lng, BEIJING.lat],
        [SHANGHAI.lng, SHANGHAI.lat],
      ]);
      // a page from further back gets the changes from there, the older form too
      expect((await ask(start.v, T0 + 40_000, 3)).changed).toHaveLength(2);
      expect((await ask(start.v, T0 + 40_000)).removed).toEqual([main.publicId, now.publicId].sort());
      // and one with a version made after the last save, which means nothing here, the whole snapshot
      const after = `${moved.v.split(".")[0]}.${Number(moved.v.split(".")[1]) + 1}`;
      expect((await roachFeed(after, T0 + 11 * MINUTE, 3)).kind).toBe("full");
    });

    it("writes down where it is every minute too, for a process that ends without being told", async () => {
      const a = await player("a@example.com");
      await world.placeRoach(a, { kind: "main" }, SHANGHAI);
      const start = await ask(null, T0, 3);
      await roachFeedSettled();
      // ended at once: the next one takes up from the last save
      resetRoachFeed(T0 + 30_000);
      const [main] = (await world.me(a))!.roaches;
      await world.placeRoach(a, { kind: "move", roachId: main.id }, TOKYO);
      expect((await ask(start.v, T0 + 40_000, 3)).changed).toMatchObject([TOKYO]);
    });

    it("spreads the whole snapshot over the first minutes for pages it does not know, so they do not all come at once", async () => {
      const a = await player("a@example.com");
      await world.placeRoach(a, { kind: "main" }, SHANGHAI);
      resetRoachFeed(T0);
      const random = vi.spyOn(Math, "random");
      // a page from a process that wrote nothing down: most wait at first, keeping what they have
      random.mockReturnValue(0.5);
      expect(await ask("0123abcd.42", T0 + MINUTE, 3)).toEqual({ v: "0123abcd.42" });
      // later more of them get it, and after ten minutes every one
      expect((await roachFeed("0123abcd.42", T0 + 6 * MINUTE, 3)).kind).toBe("full");
      random.mockReturnValue(0.999);
      expect((await roachFeed("0123abcd.42", T0 + 9 * MINUTE, 3)).kind).toBe("diff");
      expect((await roachFeed("0123abcd.42", T0 + 10 * MINUTE, 3)).kind).toBe("full");
      // a page with nothing yet never waits
      random.mockReturnValue(0.5);
      expect((await roachFeed(null, T0 + MINUTE, 3)).kind).toBe("full");
      // one still running the code from before the short form waits up to an hour
      expect((await roachFeed("0123abcd.42", T0 + 20 * MINUTE, 2)).kind).toBe("diff");
      expect((await roachFeed("0123abcd.42", T0 + 40 * MINUTE, 2)).kind).toBe("full");
    });
  });

  it("rebuilds every few minutes even if no change was reported", async () => {
    const a = await player("a@example.com");
    const start = await ask(null, T0);
    expect(start.roaches).toEqual([]);
    // written behind the feed's back
    await db.execute(sql`insert into roaches (user_id, slot, lng, lat) values (${a}, 0, 121.47, 31.23)`);
    expect(await askAfterRebuild(start.v, T0 + 2 * MINUTE)).toEqual({ v: start.v });
    expect((await askAfterRebuild(start.v, T0 + 6 * MINUTE)).changed).toHaveLength(1);
  });
});

describe("only the area a page shows (f=4)", () => {
  type AreaAnswer = AreaUpdate & { changed?: MapRoach[] };
  const askArea = async (area: Area, since: string | null, now: number): Promise<AreaAnswer> => {
    const a = await roachArea(area, since, now);
    return JSON.parse(a.kind === "full" ? a.whole.json : a.json);
  };
  const areaAfterRebuild = async (area: Area, since: string | null, now: number) => {
    await roachArea(area, since, now);
    await roachFeedSettled();
    return askArea(area, since, now);
  };
  const SHANGHAI_BOX: Area = [121, 31, 122, 31.5];

  it("gives the roaches in a box, edges included, with how many there are in all", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    await world.placeRoach(a, { kind: "clone" }, { lng: 122, lat: 31.25 });
    const box = await askArea(SHANGHAI_BOX, null, T0);
    const got = unpackRoaches(box.packed!);
    expect(got.map((r) => [r.lng, r.lat]).sort()).toEqual([
      [121.47, 31.23],
      [122, 31.25],
    ]);
    // short ids, and nothing about whose they are
    expect(got.every((r) => /^[0-9a-f]{8}$/.test(r.id) && !("owner" in r))).toBe(true);
    expect(box.box).toEqual(SHANGHAI_BOX);
    expect(box.t).toEqual([3, 0, 0, 1]);
    // made once, compressed when asked
    const full = await roachArea(SHANGHAI_BOX, null, T0);
    expect(full.kind === "full" && brotliDecompressSync(await compressedArea(full.whole, "br")).toString()).toBe(
      full.kind === "full" && full.whole.json,
    );
  });

  it("tells a page holding a box what changed in it: moved in, moved out, gone, and nothing about elsewhere", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const [main] = (await world.me(a))!.roaches;
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const clone = (await world.me(a))!.roaches.find((r) => r.slot === 1)!;
    const start = await askArea(SHANGHAI_BOX, null, T0);
    expect(unpackRoaches(start.packed!)).toHaveLength(1);
    const shortOfMain = unpackRoaches(start.packed!)[0].id;

    // the clone comes into the box, the main roach leaves it
    await world.placeRoach(a, { kind: "move", roachId: clone.id }, { lng: 121.3, lat: 31.1 });
    await world.placeRoach(a, { kind: "move", roachId: main.id }, BEIJING);
    const moved = await areaAfterRebuild(SHANGHAI_BOX, start.v, T0 + MINUTE);
    expect(moved.changed!.map((r) => [r.lng, r.lat])).toEqual([[121.3, 31.1]]);
    expect(moved.removed).toContain(shortOfMain);
    expect(moved.t).toEqual([2, 0, 0, 1]);

    // a change far away: the box hears only that some ids it may hold changed or went (a moved roach
    // goes by a new id, so its old one and its new one)
    await world.placeRoach(a, { kind: "move", roachId: (await world.me(a))!.roaches.find((r) => r.slot === 0)!.id }, TOKYO);
    const far = await areaAfterRebuild(SHANGHAI_BOX, moved.v, T0 + 2 * MINUTE);
    expect(far.changed).toEqual([]);
    expect(far.removed).toHaveLength(2);
    expect(far.removed).not.toContain(moved.changed![0].id);
    // up to date: only the version and the counts
    expect(await askArea(SHANGHAI_BOX, far.v, T0 + 2 * MINUTE)).toEqual({ v: far.v, t: [2, 0, 0, 1] });
  });

  it("gives the overview: one roach for each small square, the same one while it stays, counting all there", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    // three in one square of the overview, one in Tokyo
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, { lng: 121.471, lat: 31.231 });
    await world.placeRoach(b, { kind: "main" }, { lng: 121.472, lat: 31.229 });
    await world.placeRoach(b, { kind: "clone" }, TOKYO);
    expect(overviewCell(SHANGHAI)).toBe(overviewCell({ lng: 121.472, lat: 31.229 }));
    const o = await askArea("overview", null, T0);
    expect(o.overview).toBe(true);
    const got = unpackRoaches(o.packed!);
    expect(got.map((r) => r.n ?? 1).sort()).toEqual([1, 3]);
    expect(got.reduce((n, r) => n + (r.n ?? 1), 0)).toBe(4);
    // the square's roach is the one with the lowest short id, so it stays the same
    const shanghai = got.find((r) => r.n === 3)!;
    const all = unpackRoaches((await askArea([121, 31, 122, 31.5], null, T0)).packed!);
    expect(shanghai.id).toBe(all.map((r) => r.id).sort()[0]);
    // a page holding the overview gets it whole again, never what changed
    expect((await roachArea("overview", o.v, T0)).kind).toBe("full");
  });

  it("counts the players as their main roaches, clones none more, and none once the main roach goes with its clones", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await player("c@example.com"); // signed up, no roach yet: not on the map
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    await world.placeRoach(a, { kind: "clone" }, { lng: 121.3, lat: 31.1 });
    await world.placeRoach(b, { kind: "main" }, BEIJING);
    expect(await roachCounts(T0)).toMatchObject({ total: 4, fire: 0, riders: 0, players: 2 });
    // every f=4 answer says it last, after the three counts pages from before it read
    const box = await askArea(SHANGHAI_BOX, null, T0);
    expect(box.t).toEqual([4, 0, 0, 2]);
    expect((await askArea("overview", null, T0)).t).toEqual([4, 0, 0, 2]);

    // a clone more is a roach more, not a player more
    await world.placeRoach(b, { kind: "clone" }, TOKYO);
    expect((await areaAfterRebuild(SHANGHAI_BOX, box.v, T0 + MINUTE)).t).toEqual([5, 0, 0, 2]);
    // a's main roach taken back takes a's clones with it: one player left, with two roaches
    const main = (await world.me(a))!.roaches.find((r) => r.slot === 0)!;
    await world.removeRoach(a, main.id);
    const after = await areaAfterRebuild(SHANGHAI_BOX, box.v, T0 + 2 * MINUTE);
    expect(after.t).toEqual([2, 0, 0, 1]);
    expect(await roachCounts(T0 + 2 * MINUTE)).toMatchObject({ total: 2, players: 1 });
  });
});
