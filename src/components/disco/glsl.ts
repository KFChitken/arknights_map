/**
 * 听歌's disco on the GPU: the roaches dancing, the coloured lights at their feet and the map darkened under them, for
 * both maps' layers (amapDance.ts, maplibreDance.ts). A frame hands over a dozen numbers (dance.ts DanceNow), and each
 * roach works out its own move here. A point sprite cannot turn: each is drawn E times as big as its icon, and the icon
 * is turned, tilted and squashed inside it, about its feet, by turning where each pixel reads the picture.
 */

/** The atlas both layers read the icons from: as roachGl.ts lays its own out */
export const CELL = 96;
export const INNER = 84;
export const COLS = 21;
export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
/** How much bigger than its icon a dancing roach's point is, room for it to tilt and turn */
export const E = 1.6;
/** The site's six light colours */
export const PALETTE = ["#ff4fd8", "#3fd0ff", "#ffd23f", "#5be37d", "#b48cff", "#ff7a3d"] as const;
export const PALETTE_RGB = new Float32Array(PALETTE.flatMap((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)));

const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;";
const f = (n: number) => n.toFixed(5);

/** The frame's dance (DanceNow), as each program has it */
const DANCE_UNIFORMS = `
uniform float uBeat;
uniform float uFree;
uniform float uOn;
uniform float uMoveA;
uniform float uMoveB;
uniform float uMix;
uniform float uAmp;
uniform float uHands;
uniform float uHandsAt;
uniform float uDrop;`;

/**
 * bounce(): 舟友的酒's hop over a beat, squashed landing and stretched rising (height, width, how far up in icons).
 * pose(): a move at a beat (choreo.ts numbers them): a = (across, up, tilt in degrees), s = (width, height, turn in
 * degrees); 7 sways slowly on uFree, with no beat to it. wild(): the move a roach dances in 群魔乱舞 over the four bars
 * it is in, from its own two numbers (choreo.ts danceTraits), in whole numbers so every GPU picks alike.
 */
const SHARED = `
const float PI = 3.14159265;
float ease(float k) { return (1.0 - cos(PI * clamp(k, 0.0, 1.0))) * 0.5; }
float seg(float p, float a, float b, float va, float vb) { return va + (vb - va) * ease((p - a) / (b - a)); }
vec3 bounce(float p) {
  if (p < 0.1) return vec3(seg(p, 0.0, 0.1, 0.8, 0.94), seg(p, 0.0, 0.1, 1.18, 1.06), seg(p, 0.0, 0.1, 0.0, -2.0) / 64.0);
  if (p < 0.3) return vec3(seg(p, 0.1, 0.3, 0.94, 1.16), seg(p, 0.1, 0.3, 1.06, 0.9), seg(p, 0.1, 0.3, -2.0, -9.0) / 64.0);
  if (p < 0.52) return vec3(seg(p, 0.3, 0.52, 1.16, 1.03), seg(p, 0.3, 0.52, 0.9, 0.98), seg(p, 0.3, 0.52, -9.0, -6.0) / 64.0);
  if (p < 0.75) return vec3(seg(p, 0.52, 0.75, 1.03, 0.97), seg(p, 0.52, 0.75, 0.98, 1.02), seg(p, 0.52, 0.75, -6.0, -1.5) / 64.0);
  if (p < 0.92) return vec3(seg(p, 0.75, 0.92, 0.97, 1.05), seg(p, 0.75, 0.92, 1.02, 0.96), seg(p, 0.75, 0.92, -1.5, -0.3) / 64.0);
  return vec3(seg(p, 0.92, 1.0, 1.05, 0.8), seg(p, 0.92, 1.0, 0.96, 1.18), seg(p, 0.92, 1.0, -0.3, 0.0) / 64.0);
}
float whole6(float x) { return x - 6.0 * floor((x + 0.5) / 6.0); }
float wild(float m, vec2 w) { return (m > 5.5 && m < 6.5) ? whole6(w.x + w.y * floor(uBeat / 16.0)) : m; }
void pose(float m, float b, out vec3 a, out vec3 s) {
  float p = fract(b);
  vec3 bo = bounce(p);
  if (m > 6.5) {
    float w = sin(PI * uFree);
    a = vec3(0.07 * w, 0.0, 13.0 * w);
    s = vec3(1.0, 1.0, 0.0);
  } else if (m < 0.5) {
    float w = sin(PI * b);
    a = vec3(0.07 * w, bo.z * 0.35, 13.0 * w);
    s = vec3(mix(1.0, bo.y, 0.35), mix(1.0, bo.x, 0.35), 0.0);
  } else if (m < 1.5) {
    a = vec3(0.0, bo.z * 1.4, 4.0 * sin(PI * b));
    s = vec3(bo.y, bo.x, 0.0);
  } else if (m < 2.5) {
    float big = mod(floor(b), 2.0) < 0.5 ? 1.0 : 0.0;
    a = vec3(0.0, bo.z * mix(1.0, 3.4, big), 0.0);
    s = vec3(bo.y, bo.x, 0.0);
  } else if (m < 3.5) {
    a = vec3(0.0, bo.z * 2.2, 6.0 * sin(PI * b));
    s = vec3(bo.y, bo.x, 0.0);
  } else if (m < 4.5) {
    float c = mod(b, 8.0);
    a = vec3(0.0, bo.z * 1.2, 0.0);
    s = vec3(bo.y, bo.x, c < 2.0 ? 360.0 * ease(c / 2.0) : 0.0);
  } else {
    vec3 b2 = bounce(fract(b * 2.0));
    a = vec3(0.0, b2.z * 0.7, 9.0 * sin(PI * b));
    s = vec3(b2.y, mix(1.0, b2.x, 0.6), 0.0);
  }
}
// the wave reaches a roach later the further right it is on the screen (xN 0..1)
float waveBeat(float m, float xN) { return uBeat - (abs(m - 3.0) < 0.5 ? xN * 0.9 : 0.0); }`;

/** How the two maps' layers differ: 高德's roaches crawl and some lie asleep (roachGl's own buffer); OSM's have your own among them, drawn bigger */
export type Kind = { crawl: boolean; kinds: boolean };

const thinned = `if (aThin < 0.0 || (uThinPow > 0.0 && mod(floor(aThin / uThinPow), 2.0) < 0.5)) { ${HIDE} return; }`;
const sizeOf = (k: Kind) => (k.kinds ? "aKind > 0.5 ? uMinePx * (aKind > 1.5 ? 1.35 : 1.0) : uSize" : "uSize");

/**
 * The dancers. 高德's crawl (roachGl.ts VERT) fades out as the dance comes in; one lying asleep does neither. vStyle: the
 * icon's cell, its sleeves-up copy's (uHandsAt on) at the top of a climax's big jumps.
 */
export function danceVert(k: Kind) {
  return `
precision highp float;
attribute vec2 aPos;
attribute float aStyle;
attribute float aThin;
attribute vec3 aDance;
${k.crawl ? "attribute vec4 aCrawl;\nattribute float aCrawlY;" : ""}
${k.kinds ? "attribute float aKind;" : ""}
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uMaxPx;
uniform float uThinPow;
${k.crawl ? "uniform float uScale;\nuniform float uTime;\nuniform float uCrawl;" : ""}
${k.kinds ? "uniform float uMinePx;" : ""}
${DANCE_UNIFORMS}
varying float vStyle;
varying vec4 vXf;
varying float vBack;
${SHARED}
const float TAU = 6.2831853;
void main() {
  ${thinned}
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  float still = ${k.crawl ? "1.0 - step(0.0, aCrawlY)" : "0.0"};
  float on = uOn * (1.0 - still);
  float size = ${sizeOf(k)};
  vec2 off = vec2(0.0);
  ${
    k.crawl
      ? `float moving = uCrawl * (1.0 - still) * (1.0 - on);
  float t = uTime * aCrawl.y;
  float slowX = mod(t / 1400.0, TAU) + aCrawl.x;
  float slowY = mod(t * aCrawlY / 1400.0, TAU) + aCrawl.x * aCrawlY;
  float fastX = mod(t / aCrawl.z, TAU) + aCrawl.x * 3.0;
  float fastY = mod(t * 1.1 / aCrawl.z, TAU) + aCrawl.x * 3.3;
  off = moving * vec2(cos(slowX) * 2.2 * aCrawl.w + sin(fastX) * 0.5, sin(slowY) * 1.6 * aCrawl.w + cos(fastY) * 0.5) * uScale;`
      : ""
  }
  float mA = wild(uMoveA, aDance.xy);
  float mB = wild(uMoveB, aDance.xy);
  float xN = clamp((p.x / p.w + 1.0) * 0.5, 0.0, 1.0);
  vec3 a1; vec3 s1; vec3 a2; vec3 s2;
  pose(mA, waveBeat(mA, xN), a1, s1);
  pose(mB, waveBeat(mB, xN), a2, s2);
  vec3 A = mix(a1, a2, uMix);
  vec3 S = mix(s1, s2, uMix);
  A.y += bounce(fract(uBeat)).z * 2.6 * uDrop;
  float tilt = radians(A.z * uAmp * on);
  float sx = mix(1.0, mix(1.0, S.x, uAmp), on);
  float sy = mix(1.0, mix(1.0, S.y, uAmp), on);
  float ct = cos(radians(S.z * on));
  float sxt = sx * (ct < 0.0 ? -1.0 : 1.0) * max(0.12, abs(ct));
  off += A.xy * uAmp * size * on;
  // px (y down) to clip space
  p.xy += vec2(off.x, -off.y) * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  gl_PointSize = min(size * uDpr * ${f((E * CELL) / INNER)}, uMaxPx);
  float ph = fract(uBeat);
  float big = (abs(mB - 2.0) < 0.5 && mod(floor(uBeat), 2.0) < 0.5) ? 1.0 : 0.0;
  float up = (uHandsAt > 0.0 && uHands * on * big > 0.5 && uMix > 0.5 && ph > 0.12 && ph < 0.62) ? 1.0 : 0.0;
  vStyle = aStyle + up * uHandsAt;
  vXf = vec4(cos(tilt), sin(tilt), 1.0 / sxt, 1.0 / sy);
  vBack = ct < 0.0 ? on : 0.0;
}`;
}

/** A dancer's pixels: where in its icon each one reads, turned back about its feet; darker while it shows its back */
export const DANCE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
varying float vStyle;
varying vec4 vXf;
varying float vBack;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * ${f((E * CELL) / INNER)};
  vec2 d = q - vec2(0.0, 0.42);
  vec2 r = vec2(vXf.x * d.x + vXf.y * d.y, -vXf.y * d.x + vXf.x * d.y);
  vec2 u = vec2(r.x * vXf.z, r.y * vXf.w) + vec2(0.0, 0.42) + 0.5;
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) discard;
  float s = floor(vStyle + 0.5);
  vec2 cell = vec2(mod(s, ${COLS.toFixed(1)}), floor(s / ${COLS.toFixed(1)}));
  vec2 px = cell * ${CELL.toFixed(1)} + ${((CELL - INNER) / 2).toFixed(1)} + u * ${INNER.toFixed(1)};
  vec4 c = texture2D(uTex, px / vec2(${ATLAS_W.toFixed(1)}, ${ATLAS_H.toFixed(1)}));
  if (c.a < 0.02) discard;
  c.rgb *= 1.0 - 0.65 * vBack;
  gl_FragColor = c;
}`;

/**
 * The lights at the dancers' feet: the same points again, each a flat oval of one of the six colours, the next colour
 * each beat (uLightBeat), brightest on the beat (uPulse), smaller and fainter while its roach is up in the air
 */
export function lightVert(k: Kind) {
  return `
precision highp float;
attribute vec2 aPos;
attribute float aThin;
attribute vec3 aDance;
${k.crawl ? "attribute float aCrawlY;" : ""}
${k.kinds ? "attribute float aKind;" : ""}
uniform mat4 uMvp;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uSize;
uniform float uMaxPx;
uniform float uThinPow;
${k.kinds ? "uniform float uMinePx;" : ""}
${DANCE_UNIFORMS}
uniform float uLight;
uniform float uLightBeat;
uniform float uPulse;
uniform vec3 uPal[6];
varying vec3 vColor;
varying float vInt;
${SHARED}
void main() {
  ${thinned}
  vec4 p = uMvp * vec4(aPos, 0.0, 1.0);
  float still = ${k.crawl ? "1.0 - step(0.0, aCrawlY)" : "0.0"};
  float on = uOn * (1.0 - still);
  float size = ${sizeOf(k)};
  float mB = wild(uMoveB, aDance.xy);
  float xN = clamp((p.x / p.w + 1.0) * 0.5, 0.0, 1.0);
  vec3 a; vec3 s;
  pose(mB, waveBeat(mB, xN), a, s);
  float up = clamp(-a.y * uAmp * on * 3.0, 0.0, 0.6);
  vec2 off = vec2(a.x * uAmp * size * on, size * 0.42);
  p.xy += vec2(off.x, -off.y) * uDpr * 2.0 / uViewport * p.w;
  gl_Position = p;
  gl_PointSize = min(size * 1.15 * (1.0 - up * 0.5) * uDpr, uMaxPx);
  float idx = whole6(aDance.z + floor(uLightBeat));
  vec3 c = uPal[0];
  if (idx > 0.5) c = uPal[1];
  if (idx > 1.5) c = uPal[2];
  if (idx > 2.5) c = uPal[3];
  if (idx > 3.5) c = uPal[4];
  if (idx > 4.5) c = uPal[5];
  vColor = c;
  float ph = fract(uLightBeat);
  vInt = uLight * mix(1.0, 0.45 + 0.55 * (1.0 - ph) * (1.0 - ph), uPulse) * (1.0 - still * 0.8) * (1.0 - up);
}`;
}

/** Added to what is there (ONE, ONE): the colour only, the alpha left as it is */
export const LIGHT_FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vInt;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vec2(2.0, 6.6667);
  float a = (1.0 - smoothstep(0.25, 1.0, length(d))) * vInt;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 0.0);
}`;

/** The map darkened: one square over the whole view (aCorner -1..1), under everything of the layer */
export const DIM_VERT = `
precision highp float;
attribute vec2 aCorner;
varying vec2 vAt;
void main() {
  vAt = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

/**
 * Dark purple, lightest round where the ball hangs (30% down) and darker out to the edges, as the design's: dark enough
 * for the lights, not so dark that the roads and names are lost. uDim: how far darkened (0..1). Premultiplied.
 */
export const DIM_FRAG = `
precision mediump float;
uniform float uDim;
varying vec2 vAt;
void main() {
  float r = length((vAt - vec2(0.5, 0.7)) / vec2(1.2, 0.9));
  float a = mix(mix(0.5, 0.62, smoothstep(0.0, 0.7, r)), 0.7, smoothstep(0.7, 1.0, r)) * uDim;
  vec3 c = mix(mix(vec3(0.118, 0.047, 0.235), vec3(0.055, 0.024, 0.133), smoothstep(0.0, 0.7, r)), vec3(0.031, 0.016, 0.078), smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(c * a, a);
}`;

/** The dim's square, as a triangle strip */
export const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/** The uniforms every dance program has, by name */
export const DANCE_NAMES = ["uBeat", "uFree", "uOn", "uMoveA", "uMoveB", "uMix", "uAmp", "uHands", "uHandsAt", "uDrop"] as const;

/** The frame's dance, as the engine works it out (engine.ts) for every program */
export type DanceNow = {
  /** Beats since the first downbeat (choreo.ts), and the free sway's own clock */
  beat: number;
  free: number;
  /** How far danced (0: standing, crawling as ever; 1: dancing) */
  on: number;
  a: number;
  b: number;
  mix: number;
  amp: number;
  /** A climax: sleeves up at the top of the big jumps */
  hands: number;
  /** The climax's first beat: everyone hops */
  drop: number;
  /** The map darkened (0..1) */
  dim: number;
  /** The floor lights: how bright, their beat (a colour each), how much they flash on it */
  light: number;
  lightBeat: number;
  pulse: number;
};

export const STANDING: DanceNow = { beat: 0, free: 0, on: 0, a: 7, b: 7, mix: 1, amp: 0.55, hands: 0, drop: 0, dim: 0, light: 0, lightBeat: 0, pulse: 0 };

/** The dance's uniforms, as DANCE_NAMES has them */
export function danceUniforms(g: WebGLRenderingContext, loc: Record<string, WebGLUniformLocation | null>, n: DanceNow, handsAt: number) {
  g.uniform1f(loc.uBeat, n.beat);
  g.uniform1f(loc.uFree, n.free);
  g.uniform1f(loc.uOn, n.on);
  g.uniform1f(loc.uMoveA, n.a);
  g.uniform1f(loc.uMoveB, n.b);
  g.uniform1f(loc.uMix, n.mix);
  g.uniform1f(loc.uAmp, n.amp);
  g.uniform1f(loc.uHands, n.hands);
  g.uniform1f(loc.uHandsAt, handsAt);
  g.uniform1f(loc.uDrop, n.drop);
}

/** Uniform locations by name */
export const locations = (g: WebGLRenderingContext, p: WebGLProgram, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, g.getUniformLocation(p, n)])) as Record<string, WebGLUniformLocation | null>;
