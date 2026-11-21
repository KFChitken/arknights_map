import { woodIn, woodNow } from "./squadFire";

/**
 * 玩点什么 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑥): one mode at a time, opened by anyone in the room, the others told
 * and free to join or only watch (fishing, throwing, the fire and talking all go on beside it); each ends on its own,
 * after which anyone may open the next at once. The fight goes on above it, and a round starting never stops it. The
 * server keeps it (src/lib/server/squadModes.ts) and judges everything; the page draws it.
 *
 * 龙门广场舞 (dance): its opener leads, those who join dance in a row to one of 听歌's songs, to its table of beats
 * (src/lib/dance.ts): the song 卫戍的一起听 is playing, else one at random that has beats. A tap of 跳 on a beat (within
 * DANCE_WINDOW_MS of one) puts one's combo up, and the dance gets livelier (晃 → 跳 → 转圈); off the beat, back to 0.
 * The music is 听歌's (LISTEN), each muting their own; it ends with its song, or DANCE_IDLE_MS after the last tap.
 */

/** The modes there are (⑦ adds them one by one) */
export const MODE_KINDS = ["dance", "quiz", "gift", "race", "stack"] as const;
export type SquadModeKind = (typeof MODE_KINDS)[number];
export const isModeKind = (v: unknown): v is SquadModeKind => typeof v === "string" && (MODE_KINDS as readonly string[]).includes(v);

/** 龙门广场舞: its song starts this long after it opens (time for the pages to fetch it), unless 一起听's is playing */
export const DANCE_LEAD_MS = 3_000;
/** It ends this long after the last tap anyone made */
export const DANCE_IDLE_MS = 15_000;
/** A tap within this of a beat (either side) is on it */
export const DANCE_WINDOW_MS = 150;
/**
 * A tap's own time, as the page sends it on the server's clock, is taken when it is no more than this before the
 * server's now (the way here) nor this after it; else the server's now is
 */
export const DANCE_TAP_EARLY_MS = 400;
export const DANCE_TAP_LATE_MS = 50;
/** Taps closer together than this count as one */
export const DANCE_TAP_EVERY_MS = 180;
/** From this combo the roach jumps, and from this it spins */
export const DANCE_HOP = 5;
export const DANCE_SPIN = 10;

export type DanceMove = "sway" | "hop" | "spin";
export const danceMove = (combo: number): DanceMove => (combo >= DANCE_SPIN ? "spin" : combo >= DANCE_HOP ? "hop" : "sway");

/** How far a time (ms from the song's start) is from the nearest of its beats (s from its start), in ms */
export function beatOff(beats: ArrayLike<number>, tMs: number): number {
  const n = beats.length;
  if (!n) return Number.POSITIVE_INFINITY;
  const t = tMs / 1000;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.min(Math.abs(t - beats[lo]), Math.abs(t - beats[hi])) * 1000;
}

/** When a dance ends by itself: its song over, or DANCE_IDLE_MS after its last tap, whichever comes first */
export const danceEnds = (until: number, last: number) => Math.min(until, last + DANCE_IDLE_MS);
/** When a mode ends by itself: a dance as danceEnds, 基建加盖 STACK_IDLE_MS after the last block put, the others at their end (until) */
export const modeEnds = (kind: string, until: number, last: number) =>
  kind === "dance" ? danceEnds(until, last) : kind === "stack" ? Math.min(until, last + STACK_IDLE_MS) : until;

/**
 * The mode a room is playing, as its pages have it (SquadRoom.mode): which, opened by whom (one's number) and when;
 * those in it (not only watching) with each one's combo (a quiz's score); when it ends by itself unless something
 * happens, and when it would at the latest (until)
 */
type ModeBase = { by: number; at: number; in: { h: number; combo: number }[]; endsAt: number; until: number };
/** 龙门广场舞: its song (id and name), where its start is on the server's clock (songAt, the song's 0) */
export type DanceMode = ModeBase & { kind: "dance"; song: string; name: string; songAt: number };
/** 凯尔希随堂测: its questions, each as far as it has gone (QuizQuestion) */
export type QuizMode = ModeBase & { kind: "quiz"; questions: QuizQuestion[] };
/**
 * W 的礼物: its song as 龙门广场舞's (its 0 at songAt on the server's clock); the seed its 人机 pass by; the rounds
 * begun (GiftRound); the mode's own 人机 (GiftBot). Its points (in) are how often each was hit.
 */
export type GiftMode = ModeBase & { kind: "gift"; song: string; name: string; songAt: number; seed: number; rounds: GiftRound[]; bots: GiftBot[] };
/**
 * 企鹅物流急件赛: its start, the lanes with what their players did (RaceLane), the obstacles, the seed its 人机 run by,
 * the mode's own 人机; once it is over and the server settled it, the order they signed in (RaceEnd)
 */
export type RaceMode = ModeBase & { kind: "race"; start: number; seed: number; lanes: RaceLane[]; obs: RaceObstacle[]; bots: GiftBot[]; end?: RaceEnd };
/**
 * 基建加盖: its round (from 1) and when it began, the tower's blocks, how it fell (once it has), the room's highest, and
 * the blocks in your hand (n at `at`, as 篝火's sticks; none while you are not in it)
 */
export type StackMode = ModeBase & {
  kind: "stack";
  round: number;
  roundAt: number;
  blocks: StackBlock[];
  fell?: StackFell;
  best: number;
  hand?: { n: number; at: number | null };
};
export type SquadMode = DanceMode | QuizMode | GiftMode | RaceMode | StackMode;

// ---- 凯尔希随堂测 ----

/**
 * 凯尔希随堂测 (quiz): QUIZ_QUESTIONS questions, one after another on the server's clock, each three to pick from:
 * whose silhouette (sil) or part of whose 立绘 (crop) this is, from the pass pictures of 寻访's characters, made on the
 * server so a page cannot tell whose; which song this intro is (intro), from 听歌's songs, drawn only when everyone in
 * the room could hear it then; or one of the design thread's 方舟梗 questions (meme, src/data/quiz-meme.json). Each
 * answers each question once; the first right gets a point. A question takes QUIZ_ANSWER_MS, an intro's
 * QUIZ_INTRO_MS (as long as it plays); then QUIZ_REVEAL_MS showing the answer, and the next. After the last, QUIZ_RESULT_MS of results; with two or more in it, the lowest (all of those
 * tied there, unless everyone is) wear 漏勺 QUIZ_LADLE_MS. One alone practises. One coming in answers from the next.
 */
export const QUIZ_QUESTIONS = 5;
export const QUIZ_LEAD_MS = 3_000;
export const QUIZ_ANSWER_MS = 3_000;
export const QUIZ_INTRO_MS = 6_000;
export const QUIZ_REVEAL_MS = 2_000;
export const QUIZ_RESULT_MS = 6_000;
export const QUIZ_LADLE_MS = 60_000;
/** An answer's own time, as the page sends it on the server's clock, taken within this of the server's now (as 跳's) */
export const QUIZ_EARLY_MS = 400;
/** A question's own picture or song may be asked for this long before it starts, to be there in time */
export const QUIZ_FETCH_MS = 1_500;

export const QUIZ_KINDS = ["sil", "crop", "intro", "meme"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

/**
 * A question as the pages have it: its number (0 the first), kind, when it starts and when answers stop; once it has
 * started, its three to pick from (a 方舟梗 question's own words too: ask); once someone got it right, or its time is
 * up, which was right and who got it first, how fast (ms from its start)
 */
export type QuizQuestion = {
  n: number;
  kind: QuizKind;
  at: number;
  ends: number;
  ask?: string;
  options?: string[];
  answer?: number;
  first?: { h: number; ms: number };
};

/**
 * A quiz as the server keeps it (squad_rooms.mode_data), never sent as it is: each question's kind and times, its
 * three to pick from by id (a character's on passes, a song's, a 方舟梗 question's number), which is right, where a
 * part of a picture is cut (seed), and who got it right first and how fast
 */
export type QuizData = {
  qs: { kind: QuizKind; at: number; ends: number; ids: string[]; answer: number; seed: number; first?: { h: number; ms: number } }[];
};

/** When each question starts and its answers stop, from the quiz's start (at): one after another, each with its reveal */
export function quizTimes(at: number, kinds: readonly QuizKind[]) {
  let t = at + QUIZ_LEAD_MS;
  return kinds.map((kind) => {
    const q = { at: t, ends: t + (kind === "intro" ? QUIZ_INTRO_MS : QUIZ_ANSWER_MS) };
    t = q.ends + QUIZ_REVEAL_MS;
    return q;
  });
}
/** When a quiz is over (its results shown): after its last question's reveal */
export const quizUntil = (times: readonly { ends: number }[]) => (times.at(-1)?.ends ?? 0) + QUIZ_REVEAL_MS + QUIZ_RESULT_MS;

/**
 * Who wears 漏勺 at a quiz's end (by number): with two or more in it, those with the lowest score, unless everyone has
 * the same
 */
export function quizLast(scores: readonly { h: number; combo: number }[]): number[] {
  if (scores.length < 2) return [];
  const low = Math.min(...scores.map((s) => s.combo));
  const last = scores.filter((s) => s.combo === low).map((s) => s.h);
  return last.length === scores.length ? [] : last;
}

/**
 * A question for a page (POST /api/squad/question): its three names, and its picture (a data: URL) or its song's
 * link (to one 听歌 is open to); now, the server's clock
 */
export type QuizAsk = {
  n: number;
  kind: QuizKind;
  at: number;
  ends: number;
  ask?: string;
  options: string[];
  pic?: string;
  url?: string;
  lite?: string;
  now: number;
};
/** An answer's answer: right or not, the first right (a point), and which was right (once one has answered) */
export type QuizAnswered = { right: boolean; first: boolean; answer: number; now: number };

/**
 * 龙门广场舞's song for a page (POST /api/squad/song): its table of beats always; its link (and its smaller copy's)
 * only to one 听歌 is open to (LISTEN), while it is not paused and the site not gray
 */
export type DanceSong = { song: string; dance: string; url?: string; lite?: string; now: number };

// ---- W 的礼物 ----

/**
 * W 的礼物 (gift): 击鼓传花 with W's gift, a box with its fuse lit, round GIFT_SEATS seats about a drum: those in it
 * first (as they came), the room's 人机, then the mode's own (in it alone, numbered from GIFT_BOT_FROM down) to fill
 * them; one coming in takes a seat from the next round. The drum beats to a song as 龙门广场舞's. Each round the song
 * plays GIFT_ROUND_MIN_MS–GIFT_ROUND_MAX_MS (decided as it opens, never told to the pages) while the gift goes round:
 * one holding it passes it (传) to the next seat, or it goes by itself GIFT_HOLD_MS on; a 人机 passes it after
 * giftBotHold. The song stops: 砰, the one holding it is turned over and, with two or more players in it, wears 漏勺
 * GIFT_LADLE_MS (one alone practises); the next round starts GIFT_GAP_MS on, from them. GIFT_ROUNDS rounds, then
 * GIFT_RESULT_MS of results.
 */
export const GIFT_SEATS = 4;
export const GIFT_ROUNDS = 5;
export const GIFT_LEAD_MS = 3_000;
export const GIFT_ROUND_MIN_MS = 8_000;
export const GIFT_ROUND_MAX_MS = 20_000;
export const GIFT_GAP_MS = 4_000;
export const GIFT_RESULT_MS = 6_000;
export const GIFT_HOLD_MS = 2_000;
export const GIFT_BOT_MIN_MS = 500;
export const GIFT_BOT_MAX_MS = 1_200;
export const GIFT_LADLE_MS = 60_000;
/** A pass's own time, as the page sends it on the server's clock, taken within this before the server's now (as 跳's) */
export const GIFT_EARLY_MS = 400;
/** The mode's own 人机 are numbered from this down (the room's own are -1, -2, …) */
export const GIFT_BOT_FROM = -100;

/** A 传 by a player: when (on the server's clock), from which seat */
export type GiftTap = { at: number; seat: number };
/**
 * A round as the pages have it: when it starts, who sits where (by number, GIFT_SEATS of them, in the order the gift
 * goes), the seat it starts from, the passes players made; once its song stopped, when, and the seat hit (砰)
 */
export type GiftRound = { at: number; seats: number[]; from: number; taps: GiftTap[]; stop?: number; hit?: number };
/** One of the mode's own 人机: its number, the number in its name, its look */
export type GiftBot = { h: number; no: number; avatar: string; color: string };
/**
 * W 的礼物 as the server keeps it (squad_rooms.mode_data), never sent as it is: each round's start and stop decided as
 * it opened, the rounds begun (a round's hit once its song stopped), the seed, the mode's own 人机
 */
export type GiftData = { seed: number; plan: { at: number; stop: number }[]; rounds: Omit<GiftRound, "stop">[]; bots: GiftBot[] };

/** How long a 人机 holds the gift before passing it on: its k-th pass in round r, from the mode's seed, the same everywhere */
export function giftBotHold(seed: number, r: number, k: number): number {
  let x = (seed ^ Math.imul(r + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return GIFT_BOT_MIN_MS + (x % (GIFT_BOT_MAX_MS - GIFT_BOT_MIN_MS + 1));
}

/**
 * Where the gift is at t (the server's clock) in round r: the seat holding it, since when, and how many passes so far.
 * Before the round starts, at its first seat. A player's seat (a number 0 or above) passes it at their own 传 (one from
 * that seat within GIFT_HOLD_MS of getting it) or GIFT_HOLD_MS on; a 人机's at giftBotHold. A pass at t has happened.
 */
export function giftAt(round: Pick<GiftRound, "at" | "seats" | "from" | "taps">, seed: number, r: number, t: number) {
  let seat = round.from;
  let since = round.at;
  let k = 0;
  // passes take some time each, so this many is far past any round's end
  for (let guard = 0; guard < 2_000; guard++) {
    const h = round.seats[seat];
    const tap = h < 0 ? undefined : round.taps.find((x) => x.seat === seat && x.at >= since && x.at <= since + GIFT_HOLD_MS);
    const next = h < 0 ? since + giftBotHold(seed, r, k) : tap ? tap.at : since + GIFT_HOLD_MS;
    if (next > t) break;
    seat = (seat + 1) % round.seats.length;
    since = next;
    k += 1;
  }
  return { seat, since, k };
}

/**
 * The seats of the next round from these (null: none yet): those gone from the mode (players) or the room (its 人机)
 * leave theirs; players in it not seated yet (as they came), then the room's 人机, take the empty seats and those of
 * the mode's own 人机; the mode's own 人机 fill the rest. Everyone else keeps their seat.
 */
export function giftSeats(prev: readonly (number | null)[], players: readonly number[], roomBots: readonly number[], bots: readonly number[]): number[] {
  const seats: (number | null)[] = Array.from({ length: GIFT_SEATS }, (_, i) => prev[i] ?? null);
  const here = new Set([...players, ...roomBots]);
  for (let i = 0; i < seats.length; i++) {
    const h = seats[i];
    if (h !== null && h > GIFT_BOT_FROM && !here.has(h)) seats[i] = null;
  }
  for (const h of [...players, ...roomBots]) {
    if (seats.includes(h)) continue;
    let i = seats.indexOf(null);
    if (i < 0) i = seats.findIndex((x) => x !== null && x <= GIFT_BOT_FROM);
    if (i < 0) break;
    seats[i] = h;
  }
  const free = bots.filter((h) => !seats.includes(h));
  return seats.map((h) => (h === null ? free.shift()! : h));
}

/** The times of the rounds from a start (opened at `at`): each GIFT_GAP_MS after the last one's stop, lens their lengths */
export function giftPlan(at: number, lens: readonly number[]) {
  let t = at + GIFT_LEAD_MS;
  return lens.map((len) => {
    const r = { at: t, stop: t + len };
    t = r.stop + GIFT_GAP_MS;
    return r;
  });
}
/** When W 的礼物 is over (its results shown): after its last round's 砰 */
export const giftUntil = (plan: readonly { stop: number }[]) => (plan.at(-1)?.stop ?? 0) + GIFT_GAP_MS + GIFT_RESULT_MS;
/** As late as it could be over, from its first round's start: what the pages are told till its last round's song has stopped */
export const giftLatest = (first: number) => first + GIFT_ROUNDS * (GIFT_ROUND_MAX_MS + GIFT_GAP_MS) + GIFT_RESULT_MS;

// ---- 企鹅物流急件赛 ----

/**
 * 企鹅物流急件赛 (race): RACE_LANES roaches, each with a 企鹅物流 parcel, run RACE_M metres down a street of 龙门
 * (10 px a metre on the page) to 大帝 at its end: those in it, then the room's 人机, then the mode's own to fill the
 * lanes. A player runs RACE_BASE m/s, and RACE_PER_TAP more for each 加油 in the last second (RACE_TAPS_MAX at most);
 * a 人机 takes a speed between RACE_BOT_MIN and RACE_BOT_MAX every RACE_BOT_EVERY_MS. On the way, the same in every
 * lane: 理智顶液 (run RACE_POTION_PLUS faster RACE_POTION_MS, unless jumped over), 白开水 (RACE_WATER_SLOW of the speed
 * RACE_WATER_MS), 源石虫 (stopped RACE_SLUG_MS) and 近卫局路障 (stopped RACE_BAR_MS), none of which hurt one in the
 * air (a jump: RACE_JUMP_MS); a 人机 jumps RACE_BOT_JUMPS of the time RACE_BOT_SEE_M before an obstacle. Speeds
 * change smoothly (RACE_EASE). It starts RACE_LEAD_MS after it opens and ends when all are in, or RACE_MAX_MS on;
 * the server settles the order (from what each did, by the same rule the pages draw it by) and RACE_RESULT_MS later
 * it is over. The first in, a player, with two or more players in it, wears a small crown RACE_CROWN_MS.
 */
export const RACE_LANES = 4;
export const RACE_M = 300;
export const RACE_LEAD_MS = 3_000;
export const RACE_MAX_MS = 30_000;
export const RACE_RESULT_MS = 5_000;
export const RACE_BASE = 7;
export const RACE_PER_TAP = 2.4;
export const RACE_TAPS_MAX = 6;
export const RACE_BOT_EVERY_MS = 800;
export const RACE_BOT_MIN = 12.5;
export const RACE_BOT_MAX = 20;
export const RACE_POTION_MS = 1_500;
export const RACE_POTION_PLUS = 9;
export const RACE_WATER_MS = 700;
export const RACE_WATER_SLOW = 0.35;
export const RACE_SLUG_MS = 600;
export const RACE_BAR_MS = 900;
export const RACE_JUMP_MS = 560;
export const RACE_BOT_SEE_M = 4.6;
export const RACE_BOT_JUMPS = 0.6;
export const RACE_EASE = 6;
export const RACE_CROWN_MS = 60_000;
/** The rule runs in steps of this (ms), the same on the server and the pages */
export const RACE_STEP_MS = 50;
/** A 加油 count or a 跳's own time, as the page sends it on the server's clock, taken within this before the server's now */
export const RACE_EARLY_MS = 400;
/** The obstacles of a race: 白开水 twice, 源石虫, 理智顶液, 近卫局路障, at random between these (m), this far apart at least */
export const RACE_OBSTACLES = ["water", "water", "slug", "potion", "bar"] as const;
export const RACE_OBS_FROM = 40;
export const RACE_OBS_TO = 270;
export const RACE_OBS_GAP = 30;

export type RaceKind = (typeof RACE_OBSTACLES)[number];
export type RaceObstacle = { m: number; k: RaceKind };
/** A lane: who runs it (a player's number, a 人机's below 0), the 加油 they sent ([when, how many]) and their 跳s (when) */
export type RaceLane = { h: number; taps: [number, number][]; jumps: number[] };
/** A race settled: when it ended, the lanes in the order they signed in, each one's time in (null: not in) and metres run */
export type RaceEnd = { at: number; order: number[]; times: (number | null)[]; metres: number[] };
/** As the server keeps it (squad_rooms.mode_data) */
export type RaceData = { seed: number; start: number; lanes: RaceLane[]; obs: RaceObstacle[]; bots: GiftBot[]; end?: RaceEnd };

/** A number in [0, 1) from the race's seed and two more, the same everywhere */
export function raceRand(seed: number, a: number, b: number): number {
  let x = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The race's obstacles from its seed: RACE_OBSTACLES in a random order, at random places RACE_OBS_GAP apart at least */
export function raceObstacles(seed: number): RaceObstacle[] {
  const kinds = [...RACE_OBSTACLES];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(raceRand(seed, 900, i) * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  // places: the room left over shared out at random between the gaps
  const spare = RACE_OBS_TO - RACE_OBS_FROM - RACE_OBS_GAP * (kinds.length - 1);
  const cuts = kinds.map((_, i) => raceRand(seed, 901, i) * spare).sort((a, b) => a - b);
  return kinds.map((k, i) => ({ m: Math.round(RACE_OBS_FROM + cuts[i] + i * RACE_OBS_GAP), k }));
}

export type RaceEffect = "" | "boost" | "slip" | "block" | "fall";
/** Where everyone is at a moment of the race (t: ms from its start), as the rule has it */
export type RaceNow = {
  t: number;
  x: number[];
  v: number[];
  effect: RaceEffect[];
  air: boolean[];
  /** How far into a jump each is (ms), or null on the ground */
  airT: (number | null)[];
  /** When each signed in (ms from the start), or null */
  done: (number | null)[];
  /** The 理智顶液 each has drunk */
  ate: boolean[];
  /** What happened to each at an obstacle last, and when (ms from the start) */
  last: ({ k: RaceKind; jumped: boolean; t: number } | null)[];
  over: boolean;
};

/** 加油 counted at t (absolute) from a lane's: those of the last second, RACE_TAPS_MAX at most */
const tapsAt = (taps: readonly [number, number][], t: number) => {
  let n = 0;
  for (const [at, k] of taps) if (at > t - 1_000 && at <= t) n += k;
  return Math.min(RACE_TAPS_MAX, n);
};

/**
 * The race as it is at `now` (the server's clock): every lane run step by step from its start by the rule, from what
 * its player did (players: lanes with a number 0 or above) or the seed (人机)
 */
export function raceRun(race: Pick<RaceData, "seed" | "start" | "lanes" | "obs">, now: number): RaceNow {
  const n = race.lanes.length;
  const until = Math.max(0, Math.min(now - race.start, RACE_MAX_MS));
  const x = Array<number>(n).fill(0);
  const v = Array<number>(n).fill(0);
  const boost = Array<number>(n).fill(0);
  const slow = Array<number>(n).fill(0);
  const stun = Array<number>(n).fill(0);
  const effect = Array<RaceEffect>(n).fill("");
  const botJump = Array<number>(n).fill(-1);
  const done = Array<number | null>(n).fill(null);
  const ate = Array<boolean>(n).fill(false);
  const last: RaceNow["last"] = Array(n).fill(null);
  const decided = race.lanes.map(() => new Set<number>());
  const dt = RACE_STEP_MS / 1_000;
  /** How far into a jump lane i is at t (ms from the start), or null */
  const jumpT = (i: number, t: number): number | null => {
    const lane = race.lanes[i];
    if (lane.h < 0) return botJump[i] >= 0 && t - botJump[i] < RACE_JUMP_MS ? t - botJump[i] : null;
    const abs = race.start + t;
    const j = lane.jumps.find((x) => x <= abs && abs < x + RACE_JUMP_MS);
    return j === undefined ? null : abs - j;
  };
  const inAir = (i: number, t: number) => jumpT(i, t) !== null;
  let t = 0;
  for (; t < until; ) {
    t += RACE_STEP_MS;
    for (let i = 0; i < n; i++) {
      if (done[i] !== null) continue;
      const lane = race.lanes[i];
      if (lane.h < 0 && !inAir(i, t)) {
        const ahead = race.obs.findIndex((o) => o.k !== "potion" && o.m - x[i] > 0 && o.m - x[i] <= RACE_BOT_SEE_M);
        if (ahead >= 0 && !decided[i].has(ahead)) {
          decided[i].add(ahead);
          if (raceRand(race.seed, i, 1_000 + ahead) < RACE_BOT_JUMPS) botJump[i] = t;
        }
      }
      let base = lane.h < 0 ? RACE_BOT_MIN + (RACE_BOT_MAX - RACE_BOT_MIN) * raceRand(race.seed, i, Math.floor((t - RACE_STEP_MS) / RACE_BOT_EVERY_MS)) : RACE_BASE + RACE_PER_TAP * tapsAt(lane.taps, race.start + t);
      if (boost[i] > 0) {
        boost[i] -= RACE_STEP_MS;
        base += RACE_POTION_PLUS;
      }
      if (slow[i] > 0) {
        slow[i] -= RACE_STEP_MS;
        base *= RACE_WATER_SLOW;
      }
      if (stun[i] > 0) {
        stun[i] -= RACE_STEP_MS;
        base = 0;
      }
      if (boost[i] <= 0 && slow[i] <= 0 && stun[i] <= 0) effect[i] = "";
      v[i] += (base - v[i]) * Math.min(1, dt * RACE_EASE);
      const before = x[i];
      x[i] = Math.min(RACE_M, x[i] + v[i] * dt);
      const air = inAir(i, t);
      for (const o of race.obs) {
        if (!(before < o.m && x[i] >= o.m)) continue;
        if (o.k === "potion") {
          if (!air) {
            boost[i] = RACE_POTION_MS;
            effect[i] = "boost";
            ate[i] = true;
          }
        } else if (!air && o.k === "water") {
          slow[i] = RACE_WATER_MS;
          effect[i] = "slip";
        } else if (!air && o.k === "slug") {
          stun[i] = RACE_SLUG_MS;
          effect[i] = "block";
        } else if (!air && o.k === "bar") {
          stun[i] = RACE_BAR_MS;
          effect[i] = "fall";
        }
        last[i] = { k: o.k, jumped: air, t };
      }
      if (x[i] >= RACE_M) {
        done[i] = t;
        effect[i] = "";
      }
    }
    if (done.every((d) => d !== null)) break;
  }
  const airT = race.lanes.map((_, i) => (done[i] === null ? jumpT(i, t) : null));
  return { t, x, v, effect, air: airT.map((a) => a !== null), airT, done, ate, last, over: done.every((d) => d !== null) || t >= RACE_MAX_MS };
}

/** The lanes in the order they came in: those in first by their time, then the others by how far they ran */
export function raceOrder(r: Pick<RaceNow, "x" | "done">): number[] {
  return r.x
    .map((_, i) => i)
    .sort((a, b) => {
      const da = r.done[a];
      const db = r.done[b];
      if (da !== null && db !== null) return da - db || a - b;
      if (da !== null) return -1;
      if (db !== null) return 1;
      return r.x[b] - r.x[a] || a - b;
    });
}

// ---- 基建加盖 ----

/**
 * 基建加盖 (stack): a tower of roaches. Your roach swings over the tower's top, STACK_SWING_PX each way and back each
 * STACK_SWING_MS, the same for everyone on the server's clock; 放 lets it fall where it is (the page's time, taken within
 * STACK_EARLY_MS of the server's). One more than STACK_MISS_PX off the one under it, or a tower whose middle is more than
 * STACK_TIP_PX off the base's, falls: the round is over (its height counted), and anyone may start the next. More than
 * STACK_WOBBLE_PX off, it only sways. Each has a hand held as 篝火's sticks are (squadFire.ts woodNow: STACK_HAND_MAX
 * at most, one more each STACK_HAND_EVERY_MS), full as one first comes in after it opened, and kept from round to round
 * till it ends; the server takes one block each STACK_EVERY_MS from each. STACK_IDLE_MS with no block put (nor a round
 * begun), it is over. The room keeps its highest tower (squad_rooms.stack_best). 人机 put none; nothing is won.
 */
export const STACK_SWING_MS = 1_600;
export const STACK_SWING_PX = 60;
/** Each block raises the tower this much (px on the page) */
export const STACK_BLOCK_H = 34;
export const STACK_MISS_PX = 40;
export const STACK_TIP_PX = 30;
export const STACK_WOBBLE_PX = 18;
export const STACK_EVERY_MS = 1_000;
export const STACK_HAND_MAX = 3;
export const STACK_HAND_EVERY_MS = 30_000;
/**
 * The tower stays where it is on the page till it is this many blocks high, and then goes down as it grows (the
 * canvas's six would put the swinging roach over the line at the top right)
 */
export const STACK_SHOWN = 5;
export const STACK_IDLE_MS = 60_000;
export const STACK_EARLY_MS = 400;
/** It is over by this long after it opened at the latest, whatever is put */
export const STACK_MOST_MS = 3_600_000;

/** A block on the tower: whose roach it is (their number), where it is from the base's middle (px), put when (the server's clock) */
export type StackBlock = { h: number; x: number; at: number };
/** A round's end: when the tower fell, and how high it had been */
export type StackFell = { at: number; height: number };
/**
 * 基建加盖 as the server keeps it (squad_rooms.mode_data): the round, when it began, its blocks, how it fell, and each
 * one's hand (by number: n at `at`, as 篝火's sticks; their last block's time)
 */
export type StackData = { round: number; at: number; blocks: StackBlock[]; fell?: StackFell; hands: Record<string, { n: number; at: number | null; last: number }> };

/** Where the swinging block is at t (the server's clock) in a round begun at `at`: px from the base's middle */
export function stackSwing(at: number, t: number): number {
  const p = (((t - at) % STACK_SWING_MS) + STACK_SWING_MS) % STACK_SWING_MS;
  return -STACK_SWING_PX * Math.cos((2 * Math.PI * p) / STACK_SWING_MS);
}

/** A hand as it is now ({n, at} as kept; none yet: a full one), and till the next block grows in it (null: full) */
export function stackHand(hand: { n: number; at: number | null } | undefined, now: number): { n: number; next: number | null } {
  const n = hand ? woodNow(hand.n, hand.at, now, STACK_HAND_MAX, STACK_HAND_EVERY_MS) : STACK_HAND_MAX;
  const next = hand ? woodIn(hand.n, hand.at, now, STACK_HAND_MAX, STACK_HAND_EVERY_MS) : null;
  return { n, next };
}

/** How high the tower stands: its blocks, or as high as it was when it fell (the one that made it fall not counted) */
export const stackHeight = (s: { blocks: readonly unknown[]; fell?: StackFell }) => (s.fell ? s.fell.height : s.blocks.length);

/** A block put at x on a tower: how far off the one under it (the base's middle for the first), and whether the tower falls, or sways */
export function stackPut(blocks: readonly { x: number }[], x: number): { off: number; falls: boolean; wobbles: boolean } {
  const under = blocks.length ? blocks[blocks.length - 1].x : 0;
  const off = x - under;
  const middle = (blocks.reduce((sum, b) => sum + b.x, 0) + x) / (blocks.length + 1);
  const falls = Math.abs(off) > STACK_MISS_PX || Math.abs(middle) > STACK_TIP_PX;
  return { off, falls, wobbles: !falls && Math.abs(off) > STACK_WOBBLE_PX };
}
