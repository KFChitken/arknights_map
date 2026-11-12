import { GLOW, hoodBody } from "./roachSvg";
import type { DrawnAvatar } from "./types";

/**
 * The drawn parts of the touch scenes (a feeler reaching out, 啵!, 嗒, a heart…), on the
 * same 64 × 64 grid, colours and line weights as roachSvg.ts. The timing lives in
 * globals.css (classes ta-*); the scene itself is components/app/TouchStage.tsx.
 * Only system fonts: web fonts do not load in mainland China.
 */

const INK = "#1b1d22";
const ACCENT = "#ffd23f";
const HEART_RED = "#ff4f8b";
const FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";
const CLONE_OPACITY = 0.55;

const r1 = (n: number) => Math.round(n * 10) / 10;

export type TouchKind = "sneaky" | "bold" | "friend";
/** How long each scene runs */
export const TOUCH_MS: Record<TouchKind, number> = { sneaky: 1600, bold: 1600, friend: 2400 };

/**
 * 独立宣言: the shout runs SHOUT_MS, the toast comes at SHOUT_TOAST_MS, and then the line
 * stays over the roach on the map as a bubble for BUBBLE_MS, fading out over BUBBLE_FADE_MS.
 */
export const SHOUT_MS = 3200;
export const SHOUT_TOAST_MS = 2500;
export const BUBBLE_MS = 6000;
export const BUBBLE_FADE_MS = 600;
/** How far a declaration carries */
const REACH_M = 10000;
const EARTH_M = 40075016.686;

/**
 * The stage: 240 × 160, you on the left, them on the right, both 88 across. anchor is the
 * middle of their box, which goes where their icon is on the map.
 */
export const STAGE = { w: 240, h: 160, box: 88, you: [0, 66], them: [150, 66], anchor: [194, 110], meAnchor: [120, 110], meetY: 38 } as const;
const K = STAGE.box / 64;

/**
 * Where each look's own feelers end, on the 64 grid; 绝对主角 has none, her hair curl
 * stands in. The guides have no feelers either: a point at the top left of their head.
 */
const TIPS: Partial<Record<DrawnAvatar, { left: [number, number]; right: [number, number] }>> = {
  hood: { left: [8, 4], right: [51, 2] },
  doctor: { left: [16, 5.4], right: [48.8, 5.8] },
  endmin: { left: [22.6, 5.5], right: [44, 6.2] },
  imp: { left: [36.8, 6.6], right: [36.8, 6.6] },
  gugu: { left: [9.8, 1.8], right: [53, 1.8] },
  amiya: { left: [16, 8], right: [48, 8] },
  perlica: { left: [16, 8], right: [48, 8] },
  talulah: { left: [16, 8], right: [48, 8] },
  minghe: { left: [16, 8], right: [48, 8] },
  si: { left: [16, 8], right: [48, 8] },
};

function tip(look: DrawnAvatar, side: "left" | "right", box: readonly number[]): [number, number] {
  const [x, y] = (TIPS[look] ?? TIPS.hood!)[side];
  return [r1(box[0] + x * K), r1(box[1] + y * K)];
}

/** The long feelers, in stage coordinates, from your look to theirs */
export function feelers(you: DrawnAvatar = "hood", them: DrawnAvatar = "hood") {
  const [ax, ay] = tip(you, "right", STAGE.you);
  const [bx, by] = tip(them, "left", STAGE.them);
  const mx = r1((ax + bx) / 2);
  const my = STAGE.meetY;
  return {
    // 大胆: one arc from your feeler over onto the tip of theirs
    bold: `M${ax} ${ay} C${r1(ax + 14)} 30 ${r1(bx - 21)} 30 ${bx} ${by}`,
    boldEnd: [bx, by] as [number, number],
    // 成为触须之交: both reach up and meet in the middle
    mine: `M${ax} ${ay} C${r1(ax + 8)} 46 ${r1(mx - 17.5)} ${my} ${mx} ${my}`,
    theirs: `M${bx} ${by} C${r1(bx - 8)} 46 ${r1(mx + 17.5)} ${my} ${mx} ${my}`,
    meet: [mx, my] as [number, number],
    // 偷偷: the shadow crouches, so its feeler starts lower and creeps along the ground to their side
    sneaky: "M70 76.5 C92 72 112 132 162 124",
  };
}

/**
 * Where the stage goes in a box w × h whose middle is the spot their icon is on (plus
 * shift, in px, for a guide drawn beside her spot): scaled so your side still fits on a
 * 320-wide phone. end: how small they shrink at the last moment to be their map icon (px).
 */
export function stagePlace(w: number, h: number, iconPx: number, shift: [number, number] = [0, 0]) {
  const cx = w / 2 + shift[0];
  const cy = h / 2 + shift[1];
  const s = Math.min(1, (cx - 8) / STAGE.anchor[0]);
  return { s, left: cx - STAGE.anchor[0] * s, top: cy - STAGE.anchor[1] * s, end: iconPx / (STAGE.box * s) };
}

/** How far, in screen pixels at this zoom (MapLibre levels), one spot on the map is from another */
export function screenDelta(from: { lng: number; lat: number }, to: { lng: number; lat: number }, zoom: number) {
  const world = 512 * 2 ** zoom;
  const y = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  };
  return { x: ((to.lng - from.lng) / 360) * world, y: y(to.lat) - y(from.lat) };
}

const metresPerPx = (lat: number, zoom: number) => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/**
 * How close to be for a shout (MapLibre levels): its 10 km circle as wide as 40% of the
 * screen's shorter side, or the zoom as it is when that is within 0.3 of it.
 */
export function shoutZoom(lat: number, w: number, h: number, zoom: number) {
  const want = Math.log2((0.4 * Math.min(w, h) * EARTH_M * Math.cos((lat * Math.PI) / 180)) / (512 * REACH_M));
  return Math.abs(want - zoom) < 0.3 ? zoom : want;
}

/** Where the shout's stage goes (its roach in the middle of the screen), its 10 km in stage px, and the roach's size at the end */
export function shoutPlace(w: number, h: number, lat: number, zoom: number, roachPx: number) {
  const s = Math.min(1, (w - 16) / STAGE.w);
  return {
    s,
    left: w / 2 - STAGE.meAnchor[0] * s,
    top: h / 2 - STAGE.meAnchor[1] * s,
    end: roachPx / (STAGE.box * s),
    R: REACH_M / metresPerPx(lat, zoom) / s,
  };
}

const svg = (inner: string, viewBox = "0 0 64 64", w?: number, h?: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${w ? ` width="${w}" height="${h ?? w}"` : ""} overflow="visible" aria-hidden="true">${inner}</svg>`;

/** 偷偷碰: you as a nameless shadow, the white-lamp hood of other people's clones over a dashed yellow ground */
export const shadowRoach = () =>
  svg(
    `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="${ACCENT}55" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 3"/><g opacity="${CLONE_OPACITY}">${hoodBody(GLOW.white)}</g>`,
  );

function burstPath(cx: number, cy: number, rx: number, ry: number, n: number, inner: number) {
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const k = i % 2 ? inner : 1;
    d += `${i ? " L" : "M"}${r1(cx + Math.cos(a) * rx * k)} ${r1(cy + Math.sin(a) * ry * k)}`;
  }
  return `${d} Z`;
}

/** 啵! where a bold feeler lands, a smaller cousin of 戳一戳's 戳! */
export const boop = () =>
  svg(
    `<path d="${burstPath(22, 15, 20.5, 14, 9, 0.74)}" fill="${ACCENT}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
<text x="22" y="19.4" text-anchor="middle" font-size="12" font-weight="800" font-family="${FONT}" fill="${INK}">啵!</text>`,
    "0 0 44 30",
    44,
    30,
  );

/** 嗒: a sneaky feeler's touch, quiet: no burst, three tiny marks */
export const tap = () =>
  svg(
    `<g stroke="${INK}" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 10 L6.5 11.5 M4.6 3.6 L8 7.4 M10.6 1.2 L11 5.8"/></g>
<text x="20.5" y="16.5" text-anchor="middle" font-size="12" font-weight="800" font-family="${FONT}" fill="${INK}" stroke="#fff" stroke-width="3" paint-order="stroke">嗒</text>`,
    "0 0 30 20",
    30,
    20,
  );

/** ? or ! in a little speech bubble over whoever was touched */
export const mark = (ch: "?" | "!") =>
  svg(
    `<path d="M3.5 1.5 h17 a3 3 0 0 1 3 3 v11 a3 3 0 0 1 -3 3 h-9 l-4.5 4 v-4 h-3.5 a3 3 0 0 1 -3 -3 v-11 a3 3 0 0 1 3 -3 z" fill="${ch === "!" ? ACCENT : "#fff"}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
<text x="12" y="15.6" text-anchor="middle" font-size="14" font-weight="900" font-family="${FONT}" fill="${INK}">${ch}</text>`,
    "0 0 25 24",
    25,
    24,
  );

/** The site's heart, in a 24×23 box */
export const HEART_D =
  "M12 21.4 C4.4 16 1.4 11.8 1.4 7.6 C1.4 4.3 4 1.8 7.1 1.8 C9.1 1.8 10.9 2.9 12 4.6 C13.1 2.9 14.9 1.8 16.9 1.8 C20 1.8 22.6 4.3 22.6 7.6 C22.6 11.8 19.6 16 12 21.4 Z";

export const bigHeart = (w = 30) =>
  svg(
    `<path d="${HEART_D}" fill="${HEART_RED}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 6.4 C6.6 5 8 4.4 9.2 4.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`,
    "0 0 24 23",
    w,
    r1((w * 23) / 24),
  );

/** The lines either side of the head while it shouts (reaching outside the 64 grid) */
export const shoutLines = () =>
  svg(`<g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round">
  <path d="M2 24 L-4 21 M1 31 L-5.5 31 M2.5 38 L-3 41"/>
  <path d="M62 24 L68 21 M63 31 L69.5 31 M61.5 38 L67 41"/>
</g>`);

/** The hood with both sleeves up to shout, over your yellow ground */
export const shoutingHood = (glow: string) =>
  svg(`<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="${ACCENT}" stroke="#0d0e10" stroke-width="1.5"/>${hoodBody(glow, { raise: "both" })}`);

/**
 * The touched side: a feeler hanging straight down from the top of the map onto your dock
 * avatar, h px long. Straight down on purpose: it must never point to where the toucher is.
 */
export const dockFeeler = (h: number) =>
  svg(`<path class="ta-dline" d="M7 0 C2 ${r1(h * 0.3)} 12 ${r1(h * 0.62)} 7 ${h}" pathLength="1"/>`, `0 0 14 ${h}`, 14, h);

/** A declaration heard: sound coming down into your dock avatar, three arcs, the smallest nearest it */
export const soundArcs = () =>
  svg(
    `<g fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round">
  <path class="ta-arc a1" d="M-7 0 A7 7 0 0 1 7 0"/>
  <path class="ta-arc a2" d="M-12 -1 A12 12 0 0 1 12 -1"/>
  <path class="ta-arc a3" d="M-17 -2 A17 17 0 0 1 17 -2"/>
</g>`,
    "-19 -21 38 23",
    38,
    23,
  );

export const miniHeart = (w = 12) =>
  svg(`<path d="${HEART_D}" fill="${HEART_RED}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`, "0 0 24 23", w, r1((w * 23) / 24));
