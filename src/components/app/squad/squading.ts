import { useSyncExternalStore } from "react";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import {
  isPhrase,
  LAST_LINE_MS,
  SAY_SHOW_MS,
  SQUAD_MAX,
  type SquadBotDo,
  type SquadCall,
  type SquadCard,
  type SquadEnd,
  type SquadInviteSent,
  type SquadMe,
  type SquadMember,
  type SquadMove,
  type SquadPose,
  type SquadRoom,
  type SquadRound,
  type SquadSongChange,
  type SquadTell,
} from "@/lib/squad";
import { squadApi } from "@/lib/squadClient";
import type { TouchResult } from "@/lib/world/types";
import { loadSquadTracks, squadSongs, squadTrackName, unfollowSquad } from "./squadMusic";
import { squadPop } from "./squadSound";

/**
 * 一起卫戍 on the map page (src/lib/squad.ts): the room the player is in, kept here so the bars over the map and the
 * sheet (SquadSheet.tsx, loaded only when opened) read the same; what the room is told (the event stream's "squad",
 * MapApp.tsx) read again, taken as it is, or shown; the set lines over the roaches that said them (with 啵,
 * squadSound.ts) and the moves they do; what the site says floating a few seconds each; and why the last room was over
 * for them. Requests go through src/lib/squadClient.ts, and their refusals are thrown to the caller.
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

/** What the site says in the room (someone came in, a new key, a song), floating a few seconds */
export type SquadFloat = { key: number; text: string };
/** A line said, over its roach (BUBBLE_MS) and under it (刚才, LAST_LINE_MS); key tells one from the next */
export type SquadLine = { key: number; h: number; p: number; at: number };
/** A move done (动作) by h, with the teammate to for 击掌 and 贴贴, shown on the roaches MOVE_SHOW_MS */
export type SquadMoveDone = { key: number; h: number; move: SquadMove; to?: number; at: number };

const NO_FLOATS: SquadFloat[] = [];
const NO_LINES: SquadLine[] = [];
const NO_MOVES: SquadMoveDone[] = [];
const NO_TOUCHED: Readonly<Record<number, "sneaky" | "bold">> = {};
const room = kept<SquadRoom | null>(null);
const floats = kept<SquadFloat[]>(NO_FLOATS);
const lines = kept<SquadLine[]>(NO_LINES);
const moves = kept<SquadMoveDone[]>(NO_MOVES);
/** Who in the room this page touched (碰), by their number: sneakily (a bold touch may follow) or boldly */
const touched = kept(NO_TOUCHED);
/** How many rounds have started in sight of this page (开始游戏): the sheet makes way for the bar of the round */
const rounds = kept(0);
/** A round started while the player marked no strategy for it: 这局 opens first, with a dot, until they look */
const roundUnseen = kept(false);
/** What was said as the last room was over for them (it ended, they were asked to leave), until they are in another */
const notice = kept<string | null>(null);
/** Their 卫戍名片 as last saved, and its 列表上显示我的名字 (undefined: as me() gave them) */
const card = kept<SquadCard | null | undefined>(undefined);
const showName = kept<boolean | undefined>(undefined);

export const squadRoomNow = room.get;
export const useSquadRoom = () => useSyncExternalStore(room.on, room.get, () => null);
export const useSquadFloats = (): SquadFloat[] => useSyncExternalStore(floats.on, floats.get, () => NO_FLOATS);
export const useSquadLines = (): SquadLine[] => useSyncExternalStore(lines.on, lines.get, () => NO_LINES);
export const useSquadMoves = (): SquadMoveDone[] => useSyncExternalStore(moves.on, moves.get, () => NO_MOVES);
export const useSquadTouched = () => useSyncExternalStore(touched.on, touched.get, () => NO_TOUCHED);
/** A touch of someone in the room went (by their number): their card says so */
export const markSquadTouched = (h: number, bold: boolean) => touched.set({ ...touched.get(), [h]: bold ? "bold" : "sneaky" });
export const useSquadRounds = () => useSyncExternalStore(rounds.on, rounds.get, () => 0);
export const useSquadRoundUnseen = () => useSyncExternalStore(roundUnseen.on, roundUnseen.get, () => false);
export const seeSquadRound = () => roundUnseen.set(false);

/** 说话 / 动作 / 这局, open (from your tile on the bar, or your roach in the fight on the map) */
const talkOpen = kept(false);
export const useSquadTalkOpen = () => useSyncExternalStore(talkOpen.on, talkOpen.get, () => false);
export const openSquadTalk = () => talkOpen.set(true);
export const closeSquadTalk = () => talkOpen.set(false);

/** The fight on the map, on this device: 看打怪 (on, unless this device said 看地图), kept in its storage */
const SCENE_KEY = "squad.scene";
let sceneOnNow: boolean | null = null;
const sceneFns = new Set<() => void>();
function sceneOnGet() {
  if (sceneOnNow === null) {
    try {
      sceneOnNow = typeof window === "undefined" || window.localStorage.getItem(SCENE_KEY) !== "0";
    } catch {
      sceneOnNow = true;
    }
  }
  return sceneOnNow;
}
const sceneOnSub = (fn: () => void) => {
  sceneFns.add(fn);
  return () => {
    sceneFns.delete(fn);
  };
};
export const useSquadSceneOn = () => useSyncExternalStore(sceneOnSub, sceneOnGet, () => true);
export function setSquadSceneOn(on: boolean) {
  sceneOnNow = on;
  try {
    if (on) window.localStorage.removeItem(SCENE_KEY);
    else window.localStorage.setItem(SCENE_KEY, "0");
  } catch {
    // for this page alone
  }
  for (const fn of [...sceneFns]) fn();
}
/** The fight shows on the map now: lines come out of its roaches, not the bar's tiles */
const sceneShows = kept(false);
export const useSquadSceneShows = () => useSyncExternalStore(sceneShows.on, sceneShows.get, () => false);
export const setSquadSceneShows = (on: boolean) => sceneShows.set(on);
export const useSquadNotice = () => useSyncExternalStore(notice.on, notice.get, () => null);
export const useSquadCard = () => useSyncExternalStore(card.on, card.get, () => undefined);
export const useSquadShowName = () => useSyncExternalStore(showName.on, showName.get, () => undefined);
export const clearSquadNotice = () => notice.set(null);

let floatKey = 0;
const FLOATS_SHOWN = 3;

function addFloat(text: string) {
  const key = ++floatKey;
  floats.set([...floats.get(), { key, text }].slice(-FLOATS_SHOWN));
  window.setTimeout(() => floats.set(floats.get().filter((x) => x.key !== key)), SAY_SHOW_MS);
}

/** A move shows this long on the roaches */
export const MOVE_SHOW_MS = 1_600;
/** Your own line or move, shown as you sent it, is not shown again as the room tells it back within this long */
const ECHO_MS = 4_000;
let talkKey = 0;

/** The seat of h in the room (0 the first), for the pitch of its 啵 */
const seatOf = (r: SquadRoom, h: number) => Math.max(0, r.members.findIndex((m) => m.h === h));

/** A line said by h: its bubble takes the place of their last, its 刚才 stays LAST_LINE_MS; 啵 */
function showLine(r: SquadRoom, h: number, p: number) {
  const key = ++talkKey;
  lines.set([...lines.get().filter((l) => l.h !== h), { key, h, p, at: Date.now() }]);
  window.setTimeout(() => lines.set(lines.get().filter((l) => l.key !== key)), LAST_LINE_MS);
  squadPop(seatOf(r, h));
}

function showMove(h: number, move: SquadMove, to?: number) {
  const key = ++talkKey;
  moves.set([...moves.get().filter((m) => m.h !== h), { key, h, move, ...(to === undefined ? {} : { to }), at: Date.now() }]);
  window.setTimeout(() => moves.set(moves.get().filter((m) => m.key !== key)), MOVE_SHOW_MS);
}

/** The round the player marked (这局) and not yet sent: kept on their own tile over what the server says meanwhile */
let roundWant: SquadRound | null = null;
let roundTimer = 0;
/** Taps on 这局 are sent once they stop this long, the round as it is then */
export const ROUND_SEND_MS = 600;
const withWant = (r: SquadRoom): SquadRoom => (roundWant ? { ...r, members: r.members.map((m) => (m.you ? { ...m, ...roundWant } : m)) } : r);

/**
 * In a room, or out of it: what was said of the last goes once they are in another; its songs to the player; a round
 * that starts in sight counted (rounds), and noted for 这局 when the player marked no strategy for it
 */
function setRoom(next: SquadRoom | null) {
  const before = room.get();
  if (next) notice.set(null);
  if (!next || next.id !== before?.id) {
    floats.set(NO_FLOATS);
    lines.set(NO_LINES);
    moves.set(NO_MOVES);
    touched.set(NO_TOUCHED);
  }
  if (next && next.state === "go" && (before?.id !== next.id || before.state !== "go")) {
    rounds.set(rounds.get() + 1);
    roundUnseen.set(next.members.find((m) => m.you)?.strategy === null);
  }
  if (!next || next.state !== "go") roundUnseen.set(false);
  room.set(next && withWant(next));
  squadSongs(next && next.dj ? { id: next.id, queue: next.queue, idx: next.idx, startedAt: next.startedAt, version: next.version } : null, next?.now);
}

let loading: Promise<SquadRoom | null> | null = null;
let again = false;

/** The room as the server has it now (null: none); asked for while an answer is on its way, asked once more after it */
export async function loadSquadRoom(): Promise<SquadRoom | null> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      let r: SquadRoom | null;
      do {
        again = false;
        r = (await squadApi.room()).room;
        setRoom(r);
      } while (again);
      return r;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** One in the room changed as told (round, pose): taken as it is, or the room read again when they are not known yet */
function patchMember(r: SquadRoom, h: number | undefined, change: Partial<SquadMember>) {
  if (!r.members.some((m) => m.h === h)) return void loadSquadRoom().catch(() => {});
  room.set(withWant({ ...r, members: r.members.map((m) => (m.h === h ? { ...m, ...change } : m)) }));
}

/** At the page's start (me().squad): their card, and the room they are in, read */
export function startSquad(me: SquadMe) {
  if (card.get() === undefined) card.set(me.card);
  if (showName.get() === undefined) showName.set(me.showName);
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
  if (tell.t === "room" && tell.what?.kind === "round" && tell.what.round) return patchMember(r, tell.what.h, tell.what.round);
  if (tell.t === "room" && tell.what?.kind === "pose" && tell.what.pose !== undefined) return patchMember(r, tell.what.h, { pose: tell.what.pose });
  if (tell.t === "songs") {
    // the songs told, unless a newer answer has them already
    if (tell.version > r.version) {
      const next = { ...r, queue: tell.queue, idx: tell.idx, startedAt: tell.startedAt, version: tell.version };
      room.set(next);
      if (next.dj) squadSongs({ id: next.id, queue: next.queue, idx: next.idx, startedAt: next.startedAt, version: next.version });
    }
    if (!r.host && (tell.how === "start" || tell.how === "next" || tell.how === "restart")) {
      const first = tell.queue[tell.idx];
      void loadSquadTracks().then(() => {
        const name = first ? squadTrackName(first) : null;
        if (name) addFloat(fmt(T.squad.float.song, { name }));
      });
    }
    return;
  }
  if (tell.t === "say") {
    for (const it of tell.items) {
      if (!isPhrase(it.p) || !r.members.some((m) => m.h === it.h)) continue;
      // your own, shown as you said it
      if (it.h === r.you && lines.get().some((l) => l.h === it.h && l.p === it.p && Date.now() - l.at < ECHO_MS)) continue;
      showLine(r, it.h, it.p);
    }
    return;
  }
  if (tell.t === "move") {
    for (const it of tell.items) {
      if (!r.members.some((m) => m.h === it.h)) continue;
      if (it.h === r.you && moves.get().some((m) => m.h === it.h && m.move === it.move && Date.now() - m.at < ECHO_MS)) continue;
      showMove(it.h, it.move, it.to);
    }
    return;
  }
  // what a page of now does not know of: nothing to do
  if (tell.t !== "room") return;
  void loadSquadRoom()
    .then((next) => {
      const what = tell.t === "room" ? tell.what : undefined;
      if (!next || !what) return;
      // what you did yourself is not said back to you
      if ((what.kind === "in" || what.kind === "game") && what.h === next.you) return;
      if ((what.kind === "key" || what.kind === "state" || what.kind === "stop") && next.host) return;
      const name = next.members.find((m) => m.h === what.h)?.name ?? null;
      const text =
        what.kind === "ask"
          ? T.squad.float.ask
          : what.kind === "in" && name
          ? fmt(T.squad.float.in, { name })
          : what.kind === "game" && name
            ? fmt(T.squad.float.game, { name })
            : what.kind === "key"
              ? T.squad.float.key
              : what.kind === "stop"
                ? what.on
                  ? T.squad.float.stopped
                  : T.squad.float.resumed
                : what.kind === "state"
                ? what.to === "go"
                  ? T.squad.float.go
                  : T.squad.float.wait
                : null;
      if (text) addFloat(text);
    })
    .catch(() => {});
}

/** After the event stream was down a while: the room as it is now */
export function squadStreamBack() {
  if (room.get()) void loadSquadRoom().catch(() => {});
}

// ---- what the player does ----

/** Their 卫戍名片 saved (null clears it, and 列表上显示我的名字 with it), with that switch when given */
export async function saveSquadCard(next: SquadCard | null, show?: boolean) {
  const res = await squadApi.card(next, show);
  card.set(res.card);
  showName.set(res.showName);
  return res.card;
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

/** The host's 开始游戏 (go), 结束这局 (wait) or 销毁房间 (end) */
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
/** Your picks in the room, sent at once (while it waits) */
export const setSquadPrefs = (c: SquadRound) => after(squadApi.prefs(c));

/**
 * 这局: your round as you mark it, shown on your tile at once and sent once the taps stop (ROUND_SEND_MS), the whole
 * of it; refused (a teammate took the strategy meanwhile, too fast), the room is read again and the refusal given to
 * onError
 */
export function markSquadRound(next: SquadRound, onError: (e: unknown) => void) {
  const r = room.get();
  if (!r) return;
  roundWant = next;
  room.set(withWant(r));
  window.clearTimeout(roundTimer);
  roundTimer = window.setTimeout(() => {
    const want = roundWant;
    if (!want) return;
    squadApi
      .prefs(want)
      .then(({ room: next }) => {
        if (roundWant === want) roundWant = null;
        setRoom(next);
      })
      .catch((e) => {
        if (roundWant === want) roundWant = null;
        void loadSquadRoom().catch(() => {});
        onError(e);
      });
  }, ROUND_SEND_MS);
}

/** What your roach keeps doing in the room */
export const setSquadPose = (pose: SquadPose) => after(squadApi.pose(pose));

/** The host's 停止加入 (on) and 恢复加入 */
export const setSquadStopped = (on: boolean) => after(squadApi.stop(on));

/** 人机, for the 站长 and the admins as host: one added, or what the one numbered h does */
export const squadBot = (what: SquadBotDo, h?: number) => after(squadApi.bot(what, h));

/** A 人机 touched (碰): on this page alone, it waves; nothing is sent */
export const squadBotTouched = (h: number) => showMove(h, "wave");

/** Your roach waves, or gives a teammate 击掌 or 贴贴: false when it was one too many (full: the hour's are used up); shown at once */
export async function moveInSquad(move: SquadMove, to?: number): Promise<{ sent: boolean; full?: boolean }> {
  const res = await squadApi.move(move, to);
  const r = room.get();
  if (res.sent && r) showMove(r.you, move, to);
  return res;
}

/** 偷偷碰 or 大胆碰 someone in the room; made 触须之交 by it, the room read again */
export async function touchInSquad(h: number, bold: boolean): Promise<TouchResult> {
  const res = await squadApi.touch(h, bold);
  if (res.newFriend) void loadSquadRoom().catch(() => {});
  return res;
}

/** A set line: false when it was one too many (full: the hour's are used up); shown to them at once, and kept for 常用 */
export async function sayInSquad(p: number): Promise<{ sent: boolean; full?: boolean }> {
  const res = await squadApi.say(p);
  const r = room.get();
  if (res.sent && r) {
    showLine(r, r.you, p);
    keepRecent(p);
  }
  return res;
}

const RECENT_KEY = "squad.recent";
/** 常用: the lines this device said last, the latest first */
export const RECENT_MAX = 3;

export function recentLines(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter(isPhrase).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function keepRecent(p: number) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...recentLines().filter((x) => x !== p)].slice(0, RECENT_MAX)));
  } catch {
    // remembered for no longer than the page
  }
}

/** What the host does to the room's songs */
export const squadSongsChange = (change: SquadSongChange) => after(squadApi.music(change));
/** 点歌, and the host's answer to one */
export const requestSquadSong = (song: string) => after(squadApi.request(song));
export const takeSquadRequest = (id: number) => after(squadApi.take(id));
export const dropSquadRequest = (id: number) => after(squadApi.drop(id));

// ---- calling others in ----

/** How the room of an invitation or a 宣言招人 is now, in a line (消息, the card over the map) */
export function squadCallLine(call: SquadCall): string {
  const level = T.squad.levels[call.level - 1] ?? "";
  const server = serverName("arknights", call.server) ?? call.server;
  if (call.state === "open") return fmt(T.squad.call.line.open, { level, server, n: call.n, max: SQUAD_MAX });
  if (call.state === "full" || call.state === "playing") return fmt(T.squad.call.line[call.state], { level, server });
  return T.squad.call.line[call.state];
}

/** In at an invitation to you (its id, without 消息's qi:) or a 宣言招人 you got (its declaration's id, without d:) */
export async function joinSquadBy(by: { invite: string } | { declaration: string }) {
  const { room: r } = await squadApi.joinBy(by);
  setRoom(r);
  return r;
}
/** Your 触须之交 to invite to the room you are in */
export const loadSquadFriends = async () => (await squadApi.friends()).friends;
/** Invitations to these 触须之交 (their Friend ids): what each came to; your list of whom you invited, read again */
export async function inviteToSquad(friends: string[]) {
  const res = await squadApi.invite(friends);
  if (res.room) setRoom(res.room);
  return res.sent;
}
/** What invitations came to, said once: all sent, or how many were not and the first one's why */
export function sentWords(sent: SquadInviteSent[]) {
  const bad = sent.filter((x) => !x.ok);
  if (!bad.length) return T.squad.call.sent;
  return fmt(T.squad.call.sentSome, { n: bad.length, why: bad[0].why ?? T.map.common.tryAgain });
}
/** 下次吧: whoever sent it sees 没来, as when it runs out */
export const laterSquadInvite = (invite: string) => squadApi.later(invite);
/** 宣言招人 from these roaches (null: your main one): what it reached */
export async function declareSquadRoom(from: string[] | null) {
  const res = await squadApi.declare(from);
  if (res.room) setRoom(res.room);
  return res;
}

/** Signed out: nothing kept */
export function forgetSquadPage() {
  unfollowSquad();
  roundWant = null;
  window.clearTimeout(roundTimer);
  talkOpen.set(false);
  setRoom(null);
  notice.set(null);
  card.set(undefined);
  showName.set(undefined);
}
