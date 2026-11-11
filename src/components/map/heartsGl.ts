import type { CustomLayerInterface, CustomRenderMethodInput, Map as MaplibreMap } from "maplibre-gl";
import { heartRhythm, iconPx } from "@/lib/swarm";
import { HEART_D } from "@/lib/touchArt";
import { layerState, program, restoreState, saveState, vaoOf, type Vao } from "./glCommon";
import { crowdOf, type HeartMode, thinMasks } from "./roachGl";

/**
 * 舟u本色 on the OSM map (MapLibre): the hearts over the roaches as one custom layer on top of them,
 * drawn the way the 高德 map's roachGl.ts draws its own, on the same curve. The roaches here crawl a
 * group at a time (MaplibreView's animate()), so each heart is moved by its roach's group's offset,
 * the very offsets the roach layers were last nudged by. Far out, MapLibre draws every roach, but
 * hearts only go over the one drawn on top of each pile (thinMasks), or a country would be all hearts.
 */

/** A roach with hearts: where, its seed, its crawl group (-1: it keeps still, as yours do), and kind */
export type HeartDot = {
  lng: number;
  lat: number;
  seed: number;
  group: number;
  /** 0 a roach, 1 a clone (fainter), 2 a 触须之交's (redder, bigger, three at a time), 3 yours */
  kind: 0 | 1 | 2 | 3;
};

export type HeartsLayer = CustomLayerInterface & {
  setDots: (dots: HeartDot[]) => void;
  setMode: (mode: HeartMode) => void;
};

const CELL = 96;
const INNER = 84;
const ATLAS_W = 512;
const ATLAS_H = 128;
const TINTS = ["#ff4f8b", "#ff7eb6", "#ff98c3", "#ff2e63"];
/** Floats per heart-bearing roach: place 2 (from the origin), rhythm 3 + kind 1, crawl group 1, thinning 1, crowd 1 */
const STRIDE = 9;
/** 高德's zoom levels are one above MapLibre's; thinMasks counts in 高德's, up to this one */
const THIN_ZOOM = 7;
/** Your own roaches are shown this many px across (MaplibreView: 96 px pictures at pixelRatio 2) */
const MINE_PX = 48;
// the same curve as roachGl.ts and the design
const LIFE = 0.82;
const CROWD_TARGET = 0.8;
const CROWD_GRID = 2 ** 15;
const THIN_CAP = 4;
const CLOCK_WRAP = 2 ** 23;
/** Places are kept relative to an origin near the view (Web Mercator 0..1), so they stay exact close up */
const REORIGIN = 0.01;
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;";

const VERT = `
precision highp float;
attribute vec2 aPos;
attribute vec4 aHeart;
attribute float aGroup;
attribute float aThin;
attribute float aCrowd;
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uTime;
uniform float uThinPow;
uniform float uMode;
uniform float uSlot;
uniform float uCellCells;
uniform vec2 uGroup[16];
varying float vAlpha;
varying vec2 vCell;
varying vec2 vRot;
const float TAU = 6.2831853;
const float LIFE = ${LIFE.toFixed(3)};
void main() {
  float kind = aHeart.w;
  float mine = step(2.5, kind);
  // far out, only over the roach drawn of each pile; yours always
  if (mine < 0.5 && uThinPow > 0.0 && mod(floor(aThin / uThinPow), 2.0) < 0.5) { ${HIDE} return; }
  float friend = step(1.5, kind) * (1.0 - mine);
  float icon = mix(uSize, ${MINE_PX.toFixed(1)}, mine);
  float slots = 2.0 + friend;
  float u;
  float cyc;
  if (uMode > 2.5) {
    u = 0.32 * LIFE;
    cyc = 0.0;
  } else {
    float c = uTime / aHeart.y + aHeart.x + uSlot / slots;
    u = fract(c);
    cyc = floor(c);
  }
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
  float rise = (1.0 - pow(1.0 - v, 2.2)) * 0.95 * icon * motion;
  float sway = sin(v * TAU * 1.1 + h2 * TAU) * 0.12 * icon * (0.4 + 0.6 * v) * motion;
  float side = (aHeart.z * 0.6 + (h1 - 0.5) * 0.8) * 0.16 * icon;
  // its roach's group's crawl, as the roach layers were last moved (screen px, y down)
  vec2 crawl = vec2(0.0);
  if (aGroup > -0.5) {
    for (int g = 0; g < 16; g++) {
      if (abs(float(g) - aGroup) < 0.5) crawl = uGroup[g];
    }
  }
  float ox = crawl.x + side + sway;
  float oy = crawl.y - (0.5 * icon + rise);
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  p.xy += vec2(ox, -oy) * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  float size = max(icon * 0.42 * (1.0 + 0.25 * friend) * pop, 3.0);
  gl_PointSize = size * uDpr * ${(CELL / INNER).toFixed(4)};
  vAlpha = alpha * (kind > 0.5 && kind < 1.5 ? 0.55 : 1.0);
  vCell = vec2(friend > 0.5 ? 3.0 : floor(h3 * 2.999), 0.0);
  float tilt = (h2 - 0.5) * 0.5;
  vRot = vec2(cos(tilt), sin(tilt));
}`;

const FRAG = `
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

const heartUrl = (tint: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1.5 26 26" width="96" height="96"><path d="${HEART_D}" fill="${tint}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`,
  )}`;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("heart"));
    img.src = url;
  });

const mercator = (lng: number, lat: number): [number, number] => {
  const sin = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
};

/**
 * MapLibre's matrix takes the world in pixels (0..worldSize): m × scale(worldSize) × translate(origin),
 * column-major, worked out in doubles, then single precision for the GPU with places from the origin
 */
function placed(m: ArrayLike<number>, worldSize: number, x: number, y: number) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    out[r] = m[r] * worldSize;
    out[4 + r] = m[4 + r] * worldSize;
    out[8 + r] = m[8 + r];
    out[12 + r] = m[r] * worldSize * x + m[4 + r] * worldSize * y + m[12 + r];
  }
  return out;
}

/**
 * The layer. offsets(): each crawl group's [dx, dy] as the roach layers were last nudged (null while
 * they stand still); onFail: the hearts cannot be drawn here, and 舟u本色 is then drawn as 默认.
 */
export function heartsLayer(opts: { offsets: () => [number, number][] | null; onFail: (why: string) => void }): HeartsLayer {
  let map: MaplibreMap | null = null;
  let gl: WebGLRenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  let vao: Vao | null = null;
  let vaoObj: unknown = null;
  let buf: WebGLBuffer | null = null;
  let tex: WebGLTexture | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  let atlas: HTMLCanvasElement | null = null;
  let texReady = false;
  let failed = false;
  let mode: HeartMode = "off";
  let dots: HeartDot[] = [];
  let thin = new Float32Array(0);
  let crowd = new Float32Array(0);
  let origin: [number, number] = [0.5, 0.5];
  let dirty = true;
  let count = 0;
  let firstFriend = 0;
  const t0 = performance.now();

  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    window.setTimeout(() => opts.onFail(why), 0);
  };

  void Promise.all(TINTS.map((t) => loadImage(heartUrl(t)).catch(() => null))).then((imgs) => {
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const g = canvas.getContext("2d");
    if (!g) return fail("no 2d canvas");
    const m = (CELL - INNER) / 2;
    imgs.forEach((img, i) => img && g.drawImage(img, i * CELL + m, m, INNER, INNER));
    atlas = canvas;
    texReady = false;
    map?.triggerRepaint();
  });

  const upload = (g: WebGLRenderingContext) => {
    const data = new Float32Array(dots.length * STRIDE);
    dots.forEach((d, i) => {
      const [mx, my] = mercator(d.lng, d.lat);
      const [phase, period, side] = heartRhythm(d.seed);
      const o = i * STRIDE;
      data[o] = mx - origin[0];
      data[o + 1] = my - origin[1];
      data[o + 2] = phase;
      data[o + 3] = period;
      data[o + 4] = side;
      data[o + 5] = d.kind;
      data[o + 6] = d.group;
      data[o + 7] = thin[i];
      data[o + 8] = crowd[i];
    });
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
    count = dots.length;
    dirty = false;
  };

  const uploadAtlas = (g: WebGLRenderingContext) => {
    if (!atlas) return;
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
    texReady = true;
  };

  /** A new origin once the view has gone far from it */
  const reorigin = () => {
    if (!map) return;
    const c = map.getCenter();
    const [cx, cy] = mercator(c.lng, c.lat);
    if (Math.abs(cx - origin[0]) < REORIGIN && Math.abs(cy - origin[1]) < REORIGIN) return;
    origin = [cx, cy];
    dirty = true;
    map.triggerRepaint();
  };

  return {
    id: "hearts",
    type: "custom",
    renderingMode: "2d",
    onAdd(m, g) {
      map = m;
      gl = g as WebGLRenderingContext;
      try {
        vao = vaoOf(gl);
        if (!vao) throw new Error("no vertex arrays");
        const p = program(gl, VERT, FRAG);
        prog = p;
        loc = Object.fromEntries(
          ["uMvp", "uViewport", "uDpr", "uSize", "uTime", "uThinPow", "uMode", "uSlot", "uCellCells", "uGroup", "uTex"].map((n) => [
            n,
            gl!.getUniformLocation(p, n),
          ]),
        );
        const was = saveState(gl, vao);
        vaoObj = vao.create();
        vao.bind(vaoObj);
        buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const attr = (name: string, size: number, offset: number) => {
          const a = gl!.getAttribLocation(p, name);
          if (a < 0) return;
          gl!.enableVertexAttribArray(a);
          gl!.vertexAttribPointer(a, size, gl!.FLOAT, false, STRIDE * 4, offset * 4);
        };
        attr("aPos", 2, 0);
        attr("aHeart", 4, 2);
        attr("aGroup", 1, 6);
        attr("aThin", 1, 7);
        attr("aCrowd", 1, 8);
        tex = gl.createTexture();
        restoreState(gl, vao, was);
        const c = m.getCenter();
        origin = mercator(c.lng, c.lat);
        dirty = true;
        texReady = false;
        m.on("moveend", reorigin);
      } catch (e) {
        fail(e instanceof Error ? e.message : "hearts");
      }
    },
    render(g, options: CustomRenderMethodInput) {
      if (failed || mode === "off" || !map || !prog || !vao || !dots.length) return;
      const ctx = g as WebGLRenderingContext;
      try {
        const was = saveState(ctx, vao);
        ctx.bindTexture(ctx.TEXTURE_2D, tex);
        if (!texReady) uploadAtlas(ctx);
        vao.bind(vaoObj);
        if (dirty) upload(ctx);
        if (texReady && count) {
          const zoom = map.getZoom();
          const size = iconPx(zoom);
          const level = Math.max(2, Math.ceil(zoom + 1 - 1e-6));
          const thinPow = level <= THIN_ZOOM ? 2 ** (level - 2) : 0;
          const w = ctx.drawingBufferWidth;
          const h = ctx.drawingBufferHeight;
          const groups = new Float32Array(32);
          const offs = opts.offsets();
          if (offs) offs.forEach(([x, y], i) => i < 16 && ((groups[i * 2] = x), (groups[i * 2 + 1] = y)));
          ctx.useProgram(prog);
          ctx.uniformMatrix4fv(loc.uMvp, false, placed(options.modelViewProjectionMatrix, 512 * 2 ** zoom, origin[0], origin[1]));
          ctx.uniform2f(loc.uViewport, w, h);
          ctx.uniform1f(loc.uDpr, w / Math.max(1, map.getCanvas().clientWidth));
          ctx.uniform1f(loc.uSize, size);
          ctx.uniform1f(loc.uTime, (performance.now() - t0) % CLOCK_WRAP);
          ctx.uniform1f(loc.uThinPow, thinPow);
          ctx.uniform1f(loc.uMode, mode === "still" ? 3 : 1);
          // roaches to an icon's square per roach counted in a crowd cell; MapLibre's world is 512 × 2^zoom px
          ctx.uniform1f(loc.uCellCells, ((size / (512 * 2 ** zoom)) * CROWD_GRID) ** 2);
          ctx.uniform2fv(loc.uGroup, groups);
          ctx.uniform1i(loc.uTex, 0);
          layerState(ctx, was);
          ctx.viewport(0, 0, w, h);
          const draw = (slot: number, from: number) => {
            if (from >= count) return;
            ctx.uniform1f(loc.uSlot, slot);
            ctx.drawArrays(ctx.POINTS, from, count - from);
          };
          draw(0, 0);
          if (mode !== "still") {
            draw(1, 0);
            draw(2, firstFriend);
          }
        }
        restoreState(ctx, vao, was);
      } catch (e) {
        fail(e instanceof Error ? e.message : "render");
      }
    },
    onRemove(m) {
      m.off("moveend", reorigin);
      if (gl && !gl.isContextLost()) {
        if (buf) gl.deleteBuffer(buf);
        if (tex) gl.deleteTexture(tex);
        if (prog) gl.deleteProgram(prog);
        if (vao && vaoObj) vao.remove(vaoObj);
      }
      gl = null;
      map = null;
    },
    setDots(list) {
      // 触须之交 last, so the third heart is one draw from there on; yours never thinned or taking turns
      dots = [...list].sort((a, b) => Number(a.kind === 2) - Number(b.kind === 2));
      const f = dots.findIndex((d) => d.kind === 2);
      firstFriend = f < 0 ? dots.length : f;
      thin = thinMasks(dots, THIN_ZOOM);
      crowd = crowdOf(dots);
      dirty = true;
      map?.triggerRepaint();
    },
    setMode(m) {
      mode = m;
      map?.triggerRepaint();
    },
  };
}
