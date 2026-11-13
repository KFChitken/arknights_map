import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetSessionChecks } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { forgetNotices, loadNotices, noticeList } from "@/lib/server/notices";
import { resetRoachFeed } from "@/lib/server/roachFeed";
import { forgetSignals, recent } from "@/lib/server/signals";
import { endGray, loadSettings, setGray } from "@/lib/server/siteSettings";
import { notices, sessions, users } from "@/lib/server/schema";
import * as world from "@/lib/server/world";
import { FIRE_AT } from "@/lib/talulah";
import { unpackRoaches } from "@/lib/world/packed";
import { GET } from "./route";

const SHANGHAI = { lng: 121.47, lat: 31.23 };
const TOKYO = { lng: 139.7, lat: 35.68 };

async function player(email: string) {
  const [u] = await db
    .insert(users)
    .values({ email, policyAcceptedAt: new Date(), crossBorderAcceptedAt: new Date(), publicPlaceAcceptedAt: new Date() })
    .returning({ id: users.id });
  return u.id;
}

/** A signed-in session for the player: the cookie's token */
async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("base64url");
  await db.insert(sessions).values({ id, userId, expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

const get = (cookie?: string) => GET(new NextRequest("http://localhost/api/roaches?f=3", cookie ? { headers: { cookie } } : {}));

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  resetRoachFeed();
  forgetSessionChecks();
  forgetNotices();
});

describe("the roach list", () => {
  it("gives a visitor only how many roaches there are, in a few hundred bytes", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const b = await player("b@example.com");
    await db.execute(sql`insert into roaches (user_id, slot, lng, lat, public_id) values (${b}, 0, ${FIRE_AT.lng}, ${FIRE_AT.lat + 0.001}, gen_random_uuid())`);

    for (const cookie of [undefined, `sid=${randomBytes(32).toString("base64url")}`, "sid=not-a-token"]) {
      const res = await get(cookie);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeLessThan(300);
      const body = JSON.parse(text);
      // and how many players they belong to: a and b, a's clone being nobody more
      expect(body).toMatchObject({ hidden: true, total: 3, fire: 1, riders: 0, players: 2 });
      expect(Object.keys(body).sort()).toEqual(["fire", "hidden", "players", "riders", "total", "v"]);
      expect(res.headers.get("etag")).toBeNull();
    }
  });

  it("gives someone signed in every roach, and a visitor nothing to check a held list against", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const token = await signIn(a);

    const res = await get(`sid=${token}`);
    const body = JSON.parse(await res.text());
    expect(unpackRoaches(body.packed)).toHaveLength(2);
    const etag = res.headers.get("etag")!;

    // the same snapshot again: nothing to download for them, but a visitor holding its tag gets counts, not a 304
    const again = await GET(new NextRequest("http://localhost/api/roaches?f=3", { headers: { cookie: `sid=${token}`, "if-none-match": etag } }));
    expect(again.status).toBe(304);
    const visitor = await GET(new NextRequest("http://localhost/api/roaches?f=3", { headers: { "if-none-match": etag } }));
    expect(visitor.status).toBe(200);
    expect(JSON.parse(await visitor.text()).hidden).toBe(true);
  });

  it("gives someone signed in whose map is 全员隐匿 only the counts, how many players last", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const token = await signIn(a);
    const res = await GET(new NextRequest("http://localhost/api/roaches?f=4&c=1", { headers: { cookie: `sid=${token}` } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual({ v: expect.any(String), t: [2, 0, 0, 1] });
  });
});

describe("which notices there are (公告)", () => {
  it("is said by every answer, which stays as it was, its ETag too", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const cookie = `sid=${await signIn(a)}`;
    await db.insert(notices).values({ title: "一", body: "一", status: "live", publishedAt: new Date() });
    await loadNotices();
    const stamp = noticeList().stamp;

    const ask = (query: string, headers: Record<string, string> = {}) =>
      GET(new NextRequest(`http://localhost/api/roaches?${query}`, { headers: { cookie, ...headers } }));
    const full = await ask("f=3");
    const fullText = await full.text();
    const etag = full.headers.get("etag")!;
    const v = JSON.parse(fullText).v as string;
    const area = await ask("f=4&box=121,31,122,32");
    const areaEtag = area.headers.get("etag")!;
    const answers = {
      visitor: await get(),
      full,
      notModified: await ask("f=3", { "if-none-match": etag }),
      diff: await ask(`f=3&since=${encodeURIComponent(v)}`),
      counts: await ask("f=4&c=1"),
      area,
      areaNotModified: await ask("f=4&box=121,31,122,32", { "if-none-match": areaEtag }),
      areaDiff: await ask(`f=4&box=121,31,122,32&since=${encodeURIComponent(v)}`),
      overview: await ask("f=4&o=1"),
    };
    expect(answers.notModified.status).toBe(304);
    expect(answers.areaNotModified.status).toBe(304);
    expect(await answers.diff.text()).toBe(`{"v":"${v}"}`);
    for (const [kind, res] of Object.entries(answers)) expect([kind, res.headers.get("x-notices")]).toEqual([kind, stamp]);

    // another notice: the same answer and ETag, under the new stamp
    await db.insert(notices).values({ title: "二", body: "二", status: "live", publishedAt: new Date() });
    await loadNotices();
    const later = await ask("f=3");
    expect(later.headers.get("x-notices")).toBe(noticeList().stamp);
    expect(later.headers.get("x-notices")).not.toBe(stamp);
    expect(later.headers.get("etag")).toBe(etag);
    expect(await later.text()).toBe(fullText);
    const stillHeld = await ask("f=3", { "if-none-match": etag });
    expect(stillHeld.status).toBe(304);
    expect(stillHeld.headers.get("x-notices")).toBe(noticeList().stamp);
  });
});

describe("only an area (f=4)", () => {
  it("notes each page held back, by the limit that held it, for the site's checks", async () => {
    const a = await player("a@example.com");
    const cookie = `sid=${await signIn(a)}`;
    forgetSignals();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await GET(new NextRequest("http://localhost/api/roaches?f=4&c=1", { headers: { cookie } }))).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    expect(recent("busy", 60_000).map((s) => s.code)).toEqual(["area:counts:sid"]);
  });

  it("gives someone zooming in and out a new box at every stop, scores of them in a minute", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const cookie = `sid=${await signIn(a)}`;
    for (let i = 0; i < 120; i++) {
      // a different box each time, as each stop of a zoom asks for
      const box = `${100 + (i % 40) * 0.25},20,${121 + (i % 3)},${32 + Math.floor(i / 40) * 0.25}`;
      const res = await GET(new NextRequest(`http://localhost/api/roaches?f=4&box=${box}`, { headers: { cookie } }));
      expect(res.status, box).toBe(200);
    }
  });
});

describe("the overview as squares, and a view counted exactly (f=4)", () => {
  const ask = (query: string, cookie?: string, headers: Record<string, string> = {}) =>
    GET(new NextRequest(`http://localhost/api/roaches?${query}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } }));

  it("gives the overview with each roach as its square by ETag, the old form still, and counts a view", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const cookie = `sid=${await signIn(a)}`;
    const res = await ask("f=4&o=2", cookie, { "accept-encoding": "br" });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect((await ask("f=4&o=2", cookie, { "if-none-match": res.headers.get("etag")! })).status).toBe(304);
    const squared = await (await ask("f=4&o=2", cookie)).json();
    expect(squared.packed.sx).toHaveLength(2);
    const old = await (await ask("f=4&o=1", cookie)).json();
    expect(old.packed.sx).toBeUndefined();
    expect(unpackRoaches(old.packed)).toHaveLength(2);
    expect(await (await ask("f=4&n=120.5,30.5,122.5,32", cookie)).json()).toEqual({ n: 1 });
    expect(await (await ask("f=4&n=100,20,150,40", cookie)).json()).toEqual({ n: 2 });
    expect(await (await ask("f=4&n=100,20,150,40")).json()).toMatchObject({ hidden: true });
    for (const q of ["f=4&n=1,2,3", "f=4&n=120,40,121,30", "f=4&n=120,30,190,32"]) expect((await ask(q, cookie)).status, q).toBe(400);
  });

  it("gives the overview of main roaches only with m=1 (只看本体), by an ETag of its own, and counts the players in a view", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    await world.placeRoach(a, { kind: "clone" }, { lng: 121.3, lat: 31.1 });
    const cookie = `sid=${await signIn(a)}`;
    const all = await ask("f=4&o=2", cookie);
    const mains = await ask("f=4&o=2&m=1", cookie);
    expect(mains.headers.get("etag")).not.toBe(all.headers.get("etag"));
    expect((await ask("f=4&o=2&m=1", cookie, { "if-none-match": mains.headers.get("etag")! })).status).toBe(304);
    expect((await ask("f=4&o=2&m=1", cookie, { "if-none-match": all.headers.get("etag")! })).status).toBe(200);
    const body = await mains.json();
    expect(body).toMatchObject({ overview: true, mains: true });
    expect(unpackRoaches(body.packed).map((r) => r.clone)).toEqual([false]);
    expect((await all.json()).mains).toBeUndefined();
    // a view: its roaches, or with m=1 its players
    expect(await (await ask("f=4&n=100,20,150,40", cookie)).json()).toEqual({ n: 3 });
    expect(await (await ask("f=4&n=100,20,150,40&m=1", cookie)).json()).toEqual({ n: 1 });
    // m is for f=4 only: other forms take no notice of it
    expect(unpackRoaches((await (await ask("f=3&m=1", cookie)).json()).packed)).toHaveLength(3);
  });
});

describe("全站变灰", () => {
  it("is said by every answer, as 0 while it is off, and the answers and their ETags stay as they were", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const cookie = `sid=${await signIn(a)}`;
    await loadSettings();

    const ask = (query: string, headers: Record<string, string> = {}) =>
      GET(new NextRequest(`http://localhost/api/roaches?${query}`, { headers: { cookie, ...headers } }));
    const everyAnswer = async () => {
      const full = await ask("f=3");
      const area = await ask("f=4&box=121,31,122,32");
      const v = JSON.parse(await full.clone().text()).v as string;
      return {
        visitor: await get(),
        full,
        notModified: await ask("f=3", { "if-none-match": full.headers.get("etag")! }),
        diff: await ask(`f=3&since=${encodeURIComponent(v)}`),
        counts: await ask("f=4&c=1"),
        area,
        areaNotModified: await ask("f=4&box=121,31,122,32", { "if-none-match": area.headers.get("etag")! }),
        overview: await ask("f=4&o=1"),
        squares: await ask("f=4&o=2"),
        view: await ask("f=4&n=120.5,30.5,122.5,32"),
      };
    };

    const off = await everyAnswer();
    for (const [kind, res] of Object.entries(off)) expect([kind, res.headers.get("x-gray")]).toEqual([kind, "0"]);
    const until = Date.now() + 3_600_000;
    await setGray(a, until);
    const on = await everyAnswer();
    expect([on.notModified.status, on.areaNotModified.status]).toEqual([304, 304]);
    for (const [kind, res] of Object.entries(on)) expect([kind, res.headers.get("x-gray")]).toEqual([kind, String(until)]);
    expect(on.full.headers.get("etag")).toBe(off.full.headers.get("etag"));
    expect(await on.full.text()).toBe(await off.full.text());
    expect(on.area.headers.get("etag")).toBe(off.area.headers.get("etag"));

    await endGray();
    expect((await ask("f=3")).headers.get("x-gray")).toBe("0");
  });
});
