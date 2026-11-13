import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { badgeById } from "../badges";
import { MAX_CLONES } from "../rules";
import { SI_ID, STAMP_MILESTONES, STAMPS, STAMPS_PER_ROUND } from "../si";
import { decodeTile, INK_BYTES, INK_TILE_ZOOM, oldTile, OLD_INK_BYTES, tapOf, tilesOver, type InkPoint } from "../siTiles";
import type { LngLat } from "../types";
import { db } from "./db";
import { roaches, siInks, siTickets, siTouches, touches, userBadges, users } from "./schema";
import * as si from "./si";
import { forgetInkSnapshot, inkTile } from "./siInk";
import * as world from "./world";

// 祀 round 2, block 4: the 集章本 full the first time gives 再给你加几页 and puts her seal on 墨小强, for everyone
// to see on the map. Runs against the database named in vitest.config.mts, wiped before every test.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BEIJING = -480;
const g = globalThis as typeof globalThis & { __siShift?: number; __siWrongNext?: boolean };
/** Her clock this far on */
const at = (ms: number) => {
  g.__siShift = ms;
};
/** Her clock pinned to day d after tomorrow's midnight in Beijing, at h:m there (her day turns at 04:00) */
function pinner() {
  const bj = new Date(Date.now() + 8 * HOUR);
  const midnight = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 1) - 8 * HOUR;
  return (d: number, h: number, m: number) => at(midnight + d * DAY + h * HOUR + m * 60_000 - Date.now());
}

async function signUp(email: string, avatar = "hood") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, avatar, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}
/** A touch of hers from a device on Beijing time */
const touchSi = (id: string) => world.touch(id, SI_ID, false, BEIJING);
const herCard = async (id: string) => (await world.me(id, BEIJING))!.si;
const inkRow = async (id: string) => (await db.select().from(siInks).where(eq(siInks.userId, id)))[0];
const badges = async (id: string) => (await db.select().from(userBadges).where(eq(userBadges.userId, id))).map((b) => b.badge).sort();
/** Stamps already in the book, as if from the days before */
const stampsSoFar = (id: string, n: number) => db.update(users).set({ siStamps: n }).where(eq(users.id, id));

const SHANGHAI: LngLat = { lng: 121.4737, lat: 31.2304 };
/** The village's tiles: every ink roach of a small crowd stands on one of them */
const VILLAGE = tilesOver({ lng: 117.97, lat: 29.99 }, { lng: 118.0, lat: 30.02 }, INK_TILE_ZOOM, 400);
/** Every ink roach on the tiles as this page reads them, with its bytes as a page from before the seal has them */
async function onTiles() {
  const all: { ink: InkPoint; old: Uint8Array }[] = [];
  for (const t of VILLAGE) {
    const bytes = await inkTile(t.x, t.y);
    expect(bytes.length % INK_BYTES).toBe(0);
    const old = oldTile(bytes);
    decodeTile(t.x, t.y, INK_TILE_ZOOM, bytes).forEach((ink, i) => all.push({ ink, old: old.subarray(i * OLD_INK_BYTES, (i + 1) * OLD_INK_BYTES) }));
  }
  return all;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${roaches}, ${touches}, ${siTouches}, ${siTickets}, ${siInks} cascade`);
  at(0);
  g.__siWrongNext = false;
  si.pretendVisitors(null);
  si.forgetSiState();
  forgetInkSnapshot();
});

describe("集章本 full", () => {
  it("is 再给你加几页, her line at the 30th stamp word for word", () => {
    expect(badgeById("sibook")).toMatchObject({ code: "GD-SI-BOOK", series: "guides", pictureArt: "badge-sibook" });
    expect(badgeById("sibook")!.quote).toBe(STAMP_MILESTONES[STAMPS_PER_ROUND]);
  });

  it("gives the badge with the 30th stamp, at 04:10 in Beijing as her day turns, not the 29th at 03:50, and seals 墨小强 for all", async () => {
    const pin = pinner();
    const a = await signUp("a@example.com", "doctor");
    const b = await signUp("b@example.com", "imp");
    pin(0, 10, 0);
    expect((await touchSi(a)).si).toMatchObject({ stamp: { stamps: 1 }, you: { sealed: false } });
    await touchSi(b);
    await stampsSoFar(a, STAMPS_PER_ROUND - 2);

    // before 04:00 in Beijing, still the day before by her: the 29th
    pin(2, 3, 50);
    const t29 = await touchSi(a);
    expect(t29.si).toMatchObject({ stamp: { stamps: STAMPS_PER_ROUND - 1 }, you: { sealed: false } });
    expect(await badges(a)).not.toContain("sibook");
    expect(await inkRow(a)).toMatchObject({ sealed: false });
    const before = (await inkRow(a)).changed;
    // the map as this process reads it now: neither sealed
    expect((await onTiles()).map((t) => t.ink.sealed)).toEqual([false, false]);

    // her day turned: the 30th, her own 「祀」; the badge, and her seal on 墨小强
    pin(2, 4, 10);
    const t30 = await touchSi(a);
    expect(t30.si!.stamp).toEqual({ stamp: STAMPS_PER_ROUND - 1, stamps: STAMPS_PER_ROUND });
    expect(STAMPS[t30.si!.stamp!.stamp]).toBe("祀");
    expect(t30.si!.you).toMatchObject({ sealed: true });
    expect(await badges(a)).toContain("sibook");
    const sealed = await inkRow(a);
    expect(sealed.sealed).toBe(true);
    expect(sealed.changed).toBeGreaterThan(before);
    expect((await herCard(a)).inn).toMatchObject({ sealed: true });
    expect(await inkRow(b)).toMatchObject({ sealed: false });
    expect((await herCard(b)).inn).toMatchObject({ sealed: false });

    // on the tiles, read again at once by the process that sealed it, not half a minute on: theirs with the seal's
    // bit, the other's without; a page from before the seal reads both as it did
    const tiles = await onTiles();
    expect(tiles).toHaveLength(2);
    const aTap = tapOf(sealed.publicId);
    const theirs = tiles.find((t) => t.ink.tap === aTap)!;
    const other = tiles.find((t) => t.ink.tap !== aTap)!;
    expect(theirs.ink).toMatchObject({ sealed: true, look: 1 });
    expect(other.ink).toMatchObject({ sealed: false, look: 3 });
    expect(theirs.old[4] & 64).toBe(64);
    expect(other.old[4] & 64).toBe(0);
    // as such a page takes its look, how it stands and which way it faces
    const asBefore = (bytes: Uint8Array) => ({ look: bytes[4] & 7, state: (bytes[4] >> 3) & 3, left: (bytes[4] & 32) !== 0 });
    for (const t of tiles) expect(asBefore(t.old)).toEqual({ look: t.ink.look, state: t.ink.state, left: t.ink.left });

    // again that day: no stamp, nothing new
    pin(2, 4, 20);
    expect((await touchSi(a)).si).toMatchObject({ stamp: null, you: { sealed: true } });
    expect((await inkRow(a)).changed).toBe(sealed.changed);

    // the next day the book goes round again: the seal stays, the badge given once
    pin(3, 4, 10);
    expect((await touchSi(a)).si).toMatchObject({ stamp: { stamps: STAMPS_PER_ROUND + 1 }, you: { sealed: true } });
    expect((await badges(a)).filter((id) => id === "sibook")).toEqual(["sibook"]);
    expect(await inkRow(a)).toMatchObject({ sealed: true });
  });

  it("seals one recalled and resting all the same, and shows it sealed once it is back", async () => {
    const pin = pinner();
    const a = await signUp("a@example.com", "gugu");
    pin(0, 23, 0);
    await touchSi(a);
    pin(0, 23, 10);
    await si.recallInk(a);
    await stampsSoFar(a, STAMPS_PER_ROUND - 1);
    // a new day by her at 04:00, five hours into its twelve of rest
    pin(1, 4, 10);
    const t30 = await touchSi(a);
    expect(t30.si).toMatchObject({ stamp: { stamps: STAMPS_PER_ROUND }, inn: { event: "resting" }, you: { state: "held", sealed: true } });
    expect(await badges(a)).toContain("sibook");
    expect(await onTiles()).toEqual([]);
    // its rest over, it is back, her seal on it, on the map as every process reads it again half a minute on
    pin(1, 11, 20);
    expect((await touchSi(a)).si).toMatchObject({ stamp: null, inn: { event: "in" }, you: { sealed: true } });
    forgetInkSnapshot();
    expect((await onTiles()).map((t) => t.ink)).toEqual([expect.objectContaining({ tap: tapOf((await inkRow(a)).publicId), sealed: true })]);
  });

  it("seals one held while its owner has five clones, and gives the badge", async () => {
    const pin = pinner();
    const a = await signUp("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    for (let i = 0; i < MAX_CLONES; i++) await world.placeRoach(a, { kind: "clone" }, { lng: SHANGHAI.lng + 0.01 * (i + 1), lat: SHANGHAI.lat });
    pin(0, 10, 0);
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: true, event: "full" });
    await stampsSoFar(a, STAMPS_PER_ROUND - 1);
    pin(1, 10, 0);
    const t30 = await touchSi(a);
    expect(t30.si).toMatchObject({ stamp: { stamps: STAMPS_PER_ROUND }, inn: { event: "full" }, you: { state: "held", sealed: true } });
    expect(await badges(a)).toContain("sibook");
    expect(await inkRow(a)).toMatchObject({ ticket: null, sealed: true });
    expect(await onTiles()).toEqual([]);
  });
});
