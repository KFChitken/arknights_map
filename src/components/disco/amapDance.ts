import { program } from "@/components/map/glCommon";
import { type DanceFrame, GL_LAYOUT, type GlDance } from "@/components/map/roachGl";
import { danceTraits } from "./choreo";
import {
  CORNERS,
  DANCE_FRAG,
  DANCE_NAMES,
  type DanceNow,
  danceUniforms,
  danceVert,
  DIM_FRAG,
  DIM_VERT,
  LIGHT_FRAG,
  lightVert,
  locations,
  PALETTE_RGB,
} from "./glsl";

/**
 * 听歌's disco on the 高德 map, inside the roaches' own GPU layer (roachGl.ts setDance): each frame the map darkened, the
 * lights at the dancers' feet, then the dancers, all from the layer's own buffer of roaches with one small buffer of
 * this layer's beside it (each roach's part of the dance, choreo.ts danceTraits). Standing (now().on at 0) the layer
 * draws them as ever. onFail: the GPU would not do it, and the disco goes on with its lights.
 */
export function amapDance(now: () => DanceNow, onFail: (why: string) => void): GlDance & { free: () => void } {
  let gl: WebGLRenderingContext | null = null;
  let made: {
    dance: WebGLProgram;
    light: WebGLProgram;
    dim: WebGLProgram;
    danceLoc: Record<string, WebGLUniformLocation | null>;
    lightLoc: Record<string, WebGLUniformLocation | null>;
    dimLoc: Record<string, WebGLUniformLocation | null>;
    vao: DanceFrame["vao"];
    danceVao: unknown;
    lightVao: unknown;
    dimVao: unknown;
    traits: WebGLBuffer | null;
    corners: WebGLBuffer | null;
    /** The roaches' buffer the vertex arrays read, and the list whose traits are in the small one */
    over: WebGLBuffer | null;
    seq: number;
    count: number;
  } | null = null;
  let broken = false;

  const give = (why: unknown) => {
    broken = true;
    const w = why instanceof Error ? why.message : String(why);
    window.setTimeout(() => onFail(w), 0);
  };

  const make = (f: DanceFrame) => {
    const g = f.gl;
    const k = { crawl: true, kinds: false };
    const dance = program(g, danceVert(k), DANCE_FRAG);
    const light = program(g, lightVert(k), LIGHT_FRAG);
    const dim = program(g, DIM_VERT, DIM_FRAG);
    const traits = g.createBuffer();
    const corners = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, corners);
    g.bufferData(g.ARRAY_BUFFER, CORNERS, g.STATIC_DRAW);
    const S = GL_LAYOUT.stride * 4;
    const attr = (p: WebGLProgram, name: string, size: number, buf: WebGLBuffer | null, stride: number, offset: number) => {
      const a = g.getAttribLocation(p, name);
      if (a < 0) return;
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.enableVertexAttribArray(a);
      g.vertexAttribPointer(a, size, g.FLOAT, false, stride, offset * 4);
    };
    const danceVao = f.vao.create();
    f.vao.bind(danceVao);
    attr(dance, "aPos", 2, f.buf, S, GL_LAYOUT.pos);
    attr(dance, "aStyle", 1, f.buf, S, GL_LAYOUT.style);
    attr(dance, "aCrawl", 4, f.buf, S, GL_LAYOUT.crawl);
    attr(dance, "aCrawlY", 1, f.buf, S, GL_LAYOUT.crawlY);
    attr(dance, "aThin", 1, f.buf, S, GL_LAYOUT.thin);
    attr(dance, "aDance", 3, traits, 12, 0);
    const lightVao = f.vao.create();
    f.vao.bind(lightVao);
    attr(light, "aPos", 2, f.buf, S, GL_LAYOUT.pos);
    attr(light, "aCrawlY", 1, f.buf, S, GL_LAYOUT.crawlY);
    attr(light, "aThin", 1, f.buf, S, GL_LAYOUT.thin);
    attr(light, "aDance", 3, traits, 12, 0);
    const dimVao = f.vao.create();
    f.vao.bind(dimVao);
    attr(dim, "aCorner", 2, corners, 8, 0);
    const common = ["uMvp", "uViewport", "uDpr", "uSize", "uMaxPx", "uThinPow", ...DANCE_NAMES];
    made = {
      dance,
      light,
      dim,
      danceLoc: locations(g, dance, [...common, "uScale", "uTime", "uCrawl", "uTex"]),
      lightLoc: locations(g, light, [...common, "uLight", "uLightBeat", "uPulse", "uPal"]),
      dimLoc: locations(g, dim, ["uDim"]),
      vao: f.vao,
      danceVao,
      lightVao,
      dimVao,
      traits,
      corners,
      over: f.buf,
      seq: -1,
      count: 0,
    };
    gl = g;
  };

  /** Each roach's part of the dance, for the list the layer's buffer holds now */
  const traitsFor = (f: DanceFrame) => {
    const m = made!;
    if (m.seq === f.seq && m.count === f.count) return;
    const data = new Float32Array(f.count * 3);
    for (let i = 0; i < f.count && i < f.list.length; i++) data.set(danceTraits(f.list[i].seed), i * 3);
    const g = f.gl;
    g.bindBuffer(g.ARRAY_BUFFER, m.traits);
    g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
    m.seq = f.seq;
    m.count = f.count;
  };

  /** Ready for this frame: made on this context, over this buffer */
  const ready = (f: DanceFrame) => {
    if (broken) return false;
    try {
      if (!made || gl !== f.gl || made.over !== f.buf) make(f);
      traitsFor(f);
      return true;
    } catch (e) {
      give(e);
      return false;
    }
  };

  const view = (g: WebGLRenderingContext, loc: Record<string, WebGLUniformLocation | null>, f: DanceFrame, n: DanceNow) => {
    g.uniformMatrix4fv(loc.uMvp, false, f.mvp);
    g.uniform2f(loc.uViewport, f.w, f.h);
    g.uniform1f(loc.uDpr, f.dpr);
    g.uniform1f(loc.uSize, f.size);
    g.uniform1f(loc.uMaxPx, f.maxPoint || 4096);
    g.uniform1f(loc.uThinPow, f.thinPow);
    danceUniforms(g, loc, n, f.handsAt);
  };

  return {
    under(f) {
      if (!ready(f)) return;
      const g = f.gl;
      const m = made!;
      const n = now();
      try {
        if (n.dim > 0.002) {
          g.useProgram(m.dim);
          f.vao.bind(m.dimVao);
          g.uniform1f(m.dimLoc.uDim, n.dim);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
        }
        if (!f.piles && f.count && n.light > 0.002) {
          g.useProgram(m.light);
          f.vao.bind(m.lightVao);
          view(g, m.lightLoc, f, n);
          g.uniform1f(m.lightLoc.uLight, n.light);
          g.uniform1f(m.lightLoc.uLightBeat, n.lightBeat);
          g.uniform1f(m.lightLoc.uPulse, n.pulse);
          g.uniform3fv(m.lightLoc.uPal, PALETTE_RGB);
          // added to what is there; back to premultiplied colour over it after
          g.blendFunc(g.ONE, g.ONE);
          g.drawArrays(g.POINTS, 0, f.count);
          g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
        }
      } catch (e) {
        give(e);
      }
    },
    roaches(f) {
      const n = now();
      if (n.on <= 0.001 || !ready(f) || !f.count) return false;
      const g = f.gl;
      const m = made!;
      try {
        g.useProgram(m.dance);
        f.vao.bind(m.danceVao);
        view(g, m.danceLoc, f, n);
        g.uniform1f(m.danceLoc.uScale, f.size / 24);
        g.uniform1f(m.danceLoc.uTime, f.time);
        g.uniform1f(m.danceLoc.uCrawl, f.crawling ? 1 : 0);
        g.uniform1i(m.danceLoc.uTex, 0);
        g.drawArrays(g.POINTS, 0, f.count);
        return true;
      } catch (e) {
        give(e);
        return false;
      }
    },
    lost() {
      made = null;
      gl = null;
    },
    /** All it made let go of, on the context it was made on while that still is */
    free() {
      const g = gl;
      const m = made;
      made = null;
      gl = null;
      if (!g || !m || g.isContextLost()) return;
      for (const p of [m.dance, m.light, m.dim]) g.deleteProgram(p);
      g.deleteBuffer(m.traits);
      g.deleteBuffer(m.corners);
      for (const v of [m.danceVao, m.lightVao, m.dimVao]) m.vao.remove(v);
    },
  };
}
