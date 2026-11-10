import type { AMapNS } from "@/lib/amap";
import { coordsOf, layerState, mvpOf, offFrom, program, restoreState, saveState, type Vao, vaoOf } from "./glCommon";

/**
 * The dark swarm on the 高德 map drawn by the GPU, in place of 高德's own HeatMap. 高德's works through every
 * roach on the CPU each time it draws the map, which it does all the time while the roaches crawl: at
 * country level that took about a second of every second on a slow phone (2026-11-10: 10 frames a second,
 * however the roaches themselves were drawn). The picture is the same: a soft dark spot `radius` px across
 * around every roach, laid over one another as on a canvas (each covers 1/max of what is under it, at its
 * middle, fading to nothing at its edge), the darkness coloured along `gradient` and kept within `opacity`.
 * The spots go into a picture of their own at half the screen's CSS resolution (it is all soft), drawn
 * again only when the view or the roaches change; every frame lays that picture over the map.
 */

export type SwarmGl = {
  /** Every roach, where 高德 has it (GCJ-02) */
  setPoints: (lngLats: [number, number][]) => void;
  destroy: () => void;
};

export type SwarmLook = {
  /** Of each roach's spot, in CSS px */
  radius: number;
  /** How many spots on one another make it full dark */
  max: number;
  /** The least and most a pixel of the swarm covers the map */
  opacity: [number, number];
  /** Colours by darkness, 0 to 1: CSS rgb() or rgba() (the alpha is opacity's to give) */
  gradient: Record<number, string>;
  /** 高德 zoom levels it shows at */
  zooms: [number, number];
};

/** The spots' picture against the screen's CSS pixels */
const SCALE = 0.5;
/** Of a spot's radius, full dark out to here (a canvas radial gradient's inner circle) */
const INNER = 0.15;
/**
 * 高德's HeatMap draws a spot of radius r a little smaller on screen than r CSS px: r / 1.18, the same at
 * zooms 9 and 12 and on 1x and 3x screens (measured 2026-11-10, a single spot's darkness every 2 px from
 * its middle). The swarm keeps 高德's look with that.
 */
const AMAP_SPOT = 1 / 1.18;
/** Positions are kept relative to an origin near the view; past this far from it (metres), a new one */
const REORIGIN_M = 150_000;
const STOPS = 5;

const SPOT_VERT = `
precision highp float;
attribute vec2 aPos;
uniform mat4 uMvp;
uniform float uSize;
void main() {
  gl_Position = uMvp * vec4(aPos, 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const SPOT_FRAG = `
precision mediump float;
uniform float uAlpha;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float a = uAlpha * (1.0 - clamp((d - ${INNER.toFixed(2)}) / ${(1 - INNER).toFixed(2)}, 0.0, 1.0));
  // black, laid over what is there: the darkness adds up as on a canvas
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const SHADE_VERT = `
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const SHADE_FRAG = `
precision mediump float;
uniform sampler2D uSpots;
uniform vec3 uColor[${STOPS}];
uniform float uStop[${STOPS}];
uniform vec2 uOpacity;
varying vec2 vUv;
void main() {
  float a = texture2D(uSpots, vUv).a;
  if (a < 0.002) discard;
  vec3 c = uColor[0];
  for (int i = 1; i < ${STOPS}; i++) {
    if (a > uStop[i - 1]) c = mix(uColor[i - 1], uColor[i], clamp((a - uStop[i - 1]) / max(uStop[i] - uStop[i - 1], 0.0001), 0.0, 1.0));
  }
  float o = clamp(a, uOpacity.x, uOpacity.y);
  gl_FragColor = vec4(c * o, o);
}`;

/** The gradient as STOPS stops: positions, and colours 0..1 */
function stopsOf(gradient: Record<number, string>) {
  const entries = Object.entries(gradient)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);
  const pick = Array.from({ length: STOPS }, (_, i) => entries[Math.min(entries.length - 1, Math.round((i * (entries.length - 1)) / (STOPS - 1)))]);
  const stop = new Float32Array(pick.map(([k]) => k));
  const color = new Float32Array(
    pick.flatMap(([, v]) => {
      const m = v.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      return [m[0] / 255, m[1] / 255, m[2] / 255];
    }),
  );
  return { stop, color };
}

/** The layer, or null where 高德 cannot do it (the page then keeps 高德's HeatMap) */
export function swarmGl(AMap: AMapNS, map: AMapNS, opts: SwarmLook & { zIndex: number; onFail: (why: string) => void }): SwarmGl | null {
  if (typeof AMap.GLCustomLayer !== "function" || !map.customCoords || typeof map.render !== "function") return null;
  const cc = map.customCoords;
  const { stop, color } = stopsOf(opts.gradient);
  let gl: WebGLRenderingContext | null = null;
  let vao: Vao | null = null;
  let spotProg: WebGLProgram | null = null;
  let shadeProg: WebGLProgram | null = null;
  let spotVao: unknown = null;
  let shadeVao: unknown = null;
  let spotBuf: WebGLBuffer | null = null;
  let cornerBuf: WebGLBuffer | null = null;
  let tex: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let size: [number, number] = [0, 0];
  let su: Record<string, WebGLUniformLocation | null> = {};
  let hu: Record<string, WebGLUniformLocation | null> = {};
  let failed = false;
  let lngLats: [number, number][] = [];
  let xy = new Float64Array(0);
  let origin: [number, number] = (() => {
    const c = map.getCenter();
    return [c.getLng(), c.getLat()];
  })();
  let dirty = true;
  let count = 0;
  /** What the spots' picture was last drawn for: the camera and the points */
  let drawnFor: { mvp: Float32Array; w: number; h: number; version: number } | null = null;
  let version = 0;

  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    opts.onFail(why);
  };

  const place = () => {
    xy = coordsOf(cc, origin, lngLats);
    dirty = true;
    version++;
  };

  // 高德 calls this with its WebGL context before the layer's first frame (and again should it make a new one)
  const init = (g: WebGLRenderingContext) => {
    try {
      gl = g;
      vao = vaoOf(g);
      if (!vao) throw new Error("no vertex arrays");
      spotProg = program(g, SPOT_VERT, SPOT_FRAG);
      shadeProg = program(g, SHADE_VERT, SHADE_FRAG);
      su = Object.fromEntries(["uMvp", "uSize", "uAlpha"].map((n) => [n, g.getUniformLocation(spotProg!, n)]));
      hu = Object.fromEntries(["uSpots", "uColor", "uStop", "uOpacity"].map((n) => [n, g.getUniformLocation(shadeProg!, n)]));
      const vaoWas = vao.current();
      const bufWas = g.getParameter(g.ARRAY_BUFFER_BINDING);
      spotVao = vao.create();
      vao.bind(spotVao);
      spotBuf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, spotBuf);
      const aPos = g.getAttribLocation(spotProg, "aPos");
      g.enableVertexAttribArray(aPos);
      g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 8, 0);
      // one triangle over the whole screen
      shadeVao = vao.create();
      vao.bind(shadeVao);
      cornerBuf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, cornerBuf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
      const aCorner = g.getAttribLocation(shadeProg, "aCorner");
      g.enableVertexAttribArray(aCorner);
      g.vertexAttribPointer(aCorner, 2, g.FLOAT, false, 8, 0);
      vao.bind(vaoWas);
      g.bindBuffer(g.ARRAY_BUFFER, bufWas);
      tex = g.createTexture();
      fbo = g.createFramebuffer();
      size = [0, 0];
      dirty = true;
      drawnFor = null;
    } catch (e) {
      fail(e instanceof Error ? e.message : "init");
    }
  };

  /** The spots' picture at the screen's size now (its texture bound to unit 0 by the caller) */
  const fit = (g: WebGLRenderingContext, w: number, h: number) => {
    if (size[0] === w && size[1] === h) return;
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer");
    size = [w, h];
    drawnFor = null;
  };

  const same = (a: Float32Array, b: Float32Array) => a.every((v, i) => v === b[i]);

  const render = () => {
    const g = gl;
    if (failed || !g || !vao || !spotProg || !shadeProg || g.isContextLost()) return;
    // as 高德's HeatMap counts its zooms: by the whole level, so zoom 11.7 still shows at [2, 11]
    const level = Math.floor(map.getZoom());
    if (level < opts.zooms[0] || level > opts.zooms[1]) return;
    try {
      const was = saveState(g, vao);
      layerState(g, was);
      g.bindTexture(g.TEXTURE_2D, tex);
      if (dirty) {
        const data = new Float32Array(xy);
        g.bindBuffer(g.ARRAY_BUFFER, spotBuf);
        g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
        count = lngLats.length;
        dirty = false;
      }
      const el = map.getContainer();
      const w = Math.max(1, Math.ceil(el.clientWidth * SCALE));
      const h = Math.max(1, Math.ceil(el.clientHeight * SCALE));
      fit(g, w, h);
      cc.setCenter(origin);
      const mvp = mvpOf(cc.getCameraParams());
      // the spots again only when the view or the roaches changed: not for each frame of the crawl
      if (!drawnFor || drawnFor.version !== version || drawnFor.w !== w || drawnFor.h !== h || !same(drawnFor.mvp, mvp)) {
        // drawn into, so not bound for reading meanwhile
        g.bindTexture(g.TEXTURE_2D, null);
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.viewport(0, 0, w, h);
        g.clearColor(0, 0, 0, 0);
        g.clear(g.COLOR_BUFFER_BIT);
        if (count) {
          g.useProgram(spotProg);
          vao.bind(spotVao);
          g.uniformMatrix4fv(su.uMvp, false, mvp);
          g.uniform1f(su.uSize, 2 * opts.radius * AMAP_SPOT * SCALE);
          g.uniform1f(su.uAlpha, 1 / opts.max);
          g.drawArrays(g.POINTS, 0, count);
        }
        drawnFor = { mvp, w, h, version };
        g.bindTexture(g.TEXTURE_2D, tex);
      }
      g.bindFramebuffer(g.FRAMEBUFFER, was.framebuffer);
      g.viewport(was.viewport[0], was.viewport[1], was.viewport[2], was.viewport[3]);
      g.useProgram(shadeProg);
      vao.bind(shadeVao);
      g.uniform1i(hu.uSpots, 0);
      g.uniform3fv(hu.uColor, color);
      g.uniform1fv(hu.uStop, stop);
      g.uniform2f(hu.uOpacity, opts.opacity[0], opts.opacity[1]);
      g.drawArrays(g.TRIANGLES, 0, 3);
      restoreState(g, vao, was);
    } catch (e) {
      fail(e instanceof Error ? e.message : "render");
    }
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
    setPoints: (list) => {
      lngLats = list;
      place();
      map.render();
    },
    destroy: () => {
      map.off("moveend", reorigin);
      map.remove(layer);
      if (gl && !gl.isContextLost()) {
        if (spotBuf) gl.deleteBuffer(spotBuf);
        if (cornerBuf) gl.deleteBuffer(cornerBuf);
        if (tex) gl.deleteTexture(tex);
        if (fbo) gl.deleteFramebuffer(fbo);
        if (spotProg) gl.deleteProgram(spotProg);
        if (shadeProg) gl.deleteProgram(shadeProg);
        if (vao && spotVao) vao.remove(spotVao);
        if (vao && shadeVao) vao.remove(shadeVao);
      }
      gl = null;
      map.render();
    },
  };
}
