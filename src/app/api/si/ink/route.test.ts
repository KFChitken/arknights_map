import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { siInks, siTickets, siTouches, users } from "@/lib/server/schema";
import { forgetSiState } from "@/lib/server/si";
import { forgetInkSnapshot, inkTile } from "@/lib/server/siInk";
import * as world from "@/lib/server/world";
import { SI_ID } from "@/lib/si";
import { INK_BYTES, INK_TILE_V, INK_TILE_ZOOM, OLD_INK_BYTES, tilesOver } from "@/lib/siTiles";
import { GET } from "./route";

const get = (x: number, y: number, more = "") =>
  GET(new NextRequest(`http://localhost/api/si/ink?z=${INK_TILE_ZOOM}&x=${x}&y=${y}${more}`, { headers: { "x-forwarded-for": "198.51.100.8" } }));

/** The village's tiles: the first few ink roaches all stand on one of them */
const VILLAGE = tilesOver({ lng: 117.97, lat: 29.99 }, { lng: 118.0, lat: 30.02 }, INK_TILE_ZOOM, 400);

async function signUp(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${siTouches}, ${siTickets}, ${siInks} cascade`);
  forgetSiState();
  forgetInkSnapshot();
});

describe("缘缘庄's ink tiles", () => {
  it("carry the tap numbers for this page, and for a page from before them, still open, the bytes it reads", async () => {
    for (const email of ["a@example.com", "b@example.com"]) await world.touch(await signUp(email), SI_ID, false, 0);
    const counted = { current: 0, old: 0 };
    for (const t of VILLAGE) {
      const bytes = await inkTile(t.x, t.y);
      if (!bytes.length) continue;
      const now = await get(t.x, t.y, `&v=${INK_TILE_V}`);
      expect(now.headers.get("x-ink-v")).toBe(INK_TILE_V);
      const current = new Uint8Array(await now.arrayBuffer());
      expect(current).toEqual(bytes);
      const before = await get(t.x, t.y);
      expect(before.status).toBe(200);
      expect(before.headers.get("x-ink-v")).toBeNull();
      const old = new Uint8Array(await before.arrayBuffer());
      // the same ink roaches, each in its first bytes: where, which look, how it stands, its brush
      const n = current.length / INK_BYTES;
      expect(old.length).toBe(n * OLD_INK_BYTES);
      for (let i = 0; i < n; i++) {
        expect(old.subarray(i * OLD_INK_BYTES, (i + 1) * OLD_INK_BYTES)).toEqual(current.subarray(i * INK_BYTES, i * INK_BYTES + OLD_INK_BYTES));
      }
      counted.current += n;
      counted.old += old.length / OLD_INK_BYTES;
    }
    expect(counted).toEqual({ current: 2, old: 2 });
    expect((await get(0, 0, "&v=2")).headers.get("x-ink-v")).toBe(INK_TILE_V);
    expect((await get(-1, 0, "&v=2")).status).toBe(400);
  });
});
