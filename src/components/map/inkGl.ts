import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import { SI_AT, type PaintingTier } from "@/lib/si";
import { homeDots } from "@/lib/siHomes";
import { INN_CENTER, innDrawing } from "@/lib/siInn";
import type { InkPoint } from "@/lib/siTiles";
import { prefersReducedMotion } from "@/lib/swarm";
import { coordsOf, layerState, mvpOf, program, restoreState, saveState, type Vao, vaoOf } from "./glCommon";
import { brushReveal, butterflyCanvas, INK_LOOKS, INK_VARIANTS, inkCanvas, rolledCanvas, scrollCanvas, signCanvas, treeCanvas, variantOf } from "./inkArt";
import {
  BLOT_OPACITY,
  BLOT_RADIUS,
  blotGrowth,
  BRUSH_MS,
  BUTTERFLIES,
  BUTTERFLY_PX,
  butterflyAt,
  DOT_OPACITY,
  DOT_RADIUS,
  FAR_BELOW,
  INK_OPACITY,
  INK_PX,
  INK_SIZE,
  interp,
  MARK_SIZE,
  MARKS_FROM,
  NEAR_FROM,
  RING_PAD,
  SCROLL_OPEN,
  SCROLL_OPEN_FROM,
  SCROLL_ROLLED,
  scrollAt,
} from "./siLook";
import type { SiMapData, SiMine } from "./types";

/**
 * 祀掌柜's corner of the 高德 map drawn by the GPU, under the roaches and never in the way of a tap (the inn's lines
 * and the queue's are 高德's own, siAmap.ts): from afar the blot on 宏村, in the middle distance the fields' dots,
 * close up the inn's trees and sign, every ink roach of the tiles in view, and your own over them, ringed, drawn
 * in by her brush the first time; and her scroll beside her with her butterflies round it. As on MapLibre
 * (siMap.ts), with the same sizes (siLook.ts). Each is a point sprite cut from one picture of them all, turned
 * and placed by its bottom like MapLibre's icons; the dots and the blot are worked out by the GPU itself.
 */

export type InkGl = {
  setInn: (inn: SiMapData["inn"]) => void;
  setInks: (inks: InkPoint[]) => void;
  setMine: (mine: SiMine | null) => void;
  setTier: (tier: PaintingTier) => void;
  /** Shown, or kept hidden behind the other map: hidden, nothing flies */
  setActive: (on: boolean) => void;
  destroy: () => void;
};

/** The pictures' cells: 128 px squares, 8 × 8 of them */
const CELL = 128;
const GRID = 8;
/** Each look's four ways (inkArt.ts INK_VARIANTS), looks in ROACH_AVATARS' order */
const C_INK = 0;
const C_TREE = 20;
const C_SIGN = 21;
const C_SIGN_FULL = 22;
const C_ROLLED = 23;
/** Plus the tier */
const C_SCROLL = 24;
/** Plus the frame */
const C_FLY = 29;
/** Worked out by the GPU: a dot (MapLibre's circle-blur 0.4) and the blot (0.85) */
const C_DOT = -1;
const C_BLOT = -2;
/** Floats per point: where (2), cell, size in CSS px, tilt (radians), alpha, shift on screen (2, CSS px, y down) */
const STRIDE = 8;
const DOTS = 1600;
/** Frames a second while her butterflies fly or her brush draws */
const FRAME_MS = 50;

const VERT = `
precision highp float;
attribute vec2 aPos;
attribute float aCell;
attribute float aSize;
attribute float aTilt;
attribute float aAlpha;
attribute vec2 aShift;
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uScale;
uniform float uBottom;
uniform float uDrop;
uniform float uMaxPx;
varying float vCell;
varying float vAlpha;
varying vec2 vTurn;
void main() {
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  float s = aSize * uScale;
  // placed by its bottom (less the room round your own), turned about it: its middle that far up, turned too
  vec2 up = uBottom * vec2(sin(aTilt), -cos(aTilt)) * s * (0.5 - uDrop);
  vec2 off = aShift + up;
  p.xy += vec2(off.x, -off.y) * 2.0 / uViewport * p.w;
  gl_Position = p;
  gl_PointSize = min(s * uDpr, uMaxPx);
  vCell = aCell;
  vAlpha = aAlpha;
  vTurn = vec2(cos(aTilt), sin(aTilt));
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uGrid;
uniform float uOpacity;
uniform vec3 uInk;
varying float vCell;
varying float vAlpha;
varying vec2 vTurn;
void main() {
  float a = uOpacity * vAlpha;
  if (vCell < -0.5) {
    // a soft round spot, full in the middle, fading out over its outer part
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float blur = vCell < -1.5 ? 0.85 : 0.4;
    float k = a * (1.0 - smoothstep(1.0 - blur, 1.0, d));
    if (k < 0.004) discard;
    gl_FragColor = vec4(uInk * k, k);
    return;
  }
  // the picture turned back by its tilt, within its own cell
  vec2 q = gl_PointCoord - 0.5;
  vec2 src = vec2(q.x * vTurn.x + q.y * vTurn.y, -q.x * vTurn.y + q.y * vTurn.x) + 0.5;
  if (src.x < 0.0 || src.y < 0.0 || src.x > 1.0 || src.y > 1.0) discard;
  float c = floor(vCell + 0.5);
  vec2 cell = vec2(mod(c, uGrid), floor(c / uGrid));
  vec4 t = texture2D(uTex, (cell + src) / uGrid);
  if (t.a * a < 0.01) discard;
  gl_FragColor = t * a;
}`;

/** A picture in its cell: a square one filling it, the rest as wide as they fit (signs on its bottom) */
function putCell(c: HTMLCanvasElement, cell: number, pic: HTMLCanvasElement | null, bottom: boolean) {
  if (!pic) return;
  const x = (cell % GRID) * CELL;
  const y = Math.floor(cell / GRID) * CELL;
  const k = CELL / Math.max(pic.width, pic.height);
  const w = pic.width * k;
  const h = pic.height * k;
  c.getContext("2d")!.drawImage(pic, x + (CELL - w) / 2, bottom ? y + CELL - h : y + (CELL - h) / 2, w, h);
}

let atlasMade: Promise<HTMLCanvasElement> | null = null;
/** Every picture in its cell but the ink roaches', which wait for atlasInks */
function atlas() {
  atlasMade ??= (async () => {
    const c = document.createElement("canvas");
    c.width = c.height = CELL * GRID;
    const put = (cell: number, pic: HTMLCanvasElement | null, bottom: boolean) => putCell(c, cell, pic, bottom);
    put(C_TREE, treeCanvas(CELL), true);
    put(C_SIGN, signCanvas("缘缘庄", CELL / 2), true);
    put(C_SIGN_FULL, signCanvas("客满", CELL / 2, true), true);
    put(C_ROLLED, await rolledCanvas(CELL).catch(() => null), false);
    const tiers = await Promise.all(([0, 1, 2, 3, 4] as const).map((t) => scrollCanvas(t, CELL).catch(() => null)));
    tiers.forEach((pic, t) => put(C_SCROLL + t, pic, false));
    for (const f of [0, 1] as const) put(C_FLY + f, butterflyCanvas(f, CELL), false);
    return c;
  })();
  atlasMade.catch(() => {
    atlasMade = null;
  });
  return atlasMade;
}

let inksMade: Promise<void> | null = null;
/** The ink roaches' pictures into their cells of the atlas, only once the map shows some close up: five downloads */
function atlasInks() {
  inksMade ??= (async () => {
    const c = await atlas();
    const inks = await Promise.all(INK_LOOKS.flatMap((look) => INK_VARIANTS.map((v) => inkCanvas(look, v, CELL).catch(() => null))));
    inks.forEach((pic, i) => putCell(c, C_INK + i, pic, true));
  })();
  inksMade.catch(() => {
    inksMade = null;
  });
  return inksMade;
}

const inkCell = (look: number, state: number, left: boolean) => C_INK + look * 4 + INK_VARIANTS.indexOf(variantOf(state, left));
const RAD = Math.PI / 180;

/** One kind of thing drawn: its points, as they go to the GPU */
type Batch = { vao: unknown; buf: WebGLBuffer | null; data: Float32Array; count: number; dirty: boolean };

/** The layer, or null where 高德 cannot do it (nothing of hers but the lines is then drawn) */
export function inkGl(AMap: AMapNS, map: AMapNS, opts: { zIndex: number; zoomOffset: number; onFail: (why: string) => void }): InkGl | null {
  if (typeof AMap.GLCustomLayer !== "function" || !map.customCoords || typeof map.render !== "function") return null;
  const cc = map.customCoords;
  // everything of hers is within a few km of the village: one origin there keeps every position exact
  const origin = toGcj(INN_CENTER);
  const at = (pts: [number, number][]) => coordsOf(cc, origin, pts.map(([lng, lat]) => toGcj({ lng, lat })));

  let gl: WebGLRenderingContext | null = null;
  let vao: Vao | null = null;
  let prog: WebGLProgram | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  let atlasTex: WebGLTexture | null = null;
  let mineTex: WebGLTexture | null = null;
  let maxPx = 0;
  let failed = false;
  let atlasPic: HTMLCanvasElement | null = null;
  let atlasOn = false;
  // the ink roaches' pictures asked for (atlasInks), once some are shown close up
  let inksAsked = false;
  const batches: Record<"blot" | "dots" | "marks" | "inks" | "mine" | "her", Batch> = {
    blot: { vao: null, buf: null, data: new Float32Array(0), count: 0, dirty: true },
    dots: { vao: null, buf: null, data: new Float32Array(0), count: 0, dirty: true },
    marks: { vao: null, buf: null, data: new Float32Array(0), count: 0, dirty: true },
    inks: { vao: null, buf: null, data: new Float32Array(0), count: 0, dirty: true },
    mine: { vao: null, buf: null, data: new Float32Array(0), count: 0, dirty: true },
    her: { vao: null, buf: null, data: new Float32Array(STRIDE * (1 + BUTTERFLIES)), count: 0, dirty: true },
  };
  let inn: SiMapData["inn"] = null;
  let tier: PaintingTier = 0;
  let active = true;
  // your own: its picture, and her brush drawing it in (frame: as far as she has got by a moment)
  let minePic: ImageData | HTMLCanvasElement | null = null;
  let mineFresh = false;
  let brush: { frame: (p: number) => ImageData; start: number } | null = null;
  let mineSeq = 0;
  // your own as the page has it, its picture made only once it is close up in view (mineAsked)
  let mineWant: SiMine | null = null;
  let mineAsked = false;

  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    opts.onFail(why);
  };

  /** Whether a place is on the map's screen, or within margin px of it */
  const onScreen = (p: { lng: number; lat: number }, margin: number) => {
    try {
      const px = map.lngLatToContainer(toGcj(p));
      const el = map.getContainer();
      return px.getX() > -margin && px.getY() > -margin && px.getX() < el.clientWidth + margin && px.getY() < el.clientHeight + margin;
    } catch {
      return false;
    }
  };

  /** Your own's picture, drawn in by her brush when she has only just drawn it */
  const drawMine = (mine: SiMine) => {
    const seq = mineSeq;
    mineAsked = true;
    void inkCanvas(mine.look, mine.variant, CELL, mine.color)
      .then((c) => {
        if (seq !== mineSeq) return;
        minePic = c;
        mineFresh = true;
        const left = mine.brushFrom === null ? 0 : BRUSH_MS - (Date.now() - mine.brushFrom);
        brush = left > 0 && !prefersReducedMotion() ? { frame: brushReveal(c), start: performance.now() - (BRUSH_MS - left) } : null;
        frames();
        map.render();
      })
      .catch(() => {
        if (seq === mineSeq) mineAsked = false;
      });
  };

  /** A batch's points: where, and what each is drawn as */
  const fill = (b: Batch, pts: [number, number][], each: (i: number, out: Float32Array, o: number) => void) => {
    const xy = at(pts);
    const data = new Float32Array(pts.length * STRIDE);
    for (let i = 0; i < pts.length; i++) {
      const o = i * STRIDE;
      data[o] = xy[i * 2];
      data[o + 1] = xy[i * 2 + 1];
      each(i, data, o);
    }
    b.data = data;
    b.count = pts.length;
    b.dirty = true;
  };

  const placeInn = () => {
    const drawn = inn?.drawn ?? 0;
    fill(batches.blot, drawn > 0 ? [[INN_CENTER.lng, INN_CENTER.lat]] : [], (_, d, o) => {
      d[o + 2] = C_BLOT;
      d[o + 3] = 2 * blotGrowth(drawn);
      d[o + 5] = 1;
    });
    fill(batches.dots, homeDots(inn?.homesReach ?? 0, DOTS), (_, d, o) => {
      d[o + 2] = C_DOT;
      d[o + 3] = 2;
      d[o + 5] = 1;
    });
    const drawing = innDrawing();
    const marks: [number, number][] = [...drawing.trees.map((t): [number, number] => [t.lng, t.lat]), [drawing.sign.lng, drawing.sign.lat]];
    fill(batches.marks, marks, (i, d, o) => {
      const sign = i === marks.length - 1;
      d[o + 2] = sign ? (inn?.full ? C_SIGN_FULL : C_SIGN) : C_TREE;
      d[o + 3] = sign ? INK_PX * 1.5 : INK_PX;
      d[o + 5] = 1;
    });
  };
  placeInn();

  /** Her scroll and butterflies: where on screen, by the zoom and the time */
  const placeHer = (z: number, t: number | null) => {
    const b = batches.her;
    const s = scrollAt(z);
    if (!s) {
      b.count = 0;
      return;
    }
    if (!b.count) {
      const [x, y] = at([[SI_AT.lng, SI_AT.lat]]);
      for (let i = 0; i <= BUTTERFLIES; i++) {
        b.data[i * STRIDE] = x;
        b.data[i * STRIDE + 1] = y;
      }
    }
    const d = b.data;
    d[2] = s.open ? C_SCROLL + tier : C_ROLLED;
    d[3] = s.open ? SCROLL_OPEN.h : SCROLL_ROLLED.w;
    d[5] = 1;
    d[6] = s.dx;
    d[7] = s.dy;
    for (let i = 0; i < BUTTERFLIES; i++) {
      const f = butterflyAt(i, t, z);
      const o = (i + 1) * STRIDE;
      d[o + 2] = C_FLY + f.frame;
      d[o + 3] = BUTTERFLY_PX;
      d[o + 5] = 0.85;
      d[o + 6] = f.dx;
      d[o + 7] = f.dy;
    }
    b.count = s.open ? 1 + BUTTERFLIES : 1;
    b.dirty = true;
  };

  // 高德 calls this with its WebGL context before the layer's first frame (and again should it make a new one)
  const init = (g: WebGLRenderingContext) => {
    try {
      gl = g;
      const range = g.getParameter(g.ALIASED_POINT_SIZE_RANGE) as Float32Array;
      maxPx = range?.[1] ?? 0;
      if (maxPx < 64) throw new Error(`points up to ${maxPx}px`);
      vao = vaoOf(g);
      if (!vao) throw new Error("no vertex arrays");
      const p = program(g, VERT, FRAG);
      prog = p;
      loc = Object.fromEntries(
        ["uMvp", "uViewport", "uDpr", "uScale", "uBottom", "uDrop", "uMaxPx", "uTex", "uGrid", "uOpacity", "uInk"].map((n) => [n, g.getUniformLocation(p, n)]),
      );
      const vaoWas = vao.current();
      const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
      const attrs: [string, number, number][] = [
        ["aPos", 2, 0],
        ["aCell", 1, 2],
        ["aSize", 1, 3],
        ["aTilt", 1, 4],
        ["aAlpha", 1, 5],
        ["aShift", 2, 6],
      ];
      for (const b of Object.values(batches)) {
        b.vao = vao.create();
        vao.bind(b.vao);
        b.buf = g.createBuffer();
        g.bindBuffer(g.ARRAY_BUFFER, b.buf);
        for (const [name, size, offset] of attrs) {
          const a = g.getAttribLocation(p, name);
          g.enableVertexAttribArray(a);
          g.vertexAttribPointer(a, size, g.FLOAT, false, STRIDE * 4, offset * 4);
        }
        b.dirty = true;
      }
      vao.bind(vaoWas);
      g.bindBuffer(g.ARRAY_BUFFER, bufWas);
      atlasTex = g.createTexture();
      mineTex = g.createTexture();
      atlasOn = false;
      mineFresh = Boolean(minePic);
    } catch (e) {
      fail(e instanceof Error ? e.message : "init");
    }
  };

  /** A picture onto a texture (bound to unit 0 by the caller), read the way this layer needs, then as 高德 had it */
  const upload = (g: WebGLRenderingContext, pic: TexImageSource, mipmaps: boolean) => {
    const premultiply = g.getParameter(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const flip = g.getParameter(g.UNPACK_FLIP_Y_WEBGL);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, pic);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, flip);
    if (mipmaps) g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mipmaps ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  };

  const render = () => {
    const g = gl;
    if (failed || !g || !vao || !prog || g.isContextLost()) return;
    const z = map.getZoom() - opts.zoomOffset;
    const far = z < FAR_BELOW;
    const middle = z >= FAR_BELOW - 0.5 && z < NEAR_FROM + 0.5;
    const near = z >= NEAR_FROM;
    const now = performance.now();
    placeHer(z, prefersReducedMotion() ? null : now);
    const show = {
      blot: far && batches.blot.count > 0,
      dots: middle && batches.dots.count > 0,
      marks: z >= MARKS_FROM,
      inks: near && batches.inks.count > 0,
      mine: near && batches.mine.count > 0 && Boolean(minePic || brush),
      her: batches.her.count > 0,
    };
    // the pictures of ink roaches only now they are wanted: the page has them only close up at 宏村
    if (show.inks && !inksAsked) {
      inksAsked = true;
      void atlasInks()
        .then(() => {
          atlasOn = false;
          map.render();
        })
        .catch(() => {
          inksAsked = false;
        });
    }
    if (near && mineWant && !mineAsked && batches.mine.count > 0 && onScreen(mineWant.at, 400)) drawMine(mineWant);
    if (!Object.values(show).some(Boolean)) return;
    try {
      const was = saveState(g, vao);
      layerState(g, was);
      g.useProgram(prog);
      const el = map.getContainer();
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      cc.setCenter(origin);
      g.uniformMatrix4fv(loc.uMvp, false, mvpOf(cc.getCameraParams()));
      g.uniform2f(loc.uViewport, w, h);
      g.uniform1f(loc.uDpr, g.drawingBufferWidth / w);
      g.uniform1f(loc.uMaxPx, maxPx);
      g.uniform1i(loc.uTex, 0);
      g.uniform3f(loc.uInk, 0x24 / 255, 0x22 / 255, 0x1f / 255);
      g.bindTexture(g.TEXTURE_2D, atlasTex);
      if (!atlasOn && atlasPic) {
        upload(g, atlasPic, true);
        atlasOn = true;
      }
      const draw = (name: keyof typeof batches, u: { scale: number; opacity: number; bottom?: boolean; drop?: number; grid?: number }) => {
        const b = batches[name];
        vao!.bind(b.vao);
        g.bindBuffer(g.ARRAY_BUFFER, b.buf);
        if (b.dirty) {
          g.bufferData(g.ARRAY_BUFFER, b.data, g.DYNAMIC_DRAW);
          b.dirty = false;
        }
        g.uniform1f(loc.uScale, u.scale);
        g.uniform1f(loc.uOpacity, u.opacity);
        g.uniform1f(loc.uBottom, u.bottom ? 1 : 0);
        g.uniform1f(loc.uDrop, u.drop ?? 0);
        g.uniform1f(loc.uGrid, u.grid ?? GRID);
        g.drawArrays(g.POINTS, 0, b.count);
      };
      // the soft ones need no pictures
      if (show.blot) draw("blot", { scale: interp(BLOT_RADIUS, z), opacity: BLOT_OPACITY });
      if (show.dots) draw("dots", { scale: interp(DOT_RADIUS, z), opacity: interp(DOT_OPACITY, z) });
      if (atlasOn) {
        if (show.marks) draw("marks", { scale: interp(MARK_SIZE, z, 2), opacity: 1, bottom: true });
        if (show.inks) draw("inks", { scale: interp(INK_SIZE, z, 2), opacity: 1, bottom: true });
      }
      if (show.mine) {
        g.bindTexture(g.TEXTURE_2D, mineTex);
        if (brush) {
          const p = (now - brush.start) / BRUSH_MS;
          upload(g, brush.frame(p), true);
          if (p >= 1) brush = null;
        } else if (mineFresh && minePic) {
          upload(g, minePic, true);
          mineFresh = false;
        }
        draw("mine", { scale: interp(INK_SIZE, z, 2) / (1 - 2 * RING_PAD), opacity: 1, bottom: true, drop: RING_PAD, grid: 1 });
        g.bindTexture(g.TEXTURE_2D, atlasTex);
      }
      if (atlasOn && show.her) draw("her", { scale: 1, opacity: 1 });
      restoreState(g, vao, was);
    } catch (e) {
      fail(e instanceof Error ? e.message : "render");
    }
  };

  const layer = new AMap.GLCustomLayer({ zIndex: opts.zIndex, init, render });
  map.add(layer);
  void atlas()
    .then((pic) => {
      atlasPic = pic;
      map.render();
    })
    .catch(() => {});

  // Frames of their own while her butterflies fly in view, or her brush draws (高德 draws only as the map moves)
  let timer = 0;
  const herInView = () => map.getZoom() - opts.zoomOffset >= SCROLL_OPEN_FROM && !prefersReducedMotion() && onScreen(SI_AT, 120);
  const frames = () => {
    const want = !failed && active && !document.hidden && (herInView() || brush !== null);
    if (want && !timer) {
      timer = window.setInterval(() => {
        map.render();
        if (!brush && !herInView()) frames();
      }, FRAME_MS);
    } else if (!want && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
  map.on("moveend", frames);
  map.on("zoomend", frames);
  document.addEventListener("visibilitychange", frames);
  frames();

  return {
    setInn: (next) => {
      inn = next;
      placeInn();
      map.render();
    },
    setInks: (inks) => {
      fill(
        batches.inks,
        inks.map((p): [number, number] => [p.lng, p.lat]),
        (i, d, o) => {
          const p = inks[i];
          d[o + 2] = inkCell(p.look, p.state, p.left);
          d[o + 3] = INK_PX * p.size;
          d[o + 4] = p.tilt * RAD;
          d[o + 5] = INK_OPACITY * p.ink;
        },
      );
      // the lying ones under those standing
      const lying: number[] = [];
      const standing: number[] = [];
      inks.forEach((p, i) => (p.state === 2 ? lying : standing).push(i));
      if (lying.length && standing.length) {
        const src = batches.inks.data;
        const out = new Float32Array(src.length);
        [...lying, ...standing].forEach((from, to) => out.set(src.subarray(from * STRIDE, (from + 1) * STRIDE), to * STRIDE));
        batches.inks.data = out;
      }
      map.render();
    },
    setMine: (mine) => {
      mineSeq++;
      mineWant = mine;
      mineAsked = false;
      if (!mine) {
        batches.mine.count = 0;
        minePic = null;
        brush = null;
        map.render();
        return;
      }
      fill(batches.mine, [[mine.at.lng, mine.at.lat]], (_, d, o) => {
        d[o + 2] = 0;
        d[o + 3] = INK_PX * mine.size;
        d[o + 4] = mine.tilt * RAD;
        d[o + 5] = Math.min(1, 1.05 * mine.ink);
      });
      // drawn at once if it was before (its picture is held); otherwise once it is close up in view (render)
      if (minePic) drawMine(mine);
      map.render();
    },
    setTier: (next) => {
      tier = next;
      map.render();
    },
    setActive: (on) => {
      active = on;
      frames();
    },
    destroy: () => {
      window.clearInterval(timer);
      timer = 0;
      map.off("moveend", frames);
      map.off("zoomend", frames);
      document.removeEventListener("visibilitychange", frames);
      map.remove(layer);
      if (gl && !gl.isContextLost()) {
        for (const b of Object.values(batches)) {
          if (b.buf) gl.deleteBuffer(b.buf);
          if (vao && b.vao) vao.remove(b.vao);
        }
        if (atlasTex) gl.deleteTexture(atlasTex);
        if (mineTex) gl.deleteTexture(mineTex);
        if (prog) gl.deleteProgram(prog);
      }
      gl = null;
      map.render();
    },
  };
}
