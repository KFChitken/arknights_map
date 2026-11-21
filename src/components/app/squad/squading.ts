import { useSyncExternalStore } from "react";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import {
  isPhrase,
  isToPhrase,
  LAST_LINE_MS,
  SAY_SHOW_MS,
  SHOUT,
  HERE_EVERY_MS,
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
import { squadApi, SquadUnreached } from "@/lib/squadClient";
import { BALL_BACK_MS, throwOf, type SquadOn } from "@/lib/squadFire";
import {
  danceEnds,
  danceJudge,
  danceMove,
  isMatchKind,
  LOBBY_ASK_AGAIN_MS,
  RACE_CELL_MS,
  RACE_MAX_MS,
  RACE_REPORT_JUMPS,
  RACE_REPORT_MS,
  RACE_REPORT_TAPS,
  RACE_TAPS_MAX,
  raceRun,
  STACK_GEAR_EVERY,
  STACK_TOP,
  stackPut,
  stackShift,
  stackNow,
  stackSwing,
  type SoloDance,
  type SquadModeKind,
} from "@/lib/squadMode";
import { readDance, type DanceBeats } from "@/lib/dance";
import { WorldError, type TouchResult } from "@/lib/world/types";
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
 * The card of the mode playing (SquadQuiz.tsx, SquadGift.tsx, SquadRace.tsx), over the map's foot: open for the mode
 * as it was opened (its start, at), as the player opened or joined it; another mode, or none, and it is shut
 */
const modeCard = kept<number | null>(null);
export const useSquadModeCard = () => useSyncExternalStore(modeCard.on, modeCard.get, () => null);
/** The card open now (the tests) */
export const squadModeCardNow = modeCard.get;
/** The card of the mode playing open (the tower's folded behind it: 回去 › on the tower's card is this) */
export function openSquadModeCard() {
  const mode = room.get()?.mode;
  if (mode) showModeCard(mode.at);
}
/** Shut with ×: the tower folded behind it stays shut */
export function closeSquadModeCard() {
  modeCard.set(null);
  behind.set(false);
}

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
 * A match's 「XX 想玩…，来吗？」 answered 不了, or the mode opened, joined or left: by the mode's start
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

/**
 * 龙门广场舞, danced alone on this page (squadMode.ts SoloDance): the song as the server gave it (asked for as its card
 * opens, and for each 再跳一首), its beats, your combo as this page judges each 跳 (danceJudge), the best of it, the
 * last tap that counted and the last at all, 准！ or 歪了 as you tap, and when 群魔乱舞 came. Nothing goes to the
 * server while one dances. Its card (SquadDance.tsx) and the small window (SquadMini.tsx) both draw it; null: none.
 */
export type SoloDanceNow = {
  /** When it was asked for (this page's clock): one dance from the next */
  key: number;
  song: SoloDance | null;
  beats: DanceBeats | null;
  combo: number;
  best: number;
  last: number | null;
  tapAt: number | null;
  judge: { ok: boolean; at: number } | null;
  wildAt: number | null;
  /** Why no song came */
  err: string | null;
};
const solo = kept<SoloDanceNow | null>(null);
export const useSquadSolo = () => useSyncExternalStore(solo.on, solo.get, () => null);
export const squadSoloNow = solo.get;
/** When one's dance ends by itself: its song over, or DANCE_IDLE_MS after the last tap (its song's start, with none) */
export const soloEnds = (d: SoloDanceNow) => (d.song ? danceEnds(d.song.songAt + d.song.seconds * 1000, Math.max(d.tapAt ?? 0, d.song.songAt)) : Infinity);

/**
 * 基建加盖's card (SquadStack.tsx): open or not. It and a mode's card are never open together. The tower's opened
 * shuts the mode's (a strip on the tower's top leads back to the mode you are in); a mode's opened, a match starting
 * with you in it too, folds the tower's into a strip on its top (behind; 回去 › opens it again). A mode's card gone
 * with its mode (not shut with ×), the tower's folded behind it shows again.
 */
const stackOpen = kept(false);
const behind = kept(false);
/** The round you last put a block on, and when (this page): the board's 新纪录 is judged on it */
const stackMine = kept<{ round: number; at: number } | null>(null);
export const useSquadStackOpen = () => useSyncExternalStore(stackOpen.on, stackOpen.get, () => false);
export const useSquadStackBehind = () => useSyncExternalStore(behind.on, behind.get, () => false);
export const useSquadStackMine = () => useSyncExternalStore(stackMine.on, stackMine.get, () => null);
/** What is open now (the tests) */
export const squadStackOpenNow = stackOpen.get;
export const squadStackBehindNow = behind.get;
/** 基建加盖's card open (「玩」's tile, 回去 › on a mode's card): a mode's card open shut */
export function openSquadStack() {
  modeCard.set(null);
  behind.set(false);
  solo.set(null);
  stackOpen.set(true);
}
/** Shut with ×: nothing behind it any more */
export function closeSquadStack() {
  stackOpen.set(false);
  behind.set(false);
}
/** A mode's card open (at: the mode's start): the tower's, if open, folded behind it */
function showModeCard(at: number) {
  if (stackOpen.get()) {
    stackOpen.set(false);
    behind.set(true);
  }
  // one's own dance stops: a match started with you in it, or its card opened
  solo.set(null);
  modeCard.set(at);
}

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
export const squadNoticeNow = notice.get;
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
    // out of the room: its fire goes too, its tower, and what it played
    fireOpen.set(false);
    stackOpen.set(false);
    behind.set(false);
    stackMine.set(null);
    modeCard.set(null);
    solo.set(null);
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
        const res = await squadApi.room();
        r = res.room;
        if (r) clocked(r.now, sent, Date.now());
        // out of it for being 暂离 too long while this page was away: said as it comes back
        if (!r && res.out === "away" && room.get()) over(T.squad.afk.out);
        else setRoom(withOwnRace(r));
        if (r) raceSeenAll(r);
      } while (again);
      roomRead();
      if (r) hereSoon();
      return r;
    } catch (e) {
      if (e instanceof SquadUnreached) roomUnread();
      throw e;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * The room not read again (the network, or the server too busy: SquadUnreached): since when, and whether this page
 * stopped asking by itself (after STALE_RETRY_MS: 5 s, then 15 s), the room's top then saying so, a tap reading it
 * again (retrySquadRoom). Read, it goes. A 429 is waited out the same, never asked for sooner.
 */
export type SquadStale = { at: number; gaveUp: boolean };
const STALE_RETRY_MS = [5_000, 15_000];
const stale = kept<SquadStale | null>(null);
let staleTries = 0;
let staleTimer: number | undefined;
export const useSquadStale = () => useSyncExternalStore(stale.on, stale.get, () => null);
/** How the room stands as read (the tests) */
export const squadStaleNow = stale.get;

function roomUnread() {
  const was = stale.get();
  // one more try is on its way, or this page stopped trying till a tap
  if (staleTimer !== undefined || was?.gaveUp) return;
  const wait = STALE_RETRY_MS[staleTries];
  const at = was?.at ?? Date.now();
  if (wait === undefined) return stale.set({ at, gaveUp: true });
  staleTries += 1;
  stale.set({ at, gaveUp: false });
  staleTimer = window.setTimeout(() => {
    staleTimer = undefined;
    void loadSquadRoom().catch(() => {});
  }, wait);
}

function roomRead() {
  if (staleTimer !== undefined) window.clearTimeout(staleTimer);
  staleTimer = undefined;
  staleTries = 0;
  stale.set(null);
}

/** 「房间没刷新出来，点这里再试」: the room read again now (once; still not read, it says so on) */
export const retrySquadRoom = () => loadSquadRoom().catch(() => {});

// ---- 暂离: this page says it is here, or away ----

/** When this page last said it is here (ms; 0: not yet) */
let hereAt = 0;
/** The page in view and in a room: 「在」, unless said within the last minute (a refusal says nothing: the next goes as ever) */
function hereSoon(now = Date.now()) {
  if (!room.get() || typeof document === "undefined" || document.visibilityState !== "visible") return;
  if (now - hereAt < 60_000 && now >= hereAt) return;
  hereAt = now;
  void squadApi.here().catch(() => {});
}

/**
 * 暂离 (src/lib/squad.ts): while in a room, this page says it is here as it comes into view and each HERE_EVERY_MS
 * while in view (and as it reads the room: loadSquadRoom), and away as it is hidden or closed (a beacon). From
 * MapApp while 一起卫戍 shows; returns the undo.
 */
export function squadHereLoop() {
  const onVisible = () => {
    if (!room.get()) return;
    if (document.visibilityState === "visible") {
      hereAt = 0;
      hereSoon();
    } else {
      hereAt = 0;
      raceAway();
      squadApi.away();
    }
  };
  const onHide = () => {
    raceAway();
    if (room.get()) squadApi.away();
  };
  const timer = window.setInterval(() => {
    hereAt = 0;
    hereSoon();
  }, HERE_EVERY_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onHide);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onHide);
  };
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
  if (tell.t === "you") return over(tell.why === "kicked" ? T.squad.out.kicked : tell.why === "away" ? T.squad.afk.out : T.squad.out.left);
  // 暂离: one's page away since then, or here again, taken as it is
  if (tell.t === "room" && tell.what?.kind === "here") return patchMember(r, tell.what.h, { away: tell.what.away ?? undefined });
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
  // 基建加盖: the others' blocks onto the tower (yours went on as you put it), each told as the layer it is; a page out
  // of step (a layer it has as another's block, or one further on than its top) reads the room again
  if (tell.t === "stack") {
    let s = stackNow(r.stack, squadServerNow());
    let lost = false;
    for (const it of tell.items) {
      // a round gone by (rebuilt here already)
      if (it.round < s.round) continue;
      if (it.round === s.round && it.n <= s.n) {
        const b = s.top[s.top.length - 1 - (s.n - it.n)];
        if (!b || b.h !== it.h || b.at !== it.at) lost = true;
        continue;
      }
      if (it.round !== s.round || it.n !== s.n + 1) {
        lost = true;
        continue;
      }
      s = {
        ...s,
        n: it.n,
        sum: s.sum + it.x,
        top: [...s.top, { h: it.h, x: it.x, at: it.at }].slice(-STACK_TOP),
        swingAt: it.swingAt,
        ...(it.falls ? { fell: { at: it.at, height: it.n - 1 } } : {}),
        best: it.falls ? s.best : Math.max(s.best, it.n),
        busy: s.busy.includes(it.h) ? s.busy : [...s.busy, it.h].sort((x, y) => x - y),
      };
    }
    room.set(withWant({ ...r, stack: s }));
    if (lost) void loadSquadRoom().catch(() => {});
    return;
  }
  // 企鹅物流急件赛: the others' reports into their lanes (each once; yours are in already), known up to the server's now then
  if (tell.t === "race") {
    const mode = r.mode;
    if (mode?.kind !== "race" || mode.wait) return;
    const lanes = mode.lanes.map((l) => {
      const theirs = tell.items.filter((x) => x.h === l.h && x.h !== r.you);
      if (!theirs.length) return l;
      const taps = new Set(l.taps.map(([at]) => at));
      const jumps = new Set(l.jumps);
      return {
        ...l,
        taps: [...l.taps, ...theirs.flatMap((x) => x.taps).filter(([at]) => !taps.has(at))],
        jumps: [...l.jumps, ...theirs.flatMap((x) => x.jumps).filter((at) => !jumps.has(at))],
      };
    });
    for (const x of tell.items) if (x.h !== r.you) raceSeenAt(mode.start, x.h, x.upTo);
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
        // a match started with you in it: its card opens (the tower's folded behind it)
        const m = next.mode;
        if (what.lobby === "start" && m && !m.wait && m.in.some((x) => x.h === next.you)) {
          askedNow(m.at);
          showModeCard(m.at);
        }
        return;
      }
      // what you did yourself is not said back to you
      if ((what.kind === "in" || what.kind === "game") && what.h === next.you) return;
      // 结束这局: how high the 篝火 went in it and how long it burnt, to everyone, the host too
      if (what.kind === "state" && what.to === "wait" && next.fire.last) addFloat(fireEndLine(next.fire.last, next.fire.lastTop, next.fire.bestTop));
      if ((what.kind === "key" || what.kind === "state" || what.kind === "stop") && next.host) return;
      if (what.kind === "host") {
        const name = what.h === next.you ? T.squad.room.you : (next.members.find((m) => m.h === what.h)?.name ?? "");
        // handed on as its host was 暂离
        if (what.afk) return addFloat(what.h === next.you ? T.squad.afk.youHanded : fmt(T.squad.afk.handed, { name }));
        return addFloat(what.h === next.you ? T.squad.float.youHost : fmt(T.squad.float.host, { name }));
      }
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
/** 基建周榜 (this week's or last week's), as 火焰周榜 */
export const loadStackBoard = (week: "this" | "last") => squadApi.stackBoard(week);

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
  if (r?.mode) showModeCard(r.mode.at);
  return r;
}

/**
 * 加入 the mode playing (into; a match waiting: 准备; a round playing: 下一局算我), its card open; or out (不跳了，
 * 去围观; a match's 不玩了), the card left open. Either way, not asked to join it again.
 */
export async function squadModeIn(into: boolean) {
  if (!into) await squadRaceFlush().catch(() => {});
  await timed(() => squadApi.modeIn(into));
  const r = await loadSquadRoom();
  if (r?.mode) askedNow(r.mode.at);
  if (into && r?.mode) showModeCard(r.mode.at);
  return r;
}

/** 开始, by a match's initiator: the room as it is then, the card open on the round */
export async function squadStartMatch() {
  await timed(() => squadApi.start());
  const r = await loadSquadRoom();
  if (r?.mode) showModeCard(r.mode.at);
  return r;
}

/**
 * 龙门广场舞 from 「玩」 (or 再跳一首): its card open (a mode's or the tower's shut: one card at a time) and a song
 * asked for (not the one just danced). Refused while a match's round you are in plays: run it first.
 */
export async function squadDanceOpen() {
  const r = room.get();
  const mode = r?.mode;
  if (r && mode && !mode.wait && isMatchKind(mode.kind) && mode.in.some((m) => m.h === r.you) && mode.endsAt > squadServerNow()) {
    throw new WorldError(T.squad.dance.inMatch);
  }
  const was = solo.get()?.song?.song;
  const key = Date.now();
  modeCard.set(null);
  stackOpen.set(false);
  behind.set(false);
  solo.set({ key, song: null, beats: null, combo: 0, best: 0, last: null, tapAt: null, judge: null, wildAt: null, err: null });
  try {
    const got = await timed(() => squadApi.dance(was ? [was] : []));
    const d = solo.get();
    if (d?.key !== key) return;
    const map = readDance(got.dance);
    solo.set({ ...d, song: got, beats: map && !map.none ? map : null });
  } catch (e) {
    const d = solo.get();
    if (d?.key === key) solo.set({ ...d, err: e instanceof WorldError ? e.message : T.map.common.tryAgain });
  }
}
/** Its card shut: the dance over */
export const closeSquadDance = () => solo.set(null);

/** 跳 in one's own dance, now on the server's clock: judged here (danceJudge), the combo, its best, 准！ or 歪了 */
export function squadDanceTap() {
  const d = solo.get();
  if (!d?.song) return;
  const at = squadServerNow();
  if (at >= soloEnds(d)) return;
  const j = danceJudge(d.beats?.beats ?? null, d.song.songAt, d.combo, d.last, at);
  if (!j.counted) return solo.set({ ...d, tapAt: at });
  const wild = danceMove(j.combo) === "wild" && danceMove(d.combo) !== "wild";
  solo.set({ ...d, combo: j.combo, best: Math.max(d.best, j.combo), last: at, tapAt: at, judge: { ok: j.ok, at: Date.now() }, wildAt: wild ? Date.now() : d.wildAt });
}

/** W 的礼物's song for this page: its beats, and its link where 听歌 is open to the player */
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

/**
 * 企鹅物流急件赛 on this page (squadMode.ts RACE_REPORT_MS): your 加油 counted by the quarter second (RACE_CELL_MS) and
 * your 跳s, each in your own lane at once (your roach runs on them), kept here till the server has them: sent every
 * RACE_REPORT_MS, and at once as your roach signs in (in), its time is up, you leave the race, or the page goes. A
 * report that failed is kept for the next (the room not read again for it); one refused for good (the race over, you
 * out of it) is dropped. The room read again, those the server has not got yet go back into your lane.
 */
type RaceOwn = { start: number; taps: [number, number][]; jumps: number[]; sending: boolean; lastSent: number; inDue: boolean; inSaid: boolean };
let raceOwn: RaceOwn | null = null;
let raceTaps = 0;
let raceCellTimer = 0;
let raceReportTimer = 0;
let raceTickTimer = 0;

/** The race playing with a lane of yours: the room, the race and your lane's place */
function raceMine() {
  const r = room.get();
  const mode = r?.mode;
  if (!r || mode?.kind !== "race" || mode.wait) return null;
  const i = mode.lanes.findIndex((l) => l.h === r.you);
  return i < 0 ? null : { r, mode, i };
}

/** What you did in this race, not yet with the server (a new race: begun anew) */
function raceQueue(start: number): RaceOwn {
  if (raceOwn?.start !== start) raceOwn = { start, taps: [], jumps: [], sending: false, lastSent: 0, inDue: false, inSaid: false };
  return raceOwn;
}

/**
 * The others' lanes in the race playing, as far as this page knows them: up to the server's now as each report of theirs
 * was told (upTo), or as the room was read. SquadRace.tsx runs them on from there at their last second's pace.
 */
let raceSeen: { start: number; upTo: Map<number, number> } | null = null;
function raceSeenAt(start: number, h: number, upTo: number) {
  if (raceSeen?.start !== start) raceSeen = { start, upTo: new Map() };
  raceSeen.upTo.set(h, Math.max(upTo, raceSeen.upTo.get(h) ?? 0));
}
function raceSeenAll(r: SquadRoom) {
  const mode = r.mode;
  if (mode?.kind !== "race" || mode.wait) return;
  for (const l of mode.lanes) if (l.h >= 0 && l.h !== r.you) raceSeenAt(mode.start, l.h, r.now);
}
/** Up to when (the server's clock) another's lane in the race starting at start is known; its start when not yet */
export const squadRaceSeen = (start: number, h: number) => (raceSeen?.start === start ? (raceSeen.upTo.get(h) ?? start) : start);

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

/** The room as the server has it, your lane with what you did that the server has not got yet (each once) */
function withOwnRace(r: SquadRoom | null): SquadRoom | null {
  const q = raceOwn;
  const mode = r?.mode;
  if (!r || !q || mode?.kind !== "race" || mode.wait || mode.start !== q.start || (!q.taps.length && !q.jumps.length)) return r;
  const lanes = mode.lanes.map((l) => {
    if (l.h !== r.you) return l;
    const taps = new Set(l.taps.map(([at]) => at));
    const jumps = new Set(l.jumps);
    return { ...l, taps: [...l.taps, ...q.taps.filter(([at]) => !taps.has(at))], jumps: [...l.jumps, ...q.jumps.filter((at) => !jumps.has(at))] };
  });
  return { ...r, mode: { ...mode, lanes } };
}

/** The next report: at once when the last went RACE_REPORT_MS ago or more, else then */
function raceSoon() {
  const q = raceOwn;
  if (!q || raceReportTimer || q.sending) return;
  raceReportTimer = window.setTimeout(() => void raceReport(), Math.max(0, q.lastSent + RACE_REPORT_MS - Date.now()));
}

/** What you did since the last report, sent (RACE_REPORT_TAPS counts and RACE_REPORT_JUMPS 跳s at most; the rest next) */
async function raceReport() {
  window.clearTimeout(raceReportTimer);
  raceReportTimer = 0;
  const q = raceOwn;
  if (!q || q.sending) return;
  const inNow = q.inDue && !q.inSaid;
  if (!q.taps.length && !q.jumps.length && !inNow) return;
  const taps = q.taps.slice(0, RACE_REPORT_TAPS);
  const jumps = q.jumps.slice(0, RACE_REPORT_JUMPS);
  const all = taps.length === q.taps.length && jumps.length === q.jumps.length;
  const body = { taps, jumps, ...(inNow && all ? { in: true as const } : {}) };
  q.sending = true;
  q.lastSent = Date.now();
  try {
    await timed(() => squadApi.run(body));
    q.taps.splice(0, taps.length);
    q.jumps.splice(0, jumps.length);
    if (body.in) q.inSaid = true;
  } catch (e) {
    // refused for good: nothing of this race to send any more
    if (!(e instanceof SquadUnreached) && raceOwn === q) raceOwn = null;
  } finally {
    q.sending = false;
  }
  if (raceOwn === q && (q.taps.length || q.jumps.length || (q.inDue && !q.inSaid))) {
    // what is left of a report too big, or in, at once; the rest in time
    if (!all || (q.inDue && !q.inSaid)) void raceReport();
    else raceSoon();
  }
}

/** Each quarter second while you race: your roach in (reported at once, in), or its time up (all that is left, at once) */
function raceTick() {
  raceTickTimer = 0;
  const m = raceMine();
  const q = raceOwn;
  if (!m || !q || m.mode.start !== q.start || m.mode.end) return;
  const now = squadServerNow();
  if (!q.inDue && raceRun(m.mode, now).done[m.i] !== null) {
    q.inDue = true;
    void raceReport();
    return;
  }
  if (now >= q.start + RACE_MAX_MS) return void raceReport();
  raceTickTimer = window.setTimeout(raceTick, RACE_CELL_MS);
}

/** Something of yours in the race: kept, your roach on it at once, its report in time, the race looked at as it goes */
function raceDid(m: NonNullable<ReturnType<typeof raceMine>>, add: { tap?: [number, number]; jump?: number }) {
  const q = raceQueue(m.mode.start);
  ownLane(add);
  if (add.tap) q.taps.push(add.tap);
  if (add.jump !== undefined) q.jumps.push(add.jump);
  raceSoon();
  if (!raceTickTimer) raceTick();
}

/** 加油: counted here, the quarter second's count in your lane as it is up (and reported with the others in time) */
export function squadRaceTap() {
  raceTaps += 1;
  if (raceCellTimer) return;
  raceCellTimer = window.setTimeout(() => {
    raceCellTimer = 0;
    const n = Math.min(RACE_TAPS_MAX, raceTaps);
    raceTaps = 0;
    const m = raceMine();
    if (m && n > 0) raceDid(m, { tap: [squadServerNow(), n] });
  }, RACE_CELL_MS);
}

/** 跳, now on the server's clock as this page has it: your roach in the air at once (not while it still is: it counts for nothing) */
export function squadRaceJump() {
  const m = raceMine();
  if (!m) return;
  const at = squadServerNow();
  if (raceRun(m.mode, at).air[m.i]) return;
  raceDid(m, { jump: at });
}

/** All that is left of your race sent now (you leave it), waited for */
export async function squadRaceFlush() {
  if (raceOwn?.sending) await new Promise((done) => window.setTimeout(done, 300));
  await raceReport();
}

/** The page going (hidden or closed): what is left sent on its own, as it goes */
function raceAway() {
  const q = raceOwn;
  if (!q || q.sending || (!q.taps.length && !q.jumps.length)) return;
  const body = { taps: q.taps.splice(0, RACE_REPORT_TAPS), jumps: q.jumps.splice(0, RACE_REPORT_JUMPS), ...(q.inDue && !q.inSaid ? { in: true as const } : {}) };
  if (body.in) q.inSaid = true;
  q.lastSent = Date.now();
  squadApi.runAway(body);
}

/**
 * 基建加盖's 放, now on the server's clock as this page has it, on the room's tower as this page has it (a fallen one
 * rebuilt in time: towerNow): shown at once where the swing is (as the server will put it), then as the server took
 * it; refused, the room read again. Null when nothing was sent (the tower waiting to be rebuilt).
 */
export async function squadStackDrop() {
  const r = room.get();
  if (!r) return null;
  const at = squadServerNow();
  const tower = stackNow(r.stack, at);
  if (tower.fell) return null;
  const t = Math.max(at, tower.at, tower.top.at(-1)?.at ?? 0);
  const x = Math.round(stackSwing(tower.swingAt, tower.n, t)) || 0;
  const put = stackPut(tower, x);
  const n = tower.n + 1;
  const top = [...tower.top, { h: r.you, x, at: t }].slice(-STACK_TOP);
  const swingAt = !put.falls && n % STACK_GEAR_EVERY === 0 ? stackShift(tower.swingAt, tower.n, n, t) : tower.swingAt;
  const fell = put.falls ? { fell: { at: t, height: tower.n } } : {};
  const best = put.falls ? tower.best : Math.max(tower.best, n);
  const busy = tower.busy.includes(r.you) ? tower.busy : [...tower.busy, r.you].sort((a, b) => a - b);
  stackMine.set({ round: tower.round, at: Date.now() });
  // from the tower as it is now (one rebuilt keeps nothing of the round before)
  room.set(withWant({ ...r, stack: { ...tower, n, sum: tower.sum + x, top, ...fell, swingAt, best, busy } }));
  try {
    return await timed(() => squadApi.stack({ do: "drop", round: tower.round, at: t }));
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
  // the server's clock as learnt: learnt again from the next answers
  offs.length = 0;
  off = 0;
  // and no room to read again
  roomRead();
  hereAt = 0;
  roundWant = null;
  raceTaps = 0;
  for (const t of [raceCellTimer, raceReportTimer, raceTickTimer]) if (t) window.clearTimeout(t);
  raceCellTimer = raceReportTimer = raceTickTimer = 0;
  raceOwn = null;
  raceSeen = null;
  solo.set(null);
  window.clearTimeout(roundTimer);
  talkOpen.set(false);
  setRoom(null);
  notice.set(null);
  card.set(undefined);
  showName.set(undefined);
  noThrow.set(undefined);
  fireHide.set(undefined);
}
