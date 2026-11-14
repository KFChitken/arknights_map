/**
 * 复读 325 (src/components/app/study/Echo325.tsx): three bells, 3, 2 and 5, stand in a row. They light up one after
 * another and the player rings them back in the same order. Each turn plays one bell more than the last; ringing back
 * ten passes, and one wrong bell ends the round. The first three are always 3, 2, 5; the rest are the day's, the same
 * for everyone who plays it that day (rules.ts dayRandom). Nothing in it needs sound.
 */

/** The bells, left to right */
export const ECHO_BELLS = [3, 2, 5] as const;
export type Bell = (typeof ECHO_BELLS)[number];
/** How many bells the first turn plays */
export const ECHO_FIRST = 3;
/** How many bells rung back in a row pass */
export const ECHO_STEPS = 10;
/** How long a bell stays lit when it is played, and dark before the next (ms): fewer than two a second */
export const ECHO_ON_MS = 480;
export const ECHO_OFF_MS = 240;
/** How long before a turn's first bell (ms) */
export const ECHO_PAUSE_MS = 900;
/** How long a bell the player rings stays lit (ms) */
export const ECHO_RING_MS = 200;

/** Whether a key or a digit is one of the bells */
export const isBell = (d: unknown): d is Bell => ECHO_BELLS.includes(d as Bell);

/**
 * The day's bells, from its random (rules.ts dayRandom): 3, 2, 5, then the rest drawn from the three, never one bell
 * three times running (hard to count as it lights)
 */
export function echoBells(random: () => number): Bell[] {
  const s: Bell[] = [3, 2, 5];
  while (s.length < ECHO_STEPS) {
    const n = s.length;
    const ok = ECHO_BELLS.filter((b) => !(b === s[n - 1] && b === s[n - 2]));
    s.push(ok[Math.min(ok.length - 1, Math.floor(random() * ok.length))]);
  }
  return s;
}

/** Where a round is: how many bells this turn plays, and how many of them were rung back so far */
export type Echo = { turn: number; rung: number };

export const ECHO_START: Echo = { turn: ECHO_FIRST, rung: 0 };

/** What ringing a bell did: right so far, the turn rung back, all ten rung back, or wrong (the bell wanted) */
export type Ring = { echo: Echo; did: "right" | "turn" | "pass" } | { echo: Echo; did: "wrong"; want: Bell };

export function ring(bells: readonly Bell[], e: Echo, bell: Bell): Ring {
  const want = bells[e.rung];
  if (bell !== want) return { echo: e, did: "wrong", want };
  const rung = e.rung + 1;
  if (rung < e.turn) return { echo: { turn: e.turn, rung }, did: "right" };
  if (e.turn >= ECHO_STEPS) return { echo: { turn: e.turn, rung }, did: "pass" };
  return { echo: { turn: e.turn + 1, rung: 0 }, did: "turn" };
}

/** The most bells rung back in a row: a whole turn, or as far as this one went */
export const remembered = (e: Echo) => Math.max(e.turn > ECHO_FIRST ? e.turn - 1 : 0, e.rung);
