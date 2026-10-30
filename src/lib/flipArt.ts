import { FRIEND, HEART, hoodBody, LINE } from "./roachSvg";

/**
 * 翻肚皮: the roach asleep belly up, and the hood drinking. Drawn on roachSvg's
 * 64×64 grid with its lines and colours (from the 翻肚皮 design, flip-art.js).
 * Each function returns the inside of an <svg viewBox="0 0 64 64">.
 * anim adds SMIL motion (kicking legs, breathing lamps, drifting Zzz), which
 * also plays inside an <img>.
 */

export type Ground = "mine" | "friend" | "other";

let uid = 0;

function ground(kind: Ground | "none", long = false) {
  const rx = long ? 28 : 25;
  if (kind === "mine") return `<ellipse cx="32" cy="59" rx="${rx}" ry="4.5" fill="#ffd23f" stroke="${LINE}" stroke-width="1.5"/>`;
  if (kind === "friend") return `<ellipse cx="32" cy="59" rx="${rx}" ry="4.5" fill="${FRIEND}" stroke="${LINE}" stroke-width="1.5"/>`;
  if (kind === "none") return "";
  return `<ellipse cx="32" cy="59.5" rx="${long ? 26 : 20}" ry="3" fill="#000" opacity="0.18"/>`;
}

const limb = (d: string, w: number) =>
  `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="${w + 3.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#33363d" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Mostly still: rest, a quick kick, rest. */
const twitch = (cx: number | string, cy: number | string, deg: number, dur: number, begin: number) =>
  `<animateTransform attributeName="transform" type="rotate" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"
  values="0 ${cx} ${cy};0 ${cx} ${cy};${deg} ${cx} ${cy};${-deg * 0.4} ${cx} ${cy};${deg * 0.6} ${cx} ${cy};0 ${cx} ${cy};0 ${cx} ${cy}"
  keyTimes="0;0.78;0.82;0.86;0.9;0.94;1"/>`;

const ZS = [
  [5.6, 16.4, 3.2],
  [2.6, 9.4, 4],
  [6.4, 1.6, 5],
];

export function zzz({ anim = false } = {}) {
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${ZS.map(([x, y, s], i) => {
    const d = `M${x} ${y} h${s} l${-s} ${s} h${s}`;
    const drift = anim
      ? `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.75;1" dur="3s" begin="${(i * 0.6).toFixed(1)}s" repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values="1.5 3;0 0;-1 -2.5" dur="3s" begin="${(i * 0.6).toFixed(1)}s" repeatCount="indefinite"/>`
      : "";
    return `<g>${drift}<path d="${d}" stroke="#fff" stroke-width="3.6" opacity="0.9"/><path d="${d}" stroke="#1b1d22" stroke-width="1.7"/></g>`;
  }).join("")}</g>`;
}

// [hip, knee, foot, kick seconds, delay, degrees] for the four little legs the hood usually hides
const HOOD_LEGS: [string, string, string, number, number, number][] = [
  ["23.8 18.2", "18.6 12.4", "20.4 6.2", 5.1, 0.3, 14],
  ["28 15.4", "25.6 8.6", "28.2 3.4", 6.3, 1.9, -12],
  ["40.2 18.2", "45.4 12.4", "43.6 6.2", 5.7, 3.1, -14],
  ["36 15.4", "38.4 8.6", "35.8 3.4", 6.9, 0.9, 12],
];

/**
 * The hood on its back like a turtle, rocking on the round hood: white belly up, the
 * X straps, sleeves raised, the little legs out. The face stays the right way up:
 * eyes closed on the visor, cheeks still pink, the lamps on standby in its colour.
 */
export function sleepingHood(glow: string, { ground: kind = "other", anim = false, zzz: z = false, tilt = 9 }: { ground?: Ground; anim?: boolean; zzz?: boolean; tilt?: number } = {}) {
  const lamp = anim ? `<animate attributeName="opacity" values="0.2;0.85;0.2" dur="3.4s" repeatCount="indefinite"/>` : "";
  const legs = HOOD_LEGS.map(([a, b, c, dur, begin, deg]) => {
    const [cx, cy] = a.split(" ");
    return `<path d="M${a} L${b} L${c}" fill="none" stroke="${LINE}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${anim ? twitch(cx, cy, deg, dur, begin) : ""}</path>`;
  }).join("");
  const arms = `${limb("M16 32.6 L9 28.6 L10.6 19.6", 7)}${limb("M48 32.6 L55 28.6 L53.4 19.6", 7)}`;
  const feelers = `<g fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round">
  <path d="M27.5 57.6 C22 60.6 14.5 60.4 7.5 56.6"/><path d="M36.5 57.6 C42 60.6 49.5 60.4 56.5 56.6"/>
</g>`;
  const belly = `<path d="M21.6 32.5 L42.4 32.5 L43.8 20.4 C44 14.6 39.2 12.6 32 12.6 C24.8 12.6 20 14.6 20.2 20.4 Z" fill="#fff" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
<path d="M23.6 18.6 L40.4 28.8 M40.4 18.6 L23.6 28.8" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
  const head = `<path d="M10 32 C10 50 20 60 32 60 C44 60 54 50 54 32 C54 29 51 28 48 30 L16 30 C13 28 10 29 10 32 Z" fill="#1d1f24" stroke="${LINE}" stroke-width="2"/>
<path d="M14.5 35 C14.5 47 22 54.5 32 54.5 C42 54.5 49.5 47 49.5 35" fill="none" stroke="#3a3e46" stroke-width="1.6"/>
<rect x="17" y="34.6" width="30" height="15" rx="6" fill="#08080a"/>
<rect x="19.5" y="36.4" width="25" height="3.4" rx="1.7" fill="#50555e"/>
<path d="M21.6 43 Q25 46 28.4 43 M35.6 43 Q39 46 42.4 43" fill="none" stroke="#c9d3e0" stroke-width="1.9" stroke-linecap="round"/>
<ellipse cx="22.6" cy="47.3" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.9"/>
<ellipse cx="41.4" cy="47.3" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.9"/>
<rect x="11" y="32.4" width="6" height="4" rx="2" fill="${glow}" opacity="0.55">${lamp}</rect>
<rect x="47" y="32.4" width="6" height="4" rx="2" fill="${glow}" opacity="0.55">${lamp}</rect>`;
  const rock = anim
    ? `<animateTransform attributeName="transform" type="rotate" values="${tilt - 3} 32 52;${tilt + 3} 32 52;${tilt - 3} 32 52" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>`
    : "";
  const shadow = kind === "other" ? `<ellipse cx="32" cy="59.6" rx="17" ry="2.8" fill="#000" opacity="0.18"/>` : ground(kind);
  return `${shadow}<g transform="rotate(${tilt} 32 52)">${rock}${feelers}${legs}${arms}${belly}${head}</g>${z ? zzz({ anim }) : ""}${kind === "friend" ? HEART : ""}`;
}

// left legs as [hip, knee, foot], folded over the belly; the right side is mirrored
const BELLY_LEGS: [number, number][][] = [
  [
    [28.8, 22.6],
    [20.6, 19.4],
    [24.2, 13.2],
  ],
  [
    [28.4, 27.6],
    [18.2, 28.4],
    [22.4, 22.4],
  ],
  [
    [28.6, 32.4],
    [17.8, 39.4],
    [23.6, 45],
  ],
];
const BELLY_KICKS = [
  [4.7, 0.2, 16],
  [6.1, 2.4, -12],
  [5.3, 1.1, 14],
  [6.7, 3.3, -16],
  [5.9, 0.7, 12],
  [7.3, 4.1, -14],
];

/** The realistic roach on its back, seen from above: pale segmented underside, legs folded over it. No Zzz. */
export function realBelly({ ground: kind = "other", rotate = 0, anim = false }: { ground?: Ground; rotate?: number; anim?: boolean } = {}) {
  const id = `belly${++uid}`;
  let k = 0;
  const leg = (pts: [number, number][], flip: boolean) => {
    const [a, b, c] = pts.map(([x, y]): [number, number] => [flip ? 64 - x : x, y]);
    const spines = [0.35, 0.68]
      .map((f) => `M${(b[0] + (c[0] - b[0]) * f).toFixed(2)} ${(b[1] + (c[1] - b[1]) * f).toFixed(2)} l${flip ? -1.5 : 1.5} -0.6`)
      .join(" ");
    const [dur, begin, deg] = BELLY_KICKS[k++];
    return `<g>${anim ? twitch(a[0], a[1], flip ? -deg : deg, dur, begin) : ""}
  <path d="M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}" fill="none" stroke="#3d1c0b" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${spines}" fill="none" stroke="#3d1c0b" stroke-width="0.7" stroke-linecap="round"/>
</g>`;
  };
  const ring = kind === "mine" ? "#ffd23f" : kind === "friend" ? FRIEND : null;
  const plates = [37, 41.5, 45.8, 49.8, 53.4]
    .map((y, i) => {
      const w = 9.6 - i * 1.25;
      return `<path d="M${32 - w} ${y} Q32 ${y + 2.6} ${32 + w} ${y}" fill="none" stroke="#6b3a17" stroke-width="0.75"/>`;
    })
    .join("");
  const legs = BELLY_LEGS.map((l) => leg(l, false) + leg(l, true)).join("");
  return `<defs>
  <radialGradient id="${id}" cx="0.5" cy="0.45" r="0.62">
    <stop offset="0" stop-color="#c99058"/><stop offset="0.6" stop-color="#a86d38"/><stop offset="1" stop-color="#7d4720"/>
  </radialGradient>
</defs>
${ring ? `<ellipse cx="32" cy="34" rx="27" ry="29" fill="none" stroke="${ring}" stroke-width="3"/>` : ""}
<g transform="rotate(${rotate} 32 32)">
<ellipse cx="33.5" cy="37.5" rx="12" ry="20" fill="#000" opacity="0.16"/>
<g fill="none" stroke="#4a210c" stroke-width="0.8" stroke-linecap="round">
  <path d="M30.6 10.4 C25 5.6 15 7.4 6.6 14.6"/><path d="M33.4 10.4 C39 5.6 49 7.4 57.4 14.6"/>
  <path d="M30 55.5 L27.6 61"/><path d="M34 55.5 L36.4 61"/>
</g>
<path d="M32 18.6 C41.6 18.6 43.6 30 43 40 C42.4 50.4 37.2 58.4 32 59.2 C26.8 58.4 21.6 50.4 21 40 C20.4 30 22.4 18.6 32 18.6 Z" fill="#5a260c" stroke="#3a1707" stroke-width="0.8"/>
<path d="M32 30.5 C39.6 30.5 41 38 40.6 44 C40.2 51 36.2 56.6 32 57 C27.8 56.6 23.8 51 23.4 44 C23 38 24.4 30.5 32 30.5 Z" fill="url(#${id})" stroke="#5c2f12" stroke-width="0.8"/>
${plates}
<ellipse cx="32" cy="18.4" rx="10.4" ry="7.2" fill="#d6ad74" stroke="#3a1707" stroke-width="0.8" opacity="0.95"/>
<path d="M24.8 24.6 C26 22.6 38 22.6 39.2 24.6 L38.6 31.6 C36 33.4 28 33.4 25.4 31.6 Z" fill="#a06a38" stroke="#5c2f12" stroke-width="0.8"/>
<g fill="#c99660" stroke="#6b3a17" stroke-width="0.6">
  <ellipse cx="28.9" cy="22.9" rx="2.4" ry="1.6" transform="rotate(-20 28.9 22.9)"/><ellipse cx="35.1" cy="22.9" rx="2.4" ry="1.6" transform="rotate(20 35.1 22.9)"/>
  <ellipse cx="28.4" cy="27.8" rx="2.6" ry="1.8" transform="rotate(-12 28.4 27.8)"/><ellipse cx="35.6" cy="27.8" rx="2.6" ry="1.8" transform="rotate(12 35.6 27.8)"/>
  <ellipse cx="28.6" cy="32.4" rx="2.8" ry="2" transform="rotate(10 28.6 32.4)"/><ellipse cx="35.4" cy="32.4" rx="2.8" ry="2" transform="rotate(-10 35.4 32.4)"/>
</g>
<ellipse cx="32" cy="14.6" rx="4.4" ry="4" fill="#6e3d1a" stroke="#3a1707" stroke-width="0.7"/>
<ellipse cx="29.2" cy="13.4" rx="1.3" ry="1.8" fill="#2a1206"/><ellipse cx="34.8" cy="13.4" rx="1.3" ry="1.8" fill="#2a1206"/>
<path d="M30.6 17.6 L29.6 20 M33.4 17.6 L34.4 20 M31.2 18.4 L31.6 20.6 M32.8 18.4 L32.4 20.6" stroke="#3a1707" stroke-width="0.6" stroke-linecap="round"/>
${legs}
</g>
${kind === "friend" ? HEART : ""}`;
}

/** Where a picture look sits in its 256px image: the figure's left and right edges, and whether it needs a sleep mask */
export type PictureFit = { left: number; right: number; mask?: boolean };

/**
 * Stopgap until drawn lying versions exist: the picture laid down on a pillow under
 * a quilt. Returns what goes under it and over it, and the transform that lays the
 * picture (drawn at 4,4 56×56) down; mask is drawn in the picture's own frame.
 */
export function pictureSleeping(fit: PictureFit, { ground: kind = "other", zzz: z = false }: { ground?: Ground; zzz?: boolean } = {}) {
  const half = (((fit.right - fit.left) / 256) * 56) / 2;
  const cy = 56.4 - half;
  const top = cy - half;
  const q = Math.max(top + 9, 31);
  const shadow = kind === "other" ? `<ellipse cx="32" cy="59.5" rx="27" ry="3" fill="#000" opacity="0.18"/>` : ground(kind, true);
  const pillow = `<path d="M1.4 58.6 C1 53.4 2.8 51 7.6 50.6 L19 50.2 C23 50.2 24.6 52.6 24.4 56.4 L24.2 59.2 Z" fill="#fff" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/>`;
  const quilt = `<path d="M38 59 L38 ${q + 4} C38 ${q} 40 ${q - 2} 43 ${q - 2} C49 ${q - 2} 55 ${q + 4} 58.6 ${q + 11} C61 ${q + 16} 61.8 54 61.2 59 Z" fill="#8ec5ff" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
<g fill="#fff" opacity="0.9">
  <circle cx="45" cy="${q + 5}" r="1.3"/><circle cx="51.5" cy="${q + 9}" r="1.3"/><circle cx="56" cy="${q + 16}" r="1.3"/>
  <circle cx="47" cy="${q + 14}" r="1.3"/><circle cx="42.5" cy="${q + 10}" r="1.3"/><circle cx="53" cy="${q + 22}" r="1.3"/><circle cx="44.5" cy="${q + 21}" r="1.3"/><circle cx="58.4" cy="${q + 25}" r="1.1"/>
</g>
<path d="M36.4 59 L36.4 ${q + 3} C36.4 ${q - 0.6} 38.4 ${q - 2.2} 41 ${q - 2.2} L42.4 ${q - 2.2} L42.4 59 Z" fill="#fff" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
  const mask = fit.mask
    ? `<path d="M20 29.5 C20 25.8 23 25 26 25.6 C28 26 29.5 26.8 30.8 26.8 C32.1 26.8 33.6 26 35.6 25.6 C38.6 25 41.6 25.8 41.6 29.5 C41.6 33 39 34.4 35.6 34 C33.6 33.8 32.2 32.6 30.8 32.6 C29.4 32.6 28 33.8 26 34 C22.6 34.4 20 33 20 29.5 Z" fill="#ffb3cf" stroke="${LINE}" stroke-width="1.3"/>
<path d="M23 29.4 Q25.4 31.8 27.8 29.4 M33.8 29.4 Q36.2 31.8 38.6 29.4" fill="none" stroke="${LINE}" stroke-width="1.1" stroke-linecap="round"/>`
    : "";
  const over = `${quilt}${z ? `<g transform="translate(41 ${Math.max(top - 17, -3)})">${zzz()}</g>` : ""}${kind === "friend" ? HEART : ""}`;
  return { under: `${shadow}${pillow}`, over, mask, layDown: { x: 32, y: cy, deg: -86 } };
}

/** A green bottle: "rest" held in the hanging right sleeve, "pour" tipped into the visor from the raised one. */
export function bottle(pose: "rest" | "pour" = "rest") {
  const at = pose === "pour" ? "translate(55.5 13.5) rotate(-127)" : "translate(51 44) rotate(-24)";
  return `<g transform="${at}" stroke-linejoin="round" stroke-linecap="round">
  <path d="M-4.6 -1.4 Q-4.6 0 -3.2 0 H3.2 Q4.6 0 4.6 -1.4 V-12.6 C4.6 -15 1.8 -15.6 1.8 -17.6 V-22 H-1.8 V-17.6 C-1.8 -15.6 -4.6 -15 -4.6 -12.6 Z" fill="#3f9b62" stroke="${LINE}" stroke-width="1.6"/>
  <rect x="-4.6" y="-10.6" width="9.2" height="5.8" fill="#f6e7c1" stroke="${LINE}" stroke-width="1.1"/>
  <path d="M-1.7 -9.3 L1.7 -6.1 M1.7 -9.3 L-1.7 -6.1" stroke="#e8443a" stroke-width="1.2"/>
  <path d="M-2.8 -1.9 V-3.9 M-2.8 -11.8 V-13" stroke="#fff" stroke-width="1.1" opacity="0.55"/>
  <rect x="-2.3" y="-24.6" width="4.6" height="2.9" rx="0.9" fill="#e8443a" stroke="${LINE}" stroke-width="1.3"/>
</g>`;
}

/** The bottle alone, upright and a little jaunty, for the 摄入酒精 button. */
export const bottleIcon = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -27 28 29" width="${size}" height="${size}" aria-hidden="true">${bottle().replace(/^<g transform="[^"]*"/, '<g transform="rotate(14)"')}</svg>`;

const spiral = (cx: number, cy: number) =>
  `M${cx} ${cy} a0.6 0.6 0 0 1 1.2 0 a1.2 1.2 0 0 1 -2.4 0 a1.8 1.8 0 0 1 3.6 0 a2.4 2.4 0 0 1 -4.8 0`;

/** Drunk: the visor flushes pink, swirly eyes, big red cheeks. */
const DRUNK_FACE = `<rect x="17" y="21" width="30" height="15" rx="6" fill="#ff4d6d" opacity="0.2"/>
<path d="${spiral(25.2, 29.6)} ${spiral(38.8, 29.6)}" fill="none" stroke="#f2f5fa" stroke-width="1.25" stroke-linecap="round"/>
<ellipse cx="21.6" cy="33.6" rx="3.1" ry="1.5" fill="#ff5d7a"/>
<ellipse cx="42.4" cy="33.6" rx="3.1" ry="1.5" fill="#ff5d7a"/>`;

/** The standing hood mid-drink, without its ground: pouring from the bottle, or drunk. */
export function drinkingHood(glow: string, { pour = false, drunk = false }: { pour?: boolean; drunk?: boolean }) {
  return `${hoodBody(glow, { raise: pour })}${drunk ? DRUNK_FACE : ""}${pour ? bottle("pour") : ""}`;
}

/** Just the ground: a still layer under the swaying ones. */
export const groundOnly = (kind: Ground) => ground(kind);
