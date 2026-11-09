/**
 * ⚡舟友的酒⚡: while your main roach lies drunk, four phantoms of it dance round it, above,
 * below, left and right, for a minute under a disco light, to a minute of 「⚡邦友の酒⚡」
 * (music by 活跃黑江乐 on bilibili, kept on the server like 阿米娅向导's dance, never in this
 * repository). The dance is the seated spin of 旋转大香澄, bounce for bounce: a turn every
 * six beats, holding front and back, and on every beat a landing squash and a springy
 * stretch, the feelers flopping after the body. Only on your own screen, like the other scenes.
 */

/** The map comes at least this close as it starts (MapLibre levels) */
export const PARTY_ZOOM = 14;
/** How long the party lasts: the length of the music */
export const PARTY_MS = 60_000;
/** The song's tempo; its minute starts on a beat (the drop after a break) */
export const BEAT_S = 60 / 130;
/** One spin every six beats */
export const SPIN_BEATS = 6;

/** Where a phantom is in its dance: the turn (0 facing you, 90 showing its right side, 180 its back) and its squash */
export type PhantomPose = {
  /** Degrees, 0 to 360 */
  turn: number;
  /** Width and height scales about its feet */
  sx: number;
  sy: number;
  /** Hop, in its own units (the roach is 64 high), negative is up */
  dy: number;
  /** Lean, degrees */
  tilt: number;
  /** How far the feelers flop outward, degrees (negative: flung up) */
  feeler: number;
  /** A beat on which the phantoms flicker like a bad signal */
  glitch: boolean;
};

/** Values at points of a beat (0 to 1), eased from one to the next */
function curve(keys: readonly (readonly number[])[], p: number, at: number) {
  for (let i = 1; i < keys.length; i++) {
    const [p1] = keys[i];
    if (p > p1) continue;
    const [p0] = keys[i - 1];
    const k = p1 === p0 ? 1 : (p - p0) / (p1 - p0);
    const s = (1 - Math.cos(Math.PI * k)) / 2;
    return keys[i - 1][at] + (keys[i][at] - keys[i - 1][at]) * s;
  }
  return keys[keys.length - 1][at];
}

// One beat: [where in the beat, height, width, hop]. It lands on the beat, squashed wide, springs
// up taller than it is, settles, and draws itself up again just before the next landing.
const BOUNCE = [
  [0, 0.8, 1.18, 0],
  [0.1, 0.94, 1.06, -2],
  [0.3, 1.16, 0.9, -9],
  [0.52, 1.03, 0.98, -6],
  [0.75, 0.97, 1.02, -1.5],
  [0.92, 1.05, 0.96, -0.3],
  [1, 0.8, 1.18, 0],
] as const;

// The feelers lag behind: still falling just after the landing, flung up as the body stretches
const FEELERS = [
  [0, 22],
  [0.08, 38],
  [0.3, -22],
  [0.55, 12],
  [0.78, -7],
  [1, 22],
] as const;

const smooth = (k: number) => k * k * (3 - 2 * k);

/** The turn at a point of the six-beat spin: front, round to the back, a long look at the back, round again */
function turnAt(c: number) {
  if (c < 0.6) return 0;
  if (c < 1.9) return 180 * smooth((c - 0.6) / 1.3);
  if (c < 3.9) return 180;
  if (c < 5.4) return 180 + 180 * smooth((c - 3.9) / 1.5);
  return 0;
}

/** A phantom's pose so many beats into the dance */
export function phantomPose(beats: number): PhantomPose {
  const b = Math.max(0, beats);
  const p = b - Math.floor(b);
  const c = b % SPIN_BEATS;
  return {
    turn: turnAt(c) % 360,
    sy: curve(BOUNCE, p, 1),
    sx: curve(BOUNCE, p, 2),
    dy: curve(BOUNCE, p, 3),
    tilt: 4 * Math.sin(Math.PI * b),
    feeler: curve(FEELERS, p, 1),
    // at the start of every other spin, a few frames
    glitch: b % (2 * SPIN_BEATS) < 0.18 && b >= SPIN_BEATS,
  };
}

/** The light's colour on a beat, round the palette */
export const PARTY_COLORS = ["#ff4fd8", "#3fd0ff", "#ffd23f", "#5be37d", "#b48cff", "#ff7a3d"] as const;
export const partyColor = (beats: number) => PARTY_COLORS[Math.floor(Math.max(0, beats)) % PARTY_COLORS.length];

/**
 * Where a feature on the body shows as the body turns, as if the hood were a round drum seen
 * from the front: its centre across (from the middle, in body units, r at most), how wide it
 * looks (1 face on, 0 edge on) and whether it faces you. angle: where it sits round the body
 * (0 the front, 90 the side on your right, -90 your left), turn: the body's turn.
 */
export function onDrum(angle: number, turn: number, r: number) {
  const a = ((angle + turn) * Math.PI) / 180;
  return { x: r * Math.sin(a), width: Math.cos(a), facing: Math.cos(a) > 0 };
}
