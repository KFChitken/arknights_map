import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { rollCatch } from "../fish/roll";
import { NET_EVERY_MS, netHeld, type FishHaul } from "../fish/rules";
import { siteDay } from "../siteDay";
import { db } from "./db";
import { fishOpen, localHour } from "./fish";
import { HttpError } from "./http";
import { fishDays, fishDex as dexRows, fishNets, fishRecords, type UserRow } from "./schema";

/**
 * 自动钓 on the bank (钓鳞 ④): switched on, it counts a cast every NET_EVERY_MS from then, the page open or not, and
 * nothing runs meanwhile: 收网 draws them all at once (src/lib/fish/roll.ts, spot auto: grey, green and blue, no
 * variants, no 寻访券 or 漂流瓶), NET_MAX at most and no more than the day's casts left, each one of them; slots past
 * those are gone, and the count goes on from the last whole slot. The player's own casts go on beside it as before.
 * Its catches go into the dex and the site's biggest, but count neither towards blue-or-better after eight without
 * (the player's own pulls') nor towards 空军司令. Switched off, it is pulled in first, so nothing it held is lost.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Netted = { now: number; net: number | null; casts: number; haul: FishHaul | null };

const refuse = (status: number, message: string) => new HttpError(status, message);

/** The net's catches kept: each item and variant once in the dex (how many, the biggest), and the site's biggest */
async function keep(tx: Tx, userId: string, rolls: { no: number; variant: number; cm: number | null }[], now: number): Promise<FishHaul["items"]> {
  const groups = new Map<string, FishHaul["items"][number]>();
  for (const r of rolls) {
    const k = `${r.no}:${r.variant}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { no: r.no, variant: r.variant, n: 1, cm: r.cm, first: false });
    else {
      g.n++;
      if (r.cm !== null && (g.cm === null || r.cm > g.cm)) g.cm = r.cm;
    }
  }
  const items = [...groups.values()];
  const had = await tx
    .select({ item: dexRows.item, variant: dexRows.variant })
    .from(dexRows)
    .where(and(eq(dexRows.userId, userId), inArray(dexRows.item, [...new Set(items.map((i) => i.no))])))
    .for("update");
  for (const g of items) {
    g.first = !had.some((h) => h.item === g.no && h.variant === g.variant);
    await tx
      .insert(dexRows)
      .values({ userId, item: g.no, variant: g.variant, n: g.n, best: g.cm, firstAt: new Date(now), firstSpot: "auto" })
      .onConflictDoUpdate({
        target: [dexRows.userId, dexRows.item, dexRows.variant],
        set: { n: sql`${dexRows.n} + ${g.n}`, best: sql`greatest(${dexRows.best}, excluded.best)` },
      });
    if (g.cm !== null) {
      await tx
        .insert(fishRecords)
        .values({ item: g.no, variant: g.variant, cm: g.cm, at: new Date(now) })
        .onConflictDoUpdate({ target: [fishRecords.item, fishRecords.variant], set: { cm: g.cm, at: new Date(now) }, setWhere: lt(fishRecords.cm, g.cm) });
    }
  }
  return items;
}

/**
 * 收网 (or the net switched off): what it holds drawn and kept, the day's casts counted, and its count moved on (or
 * the net gone). None held: nothing drawn. off and no net: nothing at all.
 */
async function pull(user: Pick<UserRow, "id">, tz: unknown, off: boolean, now: number, random: () => number): Promise<Netted> {
  const day = siteDay(now);
  return db.transaction(async (tx) => {
    const [net] = await tx.select().from(fishNets).where(eq(fishNets.userId, user.id)).for("update");
    await tx.insert(fishDays).values({ userId: user.id, day }).onConflictDoNothing();
    const [today] = await tx
      .select({ casts: fishDays.casts })
      .from(fishDays)
      .where(and(eq(fishDays.userId, user.id), eq(fishDays.day, day)))
      .for("update");
    if (!net) {
      if (off) return { now, net: null, casts: today.casts, haul: null };
      throw refuse(409, T.server.fish.netOff);
    }
    const since = net.since.getTime();
    const slots = Math.max(0, Math.floor((now - since) / NET_EVERY_MS));
    const n = netHeld(since, now, today.casts);
    const next = since + slots * NET_EVERY_MS;
    if (off) await tx.delete(fishNets).where(eq(fishNets.userId, user.id));
    else if (slots > 0) await tx.update(fishNets).set({ since: new Date(next) }).where(eq(fishNets.userId, user.id));
    if (n === 0) return { now, net: off ? null : next, casts: today.casts, haul: { casts: 0, items: [] } };
    const hour = localHour(now, tz);
    const rolls = Array.from({ length: n }, () => rollCatch({ spot: "auto", dry: 0, hour, crowd: 0, caught: () => 0, random }));
    const items = await keep(tx, user.id, rolls, now);
    const [after] = await tx
      .update(fishDays)
      .set({ casts: sql`${fishDays.casts} + ${n}` })
      .where(and(eq(fishDays.userId, user.id), eq(fishDays.day, day)))
      .returning({ casts: fishDays.casts });
    return { now, net: off ? null : next, casts: after.casts, haul: { casts: n, items } };
  });
}

/** 自动钓 switched on (counting from now; on already, as it was) or off (pulled in first) */
export async function setNet(user: Pick<UserRow, "id" | "email">, body: Record<string, unknown>, now = Date.now(), random: () => number = Math.random): Promise<Netted> {
  if (!fishOpen(user)) throw refuse(404, T.server.routes.fish.notHere);
  if (typeof body.on !== "boolean") throw refuse(400, T.server.fish.badNet);
  if (!body.on) return pull(user, body.tz, true, now, random);
  await db.insert(fishNets).values({ userId: user.id, since: new Date(now) }).onConflictDoNothing();
  const [[net], [today]] = await Promise.all([
    db.select({ since: fishNets.since }).from(fishNets).where(eq(fishNets.userId, user.id)),
    db
      .select({ casts: fishDays.casts })
      .from(fishDays)
      .where(and(eq(fishDays.userId, user.id), eq(fishDays.day, siteDay(now)))),
  ]);
  return { now, net: net ? net.since.getTime() : null, casts: today?.casts ?? 0, haul: null };
}

/** 收网: what the net holds, all at once; it stays on */
export async function haulNet(user: Pick<UserRow, "id" | "email">, body: Record<string, unknown>, now = Date.now(), random: () => number = Math.random): Promise<Netted> {
  if (!fishOpen(user)) throw refuse(404, T.server.routes.fish.notHere);
  return pull(user, body.tz, false, now, random);
}
