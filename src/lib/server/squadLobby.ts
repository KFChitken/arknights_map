import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { SquadTell } from "../squad";
import { isLobbyData, isMatchKind, type MatchKind } from "../squadMode";
import { db } from "./db";
import { squadMembers, squadRooms } from "./schema";

/**
 * A match's initiator (发起人, src/lib/squadMode.ts MATCH_KINDS) as people come and go: kept apart from
 * squadModes.ts so that leaving the room (squad.ts) can hand a match on without the modes' own code.
 */

/** Within a transaction (the room's row locked by it) */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/** What became of a match whose initiator went: handed from one to another (to), or gone with nobody ready (gone) */
export type LobbyNews = { kind: MatchKind; from: number; to?: number; gone?: true };

/** The room's mode gone, everyone out of it. Within the transaction, the room's row locked. */
export async function clearMode(tx: Tx, roomId: string) {
  await tx
    .update(squadRooms)
    .set({ mode: null, modeBy: null, modeAt: null, modeSong: null, modeSongAt: null, modeUntil: null, modeLast: null, modeData: null })
    .where(eq(squadRooms.id, roomId));
  await tx
    .update(squadMembers)
    .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
}

/**
 * A match after someone went (out of it, out to watch, out of the room) or a round ended: its initiator still in the
 * room and ready, nothing; else it is handed to the one ready earliest (the lower number first at the same moment); with
 * nobody ready, one waiting goes (one playing plays on, and is looked at again as its round ends). Within the
 * transaction, the room's row locked by it. Says what became of it, for the room to be told (null: nothing).
 */
export async function handLobby(tx: Tx, roomId: string): Promise<LobbyNews | null> {
  const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
  if (!room || room.endedAt || !isMatchKind(room.mode) || room.modeBy === null) return null;
  const ready = await tx
    .select({ h: squadMembers.handle })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true)))
    .orderBy(asc(squadMembers.modeTapAt), asc(squadMembers.handle));
  if (ready.some((r) => r.h === room.modeBy)) return null;
  const kind = room.mode;
  if (ready.length) {
    await tx.update(squadRooms).set({ modeBy: ready[0].h }).where(eq(squadRooms.id, roomId));
    return { kind, from: room.modeBy, to: ready[0].h };
  }
  if (!isLobbyData(room.modeData)) return null;
  await clearMode(tx, roomId);
  return { kind, from: room.modeBy, gone: true };
}

/** The room's pages told of it: handed (h to by) or gone with nobody ready */
export const lobbyTell = (news: LobbyNews): NonNullable<Extract<SquadTell, { t: "room" }>["what"]> =>
  news.gone
    ? { kind: "mode", h: news.from, on: false, lobby: "gone", mode: news.kind }
    : { kind: "mode", h: news.from, by: news.to, lobby: "hand", mode: news.kind };
