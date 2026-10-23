import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "../profile";
import type { MapRoach } from "../world/types";
import { db } from "./db";
import { resetRoachFeed, roachFeed, roachFeedSettled } from "./roachFeed";
import { users } from "./schema";
import * as world from "./world";

const SHANGHAI = { lng: 121.47, lat: 31.23 };
const TOKYO = { lng: 139.7, lat: 35.68 };
const BEIJING = { lng: 116.4, lat: 39.9 };
const T0 = 1_900_000_000_000;
const MINUTE = 60_000;

type Answer = { v: string; roaches?: MapRoach[]; changed?: MapRoach[]; removed?: string[] };

async function ask(since: string | null, now: number): Promise<Answer> {
  return JSON.parse((await roachFeed(since, now)).json);
}

/** Ask once to start a rebuild that is due, let it finish, then ask again. */
async function askAfterRebuild(since: string | null, now: number) {
  await roachFeed(since, now);
  await roachFeedSettled();
  return ask(since, now);
}

async function player(email: string) {
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: new Date(), policyAcceptedAt: new Date() })
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
    // twenty minutes later the change log no longer reaches back to the start
    const later = (await world.me(a))!.roaches[0];
    await world.placeRoach(a, { kind: "move", roachId: later.id }, BEIJING);
    const far = await askAfterRebuild(start.v, T0 + 20 * MINUTE);
    expect(far.roaches).toHaveLength(1);
    expect(far.roaches![0]).toMatchObject(BEIJING);
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
