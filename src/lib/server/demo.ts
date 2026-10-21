import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { displayName } from "../profile";
import { passerbyProfile, passersby, TESTERS } from "../world/cast";
import type { Identity } from "../world/types";
import { db } from "./db";
import { declarations, deliveries, friendCuts, friendships, moves, roaches, touches, users } from "./schema";
import { profileColumns, profileOf } from "./world";

/**
 * Demo players for development and testing: the named testers and the
 * passer-by swarm, stored as real players so every feature works on them.
 */

const HOUR = 3_600_000;

export async function seedDemo() {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(isNotNull(users.demoKey));
  if (n > 0) return;

  const now = Date.now();
  const testerRows = TESTERS.map((t) => ({ id: randomUUID(), demoKey: t.id, ...profileColumns(t.profile) }));
  const passerRows = passersby().map((p) => ({ id: randomUUID(), demoKey: p.id, ...profileColumns(passerbyProfile(p)) }));
  const allUsers = [...testerRows, ...passerRows];
  for (let i = 0; i < allUsers.length; i += 1000) await db.insert(users).values(allUsers.slice(i, i + 1000));

  const roachRows = [
    ...TESTERS.flatMap((t, i) =>
      t.roaches.map((at, slot) => ({ userId: testerRows[i].id, slot, lng: at.lng, lat: at.lat })),
    ),
    ...passersby().map((p, i) => ({ userId: passerRows[i].id, slot: 0, lng: p.lng, lat: p.lat })),
  ];
  for (let i = 0; i < roachRows.length; i += 1000) await db.insert(roaches).values(roachRows.slice(i, i + 1000));

  await db.insert(moves).values(
    TESTERS.flatMap((t, i) =>
      t.roaches.map((at, slot) => ({
        userId: testerRows[i].id,
        slot,
        toLng: at.lng,
        toLat: at.lat,
        at: new Date(now - (i * 7 + slot + 1) * HOUR),
      })),
    ),
  );
}

/** Wipe all social activity and the demo players, then seed them again. Real players and their roaches stay. */
export async function resetDemo() {
  await db.delete(touches);
  await db.delete(declarations);
  await db.delete(friendships);
  await db.delete(friendCuts);
  await db.delete(moves);
  await db.delete(users).where(isNotNull(users.demoKey));
  await seedDemo();
}

async function unseenFor(ids: string[]) {
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  const add = (id: string, n: number) => counts.set(id, (counts.get(id) ?? 0) + n);
  const ts = await db
    .select({ id: touches.toUserId, n: sql<number>`count(*)::int` })
    .from(touches)
    .where(and(inArray(touches.toUserId, ids), isNull(touches.seenAt)))
    .groupBy(touches.toUserId);
  for (const r of ts) add(r.id, r.n);
  const ds = await db
    .select({ id: deliveries.recipientId, n: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(and(inArray(deliveries.recipientId, ids), isNull(deliveries.seenAt)))
    .groupBy(deliveries.recipientId);
  for (const r of ds) add(r.id, r.n);
  const fs = await db.select().from(friendships);
  for (const f of fs) {
    if (!f.seenByA && ids.includes(f.a)) add(f.a, 1);
    if (!f.seenByB && ids.includes(f.b)) add(f.b, 1);
  }
  return counts;
}

/** Who you can step into: yourself, the testers, and passers-by somebody touched. */
export async function identities(currentId: string, homeId: string | null): Promise<Identity[]> {
  const me = homeId ?? currentId;
  const testers = await db.select().from(users).where(like(users.demoKey, "t%"));
  const touchedPassers = await db
    .selectDistinct({ id: touches.toUserId })
    .from(touches)
    .innerJoin(users, eq(users.id, touches.toUserId))
    .where(and(isNull(touches.seenAt), like(users.demoKey, "n%")));
  const passerIds = [...new Set([...touchedPassers.map((r) => r.id), currentId])];
  const passers = await db
    .select()
    .from(users)
    .where(and(inArray(users.id, passerIds), like(users.demoKey, "n%")));
  const unseen = await unseenFor([me, ...testers.map((t) => t.id), ...passers.map((p) => p.id)]);

  const out: Identity[] = [
    { id: me, label: "我", note: "你自己", unseen: unseen.get(me) ?? 0, current: currentId === me, group: "me" },
  ];
  for (const key of TESTERS.map((t) => t.id)) {
    const u = testers.find((t) => t.demoKey === key);
    if (!u) continue;
    const p = profileOf(u);
    out.push({
      id: u.id,
      label: p.anonymous && p.name.trim() ? `${p.name.trim()}（匿名）` : displayName(p),
      note: TESTERS.find((t) => t.id === key)!.note,
      unseen: unseen.get(u.id) ?? 0,
      current: currentId === u.id,
      group: "tester",
    });
  }
  for (const u of passers) {
    const index = Number(u.demoKey!.slice(1));
    out.push({
      id: u.id,
      label: `路人舟p #${index + 1}`,
      note: passersby()[index]?.city ?? "",
      unseen: unseen.get(u.id) ?? 0,
      current: currentId === u.id,
      group: "passerby",
    });
  }
  return out;
}
