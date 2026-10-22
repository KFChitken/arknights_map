import type { RoachAvatar, RoachColor, RoachStyle } from "./types";

// Front-facing chibi roach (the "hood" look): round black hood with antennae,
// dark visor, glowing side lights, white front with X straps, dark grey sleeves.
// The color option only changes the side lights. The other cartoon looks are
// pictures drawn on top of the same ground (see roachImages.ts).
export const GLOW: Record<RoachColor, string> = {
  cyan: "#3fd0d4",
  pink: "#ff7eb6",
  gold: "#ffd23f",
  green: "#5be37d",
  purple: "#b48cff",
  orange: "#ff9f43",
  red: "#ff5d5d",
  white: "#e8f1ff",
};

const LINE = "#0d0e10";

/**
 * clone: a see-through look shared by every clone, so a clone cannot be matched to its main roach.
 * friend: a pink ground and a heart, for roaches of your 触须之交.
 */
export type RoachOpts = {
  avatar?: RoachAvatar;
  /** Draw only the ground under the roach, or only what goes on top of it (the heart) */
  part?: "ground" | "overlay";
  mine?: boolean;
  clone?: boolean;
  friend?: boolean;
  size?: number;
  look?: RoachStyle;
  rotate?: number;
  /** Realistic roach only: where its legs are in the walk cycle, 0..1 */
  step?: number;
};

const FRIEND = "#ff7eb6";
const HEART = `<path d="M54 17 C48.5 13 47.5 8.5 50.5 7 C52.4 6.1 53.6 7.3 54 8.5 C54.4 7.3 55.6 6.1 57.5 7 C60.5 8.5 59.5 13 54 17 Z" fill="#ff4f8b" stroke="#fff" stroke-width="1.2"/>`;

const CLONE_OPACITY = 0.55;
// your own clones stay a bit more solid so you can tell them from other players' clones
const MINE_CLONE_OPACITY = 0.75;
const bodyOpacity = (mine?: boolean, clone?: boolean) => (clone ? (mine ? MINE_CLONE_OPACITY : CLONE_OPACITY) : 1);

export function roachSvg(color: RoachColor, opts: RoachOpts = {}) {
  if (opts.look === "real") return realRoachSvg(opts);
  const size = opts.size ?? 64;
  const glow = GLOW[opts.clone && !opts.mine ? "white" : color];
  const dash = opts.clone ? ` stroke-dasharray="4 3"` : "";
  const ground = opts.mine
    ? opts.clone
      ? `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="#ffd23f55" stroke="#ffd23f" stroke-width="2"${dash}/>`
      : `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="#ffd23f" stroke="${LINE}" stroke-width="1.5"/>`
    : opts.friend
      ? opts.clone
        ? `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="${FRIEND}55" stroke="${FRIEND}" stroke-width="2"${dash}/>`
        : `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="${FRIEND}" stroke="${LINE}" stroke-width="1.5"/>`
    : opts.clone
      ? `<ellipse cx="32" cy="59.5" rx="21" ry="3.2" fill="none" stroke="#1b1d22" stroke-width="1.5"${dash} opacity="0.6"/>`
      : `<ellipse cx="32" cy="59.5" rx="20" ry="3" fill="#000" opacity="0.18"/>`;
  const body = BODIES[shownAvatar(opts)]?.(glow) ?? "";
  const heart = opts.friend && !opts.mine ? HEART : "";
  const parts =
    opts.part === "ground"
      ? ground
      : opts.part === "overlay"
        ? heart
        : `${ground}\n<g opacity="${bodyOpacity(opts.mine, opts.clone)}">\n${body}\n</g>\n${heart}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
${parts}
</svg>`;
}

/** Clones of other players all wear the plain hood, whatever their owner picked. */
export function shownAvatar(opts: Pick<RoachOpts, "avatar" | "clone" | "mine">): RoachAvatar {
  return opts.clone && !opts.mine ? "hood" : (opts.avatar ?? "hood");
}

export const bodyOpacityFor = (opts: Pick<RoachOpts, "mine" | "clone">) => bodyOpacity(opts.mine, opts.clone);

// Only the hood is drawn here; the other looks are pictures (see roachImages.ts)
const BODIES: Partial<Record<RoachAvatar, (accent: string) => string>> = {
  hood: (glow) => `<g fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round">
  <path d="M27 14 C24 7 17 3 8 4"/><path d="M36 13 C38 6 43 2 51 2"/>
</g>
<rect x="9" y="33" width="15" height="25" rx="5" fill="#33363d" stroke="${LINE}" stroke-width="2"/>
<rect x="40" y="33" width="15" height="25" rx="5" fill="#33363d" stroke="${LINE}" stroke-width="2"/>
<path d="M22 40 L42 40 L43.5 57.5 L20.5 57.5 Z" fill="#fff" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
<path d="M23.5 42.5 L40.5 50 M40.5 42.5 L23.5 50" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>
<path d="M10 40 C10 22 20 12 32 12 C44 12 54 22 54 40 C54 43 51 44 48 42 L16 42 C13 44 10 43 10 40 Z" fill="#1d1f24" stroke="${LINE}" stroke-width="2"/>
<path d="M14.5 37 C14.5 25 22 17.5 32 17.5 C42 17.5 49.5 25 49.5 37" fill="none" stroke="#3a3e46" stroke-width="1.6"/>
<rect x="17" y="21" width="30" height="15" rx="6" fill="#08080a"/>
<rect x="19.5" y="22.8" width="25" height="3.6" rx="1.8" fill="#50555e"/>
<ellipse cx="22.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85"/>
<ellipse cx="41.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85"/>
<rect x="11" y="35" width="6" height="4" rx="2" fill="${glow}"/>
<rect x="47" y="35" width="6" height="4" rx="2" fill="${glow}"/>`,
};

// Top-down American cockroach (Periplaneta americana), head up: reddish-brown
// wings over the abdomen, pale-rimmed pronotum shield with a dark centre,
// six spiny legs, long antennae and a pair of cerci at the tail.
const LEG = "#3d1c0b";
const LEGS = [
  // [hip, knee, foot] for the left side; the right side is mirrored
  [[27.5, 21], [20, 18.5], [14, 11]],
  [[26.5, 29], [16, 29.5], [8, 35]],
  [[27, 37], [17.5, 44], [11, 58]],
];
// how far each pair of legs swings forward and back, in degrees
const LEG_SWING = [22, 16, 20];

type Pt = [number, number];
function turn([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const [dx, dy] = [x - cx, y - cy];
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(cx + dx * Math.cos(r) - dy * Math.sin(r)), round(cy + dx * Math.sin(r) + dy * Math.cos(r))];
}

/**
 * Legs at a point of the walk cycle. Roaches walk on alternating tripods: front
 * and hind legs of one side with the middle leg of the other move together.
 */
function legPoints(flip: boolean, step: number | undefined) {
  return LEGS.map((pts, i) => {
    const [a, b, c] = pts.map(([x, y]): Pt => [flip ? 64 - x : x, y]);
    if (step === undefined) return [a, b, c];
    const tripod = (i % 2 === 0) !== flip ? 0 : Math.PI;
    // the mirrored side turns the other way for the same forward swing
    const deg = LEG_SWING[i] * Math.sin(step * 2 * Math.PI + tripod) * (flip ? -1 : 1);
    return [a, turn(b, a, deg), turn(c, a, deg)];
  });
}

function realRoachSvg({ mine, clone, friend, size = 64, rotate = 0, step }: RoachOpts) {
  const legPath = (flip: boolean) =>
    legPoints(flip, step)
      .map(([a, b, c]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`)
      .join(" ");
  // the antennae sweep a little as it walks
  const feel = (base: Pt, d: string, phase: number) =>
    step === undefined
      ? `<path d="${d}"/>`
      : `<path d="${d}" transform="rotate(${(6 * Math.sin(step * 2 * Math.PI + phase)).toFixed(2)} ${base[0]} ${base[1]})"/>`;
  // little spines on each lower leg
  const spines = (flip: boolean) =>
    legPoints(flip, step).map(([, b, c]) => {
      return [0.35, 0.65]
        .map((f) => {
          const x = b[0] + (c[0] - b[0]) * f;
          const y = b[1] + (c[1] - b[1]) * f;
          const dx = flip ? 1.6 : -1.6;
          return `M${x} ${y} l${dx} 0.8`;
        })
        .join(" ");
    }).join(" ");
  const ring = mine ? "#ffd23f" : friend ? FRIEND : null;
  const ground = ring
    ? `<ellipse cx="32" cy="34" rx="27" ry="29" fill="none" stroke="${ring}" stroke-width="3"${clone ? ` stroke-dasharray="6 4"` : ""}/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
<defs>
  <linearGradient id="w" x1="0" x2="1">
    <stop offset="0" stop-color="#5a260c"/><stop offset="0.35" stop-color="#8f4a1f"/>
    <stop offset="0.5" stop-color="#7a3a16"/><stop offset="0.65" stop-color="#8f4a1f"/>
    <stop offset="1" stop-color="#4f210a"/>
  </linearGradient>
  <radialGradient id="p" cx="0.5" cy="0.55" r="0.6">
    <stop offset="0" stop-color="#3a1808"/><stop offset="0.55" stop-color="#5e2a0e"/>
    <stop offset="0.8" stop-color="#c79a52"/><stop offset="1" stop-color="#a87a3a"/>
  </radialGradient>
</defs>
${ground}
<g transform="rotate(${rotate} 32 32)" opacity="${bodyOpacity(mine, clone)}">
<ellipse cx="32" cy="38" rx="11" ry="20" fill="#000" opacity="0.18" transform="translate(1.5 1.5)"/>
<g fill="none" stroke="${LEG}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="${legPath(false)} ${legPath(true)}"/>
</g>
<g fill="none" stroke="${LEG}" stroke-width="0.7" stroke-linecap="round">
  <path d="${spines(false)} ${spines(true)}"/>
</g>
<g fill="none" stroke="#4a210c" stroke-width="0.8" stroke-linecap="round">
  ${feel([30.5, 12], "M30.5 12 C27 6 20 2.5 6 2", 0.9)}${feel([33.5, 12], "M33.5 12 C37 6 44 2.5 58 2", 2.3)}
  <path d="M30 55 L27.5 61"/><path d="M34 55 L36.5 61"/>
</g>
<path d="M32 19 C41 19 43 30 42.5 40 C42 50 37 58 32 59 C27 58 22 50 21.5 40 C21 30 23 19 32 19 Z" fill="url(#w)" stroke="#3a1707" stroke-width="0.8"/>
<path d="M32 24 C31.4 36 31.6 48 32.6 58" fill="none" stroke="#3a1707" stroke-width="0.8"/>
<path d="M26 27 C25 36 25.5 46 28 54" fill="none" stroke="#b5703a" stroke-width="0.6" opacity="0.6"/>
<path d="M38 27 C39 36 38.5 46 36 54" fill="none" stroke="#b5703a" stroke-width="0.6" opacity="0.5"/>
<ellipse cx="32" cy="12.5" rx="3.6" ry="3" fill="#2e1406"/>
<ellipse cx="32" cy="20" rx="10" ry="7" fill="url(#p)" stroke="#3a1707" stroke-width="0.8"/>
<path d="M28.5 19 C29.5 16.5 31 16.5 32 18.5 C33 16.5 34.5 16.5 35.5 19 C34.5 22 33 23 32 22 C31 23 29.5 22 28.5 19 Z" fill="#241005" opacity="0.9"/>
<ellipse cx="28.5" cy="34" rx="1.6" ry="6" fill="#d39a62" opacity="0.25"/>
</g>
${friend && !mine ? HEART : ""}
</svg>`;
}

export function roachDataUrl(color: RoachColor, opts: RoachOpts = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(roachSvg(color, opts))}`;
}
