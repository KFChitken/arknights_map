import { useSyncExternalStore } from "react";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import {
  isPhrase,
  isToPhrase,
  LAST_LINE_MS,
  SAY_SHOW_MS,
  SHOUT,
  SQUAD_MAX,
  strategyOf,
  TO,
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
  type SquadTell,
} from "@/lib/squad";
import { squadApi } from "@/lib/squadClient";
import { BALL_BACK_MS, throwOf, woodAfter, type SquadOn } from "@/lib/squadFire";
import {
  beatOff,
  DANCE_TAP_EVERY_MS,
  DANCE_WINDOW_MS,
  danceEnds,
  isMatchKind,
  LOBBY_ASK_AGAIN_MS,
  RACE_TAPS_MAX,
  STACK_HAND_EVERY_MS,
  STACK_HAND_MAX,
  STACK_IDLE_MS,
  stackPut,
  stackSwing,
  type SquadModeKind,
} from "@/lib/squadMode";
import type { TouchResult } from "@/lib/world/types";
import { squadDing, squadPop } from "./squadSound";
import { nameOf, weightAfterName } from "../fish/words";

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

/** What the site says in the room (someone came in, a new key, a strategy freed), floating a few seconds */
export type SquadFloat = { key: number; text: string };
/**
 * A line said by h, by its number, over its roach (BUBBLE_MS) and under it (刚才, LAST_LINE_MS); key tells one from
 * the next; to: the one it was said to (对 TA 说), s: TA's strategy as it was said (its 「…」)
 */
export type SquadLine = { key: number; h: number; p: number; at: number; to?: number; s?: number | null };
/** A line said to you (对 TA 说, 36–40) by h: over the room or the map till answered, closed, or the round starts; s: your strategy as it was said */
export type SquadToMe = { key: number; h: number; p: number; at: number; s: number | null };
/** A move done (动作) by h, with the teammate to for 击掌 and 贴贴, shown on the roaches MOVE_SHOW_MS */
export type SquadMoveDone = { key: number; h: number; move: SquadMove; to?: number; at: number };
/**
 * 扔东西: item (src/lib/squadFire.ts THROWS) landing on the one numbered to, thrown by h (sent back: back), shown on
 * TA's tile THROW_SHOW_MS; out: what a parcel held (a 钓鳞 item's number); n: a ball's rally so far
 */
export type SquadThrown = { key: number; h: number; to: number; item: number; out?: number; n?: number; back?: true; at: number };

const NO_FLOATS: SquadFloat[] = [];
const NO_LINES: SquadLine[] = [];
const NO_MOVES: SquadMoveDone[] = [];
const NO_TOUCHED: Readonly<Record<number, "sneaky" | "bold">> = {};
const NO_THROWS: SquadThrown[] = [];
const room = kept<SquadRoom | null>(null);
const floats = kept<SquadFloat[]>(NO_FLOATS);
const lines = kept<SquadLine[]>(NO_LINES);
const moves = kept<SquadMoveDone[]>(NO_MOVES);
const throws = kept<SquadThrown[]>(NO_THROWS);
/** Who in the room this page touched (碰), by their number: sneakily (a bold touch may follow) or boldly */
const touched = kept(NO_TOUCHED);
const toMe = kept<SquadToMe | null>(null);
/** Asked to change or give up a strategy (36, 37) by you: whom, the strategy TA had, and when; TA's change said within ASKED_MS */
const asked = new Map<number, { s: number; at: number }>();
const ASKED_MS = 60_000;
/** A line said to you with nothing to answer (谢谢！) closes by itself this long after */
const TO_ME_THANKS_MS = 5_000;
/** The strategy picker to open as the room's sheet opens (好，我换 tapped over the map) */
const pickNext = kept(false);
/** How many rounds have started in sight of this page (开始游戏): the sheet makes way for the bar of the round */
const rounds = kept(0);
/** A round started while the player marked no strategy for it: 这局 opens first, with a dot, until they look */
const roundUnseen = kept(false);
/** What was said as the last room was over for them (it ended, they were asked to leave), until they are in another */
const notice = kept<string | null>(null);
/** Their 卫戍名片 as last saved, and its 列表上显示我的名字 (undefined: as me() gave them) */
const card = kept<SquadCard | null | undefined>(undefined);
const showName = kept<boolean | undefined>(undefined);
const noThrow = kept<boolean | undefined>(undefined);
const fireHide = kept<boolean | undefined>(undefined);

export const squadRoomNow = room.get;
export const useSquadRoom = () => useSyncExternalStore(room.on, room.get, () => null);
export const useSquadFloats = (): SquadFloat[] => useSyncExternalStore(floats.on, floats.get, () => NO_FLOATS);
/** The lines floating now (the tests) */
export const squadFloatsNow = floats.get;
export const useSquadLines = (): SquadLine[] => useSyncExternalStore(lines.on, lines.get, () => NO_LINES);
export const useSquadMoves = (): SquadMoveDone[] => useSyncExternalStore(moves.on, moves.get, () => NO_MOVES);
export const useSquadThrows = (): SquadThrown[] => useSyncExternalStore(throws.on, throws.get, () => NO_THROWS);
export const useSquadTouched = () => useSyncExternalStore(touched.on, touched.get, () => NO_TOUCHED);
export const useSquadToMe = () => useSyncExternalStore(toMe.on, toMe.get, () => null);
export const closeSquadToMe = () => toMe.set(null);
export const useSquadPickNext = () => useSyncExternalStore(pickNext.on, pickNext.get, () => false);
/** The strategy picker opens with the room's sheet (asked to from the map), or that was done */
export const setSquadPickNext = (on: boolean) => pickNext.set(on);

/** A line's words as they show: 能把「{s}」让给我吗？ with the strategy s (its operator); with none known, 能换个策略吗？ */
export function lineWords(p: number, s?: number | null) {
  const text = T.squad.say.lines[p - 1] ?? "";
  // 喊一声: as the match waiting or playing has it, else a match's in general
  const kind = p === SHOUT ? room.get()?.mode?.kind : undefined;
  if (kind && isMatchKind(kind)) return T.squad.say.shout[kind];
  if (!text.includes("{s}")) return text;
  const op = s == null ? null : strategyOf(s)?.op;
  return op ? fmt(text, { s: op }) : (T.squad.say.lines[TO.change - 1] ?? "");
}
/** A touch of someone in the room went (by their number): their card says so */
export const markSquadTouched = (h: number, bold: boolean) => touched.set({ ...touched.get(), [h]: bold ? "bold" : "sneaky" });
export const useSquadRounds = () => useSyncExternalStore(rounds.on, rounds.get, () => 0);
export const useSquadRoundUnseen = () => useSyncExternalStore(roundUnseen.on, roundUnseen.get, () => false);
export const seeSquadRound = () => roundUnseen.set(false);

/**
 * The card of the mode playing (SquadDance.tsx, SquadQuiz.tsx), over the map's foot: open for the mode as it was
 * opened (its start, at), as the player opened or joined it; another mode, or none, and it is shut
 */
const modeCard = kept<number | null>(null);
export const useSquadModeCard = () => useSyncExternalStore(modeCard.on, modeCard.get, () => null);
/** The card open now (the tests) */
export const squadModeCardNow = modeCard.get;
export function openSquadModeCard() {
  const mode = room.get()?.mode;
  if (mode) modeCard.set(mode.at);
}
export const closeSquadModeCard = () => modeCard.set(null);

/**
 * 凯尔希随堂测: your answers in the round begun at `at` (its initiator's 开始), by question number, as picked and then
 * as the server judged them (right; first: the point; answer: which was right)
 */
export type QuizPick = { pick: number; right?: boolean; first?: boolean; answer?: number };
export type QuizPicks = { at: number; picks: Readonly<Record<number, QuizPick>> };
const quizPicks = kept<QuizPicks | null>(null);
export const useSquadQuizPicks = () => useSyncExternalStore(quizPicks.on, quizPicks.get, () => null);
export const squadQuizPicksNow = quizPicks.get;
const picksOf = (at: number): QuizPicks => {
  const p = quizPicks.get();
  return p?.at === at ? p : { at, picks: {} };
};

/**
 * 「XX 开了龙门广场舞，加入？」 (or a match's) answered 不了, or the mode opened, joined or left: by the mode's start
 * (at), not asked again for it, and when (a match's 喊一声 asks again from LOBBY_ASK_AGAIN_MS after a 不了)
 */
export type ModeAsked = { at: number; when: number };
const modeAsked = kept<ModeAsked | null>(null);
export const useSquadModeAsked = () => useSyncExternalStore(modeAsked.on, modeAsked.get, () => null);
/** The match put away now (the tests) */
export const squadModeAskedNow = modeAsked.get;
const askedNow = (at: number) => modeAsked.set({ at, when: Date.now() });
export const dismissSquadMode = (at: number) => askedNow(at);
/** Asked again for the match waiting or playing (someone's 喊一声, or 来一起玩？ to you), unless you said 不了 just now */
function askAgain(r: SquadRoom) {
  const asked = modeAsked.get();
  if (!r.mode || !isMatchKind(r.mode.kind)) return;
  if (asked && asked.at === r.mode.at && Date.now() - asked.when < LOBBY_ASK_AGAIN_MS) return;
  modeAsked.set(null);
}

/** 跳's answers as they come (the player's own judge, 准！ or 歪了), by when */
const danceJudge = kept<{ ok: boolean; at: number } | null>(null);
export const useSquadDanceJudge = () => useSyncExternalStore(danceJudge.on, danceJudge.get, () => null);
export const squadDanceJudgeNow = danceJudge.get;

/** 篝火's card (SquadFire.tsx), over the map: 「玩」 → 添柴 opens it */
const fireOpen = kept(false);
export const useSquadFireOpen = () => useSyncExternalStore(fireOpen.on, fireOpen.get, () => false);
export const openSquadFire = () => fireOpen.set(true);
export const closeSquadFire = () => fireOpen.set(false);

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
export const useSquadNoThrow = () => useSyncExternalStore(noThrow.on, noThrow.get, () => undefined);
export const useSquadFireHide = () => useSyncExternalStore(fireHide.on, fireHide.get, () => undefined);
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
/** A throw shows on the tile it lands on this long */
export const THROW_SHOW_MS = 2_600;

/**
 * Something thrown lands (by the one numbered h at to): shown on TA's tile, and what stays put on TA as the room has
 * it (on the head, asleep, dancing, a ball; 白开水 wakes TA from 令的酒), till the room is read again
 */
function showThrow(r: SquadRoom, t: Omit<SquadThrown, "key" | "at">) {
  const key = ++talkKey;
  const now = Date.now();
  throws.set([...throws.get().filter((x) => x.to !== t.to), { ...t, key, at: now }]);
  window.setTimeout(() => throws.set(throws.get().filter((x) => x.key !== key)), THROW_SHOW_MS);
  const item = throwOf(t.item);
  if (!item) return;
  const on = (ms: number): SquadOn => ({ item: item.no, until: now + ms });
  const change: Partial<SquadMember> =
    item.fx === "head"
      ? { head: on(item.ms) }
      : item.fx === "faint" || item.fx === "dance"
        ? { fx: on(item.ms) }
        : item.fx === "ball"
          ? { ball: { item: item.no, from: t.h, n: t.n ?? 1, until: now + BALL_BACK_MS } }
          : item.fx === "wake"
            ? { fx: undefined }
            : {};
  // a ball sent back is gone from the one who sent it
  const members = r.members.map((m) =>
    m.h === t.to ? { ...m, ...change } : t.back && m.h === t.h && m.ball ? { ...m, ball: undefined } : m,
  );
  room.set(withWant({ ...r, members }));
}

/** Your own line or move, shown as you sent it, is not shown again as the room tells it back within this long */
const ECHO_MS = 4_000;
let talkKey = 0;

/** The seat of h in the room (0 the first), for the pitch of its 啵 */
const seatOf = (r: SquadRoom, h: number) => Math.max(0, r.members.findIndex((m) => m.h === h));

/** A line said by h (to: the one it is said to): its bubble takes the place of their last, its 刚才 stays LAST_LINE_MS; 啵 */
function showLine(r: SquadRoom, h: number, p: number, to?: number) {
  const key = ++talkKey;
  const said = to === undefined ? {} : { to, s: r.members.find((m) => m.h === to)?.strategy ?? null };
  lines.set([...lines.get().filter((l) => l.h !== h), { key, h, p, at: Date.now(), ...said }]);
  window.setTimeout(() => lines.set(lines.get().filter((l) => l.key !== key)), LAST_LINE_MS);
  squadPop(seatOf(r, h));
  // said to you, and not an answer: over the room or the map till answered (谢谢！ goes by itself)
  if (to === r.you && h !== r.you && p >= TO.change && p <= TO.thanks) {
    toMe.set({ key, h, p, at: Date.now(), s: said.s ?? null });
    squadDing();
    if (p === TO.thanks) window.setTimeout(() => toMe.get()?.key === key && toMe.set(null), TO_ME_THANKS_MS);
  }
}

/** Those you asked to change or give up their strategy who did, within ASKED_MS: 「X 换了，「s」空出来了」 */
function freedBy(before: SquadRoom | null, next: SquadRoom) {
  if (!asked.size || before?.id !== next.id) return;
  for (const [h, a] of [...asked]) {
    if (Date.now() - a.at > ASKED_MS) {
      asked.delete(h);
      continue;
    }
    const m = next.members.find((x) => x.h === h);
    if (!m || m.strategy === a.s) continue;
    asked.delete(h);
    addFloat(fmt(T.squad.float.freed, { name: m.name, s: strategyOf(a.s)?.op ?? "" }));
  }
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
 * In a room, or out of it: what was said of the last goes once they are in another; a round that starts in sight
 * counted (rounds), and noted for 这局 when the player marked no strategy for it
 */
function setRoom(next: SquadRoom | null) {
  const before = room.get();
  if (next) notice.set(null);
  if (!next || next.id !== before?.id) {
    floats.set(NO_FLOATS);
    lines.set(NO_LINES);
    moves.set(NO_MOVES);
    touched.set(NO_TOUCHED);
    toMe.set(null);
    asked.clear();
    // out of the room: its fire goes too, and what it played
    fireOpen.set(false);
    modeCard.set(null);
    danceJudge.set(null);
    quizPicks.set(null);
    throws.set(NO_THROWS);
  }
  if (next && next.state === "go" && (before?.id !== next.id || before.state !== "go")) {
    rounds.set(rounds.get() + 1);
    roundUnseen.set(next.members.find((m) => m.you)?.strategy === null);
  }
  // a line to you closes as the round starts
  if (next?.state === "go") toMe.set(null);
  if (next) freedBy(before, next);
  if (!next || next.state !== "go") roundUnseen.set(false);
  room.set(next && withWant(next));
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
        const sent = Date.now();
        r = (await squadApi.room()).room;
        if (r) clocked(r.now, sent, Date.now());
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
  const next = withWant({ ...r, members: r.members.map((m) => (m.h === h ? { ...m, ...change } : m)) });
  room.set(next);
  freedBy(r, next);
}

/** At the page's start (me().squad): their card, and the room they are in, read */
export function startSquad(me: SquadMe) {
  if (card.get() === undefined) card.set(me.card);
  if (showName.get() === undefined) showName.set(me.showName);
  if (noThrow.get() === undefined) noThrow.set(me.noThrow);
  if (fireHide.get() === undefined) fireHide.set(me.fireHide);
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
  if (tell.t === "say") {
    for (const it of tell.items) {
      if (!isPhrase(it.p) || !r.members.some((m) => m.h === it.h)) continue;
      // your own, shown as you said it
      if (it.h === r.you && lines.get().some((l) => l.h === it.h && l.p === it.p && Date.now() - l.at < ECHO_MS)) continue;
      showLine(r, it.h, it.p, it.to);
      // a match's 喊一声 by someone else, or 来一起玩？ to you: the line asking you to it again
      if ((it.p === SHOUT && it.h !== r.you) || (it.p === TO.play && it.to === r.you)) askAgain(r);
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
  // 扔东西: what lands where (your own, shown as the server took it, not twice)
  if (tell.t === "throw") {
    for (const it of tell.items) {
      if (!r.members.some((m) => m.h === it.to) || !r.members.some((m) => m.h === it.h)) continue;
      if (it.h === r.you && throws.get().some((x) => x.h === it.h && x.to === it.to && x.item === it.item && Date.now() - x.at < ECHO_MS)) continue;
      showThrow(room.get() ?? r, it);
    }
    return;
  }
  // 龙门广场舞: each one's combo as it is now, and the dance living on from their tap
  if (tell.t === "dance") {
    const mode = r.mode;
    if (!mode) return;
    let endsAt = mode.endsAt;
    const dancers = mode.in.map((m) => {
      const it = tell.items.findLast((x) => x.h === m.h);
      if (it) endsAt = Math.max(endsAt, danceEnds(mode.until, it.at));
      // your own as your taps' answers had it, newer than the batch's
      return it && m.h !== r.you ? { ...m, combo: it.combo } : m;
    });
    room.set(withWant({ ...r, mode: { ...mode, in: dancers, endsAt } }));
    return;
  }
  // 企鹅物流急件赛: what the others did, into their lanes (your own went in as you did it)
  if (tell.t === "race") {
    const mode = r.mode;
    if (mode?.kind !== "race" || mode.wait) return;
    const lanes = mode.lanes.map((l) => {
      const mine = tell.items.filter((x) => x.h === l.h && x.h !== r.you);
      if (!mine.length) return l;
      return {
        ...l,
        taps: [...l.taps, ...mine.flatMap((x) => (x.tap ? [x.tap] : []))],
        jumps: [...l.jumps, ...mine.flatMap((x) => (x.jump === undefined ? [] : [x.jump]))],
      };
    });
    room.set(withWant({ ...r, mode: { ...mode, lanes } }));
    return;
  }
  // 卫戍池塘: a teammate's purple or better, to the whole room by name (your own has its page)
  if (tell.t === "fish") {
    for (const it of tell.items) {
      const m = r.members.find((x) => x.h === it.h);
      if (!m || it.h === r.you) continue;
      addFloat(fmt(T.fish.roomShout, { name: m.name, item: nameOf(it.no, it.variant), size: weightAfterName(it.no, it.cm) }));
    }
    return;
  }
  // what a page of now does not know of: nothing to do
  if (tell.t !== "room") return;
  // in the mode playing, or looking at it, as it was before this
  const was = r.mode && (modeCard.get() === r.mode.at || r.mode.in.some((m) => m.h === r.you)) ? r.mode.kind : null;
  void loadSquadRoom()
    .then((next) => {
      const what = tell.t === "room" ? tell.what : undefined;
      if (!next || !what) return;
      // 玩点什么: a mode over (by itself) is said to those who were in it or looking at it; one opened asks the others itself
      if (what.kind === "mode") {
        if (!next.mode && what.on === false && what.h === undefined && !what.lobby && was) addFloat(T.squad.modes.ended[was]);
        if (what.lobby) lobbyFloat(r, next, what);
        // a match started with you in it: its card opens
        const m = next.mode;
        if (what.lobby === "start" && m && !m.wait && m.in.some((x) => x.h === next.you)) {
          askedNow(m.at);
          modeCard.set(m.at);
        }
        return;
      }
      // what you did yourself is not said back to you
      if ((what.kind === "in" || what.kind === "game") && what.h === next.you) return;
      // 结束这局: how high the 篝火 went in it and how long it burnt, to everyone, the host too
      if (what.kind === "state" && what.to === "wait" && next.fire.last) addFloat(fireEndLine(next.fire.last, next.fire.lastTop, next.fire.bestTop));
      if ((what.kind === "key" || what.kind === "state" || what.kind === "stop") && next.host) return;
      if (what.kind === "host") return addFloat(what.h === next.you ? T.squad.float.youHost : fmt(T.squad.float.host, { name: next.members.find((m) => m.h === what.h)?.name ?? "" }));
      const name = next.members.find((m) => m.h === what.h)?.name ?? null;
      const text =
        what.kind === "in" && name
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

/**
 * What a match's news says to the room (玩点什么): picked, readied, started, handed on, gone; what you did yourself
 * not said back to you, but its being handed to you. The one who went may have left: their name from the room before.
 */
function lobbyFloat(was: SquadRoom, next: SquadRoom, what: NonNullable<Extract<SquadTell, { t: "room" }>["what"]>) {
  const t = T.squad.float;
  const kind = what.mode;
  if (!kind) return;
  const mode = T.squad.modes.names[kind];
  const nameOf = (h: number | undefined) => next.members.find((m) => m.h === h)?.name ?? was.members.find((m) => m.h === h)?.name ?? T.squad.quiz.someone;
  if (what.lobby === "idle") return addFloat(fmt(t.matchIdle, { mode }));
  if (what.lobby === "hand" && what.by === next.you) return addFloat(fmt(t.handYou, { a: nameOf(what.h) }));
  if (what.h === next.you) return;
  if (what.lobby === "open") return addFloat(fmt(t.matchOpen, { name: nameOf(what.h), mode }));
  if (what.lobby === "ready") return addFloat(fmt(t.matchReady, { name: nameOf(what.h), mode }));
  if (what.lobby === "start") return addFloat(fmt(kind === "race" ? t.matchStartRun : t.matchStart, { name: nameOf(what.h) }));
  if (what.lobby === "hand") return addFloat(fmt(t.hand, { a: nameOf(what.h), b: nameOf(what.by) }));
  if (what.lobby === "gone") return addFloat(fmt(t.matchGone, { mode }));
}

/** After the event stream was down a while: the room as it is now */
export function squadStreamBack() {
  if (room.get()) void loadSquadRoom().catch(() => {});
}

// ---- what the player does ----

/**
 * Their 卫戍名片 saved (null clears it, and 列表上显示我的名字 with it), with those switches when given (别人扔我 off:
 * noThrow; 火焰周榜写我的名字 off: hide)
 */
export async function saveSquadCard(next: SquadCard | null, show?: boolean, off?: boolean, hide?: boolean) {
  const res = await squadApi.card(next, show, off, hide);
  card.set(res.card);
  showName.set(res.showName);
  noThrow.set(res.noThrow);
  fireHide.set(res.fireHide);
  return res.card;
}

/** 火焰周榜 (src/lib/server/fireBoard.ts): this week's or last week's, and the room the player is in on it */
export const loadFireBoard = (week: "this" | "last") => squadApi.fireBoard(week);

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

export async function leaveSquadRoom(to?: number) {
  await squadApi.leave(to);
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

/** How long a 篝火 burnt, in words: 47 分钟, 1 小时 12 分, 不到 1 分钟 */
export function fireTime(ms: number) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return T.squad.fire.seconds;
  return m < 60 ? fmt(T.squad.fire.minutes, { m }) : fmt(T.squad.fire.hours, { h: Math.floor(m / 60), m: m % 60 });
}
/** 结束这局's line of the 篝火: this 局's highest and how long it burnt, and the room's highest when it is higher */
export const fireEndLine = (last: number, top: number, best: number) =>
  best > top
    ? fmt(T.squad.fire.endedBest, { top, time: fireTime(last), best })
    : fmt(T.squad.fire.ended, { top, time: fireTime(last) });

/** 添一根: the stick on the room's fire (up a level once enough are on), a stick less in your hand, at once */
export async function squadAddWood() {
  const res = await squadApi.fire();
  const r = room.get();
  if (r) room.set(withWant({ ...r, fire: res.fire, members: r.members.map((m) => (m.you ? { ...m, wood: res.wood, woodAt: res.woodAt } : m)) }));
  return res;
}

/**
 * 扔: one of THROWS at the one numbered to, shown as the server took it; at a 人机, on this page alone (a parcel's
 * pick made here), nothing sent
 */
export async function squadThrowAt(to: number, item: number, junk: readonly number[]) {
  const r = room.get();
  if (!r) return;
  const ball = throwOf(item)?.fx === "ball" ? { n: 1 } : {};
  if (to < 0) {
    const out = throwOf(item)?.fx === "parcel" ? { out: junk[Math.floor(Math.random() * junk.length)] } : {};
    return showThrow(r, { h: r.you, to, item, ...out, ...ball });
  }
  const res = await squadApi.throwAt(to, item);
  showThrow(room.get() ?? r, { h: r.you, to, item, ...(res.out === undefined ? {} : { out: res.out }), ...ball });
}

/** 打回去: the ball on your tile back to whoever sent it */
export async function squadHitBack() {
  const r = room.get();
  const ball = r?.members.find((m) => m.you)?.ball;
  if (!r || !ball) return;
  const res = await squadApi.hit();
  showThrow(room.get() ?? r, { h: r.you, to: ball.from, item: ball.item, n: res.n, back: true });
}

/** 甩掉: what crawled onto your roach's head off it */
export async function squadShakeOff() {
  await squadApi.shake();
  const r = room.get();
  if (r) room.set(withWant({ ...r, members: r.members.map((m) => (m.you ? { ...m, head: undefined } : m)) }));
}

// ---- 玩点什么 ----

/** The server's clock less this page's (ms): the middle of the last few answers', each less half its way there and back */
const offs: number[] = [];
let off = 0;
function clocked(now: number, sent: number, got: number) {
  if (!Number.isFinite(now)) return;
  offs.push(now - (sent + got) / 2);
  if (offs.length > 5) offs.shift();
  const sorted = [...offs].sort((a, b) => a - b);
  off = sorted[Math.floor(sorted.length / 2)];
}
async function timed<R extends { now: number }>(ask: () => Promise<R>): Promise<R> {
  const sent = Date.now();
  const res = await ask();
  clocked(res.now, sent, Date.now());
  return res;
}
/** The server's clock now (ms), as the room's answers put it: what 龙门广场舞's song and its taps go by */
export const squadServerNow = () => Date.now() + off;

/** 开 a mode from 「玩」 (a match: waiting for people, you its initiator): the room as it is then, and the mode's own card open */
export async function squadOpenMode(kind: SquadModeKind) {
  await timed(() => squadApi.mode(kind));
  const r = await loadSquadRoom();
  if (r?.mode) askedNow(r.mode.at);
  if (r?.mode) modeCard.set(r.mode.at);
  return r;
}

/**
 * 加入 the mode playing (into; a match waiting: 准备; a round playing: 下一局算我), its card open; or out (不跳了，
 * 去围观; a match's 不玩了), the card left open. Either way, not asked to join it again.
 */
export async function squadModeIn(into: boolean) {
  await timed(() => squadApi.modeIn(into));
  danceJudge.set(null);
  const r = await loadSquadRoom();
  if (r?.mode) askedNow(r.mode.at);
  if (into && r?.mode) modeCard.set(r.mode.at);
  return r;
}

/** 开始, by a match's initiator: the room as it is then, the card open on the round */
export async function squadStartMatch() {
  await timed(() => squadApi.start());
  const r = await loadSquadRoom();
  if (r?.mode) modeCard.set(r.mode.at);
  return r;
}

/** Your own combo in the dance (as your taps' answers have it), and the dance living on from a tap at `at` */
function ownCombo(combo: number, at: number | null) {
  const r = room.get();
  const mode = r?.mode;
  if (!r || !mode) return;
  const endsAt = at === null ? mode.endsAt : Math.max(mode.endsAt, danceEnds(mode.until, at));
  room.set(withWant({ ...r, mode: { ...mode, in: mode.in.map((m) => (m.h === r.you ? { ...m, combo } : m)), endsAt } }));
}

let tapAt = 0;
/**
 * 跳, now, on the server's clock as this page has it. Judged here at once against the song's beats (s from its start,
 * when the page has them), as the server judges it, and put right by its answer where that differs; taps closer
 * together than DANCE_TAP_EVERY_MS are one (nothing sent). Null when nothing was sent.
 */
export async function squadDanceTap(beats: ArrayLike<number> | null) {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "dance") return null;
  const here = Date.now();
  if (here - tapAt < DANCE_TAP_EVERY_MS) return null;
  tapAt = here;
  const at = squadServerNow();
  const mine = mode.in.find((m) => m.h === r.you);
  if (beats && mine) {
    const ok = beatOff(beats, at - mode.songAt) <= DANCE_WINDOW_MS;
    danceJudge.set({ ok, at: here });
    ownCombo(ok ? mine.combo + 1 : 0, at);
  }
  let res: Awaited<ReturnType<typeof squadApi.tap>>;
  try {
    res = await timed(() => squadApi.tap(at));
  } catch (e) {
    // refused (the dance over, or you out of it): the room as it is
    danceJudge.set(null);
    void loadSquadRoom().catch(() => {});
    throw e;
  }
  if (!res.counted) danceJudge.set(null);
  else if (danceJudge.get()?.ok !== res.ok) danceJudge.set({ ok: res.ok, at: here });
  ownCombo(res.combo, res.counted ? res.now : null);
  return res;
}

/** 龙门广场舞's song for this page: its beats, and its link where 听歌 is open to the player */
export const squadDanceSong = () => timed(() => squadApi.song());

/**
 * 传 in W 的礼物, now on the server's clock as this page has it: shown at once (the gift goes on from your seat in the
 * round as the page has it), then as the server took it; refused (it was not in your hands, or the song stopped), the
 * room read again. Null when nothing was sent (no round going, or your seat not in it).
 */
export async function squadGiftPass() {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "gift" || mode.wait) return null;
  const at = squadServerNow();
  const i = mode.rounds.findLastIndex((x) => x.at <= at);
  const round = mode.rounds[i];
  const seat = round ? round.seats.indexOf(r.you) : -1;
  if (!round || round.hit !== undefined || seat < 0) return null;
  const rounds = mode.rounds.map((x, k) => (k === i ? { ...x, taps: [...x.taps, { at, seat }] } : x));
  room.set(withWant({ ...r, mode: { ...mode, rounds } }));
  try {
    return await timed(() => squadApi.pass(at));
  } catch (e) {
    void loadSquadRoom().catch(() => {});
    throw e;
  }
}

/** 企鹅物流急件赛's 加油 since the last sent, sent every RACE_SEND_MS (a lane's run counts them by the second) */
const RACE_SEND_MS = 250;
let raceTaps = 0;
let raceTimer = 0;

/** Your own lane in the race playing, what you did added at once (as the server will take it) */
function ownLane(add: { tap?: [number, number]; jump?: number }) {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "race" || mode.wait) return;
  const lanes = mode.lanes.map((l) =>
    l.h === r.you ? { ...l, taps: add.tap ? [...l.taps, add.tap] : l.taps, jumps: add.jump === undefined ? l.jumps : [...l.jumps, add.jump] } : l,
  );
  room.set(withWant({ ...r, mode: { ...mode, lanes } }));
}

/** 加油: counted here, sent with the others of the next quarter second (your lane runs on them as they go) */
export function squadRaceTap() {
  raceTaps += 1;
  if (raceTimer) return;
  raceTimer = window.setTimeout(() => {
    raceTimer = 0;
    const n = Math.min(RACE_TAPS_MAX, raceTaps);
    raceTaps = 0;
    const at = squadServerNow();
    ownLane({ tap: [at, n] });
    timed(() => squadApi.run({ tap: n, at })).catch(() => void loadSquadRoom().catch(() => {}));
  }, RACE_SEND_MS);
}

/** 跳, now on the server's clock as this page has it: your roach in the air at once; refused, the room read again */
export async function squadRaceJump() {
  const at = squadServerNow();
  ownLane({ jump: at });
  try {
    return await timed(() => squadApi.run({ jump: true, at }));
  } catch (e) {
    void loadSquadRoom().catch(() => {});
    throw e;
  }
}

/**
 * 基建加盖's 放, now on the server's clock as this page has it, in the round this page has: your roach on the tower at
 * once where the swing is (as the server will put it, the tower falling as it will), a block out of your hand, then the
 * room as the server has it (it tells the room). Refused (too soon, an empty hand, the tower fell or another round
 * began meanwhile), the room read again. Null when nothing was sent (none playing, or the tower down).
 */
export async function squadStackDrop() {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "stack" || mode.fell) return null;
  const at = Math.max(squadServerNow(), mode.roundAt);
  const x = Math.round(stackSwing(mode.roundAt, at)) || 0;
  const put = stackPut(mode.blocks, x);
  const blocks = [...mode.blocks, { h: r.you, x, at }];
  const after = woodAfter(mode.hand?.n ?? STACK_HAND_MAX, mode.hand?.at ?? null, at, STACK_HAND_MAX, STACK_HAND_EVERY_MS);
  const fell = put.falls ? { fell: { at, height: mode.blocks.length } } : {};
  const best = put.falls ? mode.best : Math.max(mode.best, blocks.length);
  room.set(withWant({ ...r, mode: { ...mode, blocks, ...fell, best, hand: { n: after.wood, at: after.at }, endsAt: Math.min(mode.until, at + STACK_IDLE_MS) } }));
  try {
    return await timed(() => squadApi.stack({ do: "drop", round: mode.round, at }));
  } catch (e) {
    void loadSquadRoom().catch(() => {});
    throw e;
  }
}

/** 基建加盖's 再来一轮, in the round this page has (one another began first is nothing): the room as it is then */
export async function squadStackAgain() {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "stack") return null;
  try {
    const res = await timed(() => squadApi.stack({ do: "again", round: mode.round }));
    await loadSquadRoom();
    return res;
  } catch (e) {
    void loadSquadRoom().catch(() => {});
    throw e;
  }
}

/** 凯尔希随堂测's question n for this page: its three, and its picture or (where 听歌 is open to the player) its song */
export const squadQuizAsk = (n: number) => timed(() => squadApi.question(n));

/**
 * Your answer (pick: 0–2) to question n of the quiz playing, now on the server's clock as this page has it: shown at
 * once as picked, then as the server judged it (taken back if it was refused); once a question. Your point, if it was
 * the first right, comes with the room (as everyone's does). Null when nothing was sent.
 */
export async function squadQuizAnswer(n: number, pick: number) {
  const mode = room.get()?.mode;
  if (mode?.kind !== "quiz" || mode.wait || picksOf(mode.begun).picks[n]) return null;
  const at = squadServerNow();
  const set = (p: QuizPick | null) => {
    const was = picksOf(mode.begun);
    const picks = { ...was.picks };
    if (p) picks[n] = p;
    else delete picks[n];
    quizPicks.set({ ...was, picks });
  };
  set({ pick });
  let res: Awaited<ReturnType<typeof squadApi.answer>>;
  try {
    res = await timed(() => squadApi.answer(n, pick, at));
  } catch (e) {
    set(null);
    throw e;
  }
  set({ pick, right: res.right, first: res.first, answer: res.answer });
  return res;
}

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

/**
 * A set line: false when it was one too many (full: the hour's are used up); shown to them at once, and kept for 常用.
 * to: said to that one alone (对 TA 说), never kept for 常用; asking TA to change or give up a strategy is kept a minute
 * (「…空出来了」), and an answer closes what TA said to you.
 */
export async function sayInSquad(p: number, to?: number): Promise<{ sent: boolean; full?: boolean }> {
  const res = await squadApi.say(p, to);
  const r = room.get();
  if (res.sent && r) {
    showLine(r, r.you, p, to);
    if (to === undefined && p !== SHOUT) keepRecent(p);
    const m = to === undefined ? undefined : r.members.find((x) => x.h === to);
    if (m && m.strategy !== null && (p === TO.change || p === TO.giveUp)) asked.set(m.h, { s: m.strategy, at: Date.now() });
    // answered what was said to you
    const open = toMe.get();
    if (open && open.h === to) toMe.set(null);
  }
  return res;
}

const RECENT_KEY = "squad.recent";
/** 常用: the lines this device said last, the latest first */
export const RECENT_MAX = 3;

export function recentLines(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    // 对 TA 说 is never one of them (said from a teammate's card, to TA)
    return Array.isArray(v) ? v.filter((p) => isPhrase(p) && !isToPhrase(p)).slice(0, RECENT_MAX) : [];
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
  roundWant = null;
  raceTaps = 0;
  if (raceTimer) window.clearTimeout(raceTimer);
  raceTimer = 0;
  window.clearTimeout(roundTimer);
  talkOpen.set(false);
  setRoom(null);
  notice.set(null);
  card.set(undefined);
  showName.set(undefined);
  noThrow.set(undefined);
  fireHide.set(undefined);
}
