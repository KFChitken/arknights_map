import type { CustomLayerInterface, CustomRenderMethodInput, Map as MaplibreMap } from "maplibre-gl";
import type { DiscoRoach } from "@/components/map/discoStage";
import { program, restoreState, saveState, type Vao, vaoOf } from "@/components/map/glCommon";
import { imageSpec } from "@/components/map/roachIcons";
import { drawRoach, usesPicture } from "@/lib/roachImages";
import { iconPx } from "@/lib/swarm";
import { danceTraits } from "./choreo";
import {
  ATLAS_H,
  ATLAS_W,
  CELL,
  COLS,
  CORNERS,
  DANCE_FRAG,
  DANCE_NAMES,
  type DanceNow,
  danceUniforms,
  danceVert,
  DIM_FRAG,
  DIM_VERT,
  INNER,
  LIGHT_FRAG,
  lightVert,
  locations,
  PALETTE_RGB,
} from "./glsl";

/**
 * 听歌's disco on the OSM map (and over 腾讯's, which this map draws our things for): two layers of MapLibre's own, the
 * map darkened under the roaches (dimLayer, under the sleeping ones too), and every roach dancing with the lights at
 * their feet (danceLayer), drawn as the 高德 map's are (glsl.ts), from an atlas of the very icons the roaches' own
 * layers show. Those layers are made see-through meanwhile (MaplibreStage.hold), so taps still find each roach there.
 * Every roach they draw is drawn, as those layers draw them all, however far out the map is.
 */

/** Floats per roach: place 2 (Web Mercator, from the origin), cell 1, drawn 1 (-1: its icon not in the atlas yet), kind 1, its part of the dance 3 */
const STRIDE = 8;
/** Places are kept relative to an origin near the view (Web Mercator 0..1), so they stay exact close up */
const REORIGIN = 0.01;
/** Your own roaches are this many px across (MaplibreView's mine layer) */
const MINE_PX = 48;
/** The sleeves-up copies, this many cells on from their icons', where the icons take no more */
const HANDS_AT = Math.floor((COLS * Math.floor(ATLAS_H / CELL)) / 2);
const MAX_CELLS = COLS * Math.floor(ATLAS_H / CELL);
/** Each icon drawn at this size (as the map's own, 96 px at pixelRatio 2) and fitted to its cell */
const ICON_PX = 96;

const mercator = (lng: number, lat: number): [number, number] => {
  const sin = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
};

/** MapLibre's matrix with the world in pixels, times scale(worldSize) × translate(origin), as heartsGl.ts has it */
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
 * How these layers draw: premultiplied colour over what is there, nothing else in the way. MapLibre sets everything it
 * draws with again after each custom layer's frame (its context marked dirty), so nothing is read back from the context
 * here: each such read waits for the GPU to finish all that came before it, every frame.
 */
function drawState(gl: WebGLRenderingContext) {
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.CULL_FACE);
  gl.colorMask(true, true, true, true);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

/** An icon's picture, as MaplibreView draws its own (roachIcons.ts imageSpec), and its copy with both sleeves up (null: none, a picture look) */
async function iconImages(id: string): Promise<[CanvasImageSource | null, CanvasImageSource | null]> {
  const [color, opts] = imageSpec(id);
  const plain = await drawRoach(color, opts, ICON_PX).catch(() => null);
  const up = usesPicture(opts) || opts.asleep ? null : await drawRoach(color, { ...opts, hands: true }, ICON_PX).catch(() => null);
  return [plain, up];
}

export type DimLayer = CustomLayerInterface & { free: () => void };

/** The map darkened, one square over the whole view */
export function dimLayer(now: () => DanceNow, onFail: (why: string) => void): DimLayer {
  let gl: WebGLRenderingContext | null = null;
  let vao: Vao | null = null;
  let vaoObj: unknown = null;
  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  let failed = false;
  const fail = (e: unknown) => {
    if (failed) return;
    failed = true;
    window.setTimeout(() => onFail(e instanceof Error ? e.message : "dim"), 0);
  };
  return {
    id: "disco-dim",
    type: "custom",
    renderingMode: "2d",
    onAdd(_m, g) {
      gl = g as WebGLRenderingContext;
      try {
        vao = vaoOf(gl);
        if (!vao) throw new Error("no vertex arrays");
        const was = saveState(gl, vao);
        prog = program(gl, DIM_VERT, DIM_FRAG);
        loc = locations(gl, prog, ["uDim"]);
        vaoObj = vao.create();
        vao.bind(vaoObj);
        buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
        const a = gl.getAttribLocation(prog, "aCorner");
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 8, 0);
        restoreState(gl, vao, was);
      } catch (e) {
        fail(e);
      }
    },
    render(g) {
      const n = now();
      if (failed || !prog || !vao || n.dim <= 0.002) return;
      const ctx = g as WebGLRenderingContext;
      try {
        drawState(ctx);
        ctx.useProgram(prog);
        vao.bind(vaoObj);
        ctx.uniform1f(loc.uDim, n.dim);
        ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
        vao.bind(null);
      } catch (e) {
        fail(e);
      }
    },
    onRemove() {
      this.free();
    },
    free() {
      if (gl && !gl.isContextLost()) {
        if (prog) gl.deleteProgram(prog);
        if (buf) gl.deleteBuffer(buf);
        if (vao && vaoObj) vao.remove(vaoObj);
      }
      prog = null;
      buf = null;
      vaoObj = null;
      gl = null;
    },
  };
}

export type DanceLayer = CustomLayerInterface & {
  /** The roaches to dance (seq: which list), drawn from the next frame on */
  setDancers: (list: readonly DiscoRoach[], seq: number) => void;
  /** Whether the dancers are drawn (the roaches' own layers then see-through, MaplibreStage.hold) */
  setDrawn: (on: boolean) => void;
  /** Every icon of the dancers on the GPU, so they can stand in for the roaches' own layers */
  ready: () => boolean;
  free: () => void;
};

/** Every roach dancing, the lights at their feet first */
export function danceLayer(now: () => DanceNow, onFail: (why: string) => void): DanceLayer {
  let map: MaplibreMap | null = null;
  let gl: WebGLRenderingContext | null = null;
  let vao: Vao | null = null;
  let danceVao: unknown = null;
  let lightVao: unknown = null;
  let dance: WebGLProgram | null = null;
  let light: WebGLProgram | null = null;
  let danceLoc: Record<string, WebGLUniformLocation | null> = {};
  let lightLoc: Record<string, WebGLUniformLocation | null> = {};
  let buf: WebGLBuffer | null = null;
  let tex: WebGLTexture | null = null;
  let failed = false;
  let drawn = false;
  let list: readonly DiscoRoach[] = [];
  /** The icons the list wears, each once */
  let icons: string[] = [];
  let listSeq = -1;
  /** The context's largest point (px), and the map's width in CSS px: read when the layer is added and on a resize */
  let maxPx = 4096;
  let cssWidth = 1;
  let origin: [number, number] = [0.5, 0.5];
  let dirty = true;
  let count = 0;
  // the atlas: each icon's cell, the picture of them all until it is on the GPU, and whether it has the sleeves-up copies
  let cells = new Map<string, number>();
  let atlas: HTMLCanvasElement | null = null;
  let atlasSeq = 0;
  let texReady = false;
  let hands = false;
  let handsBuilt = false;

  const fail = (e: unknown) => {
    if (failed) return;
    failed = true;
    window.setTimeout(() => onFail(e instanceof Error ? e.message : "dance"), 0);
  };

  /** All the dancers' icons in one picture: on the GPU with the next frame */
  const build = async (ids: string[]) => {
    const seq = ++atlasSeq;
    const withHands = ids.length <= HANDS_AT;
    const imgs = await Promise.all(ids.map((id) => iconImages(id).catch((): [null, null] => [null, null])));
    if (failed || seq !== atlasSeq) return;
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const g = canvas.getContext("2d");
    if (!g) return fail(new Error("no 2d canvas"));
    const m = (CELL - INNER) / 2;
    const put = (img: CanvasImageSource | null, i: number) => {
      if (img && i < MAX_CELLS) g.drawImage(img, (i % COLS) * CELL + m, Math.floor(i / COLS) * CELL + m, INNER, INNER);
    };
    const next = new Map<string, number>();
    imgs.forEach(([plain, up], i) => {
      next.set(ids[i], i);
      put(plain, i);
      if (withHands) put(up ?? plain, i + HANDS_AT);
    });
    cells = next;
    handsBuilt = withHands;
    atlas = canvas;
    dirty = true;
    map?.triggerRepaint();
  };

  const upload = (g: WebGLRenderingContext) => {
    const data = new Float32Array(list.length * STRIDE);
    list.forEach((r, i) => {
      const [mx, my] = mercator(r.lng, r.lat);
      const o = i * STRIDE;
      data[o] = mx - origin[0];
      data[o + 1] = my - origin[1];
      data[o + 2] = cells.get(r.icon) ?? 0;
      data[o + 3] = cells.has(r.icon) ? 0 : -1;
      data[o + 4] = r.kind;
      data.set(danceTraits(r.seed), o + 5);
    });
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
    count = list.length;
    dirty = false;
  };

  const uploadAtlas = (g: WebGLRenderingContext) => {
    if (!atlas) return;
    // MapLibre's own setting is false (and set again before its next upload)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, atlas);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    atlas = null;
    texReady = true;
    hands = handsBuilt;
  };

  const measure = () => {
    if (map) cssWidth = Math.max(1, map.getCanvas().clientWidth);
  };

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
    id: "disco-dance",
    type: "custom",
    renderingMode: "2d",
    onAdd(m, g) {
      map = m;
      gl = g as WebGLRenderingContext;
      try {
        vao = vaoOf(gl);
        if (!vao) throw new Error("no vertex arrays");
        const was = saveState(gl, vao);
        const k = { crawl: false, kinds: true };
        const dp = program(gl, danceVert(k), DANCE_FRAG);
        const lp = program(gl, lightVert(k), LIGHT_FRAG);
        dance = dp;
        light = lp;
        const common = ["uMvp", "uViewport", "uDpr", "uSize", "uMaxPx", "uThinPow", "uMinePx", ...DANCE_NAMES];
        danceLoc = locations(gl, dp, [...common, "uTex"]);
        lightLoc = locations(gl, lp, [...common, "uLight", "uLightBeat", "uPulse", "uPal"]);
        buf = gl.createBuffer();
        const attrs = (p: WebGLProgram, names: [string, number, number][]) => {
          for (const [name, size, offset] of names) {
            const a = gl!.getAttribLocation(p, name);
            if (a < 0) continue;
            gl!.enableVertexAttribArray(a);
            gl!.vertexAttribPointer(a, size, gl!.FLOAT, false, STRIDE * 4, offset * 4);
          }
        };
        danceVao = vao.create();
        vao.bind(danceVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        attrs(dp, [
          ["aPos", 2, 0],
          ["aStyle", 1, 2],
          ["aThin", 1, 3],
          ["aKind", 1, 4],
          ["aDance", 3, 5],
        ]);
        lightVao = vao.create();
        vao.bind(lightVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        attrs(lp, [
          ["aPos", 2, 0],
          ["aThin", 1, 3],
          ["aKind", 1, 4],
          ["aDance", 3, 5],
        ]);
        tex = gl.createTexture();
        maxPx = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null)?.[1] || 4096;
        // added between MapLibre's frames, which would not know of what was bound here
        restoreState(gl, vao, was);
        const c = m.getCenter();
        origin = mercator(c.lng, c.lat);
        dirty = true;
        texReady = false;
        if (cells.size && !atlas) void build([...cells.keys()]);
        measure();
        m.on("moveend", reorigin);
        m.on("resize", measure);
      } catch (e) {
        fail(e);
      }
    },
    render(g, options: CustomRenderMethodInput) {
      const n = now();
      // the icons go up to the GPU before the dancers are drawn, so they are ready to stand in for the roaches
      if (failed || !map || !dance || !light || !vao || (!atlas && (!drawn || !list.length))) return;
      const ctx = g as WebGLRenderingContext;
      try {
        ctx.activeTexture(ctx.TEXTURE0);
        ctx.bindTexture(ctx.TEXTURE_2D, tex);
        if (atlas) uploadAtlas(ctx);
        vao.bind(danceVao);
        if (dirty) upload(ctx);
        if (drawn && texReady && count) {
          const zoom = map.getZoom();
          const w = ctx.drawingBufferWidth;
          const h = ctx.drawingBufferHeight;
          const mvp = placed(options.modelViewProjectionMatrix, 512 * 2 ** zoom, origin[0], origin[1]);
          const view = (loc: Record<string, WebGLUniformLocation | null>) => {
            ctx.uniformMatrix4fv(loc.uMvp, false, mvp);
            ctx.uniform2f(loc.uViewport, w, h);
            ctx.uniform1f(loc.uDpr, w / cssWidth);
            ctx.uniform1f(loc.uSize, iconPx(zoom));
            ctx.uniform1f(loc.uMaxPx, maxPx);
            ctx.uniform1f(loc.uThinPow, 0);
            ctx.uniform1f(loc.uMinePx, MINE_PX);
            danceUniforms(ctx, loc, n, hands ? HANDS_AT : 0);
          };
          drawState(ctx);
          if (n.light > 0.002) {
            ctx.useProgram(light);
            vao.bind(lightVao);
            view(lightLoc);
            ctx.uniform1f(lightLoc.uLight, n.light);
            ctx.uniform1f(lightLoc.uLightBeat, n.lightBeat);
            ctx.uniform1f(lightLoc.uPulse, n.pulse);
            ctx.uniform3fv(lightLoc.uPal, PALETTE_RGB);
            ctx.blendFunc(ctx.ONE, ctx.ONE);
            ctx.drawArrays(ctx.POINTS, 0, count);
            ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
          }
          ctx.useProgram(dance);
          vao.bind(danceVao);
          view(danceLoc);
          ctx.uniform1i(danceLoc.uTex, 0);
          ctx.drawArrays(ctx.POINTS, 0, count);
        }
        vao.bind(null);
      } catch (e) {
        fail(e);
      }
    },
    onRemove(m) {
      m.off("moveend", reorigin);
      m.off("resize", measure);
      this.free();
      map = null;
    },
    setDancers(next, seq) {
      if (seq === listSeq) return;
      listSeq = seq;
      list = next;
      dirty = true;
      icons = [...new Set(next.map((r) => r.icon))];
      if (icons.some((id) => !cells.has(id))) {
        // the icons already in it first, so each keeps its cell while the new picture is made
        const known = [...cells.keys()];
        void build([...known, ...icons.filter((id) => !cells.has(id))]);
      }
      map?.triggerRepaint();
    },
    setDrawn(on) {
      drawn = on;
      map?.triggerRepaint();
    },
    ready: () => !failed && texReady && !atlas && icons.every((id) => cells.has(id)),
    free() {
      if (gl && !gl.isContextLost()) {
        if (buf) gl.deleteBuffer(buf);
        if (tex) gl.deleteTexture(tex);
        if (dance) gl.deleteProgram(dance);
        if (light) gl.deleteProgram(light);
        if (vao && danceVao) vao.remove(danceVao);
        if (vao && lightVao) vao.remove(lightVao);
      }
      buf = null;
      tex = null;
      dance = null;
      light = null;
      danceVao = null;
      lightVao = null;
      gl = null;
    },
  };
}
