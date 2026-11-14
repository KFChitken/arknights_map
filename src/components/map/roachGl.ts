import type { AMapNS } from "@/lib/amap";
import { cartoonCrawl, crawl, heartRhythm, iconPx } from "@/lib/swarm";
import { HEART_D } from "@/lib/touchArt";
import { coordsOf, layerState, mvpOf, offFrom, onScreen, program, restoreState, saveState, type Vao, vaoOf } from "./glCommon";
import { BADGE_AT, countBadgeText, drawBadge, PILE_MAX_PX, pileMul, type PileItem } from "./piles";

/**
 * Every roach on the 高德 map drawn by the GPU in one go, the way the OSM map's MapLibre draws them:
 * a WebGL layer of 高德's own (AMap.GLCustomLayer) with one point per roach, its icon taken from one
 * picture of all the icons, and the cartoon crawl worked out in the shader. Dragging, zooming and
 * crawling no longer cost more the more roaches there are; 高德's MassMarks went through every point
 * on every frame (2026-11-10: 11,000 roaches dragged at 11–12 frames a second that way, 60 like this).
 * The pictures, the crawl and the roaches left out far out are those of the MassMarks layers it
 * replaces (AmapView); the realistic look, and a phone whose GPU cannot do this, keep MassMarks.
 */

/** One roach as this layer draws it: where (高德's GCJ-02), which icon, how it crawls */
export type GlRoach = {
  id: string;
  lng: number;
  lat: number;
  /** Index into the icons (AmapView's styleIndex for the cartoon look) */
  style: number;
  /** Lies still (asleep): no crawl, and no hearts */
  still: boolean;
  seed: number;
  /** A 触须之交's: drawn last, on top, and in 舟u本色 with redder, bigger hearts, three at a time */
  friend: boolean;
  /** A clone: its hearts are fainter */
  clone: boolean;
};

/** 舟u本色's hearts (src/lib/mapStyle.ts): off, rising, or one still over each roach (motion turned down) */
export type HeartMode = "off" | "float" | "still";

export type RoachGl = {
  /** All the roaches, 触须之交 last so they are drawn on top */
  setRoaches: (roaches: GlRoach[]) => void;
  /** One roach (by id) not drawn, nor hit, until another or none (null): the one a touch scene plays out */
  setHidden: (id: string | null) => void;
  /** One icon URL per style index */
  setIcons: (urls: string[]) => Promise<void>;
  /** The roaches crawl, or all stand still (motion turned down) */
  setCrawl: (on: boolean) => void;
  /** Ask 高德 for frames so the crawl shows while the map stands still (about 15 a second), or stop; while it moves, 高德 draws anyway */
  tick: (on: boolean) => void;
  /** 舟u本色: hearts over the roaches, drawn with them (nothing of them is built until first asked for) */
  setHearts: (mode: HeartMode) => void;
  /**
   * 轻量 (src/lib/mapStyle.ts): only these piles and lone roaches drawn, standing still, each pile with its
   * count; null: every roach again (setRoaches' list, which 轻量 leaves as it was)
   */
  setPiles: (items: PileItem[] | null) => void;
  /** What is drawn at a point of the map's container (CSS px), the top one: a roach's id, a pile, or null */
  hit: (x: number, y: number) => string | PileHit | null;
  destroy: () => void;
};

/** A pile tapped: its cluster id, and where it is (as the map has it) */
export type PileHit = { pile: number; lng: number; lat: number };

// The icons, one cell each in a picture that the GPU can shrink smoothly (a power of two, with mipmaps)
const CELL = 96;
/** The icon fills this much of its cell; the rest keeps neighbours from bleeding into it when shrunk */
const INNER = 84;
const COLS = 21;
const ATLAS_W = 2048;
const ATLAS_H = 1024;
const MAX_ICONS = COLS * Math.floor(ATLAS_H / CELL);
/** The hearts take the last four cells: three pinks, then a 触须之交's red */
const HEART_TINTS = ["#ff4f8b", "#ff7eb6", "#ff98c3", "#ff2e63"];
const HEART_CELL = MAX_ICONS - HEART_TINTS.length;
/** How many roach icons fit besides the hearts: the cartoon look's (massPoints.ts styleSpecs) must, or the layer gives up */
export const ICON_ROOM = HEART_CELL;
// 高德 zoom levels are one above MapLibre's, which swarm.ts counts in
const ZOOM_OFFSET = 1;
/** Frames asked for while the roaches crawl: as often as the OSM map moves them */
const CRAWL_FRAME_MS = 66;
/** The shader's clock starts over this often (ms), well within a float's exact range */
const CLOCK_WRAP = 2 ** 23;
/** Positions are kept relative to an origin near the view; past this far from it (metres), a new one */
const REORIGIN_M = 150_000;
/** Floats per roach handed to the GPU: position 2, icon 1, crawl 4 + 1, which zooms draw it 1, hearts 5 */
const STRIDE = 14;
// 舟u本色's hearts, as the design (render-styles) has them: a heart shows for LIFE of its roach's cycle, pops
// up START_OF_ICON icons above the roach's middle, rises RISE_OF_ICON icons and is HEART_OF_ICON of an icon wide
const LIFE = 0.82;
const START_OF_ICON = 0.5;
const RISE_OF_ICON = 0.95;
const HEART_OF_ICON = 0.42;
/**
 * Where many roaches share an icon's square, they take turns: about CROWD_TARGET hearts at a time to each
 * square (触须之交 always have theirs). Crowding is counted on the world cut into CROWD_GRID cells across
 * (about a kilometre at Shanghai); far out, at most THIN_CAP to a square are drawn anyway (thinMasks).
 */
const CROWD_TARGET = 0.8;
const CROWD_GRID = 2 ** 15;
const THIN_CAP = 4;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;";
/** With the icons ready and the map on screen, a first frame this soon, or the page goes back to MassMarks */
const FIRST_FRAME_MS = 5000;

const VERT = `
precision highp float;
attribute vec2 aPos;
attribute float aStyle;
attribute vec4 aCrawl;
attribute float aCrawlY;
attribute float aThin;
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uScale;
uniform float uTime;
uniform float uCrawl;
uniform float uThinPow;
varying float vStyle;
const float TAU = 6.2831853;
void main() {
  vStyle = aStyle;
  // below 0: the one off stage (setHidden); far out, only one roach of each pile: the bit of this zoom (thinMasks)
  if (aThin < 0.0 || (uThinPow > 0.0 && mod(floor(aThin / uThinPow), 2.0) < 0.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  // swarm.ts crawl(), cartoon: aCrawl = phase, speed, fast period, reach; aCrawlY the slow y multiplier,
  // below 0 for one lying still. The clock's part of each angle is wrapped first: sin() of a large
  // number is not exact on every phone.
  float moving = uCrawl * step(0.0, aCrawlY);
  float k = uTime * aCrawl.y;
  float slowX = mod(k / 1400.0, TAU) + aCrawl.x;
  float slowY = mod(k * aCrawlY / 1400.0, TAU) + aCrawl.x * aCrawlY;
  float fastX = mod(k / aCrawl.z, TAU) + aCrawl.x * 3.0;
  float fastY = mod(k * 1.1 / aCrawl.z, TAU) + aCrawl.x * 3.3;
  float dx = (cos(slowX) * 2.2 * aCrawl.w + sin(fastX) * 0.5) * uScale;
  float dy = (sin(slowY) * 1.6 * aCrawl.w + cos(fastY) * 0.5) * uScale;
  // screen px (y down) to clip space
  p.xy += moving * vec2(dx, -dy) * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  gl_PointSize = uSize * uDpr * ${(CELL / INNER).toFixed(4)};
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying float vStyle;
void main() {
  float s = floor(vStyle + 0.5);
  float col = mod(s, ${COLS.toFixed(1)});
  float row = floor(s / ${COLS.toFixed(1)});
  vec2 uv = (vec2(col, row) + gl_PointCoord) * vec2(${(CELL / ATLAS_W).toFixed(8)}, ${(CELL / ATLAS_H).toFixed(8)});
  vec4 c = texture2D(uTex, uv);
  if (c.a < 0.02) discard;
  gl_FragColor = c;
}`;

// 轻量's counts, one cell each in a picture of their own, drawn the first time each is wanted
const BADGE_W = 96;
const BADGE_H = 36;
const BADGES_W = 2048;
const BADGES_H = 1024;
const BADGE_COLS = Math.floor(BADGES_W / BADGE_W);
const BADGE_CELLS = BADGE_COLS * Math.floor(BADGES_H / BADGE_H);

/** 轻量: a pile or a lone roach, standing still, as big as its pile (aMul below 0: the one off stage) */
const LITE_VERT = `
precision highp float;
attribute vec2 aPos;
attribute float aStyle;
attribute float aMul;
uniform mat4 uMvp;
uniform float uDpr;
uniform float uSize;
uniform float uMaxPx;
varying float vStyle;
void main() {
  vStyle = aStyle;
  if (aMul < 0.0) { ${HIDE} return; }
  gl_Position = uMvp * vec4(aPos, 0.0, 1.0);
  gl_PointSize = min(uSize * aMul, max(uSize, uMaxPx)) * uDpr * ${(CELL / INNER).toFixed(4)};
}`;

/** 轻量's counts: one square point each, right of and above its pile, the badge in a band across its middle */
const LABEL_VERT = `
precision highp float;
attribute vec2 aPos;
attribute float aMul;
attribute float aCell;
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uMaxPx;
varying vec2 vCell;
void main() {
  float s = min(uSize * aMul, max(uSize, uMaxPx));
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  // CSS px (y down) to clip space
  p.xy += vec2(${BADGE_AT[0].toFixed(3)}, ${(-BADGE_AT[1]).toFixed(3)}) * s * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  gl_PointSize = clamp(s * 1.2, 46.0, 58.0) * uDpr;
  vCell = vec2(mod(aCell, ${BADGE_COLS.toFixed(1)}), floor(aCell / ${BADGE_COLS.toFixed(1)}));
}`;

const LABEL_FRAG = `
precision mediump float;
uniform sampler2D uLab;
varying vec2 vCell;
void main() {
  vec2 pc = gl_PointCoord;
  float y = (pc.y - 0.5) / ${(BADGE_H / BADGE_W).toFixed(5)} + 0.5;
  if (y < 0.0 || y > 1.0) discard;
  vec2 uv = (vCell + vec2(pc.x, y)) * vec2(${(BADGE_W / BADGES_W).toFixed(8)}, ${(BADGE_H / BADGES_H).toFixed(8)});
  vec4 c = texture2D(uLab, uv);
  if (c.a < 0.02) discard;
  gl_FragColor = c;
}`;

/**
 * The counts' picture: a cell drawn for each count the first time it is wanted, all of it started again once
 * full. Only the cells drawn since go to the GPU (the whole picture is 8 MB, and counts change with updates).
 */
function badgeAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = BADGES_W;
  canvas.height = BADGES_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let cells = new Map<string, number>();
  /** The whole picture must go up again (started again); else the cells drawn since it last went up */
  let whole = true;
  let fresh: number[] = [];
  const at = (i: number) => [(i % BADGE_COLS) * BADGE_W, Math.floor(i / BADGE_COLS) * BADGE_H] as const;
  return {
    /** Room for these counts, the picture started again if they do not all fit with those already in it */
    makeRoom(texts: string[]) {
      const wanted = new Set(texts.filter((t) => !cells.has(t)));
      if (cells.size + wanted.size <= BADGE_CELLS) return;
      ctx?.clearRect(0, 0, BADGES_W, BADGES_H);
      cells = new Map();
      whole = true;
      fresh = [];
    },
    cell(text: string) {
      let i = cells.get(text);
      if (i !== undefined) return i;
      if (!ctx || cells.size >= BADGE_CELLS) return 0;
      i = cells.size;
      cells.set(text, i);
      const [x, y] = at(i);
      drawBadge(ctx, text, x + BADGE_W / 2, y + BADGE_H / 2, BADGE_H - 4);
      fresh.push(i);
      return i;
    },
    /** What changed onto the bound texture: all of it once, then the new cells only */
    upload(g: WebGLRenderingContext) {
      if (!ctx || (!whole && !fresh.length)) return;
      if (whole) {
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, canvas);
      } else {
        for (const i of fresh) {
          const [x, y] = at(i);
          g.texSubImage2D(g.TEXTURE_2D, 0, x, y, g.RGBA, g.UNSIGNED_BYTE, ctx.getImageData(x, y, BADGE_W, BADGE_H));
        }
      }
      whole = false;
      fresh = [];
    },
    /** A new GPU context: everything up again */
    lost() {
      whole = true;
      fresh = [];
    },
  };
}

/**
 * The hearts: the roaches' own buffer drawn again, once for each of a roach's hearts (uSlot), each point
 * where its roach crawls, a little above it, rising and fading over its cycle. The same sums as the
 * design's heartAt(). Each heart's tilt and picture are worked out here, not for every pixel.
 */
const HEART_VERT = `
precision highp float;
attribute vec2 aPos;
attribute vec4 aCrawl;
attribute float aCrawlY;
attribute float aThin;
attribute vec4 aHeart;
attribute float aCrowd;
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uScale;
uniform float uTime;
uniform float uCrawl;
uniform float uThinPow;
uniform float uMode;
uniform float uSlot;
uniform float uCellCells;
varying float vAlpha;
varying vec2 vCell;
varying vec2 vRot;
const float TAU = 6.2831853;
const float LIFE = ${LIFE.toFixed(3)};
void main() {
  // no hearts over one lying asleep, nor the one off stage; far out, only over the roach drawn of each pile
  if (aCrawlY < 0.0 || aThin < 0.0 || (uThinPow > 0.0 && mod(floor(aThin / uThinPow), 2.0) < 0.5)) { ${HIDE} return; }
  // aHeart: where in its cycle, the cycle (ms), left or right, kind (0 a roach, 1 a clone, 2 a 触须之交's)
  float kind = aHeart.w;
  float friend = step(1.5, kind);
  float slots = 2.0 + friend;
  float u;
  float cyc;
  // uMode 3: motion turned down, one heart hanging still over each
  if (uMode > 2.5) {
    u = 0.32 * LIFE;
    cyc = 0.0;
  } else {
    float c = uTime / aHeart.y + aHeart.x + uSlot / slots;
    u = fract(c);
    cyc = floor(c);
  }
  // in a crowd a roach has its hearts in only some of its rounds, picked afresh each round
  if (kind < 1.5) {
    float crowd = aCrowd * uCellCells;
    if (uThinPow > 0.0) crowd = min(crowd, ${THIN_CAP.toFixed(1)});
    float k = max(1.0, crowd / ${CROWD_TARGET.toFixed(2)});
    float pick = fract(sin(aHeart.x * 37.3 + uSlot * 5.7 + cyc * 3.91) * 9157.3);
    if (pick * k > 1.0) { ${HIDE} return; }
  }
  if (u > LIFE) { ${HIDE} return; }
  float v = u / LIFE;
  float h1 = fract(sin(aHeart.x * 91.7 + uSlot * 13.1 + cyc * 7.31) * 4375.85);
  float h2 = fract(h1 * 13.7);
  float h3 = fract(h1 * 71.3);
  float pop = v < 0.1 ? mix(0.3, 1.15, v / 0.1) : (v < 0.2 ? mix(1.15, 1.0, (v - 0.1) / 0.1) : 1.0);
  float alpha = min(v / 0.08, 1.0) * (1.0 - smoothstep(0.55, 1.0, v));
  float motion = 1.0;
  if (uMode > 2.5) {
    pop = 1.0;
    alpha = 1.0;
    motion = 0.0;
    v = 0.3;
  }
  float rise = (1.0 - pow(1.0 - v, 2.2)) * ${RISE_OF_ICON.toFixed(3)} * uSize * motion;
  float sway = sin(v * TAU * 1.1 + h2 * TAU) * 0.12 * uSize * (0.4 + 0.6 * v) * motion;
  float side = (aHeart.z * 0.6 + (h1 - 0.5) * 0.8) * 0.16 * uSize;
  // the roach's own crawl, as VERT moves it
  float moving = uCrawl * step(0.0, aCrawlY);
  float k = uTime * aCrawl.y;
  float slowX = mod(k / 1400.0, TAU) + aCrawl.x;
  float slowY = mod(k * aCrawlY / 1400.0, TAU) + aCrawl.x * aCrawlY;
  float fastX = mod(k / aCrawl.z, TAU) + aCrawl.x * 3.0;
  float fastY = mod(k * 1.1 / aCrawl.z, TAU) + aCrawl.x * 3.3;
  float dx = (cos(slowX) * 2.2 * aCrawl.w + sin(fastX) * 0.5) * uScale;
  float dy = (sin(slowY) * 1.6 * aCrawl.w + cos(fastY) * 0.5) * uScale;
  // screen px (y down) from the roach's point
  float ox = moving * dx + side + sway;
  float oy = moving * dy - (${START_OF_ICON.toFixed(3)} * uSize + rise);
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  p.xy += vec2(ox, -oy) * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  float size = max(uSize * ${HEART_OF_ICON.toFixed(3)} * (1.0 + 0.25 * friend) * pop, 3.0);
  gl_PointSize = size * uDpr * ${(CELL / INNER).toFixed(4)};
  vAlpha = alpha * (kind > 0.5 && kind < 1.5 ? 0.55 : 1.0);
  float cell = ${HEART_CELL.toFixed(1)} + (friend > 0.5 ? 3.0 : floor(h3 * 2.999));
  vCell = vec2(mod(cell, ${COLS.toFixed(1)}), floor(cell / ${COLS.toFixed(1)}));
  float tilt = (h2 - 0.5) * 0.5;
  vRot = vec2(cos(tilt), sin(tilt));
}`;

const HEART_FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying float vAlpha;
varying vec2 vCell;
varying vec2 vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p = vec2(vRot.x * p.x - vRot.y * p.y, vRot.y * p.x + vRot.x * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  vec4 c = texture2D(uTex, (vCell + p) * vec2(${(CELL / ATLAS_W).toFixed(8)}, ${(CELL / ATLAS_H).toFixed(8)})) * vAlpha;
  if (c.a < 0.02) discard;
  gl_FragColor = c;
}`;

/** A heart's picture: the site's heart (touchArt.ts) in one tint with a white edge, as an SVG data URL */
const heartUrl = (tint: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1.5 26 26" width="96" height="96"><path d="${HEART_D}" fill="${tint}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`,
  )}`;

/** A point's place in Web Mercator's 0..1 square */
function mercator(r: Pick<GlRoach, "lng" | "lat">): [number, number] {
  const sin = Math.max(-0.9999, Math.min(0.9999, Math.sin((r.lat * Math.PI) / 180)));
  return [(r.lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

/**
 * How crowded it is around each roach, for the hearts' taking turns: the average number of roaches in
 * the 3×3 cells of CROWD_GRID around it. The shader turns it into roaches to an icon's square per zoom.
 */
export function crowdOf(roaches: Pick<GlRoach, "lng" | "lat">[]) {
  const n = roaches.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cells = new Map<number, number>();
  roaches.forEach((r, i) => {
    const [mx, my] = mercator(r);
    cx[i] = Math.floor(mx * CROWD_GRID);
    cy[i] = Math.floor(my * CROWD_GRID);
    const key = cx[i] * CROWD_GRID + cy[i];
    cells.set(key, (cells.get(key) ?? 0) + 1);
  });
  const crowd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) c += cells.get((cx[i] + a) * CROWD_GRID + cy[i] + b) ?? 0;
    crowd[i] = c / 9;
  }
  return crowd;
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("icon"));
    img.src = url;
  });

/**
 * For each roach, one bit per 高德 zoom from 2 to thinZoom: whether it is drawn there. As AmapView's
 * thinned() does for MassMarks, one roach for each square of the screen half an icon wide, the one
 * drawn on top (触须之交 are last); the rest would only be drawn under it, and on a phone's GPU a
 * whole country of roaches piled up costs more than all the map besides.
 */
export function thinMasks(roaches: Pick<GlRoach, "lng" | "lat">[], thinZoom: number) {
  const n = roaches.length;
  const mask = new Float32Array(n);
  const mx = new Float64Array(n);
  const my = new Float64Array(n);
  roaches.forEach((r, i) => {
    [mx[i], my[i]] = mercator(r);
  });
  for (let zoom = 2; zoom <= thinZoom; zoom++) {
    const per = (256 * 2 ** zoom) / Math.max(4, iconPx(zoom - ZOOM_OFFSET) / 2);
    const bit = 2 ** (zoom - 2);
    const taken = new Set<number>();
    for (let i = n - 1; i >= 0; i--) {
      const key = Math.floor(mx[i] * per) * 1e7 + Math.floor(my[i] * per);
      if (taken.has(key)) continue;
      taken.add(key);
      mask[i] += bit;
    }
  }
  return mask;
}

/** The layer, or null where 高德 or the GPU cannot do it (the page then keeps MassMarks) */
export function roachGl(
  AMap: AMapNS,
  map: AMapNS,
  /** onHeartsFail: the hearts could not be drawn here (the roaches still are) */
  opts: { zIndex: number; thinZoom: number; onFail: (why: string) => void; onHeartsFail?: (why: string) => void },
): RoachGl | null {
  if (typeof AMap.GLCustomLayer !== "function" || !map.customCoords || typeof map.render !== "function") return null;
  const cc = map.customCoords;
  let gl: WebGLRenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  let vao: Vao | null = null;
  let vaoObj: unknown = null;
  let buf: WebGLBuffer | null = null;
  let tex: WebGLTexture | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  let failed = false;
  let roaches: GlRoach[] = [];
  /** Positions in metres from the origin, kept in full for hits */
  let xy = new Float64Array(0);
  let crawlOf: [number, number, number, number, number][] = [];
  let thin = new Float32Array(0);
  /** The roach off stage (setHidden), where it is in the list (-1: none there), and the roaches whose aThin is to be written again */
  let hiddenId: string | null = null;
  let hiddenIndex = -1;
  let patch: number[] = [];
  // 舟u本色: built only once first asked for; crowding only worked out while they are on
  let hearts: HeartMode = "off";
  let heartsBroken = false;
  let heartProg: WebGLProgram | null = null;
  let heartVao: unknown = null;
  let heartLoc: Record<string, WebGLUniformLocation | null> = {};
  let crowd: Float32Array | null = null;
  /** 触须之交 come last: from here on */
  let firstFriend = 0;
  let origin: [number, number] = (() => {
    const c = map.getCenter();
    return [c.getLng(), c.getLat()];
  })();
  let dirty = true;
  let count = 0;
  /** The icons' URLs, and the picture of them all until it is on the GPU */
  let iconUrls: string[] = [];
  let atlas: HTMLCanvasElement | null = null;
  let atlasSeq = 0;
  let iconsReady = false;
  /** What the last frame drew with, for hits */
  let last: { mvp: Float32Array; size: number; thinPow: number; maxPx: number } | null = null;
  // 轻量: the piles drawn instead of every roach (setPiles), their positions from the origin, and the counts'
  // own programs, buffers and picture; made the first time 轻量 is drawn
  let piles: PileItem[] | null = null;
  let pileXY = new Float64Array(0);
  let pilesDirty = false;
  let pileCount = 0;
  let labelCount = 0;
  let liteProg: WebGLProgram | null = null;
  let liteVao: unknown = null;
  let liteBuf: WebGLBuffer | null = null;
  let liteLoc: Record<string, WebGLUniformLocation | null> = {};
  let labelProg: WebGLProgram | null = null;
  let labelVao: unknown = null;
  let labelBuf: WebGLBuffer | null = null;
  let labelTex: WebGLTexture | null = null;
  let labelLoc: Record<string, WebGLUniformLocation | null> = {};
  let badges: ReturnType<typeof badgeAtlas> | null = null;
  /** The largest point this GPU draws, in device px */
  let maxPoint = 0;
  const t0 = performance.now();
  let crawling = false;
  let timer = 0;
  let frames = 0;
  let watchdog = 0;

  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    window.clearInterval(timer);
    window.clearTimeout(watchdog);
    opts.onFail(why);
  };

  /** Positions relative to the origin, from 高德 itself so they match its map exactly */
  const place = () => {
    xy = coordsOf(
      cc,
      origin,
      roaches.map((r) => [r.lng, r.lat]),
    );
    dirty = true;
    placePiles();
  };
  const placePiles = () => {
    if (!piles) return;
    pileXY = coordsOf(
      cc,
      origin,
      piles.map((p) => [p.lng, p.lat]),
    );
    pilesDirty = true;
  };

  /** Hand the GPU every roach (STRIDE floats each) */
  const upload = (g: WebGLRenderingContext) => {
    const data = new Float32Array(roaches.length * STRIDE);
    roaches.forEach((r, i) => {
      const k = crawlOf[i];
      const o = i * STRIDE;
      data[o] = xy[i * 2];
      data[o + 1] = xy[i * 2 + 1];
      data[o + 2] = r.style;
      data[o + 3] = k[0];
      data[o + 4] = k[1];
      data[o + 5] = k[2];
      data[o + 6] = k[3];
      data[o + 7] = r.still ? -1 : k[4];
      data[o + 8] = i === hiddenIndex ? -1 : thin[i];
      const [phase, period, side] = heartRhythm(r.seed);
      data[o + 9] = phase;
      data[o + 10] = period;
      data[o + 11] = side;
      data[o + 12] = r.friend ? 2 : r.clone ? 1 : 0;
      data[o + 13] = crowd?.[i] ?? 0;
    });
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
    count = roaches.length;
    dirty = false;
    patch = [];
  };

  /** Only the aThin of the roaches going off or back on stage, four bytes each, instead of every roach again */
  const patchThin = (g: WebGLRenderingContext) => {
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    for (const i of patch) {
      if (i >= 0 && i < count) g.bufferSubData(g.ARRAY_BUFFER, (i * STRIDE + 8) * 4, new Float32Array([i === hiddenIndex ? -1 : thin[i]]));
    }
    patch = [];
  };

  /** The icons onto the GPU (texture unit 0 is bound to this layer's texture by the caller) */
  const uploadIcons = (g: WebGLRenderingContext) => {
    if (!atlas) return;
    // how pictures are read is shared with 高德: as this layer needs it, then back
    const premultiply = g.getParameter(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, atlas);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, flip);
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    atlas = null;
    iconsReady = true;
  };

  // 高德 calls this with its WebGL context before the layer's first frame (and again should it make a new one)
  const init = (g: WebGLRenderingContext) => {
    try {
      gl = g;
      const range = g.getParameter(g.ALIASED_POINT_SIZE_RANGE) as Float32Array;
      maxPoint = range?.[1] ?? 0;
      // the largest icon (36 px at 12 and up) on this screen, with its cell's margin
      const dpr = g.drawingBufferWidth / Math.max(1, map.getContainer().clientWidth);
      if (maxPoint < iconPx(12) * dpr * (CELL / INNER)) throw new Error(`points up to ${maxPoint}px`);
      vao = vaoOf(g);
      if (!vao) throw new Error("no vertex arrays");
      const p = program(g, VERT, FRAG);
      prog = p;
      loc = Object.fromEntries(
        ["uMvp", "uViewport", "uDpr", "uSize", "uScale", "uTime", "uCrawl", "uThinPow", "uTex"].map((n) => [n, g.getUniformLocation(p, n)]),
      );
      const vaoWas = vao.current();
      const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
      vaoObj = vao.create();
      vao.bind(vaoObj);
      buf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const attr = (name: string, size: number, offset: number) => {
        const a = g.getAttribLocation(p, name);
        if (a < 0) return;
        g.enableVertexAttribArray(a);
        g.vertexAttribPointer(a, size, g.FLOAT, false, STRIDE * 4, offset * 4);
      };
      attr("aPos", 2, 0);
      attr("aStyle", 1, 2);
      attr("aCrawl", 4, 3);
      attr("aCrawlY", 1, 7);
      attr("aThin", 1, 8);
      vao.bind(vaoWas);
      g.bindBuffer(g.ARRAY_BUFFER, bufWas);
      tex = g.createTexture();
      // the hearts' and 轻量's programs are made again when next wanted
      heartProg = null;
      heartVao = null;
      liteProg = null;
      labelProg = null;
      pilesDirty = true;
      // everything goes up again with a new context
      dirty = true;
      iconsReady = false;
      if (!atlas && iconUrls.length) void buildAtlas();
    } catch (e) {
      fail(e instanceof Error ? e.message : "init");
    }
  };

  /** The hearts' program, and a vertex array over the roaches' own buffer, made the first time they are drawn */
  const makeHearts = (g: WebGLRenderingContext) => {
    try {
      const p = program(g, HEART_VERT, HEART_FRAG);
      heartLoc = Object.fromEntries(
        ["uMvp", "uViewport", "uDpr", "uSize", "uScale", "uTime", "uCrawl", "uThinPow", "uMode", "uSlot", "uCellCells", "uTex"].map((n) => [
          n,
          g.getUniformLocation(p, n),
        ]),
      );
      const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
      heartVao = vao!.create();
      vao!.bind(heartVao);
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const attr = (name: string, size: number, offset: number) => {
        const a = g.getAttribLocation(p, name);
        if (a < 0) return;
        g.enableVertexAttribArray(a);
        g.vertexAttribPointer(a, size, g.FLOAT, false, STRIDE * 4, offset * 4);
      };
      attr("aPos", 2, 0);
      attr("aCrawl", 4, 3);
      attr("aCrawlY", 1, 7);
      attr("aThin", 1, 8);
      attr("aHeart", 4, 9);
      attr("aCrowd", 1, 13);
      vao!.bind(vaoObj);
      g.bindBuffer(g.ARRAY_BUFFER, bufWas);
      heartProg = p;
      return true;
    } catch (e) {
      heartsBroken = true;
      const why = e instanceof Error ? e.message : "hearts";
      window.setTimeout(() => opts.onHeartsFail?.(why), 0);
      return false;
    }
  };

  /** Each roach's hearts, two (three for a 触须之交's), one draw each; one only, still, with motion turned down */
  const drawHearts = (g: WebGLRenderingContext, f: { mvp: Float32Array; size: number; thinPow: number; zoom: number; w: number; h: number }) => {
    g.useProgram(heartProg);
    vao!.bind(heartVao);
    g.uniformMatrix4fv(heartLoc.uMvp, false, f.mvp);
    g.uniform2f(heartLoc.uViewport, f.w, f.h);
    g.uniform1f(heartLoc.uDpr, f.w / Math.max(1, map.getContainer().clientWidth));
    g.uniform1f(heartLoc.uSize, f.size);
    g.uniform1f(heartLoc.uScale, f.size / 24);
    g.uniform1f(heartLoc.uTime, (performance.now() - t0) % CLOCK_WRAP);
    g.uniform1f(heartLoc.uCrawl, crawling ? 1 : 0);
    g.uniform1f(heartLoc.uThinPow, f.thinPow);
    g.uniform1f(heartLoc.uMode, hearts === "still" ? 3 : 1);
    // roaches to an icon's square per roach counted in a crowd cell: (icon / world px × cells)², 高德's world 256 × 2^zoom
    g.uniform1f(heartLoc.uCellCells, ((f.size / (256 * 2 ** f.zoom)) * CROWD_GRID) ** 2);
    g.uniform1i(heartLoc.uTex, 0);
    const draw = (slot: number, from: number) => {
      if (from >= count) return;
      g.uniform1f(heartLoc.uSlot, slot);
      g.drawArrays(g.POINTS, from, count - from);
    };
    draw(0, 0);
    if (hearts === "still") return;
    draw(1, 0);
    draw(2, firstFriend);
  };

  /** 轻量's two programs, buffers, vertex arrays and the counts' picture, made the first time 轻量 is drawn */
  const makeLite = (g: WebGLRenderingContext, v: Vao) => {
    const lp = program(g, LITE_VERT, FRAG);
    const bp = program(g, LABEL_VERT, LABEL_FRAG);
    liteLoc = Object.fromEntries(["uMvp", "uDpr", "uSize", "uMaxPx", "uTex"].map((n) => [n, g.getUniformLocation(lp, n)]));
    labelLoc = Object.fromEntries(["uMvp", "uViewport", "uDpr", "uSize", "uMaxPx", "uLab"].map((n) => [n, g.getUniformLocation(bp, n)]));
    const vaoWas = v.current();
    const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
    const attrs = (pr: WebGLProgram, list: [string, number, number][]) => {
      for (const [name, size, offset] of list) {
        const a = g.getAttribLocation(pr, name);
        if (a < 0) continue;
        g.enableVertexAttribArray(a);
        g.vertexAttribPointer(a, size, g.FLOAT, false, 16, offset * 4);
      }
    };
    liteVao = v.create();
    v.bind(liteVao);
    liteBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, liteBuf);
    attrs(lp, [
      ["aPos", 2, 0],
      ["aStyle", 1, 2],
      ["aMul", 1, 3],
    ]);
    labelVao = v.create();
    v.bind(labelVao);
    labelBuf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, labelBuf);
    attrs(bp, [
      ["aPos", 2, 0],
      ["aMul", 1, 2],
      ["aCell", 1, 3],
    ]);
    v.bind(vaoWas);
    g.bindBuffer(g.ARRAY_BUFFER, bufWas);
    labelTex = g.createTexture();
    badges ??= badgeAtlas();
    badges.lost();
    liteProg = lp;
    labelProg = bp;
    pilesDirty = true;
  };

  /** The piles onto the GPU (four floats each), and their counts, the bigger counts drawn last where two meet */
  const uploadPiles = (g: WebGLRenderingContext, v: Vao) => {
    const items = piles ?? [];
    const pd = new Float32Array(items.length * 4);
    items.forEach((it, i) => {
      const o = i * 4;
      pd[o] = pileXY[i * 2];
      pd[o + 1] = pileXY[i * 2 + 1];
      pd[o + 2] = it.style;
      pd[o + 3] = it.ref === hiddenId ? -1 : pileMul(it.n);
    });
    const counted = items.map((it, i) => ({ it, i })).filter(({ it }) => it.n > 1);
    counted.sort((a, b) => a.it.n - b.it.n);
    const atlas = badges!;
    atlas.makeRoom(counted.map(({ it }) => countBadgeText(it.n)));
    const ld = new Float32Array(counted.length * 4);
    counted.forEach(({ it, i }, j) => {
      const o = j * 4;
      ld[o] = pileXY[i * 2];
      ld[o + 1] = pileXY[i * 2 + 1];
      ld[o + 2] = pileMul(it.n);
      ld[o + 3] = atlas.cell(countBadgeText(it.n));
    });
    const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
    v.bind(liteVao);
    g.bindBuffer(g.ARRAY_BUFFER, liteBuf);
    g.bufferData(g.ARRAY_BUFFER, pd, g.DYNAMIC_DRAW);
    v.bind(labelVao);
    g.bindBuffer(g.ARRAY_BUFFER, labelBuf);
    g.bufferData(g.ARRAY_BUFFER, ld, g.DYNAMIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, bufWas);
    g.bindTexture(g.TEXTURE_2D, labelTex);
    const premultiply = g.getParameter(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    atlas.upload(g);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, flip);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.bindTexture(g.TEXTURE_2D, tex);
    pileCount = items.length;
    labelCount = counted.length;
    pilesDirty = false;
  };

  /** 轻量's frame: the piles, then their counts, each in one go */
  const drawLite = (g: WebGLRenderingContext, v: Vao, was: ReturnType<typeof saveState>) => {
    if (!liteProg) makeLite(g, v);
    if (pilesDirty) uploadPiles(g, v);
    if (!iconsReady || !pileCount) return;
    cc.setCenter(origin);
    const zoom = map.getZoom();
    const size = iconPx(zoom - ZOOM_OFFSET);
    const mvp = mvpOf(cc.getCameraParams());
    const w = g.drawingBufferWidth;
    const h = g.drawingBufferHeight;
    const dpr = w / Math.max(1, map.getContainer().clientWidth);
    // the biggest pile as this GPU can draw a point, with its cell's margin
    const maxPx = Math.max(size, Math.min(PILE_MAX_PX, maxPoint / (dpr * (CELL / INNER))));
    last = { mvp, size, thinPow: 0, maxPx };
    layerState(g, was);
    g.viewport(0, 0, w, h);
    g.useProgram(liteProg);
    g.uniformMatrix4fv(liteLoc.uMvp, false, mvp);
    g.uniform1f(liteLoc.uDpr, dpr);
    g.uniform1f(liteLoc.uSize, size);
    g.uniform1f(liteLoc.uMaxPx, maxPx);
    g.uniform1i(liteLoc.uTex, 0);
    v.bind(liteVao);
    g.drawArrays(g.POINTS, 0, pileCount);
    if (labelCount) {
      g.bindTexture(g.TEXTURE_2D, labelTex);
      g.useProgram(labelProg);
      g.uniformMatrix4fv(labelLoc.uMvp, false, mvp);
      g.uniform2f(labelLoc.uViewport, w, h);
      g.uniform1f(labelLoc.uDpr, dpr);
      g.uniform1f(labelLoc.uSize, size);
      g.uniform1f(labelLoc.uMaxPx, maxPx);
      g.uniform1i(labelLoc.uLab, 0);
      v.bind(labelVao);
      g.drawArrays(g.POINTS, 0, labelCount);
      g.bindTexture(g.TEXTURE_2D, tex);
    }
    frames++;
  };

  const render = () => {
    const g = gl;
    if (failed || !g || !prog || !vao || g.isContextLost()) return;
    try {
      // what this layer changes, so 高德 finds its own state as it left it
      const was = saveState(g, vao);
      g.bindTexture(g.TEXTURE_2D, tex);
      if (!iconsReady) uploadIcons(g);
      if (piles) {
        drawLite(g, vao, was);
        restoreState(g, vao, was);
        return;
      }
      vao.bind(vaoObj);
      if (dirty) upload(g);
      else if (patch.length) patchThin(g);
      if (iconsReady && count) {
        cc.setCenter(origin);
        const params = cc.getCameraParams();
        const zoom = map.getZoom();
        const size = iconPx(zoom - ZOOM_OFFSET);
        const level = Math.max(2, Math.ceil(zoom - 1e-6));
        const thinPow = level <= opts.thinZoom ? 2 ** (level - 2) : 0;
        const mvp = mvpOf(params);
        last = { mvp, size, thinPow, maxPx: PILE_MAX_PX };
        const w = g.drawingBufferWidth;
        const h = g.drawingBufferHeight;
        g.useProgram(prog);
        g.uniformMatrix4fv(loc.uMvp, false, mvp);
        g.uniform2f(loc.uViewport, w, h);
        g.uniform1f(loc.uDpr, w / Math.max(1, map.getContainer().clientWidth));
        g.uniform1f(loc.uSize, size);
        g.uniform1f(loc.uScale, size / 24);
        g.uniform1f(loc.uTime, (performance.now() - t0) % CLOCK_WRAP);
        g.uniform1f(loc.uCrawl, crawling ? 1 : 0);
        g.uniform1f(loc.uThinPow, thinPow);
        g.uniform1i(loc.uTex, 0);
        // the icons are premultiplied, as 高德's canvas is
        layerState(g, was);
        g.viewport(0, 0, w, h);
        g.drawArrays(g.POINTS, 0, count);
        frames++;
        if (hearts !== "off" && !heartsBroken && (heartProg || makeHearts(g))) drawHearts(g, { mvp, size, thinPow, zoom, w, h });
      }
      restoreState(g, vao, was);
    } catch (e) {
      fail(e instanceof Error ? e.message : "render");
    }
  };

  /** All the icons in one picture, one cell each; on the GPU with the next frame, inside 高德's own drawing */
  const buildAtlas = async () => {
    const seq = ++atlasSeq;
    const urls = iconUrls;
    const imgs = await Promise.all(urls.map((u) => loadImage(u).catch(() => null)));
    const heartImgs = await Promise.all(HEART_TINTS.map((t) => loadImage(heartUrl(t)).catch(() => null)));
    if (failed || seq !== atlasSeq) return;
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const g = canvas.getContext("2d");
    if (!g) return fail("no 2d canvas");
    const m = (CELL - INNER) / 2;
    imgs.forEach((img, i) => {
      if (img) g.drawImage(img, (i % COLS) * CELL + m, Math.floor(i / COLS) * CELL + m, INNER, INNER);
    });
    // 舟u本色's hearts, in the cells kept for them at the end
    heartImgs.forEach((img, t) => {
      const i = HEART_CELL + t;
      if (img) g.drawImage(img, (i % COLS) * CELL + m, Math.floor(i / COLS) * CELL + m, INNER, INNER);
    });
    atlas = canvas;
    iconsReady = false;
    map.render();
    // 高德 never asking this layer for a frame would leave the map without roaches, and nothing would say so
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(function check() {
      if (failed || frames || !roaches.length) return;
      const el = map.getContainer();
      if (document.visibilityState !== "visible" || !el.clientWidth || !el.clientHeight) {
        watchdog = window.setTimeout(check, FIRST_FRAME_MS);
        return;
      }
      fail("no frame");
    }, FIRST_FRAME_MS);
  };

  const layer = new AMap.GLCustomLayer({ zIndex: opts.zIndex, init, render });
  map.add(layer);

  // A new origin once the view has gone far from it, so positions stay exact close up
  const reorigin = () => {
    if (offFrom(map, cc, origin) < REORIGIN_M) return;
    const c = map.getCenter();
    origin = [c.getLng(), c.getLat()];
    place();
    map.render();
  };
  map.on("moveend", reorigin);

  return {
    setRoaches: (list) => {
      roaches = list;
      // still off stage in the new list, wherever it now is (uploaded with it)
      hiddenIndex = hiddenId === null ? -1 : list.findIndex((r) => r.id === hiddenId);
      crawlOf = list.map((r) => cartoonCrawl(r.seed));
      thin = thinMasks(list, opts.thinZoom);
      const f = list.findIndex((r) => r.friend);
      firstFriend = f < 0 ? list.length : f;
      // counting the crowds takes a moment with many roaches: only while the hearts are on
      crowd = hearts === "off" ? null : crowdOf(list);
      place();
      map.render();
    },
    setHidden: (id) => {
      if (id === hiddenId) return;
      const was = hiddenIndex;
      hiddenId = id;
      hiddenIndex = id === null ? -1 : roaches.findIndex((r) => r.id === id);
      patch.push(was, hiddenIndex);
      // in 轻量 the piles go up again: a hundred or two
      if (piles) pilesDirty = true;
      map.render();
    },
    setPiles: (items) => {
      piles = items;
      if (items) {
        // nothing moves: no frames asked for while the map stands still
        window.clearInterval(timer);
        timer = 0;
        placePiles();
      } else {
        pileXY = new Float64Array(0);
        pileCount = 0;
        labelCount = 0;
      }
      map.render();
    },
    setHearts: (mode) => {
      if (mode === hearts) return;
      hearts = mode;
      if (mode !== "off" && !crowd) {
        crowd = crowdOf(roaches);
        dirty = true;
      }
      map.render();
    },
    setIcons: (urls) => {
      if (urls.length > HEART_CELL) {
        fail("too many icons");
        return Promise.resolve();
      }
      iconUrls = urls;
      return buildAtlas();
    },
    setCrawl: (on) => {
      crawling = on;
      if (!on) window.clearInterval(timer);
      map.render();
    },
    tick: (on) => {
      window.clearInterval(timer);
      timer = 0;
      if (on && crawling && !failed && !piles) timer = window.setInterval(() => map.render(), CRAWL_FRAME_MS);
    },
    hit: (x, y) => {
      if (!last || !iconsReady) return null;
      const el = map.getContainer();
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (piles) {
        const { mvp: m, size, maxPx } = last;
        // the last drawn (on top) wins
        for (let i = piles.length - 1; i >= 0; i--) {
          const it = piles[i];
          if (it.ref === hiddenId || i * 2 + 1 >= pileXY.length) continue;
          const { x: sx, y: sy } = onScreen(m, pileXY[i * 2], pileXY[i * 2 + 1], W, H);
          const width = Math.min(size * pileMul(it.n), Math.max(size, maxPx));
          if (Math.hypot(sx - x, sy - y) > Math.max(width / 2, 16)) continue;
          return typeof it.ref === "string" ? it.ref : { pile: it.ref, lng: it.lng, lat: it.lat };
        }
        return null;
      }
      const { mvp: m, size, thinPow } = last;
      const radius = Math.max(size / 2, 14);
      const now = (performance.now() - t0) % CLOCK_WRAP;
      // the last drawn (on top) wins: 触须之交 are at the end
      for (let i = roaches.length - 1; i >= 0; i--) {
        if (i === hiddenIndex || (thinPow && Math.floor(thin[i] / thinPow) % 2 === 0)) continue;
        const { x: sx, y: sy } = onScreen(m, xy[i * 2], xy[i * 2 + 1], W, H);
        if (Math.abs(sx - x) > radius + 8 || Math.abs(sy - y) > radius + 8) continue;
        const c = crawling && !roaches[i].still ? crawl(roaches[i].seed, now, "cartoon", size / 24) : { dx: 0, dy: 0 };
        if (Math.hypot(sx + c.dx - x, sy + c.dy - y) <= radius) return roaches[i].id;
      }
      return null;
    },
    destroy: () => {
      window.clearInterval(timer);
      window.clearTimeout(watchdog);
      map.off("moveend", reorigin);
      map.remove(layer);
      if (gl && !gl.isContextLost()) {
        if (buf) gl.deleteBuffer(buf);
        if (tex) gl.deleteTexture(tex);
        if (prog) gl.deleteProgram(prog);
        if (heartProg) gl.deleteProgram(heartProg);
        if (liteProg) gl.deleteProgram(liteProg);
        if (labelProg) gl.deleteProgram(labelProg);
        if (liteBuf) gl.deleteBuffer(liteBuf);
        if (labelBuf) gl.deleteBuffer(labelBuf);
        if (labelTex) gl.deleteTexture(labelTex);
        if (vao && vaoObj) vao.remove(vaoObj);
        if (vao && heartVao) vao.remove(heartVao);
        if (vao && liteVao) vao.remove(liteVao);
        if (vao && labelVao) vao.remove(labelVao);
      }
      gl = null;
      map.render();
    },
  };
}
