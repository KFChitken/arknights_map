import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { resetRoachFeed } from "@/lib/server/roachFeed";
import { users } from "@/lib/server/schema";
import { GET } from "./route";

const get = (q: string, ip = "198.51.100.7") => GET(new NextRequest(`http://localhost/api/around?${q}`, { headers: { "x-forwarded-for": ip } }));

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  resetRoachFeed();
});

describe("roaches around a spot, for visitors", () => {
  it("counts roughly, from the server's own snapshot", async () => {
    // 13 within a few kilometres of the middle of Shanghai, 3 some 50 km out
    const spots = [
      ...Array.from({ length: 13 }, (_, i) => ({ lng: 121.47 + (i % 4) * 0.01, lat: 31.23 + Math.floor(i / 4) * 0.01 })),
      ...Array.from({ length: 3 }, (_, i) => ({ lng: 121.0 + i * 0.01, lat: 31.0 })),
    ];
    for (const [i, at] of spots.entries()) {
      const [u] = await db.insert(users).values({ email: `p${i}@example.com` }).returning({ id: users.id });
      await db.execute(sql`insert into roaches (user_id, slot, lng, lat, public_id) values (${u.id}, 0, ${at.lng}, ${at.lat}, gen_random_uuid())`);
    }
    const res = await get("lng=121.4712&lat=31.2309");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ near: 10, far: 10 });
    expect(await (await get("lng=100&lat=30")).json()).toEqual({ near: 0, far: 0 });
  });

  it("turns away spots that are not on the map, and a script walking it", async () => {
    for (const q of ["lng=200&lat=30", "lng=121&lat=", "lat=31", "lng=abc&lat=31"]) expect((await get(q)).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await get("lng=121.47&lat=31.23", "203.0.113.9")).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
