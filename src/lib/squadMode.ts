/**
 * 玩点什么 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑥): one mode at a time, opened by anyone in the room, the others told
 * and free to join or only watch (fishing, throwing, the fire and talking all go on beside it); each ends on its own,
 * after which anyone may open the next, though one who opened a mode waits MODE_AGAIN_MS after it ended before opening
 * another. The fight goes on above it, and a round starting never stops it. The server keeps it
 * (src/lib/server/squadModes.ts) and judges everything; the page draws it.
 *
 * 龙门广场舞 (dance): its opener leads, those who join dance in a row to one of 听歌's songs, to its table of beats
 * (src/lib/dance.ts): the song 卫戍的一起听 is playing, else one at random that has beats. A tap of 跳 on a beat (within
 * DANCE_WINDOW_MS of one) puts one's combo up, and the dance gets livelier (晃 → 跳 → 转圈); off the beat, back to 0.
 * The music is 听歌's (LISTEN), each muting their own; it ends with its song, or DANCE_IDLE_MS after the last tap.
 */

/** The modes there are (⑦ adds them one by one) */
export const MODE_KINDS = ["dance", "quiz", "gift"] as const;
export type SquadModeKind = (typeof MODE_KINDS)[number];
export const isModeKind = (v: unknown): v is SquadModeKind => typeof v === "string" && (MODE_KINDS as readonly string[]).includes(v);

/** One who opened a mode opens another this long after it ended at the soonest */
export const MODE_AGAIN_MS = 60_000;

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
/** When a mode ends by itself: a dance as danceEnds, the others at their end (until) */
export const modeEnds = (kind: string, until: number, last: number) => (kind === "dance" ? danceEnds(until, last) : until);

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
export type SquadMode = DanceMode | QuizMode | GiftMode;

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
