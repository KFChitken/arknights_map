import { useSyncExternalStore } from "react";
import { fmt, T } from "@/i18n";
import { SAY_MERGE_MS, SAY_SHOW_MS, type SquadCard, type SquadEnd, type SquadMe, type SquadRoom, type SquadTell } from "@/lib/squad";
import { squadApi } from "@/lib/squadClient";
import type { TouchResult } from "@/lib/world/types";

/**
 * 一起卫戍 on the map page (src/lib/squad.ts): the room the player is in, kept here so the bar over the map and the
 * sheet (SquadSheet.tsx, loaded only when opened) read the same; what the room is told (the event stream's "squad",
 * MapApp.tsx) read again or shown; the set lines and what the site says floating a few seconds each; and why the last
 * room was over for them. Requests go through src/lib/squadClient.ts, and their refusals are thrown to the caller.
 */

function kept<S>(first: S) {
  let now = first;
  const fns = new Set<() => void>();
  return {
    get: () => now,
    set(next: S) {
      if (Object.is(next, now)) return;
      now = next;
      for (const fn of [...fns]) fn();
    },
    on(fn: () => void) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
  };
}

/** A line floating in the room: one said (by a number of the room, merged ×n), or what the site says (sys) */
export type SquadFloat = { key: number; text: string; sys: boolean };
type Float = SquadFloat & { p: number | null; n: number; first: number; name: string };

const NO_FLOATS: Float[] = [];
const room = kept<SquadRoom | null>(null);
const floats = kept<Float[]>(NO_FLOATS);
/** What was said as the last room was over for them (it ended, they were asked to leave), until they are in another */
const notice = kept<string | null>(null);
/** Their 卫戍名片 as last saved (undefined: as me() gave it) */
const card = kept<SquadCard | null | undefined>(undefined);

export const squadRoomNow = room.get;
export const useSquadRoom = () => useSyncExternalStore(room.on, room.get, () => null);
export const useSquadFloats = (): SquadFloat[] => useSyncExternalStore(floats.on, floats.get, () => NO_FLOATS);
export const useSquadNotice = () => useSyncExternalStore(notice.on, notice.get, () => null);
export const useSquadCard = () => useSyncExternalStore(card.on, card.get, () => undefined);
export const clearSquadNotice = () => notice.set(null);

let floatKey = 0;
const FLOATS_SHOWN = 3;

function addFloat(f: Omit<Float, "key" | "first">) {
  const now = Date.now();
  const list = floats.get();
  // the same line again soon: one float, ×n
  const same = f.p !== null ? list.find((x) => x.p === f.p && now - x.first < SAY_MERGE_MS) : undefined;
  if (same) {
    const n = same.n + 1;
    floats.set(list.map((x) => (x === same ? { ...x, n, text: fmt(T.squad.say.times, { line: T.squad.say.lines[f.p! - 1], n }) } : x)));
    return;
  }
  const key = ++floatKey;
  floats.set([...list, { ...f, key, first: now }].slice(-FLOATS_SHOWN));
  window.setTimeout(() => floats.set(floats.get().filter((x) => x.key !== key)), SAY_SHOW_MS);
}

const nameOf = (r: SquadRoom | null, h: number | undefined) => r?.members.find((m) => m.h === h)?.name ?? null;

/** In a room, or out of it: what was said of the last goes once they are in another */
function setRoom(next: SquadRoom | null) {
  if (next) notice.set(null);
  if (!next) floats.set(NO_FLOATS);
  room.set(next);
}

/** The room as the server has it now (null: none) */
export async function loadSquadRoom(): Promise<SquadRoom | null> {
  const { room: r } = await squadApi.room();
  setRoom(r);
  return r;
}

/** At the page's start (me().squad): their card, and the room they are in, read */
export function startSquad(me: SquadMe) {
  if (card.get() === undefined) card.set(me.card);
  if (me.room && !room.get()) void loadSquadRoom().catch(() => {});
  if (!me.room && room.get()) setRoom(null);
}

/** Out of the room, with why */
function over(text: string) {
  setRoom(null);
  notice.set(text);
}

/** What the room you are in was told (the event stream's "squad") */
export function heardSquad(raw: unknown) {
  let tell: SquadTell;
  try {
    tell = JSON.parse(String(raw)) as SquadTell;
  } catch {
    return;
  }
  const r = room.get();
  if (!r || tell.room !== r.id) {
    // one that came before the room was read (just in) is not lost: it is read again anyway
    if (tell.t === "room" && !r) void loadSquadRoom().catch(() => {});
    return;
  }
  if (tell.t === "end") return over(T.squad.ended[tell.why as SquadEnd] ?? T.squad.ended.host);
  if (tell.t === "you") return over(tell.why === "kicked" ? T.squad.out.kicked : T.squad.out.left);
  if (tell.t === "say") {
    for (const it of tell.items) {
      const line = T.squad.say.lines[it.p - 1];
      const name = nameOf(r, it.h);
      if (!line || !name) continue;
      addFloat({ p: it.p, n: 1, name, text: fmt(T.squad.say.who, { name, line }), sys: false });
    }
    return;
  }
  void loadSquadRoom()
    .then((next) => {
      const what = tell.t === "room" ? tell.what : undefined;
      if (!next || !what) return;
      // what you did yourself is not said back to you
      if ((what.kind === "in" || what.kind === "game") && what.h === next.you) return;
      if ((what.kind === "key" || what.kind === "state") && next.host) return;
      const name = nameOf(next, what.h);
      const text =
        what.kind === "in" && name
          ? fmt(T.squad.float.in, { name })
          : what.kind === "game" && name
            ? fmt(T.squad.float.game, { name })
            : what.kind === "key"
              ? T.squad.float.key
              : what.kind === "state"
                ? what.to === "go"
                  ? T.squad.float.go
                  : T.squad.float.wait
                : null;
      if (text) addFloat({ p: null, n: 1, name: "", text, sys: true });
    })
    .catch(() => {});
}

/** After the event stream was down a while: the room as it is now */
export function squadStreamBack() {
  if (room.get()) void loadSquadRoom().catch(() => {});
}

// ---- what the player does ----

/** Their 卫戍名片 saved (null clears it) */
export async function saveSquadCard(next: SquadCard | null) {
  const { card: saved } = await squadApi.card(next);
  card.set(saved);
  return saved;
}

export async function openSquadRoom(form: { key: string; server: string; level: number; tags: number[]; friendsOnly: boolean }) {
  const { room: r } = await squadApi.open(form);
  setRoom(r);
  return r;
}

export async function joinSquadRoom(id: string) {
  const { room: r } = await squadApi.join(id);
  setRoom(r);
  return r;
}

export async function leaveSquadRoom() {
  await squadApi.leave();
  setRoom(null);
}

/** The host's 等人, 开打 or 结束 */
export async function squadState(to: "wait" | "go" | "end") {
  const { room: r } = await squadApi.state(to);
  setRoom(r);
  if (to === "end") notice.set(null);
  return r;
}

const after = async (p: Promise<{ room: SquadRoom | null }>) => {
  const { room: r } = await p;
  setRoom(r);
  return r;
};
export const changeSquadKey = (key: string) => after(squadApi.key(key));
export const kickFromSquad = (h: number) => after(squadApi.kick(h));
export const setSquadInGame = (on: boolean) => after(squadApi.game(on));
export const setSquadPrefs = (c: SquadCard) => after(squadApi.prefs(c));

/** 偷偷碰 or 大胆碰 someone in the room; made 触须之交 by it, the room read again */
export async function touchInSquad(h: number, bold: boolean): Promise<TouchResult> {
  const res = await squadApi.touch(h, bold);
  if (res.newFriend) void loadSquadRoom().catch(() => {});
  return res;
}

/** A set line: false when it was one too many (full: the hour's are used up); shown to them at once */
export async function sayInSquad(p: number): Promise<{ sent: boolean; full?: boolean }> {
  const res = await squadApi.say(p);
  const r = room.get();
  if (res.sent && r) {
    const name = nameOf(r, r.you) ?? "";
    addFloat({ p, n: 1, name, text: fmt(T.squad.say.who, { name, line: T.squad.say.lines[p - 1] }), sys: false });
  }
  return res;
}

/** Signed out: nothing kept */
export function forgetSquadPage() {
  setRoom(null);
  notice.set(null);
  card.set(undefined);
}
