import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { resetRoachFeed, roachArea, roachCounts } from "./roachFeed";
import { users } from "./schema";
import * as world from "./world";

// a few show roaches (world/bots.ts), which belong to nobody
vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), SHOW_BOTS: 5 }));

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  resetRoachFeed();
});

describe("players, with show roaches on the map", () => {
  it("counts the show roaches among the roaches, but as nobody's", async () => {
    const [a] = await db
      .insert(users)
      .values({ email: "a@example.com", policyAcceptedAt: new Date(), crossBorderAcceptedAt: new Date(), publicPlaceAcceptedAt: new Date() })
      .returning({ id: users.id });
    await world.placeRoach(a.id, { kind: "main" }, { lng: 121.47, lat: 31.23 });
    await world.placeRoach(a.id, { kind: "clone" }, { lng: 139.7, lat: 35.68 });
    expect(await roachCounts()).toMatchObject({ total: 7, players: 1 });
    const overview = await roachArea("overview", null);
    expect(overview.kind === "full" && JSON.parse(overview.whole.json).t).toEqual([7, 0, 0, 1]);
  });
});
