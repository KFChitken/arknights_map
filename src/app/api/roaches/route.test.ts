import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetSessionChecks } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { resetRoachFeed } from "@/lib/server/roachFeed";
import { sessions, users } from "@/lib/server/schema";
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
      expect(body).toMatchObject({ hidden: true, total: 3, fire: 1, riders: 0 });
      expect(Object.keys(body).sort()).toEqual(["fire", "hidden", "riders", "total", "v"]);
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
});
