import type { AMapNS } from "@/lib/amap";

/**
 * What the GPU layers on the 高德 map (roachGl.ts, swarmGl.ts) share. They draw with 高德's own WebGL
 * context inside its frame (AMap.GLCustomLayer), so each borrows the context's state and hands it back
 * exactly as it found it, and places its points with 高德's own coordinates (map.customCoords).
 */

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
  return sh;
}

/** A linked program, or an error to fall back on */
export function program(gl: WebGLRenderingContext, vert: string, frag: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

export type Vao = {
  create: () => unknown;
  bind: (v: unknown) => void;
  current: () => unknown;
  remove: (v: unknown) => void;
};

const isGl2 = (gl: WebGLRenderingContext): gl is WebGL2RenderingContext =>
  typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

/** Vertex arrays, so a layer's attributes never touch 高德's own */
export function vaoOf(gl: WebGLRenderingContext): Vao | null {
  if (isGl2(gl)) {
    return {
      create: () => gl.createVertexArray(),
      bind: (v) => gl.bindVertexArray(v as WebGLVertexArrayObject | null),
      current: () => gl.getParameter(gl.VERTEX_ARRAY_BINDING),
      remove: (v) => gl.deleteVertexArray(v as WebGLVertexArrayObject | null),
    };
  }
  const ext = gl.getExtension("OES_vertex_array_object");
  if (!ext) return null;
  return {
    create: () => ext.createVertexArrayOES(),
    bind: (v) => ext.bindVertexArrayOES(v as WebGLVertexArrayObjectOES | null),
    current: () => gl.getParameter(ext.VERTEX_ARRAY_BINDING_OES),
    remove: (v) => ext.deleteVertexArrayOES(v as WebGLVertexArrayObjectOES | null),
  };
}

/**
 * 高德's 2D camera (customCoords.getCameraParams) as one matrix: column-major [left..right] × [bottom..top]
 * × [near..far] orthographic projection, times the turn of the map about z, times the move to the camera
 */
export function mvpOf(p: AMapNS) {
  const { left: l, right: r, top: t, bottom: b, near: n, far: f } = p;
  const pos = Array.isArray(p.position) ? p.position : [p.position?.x ?? 0, p.position?.y ?? 0, p.position?.z ?? 0];
  const [px, py, pz] = [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
  const a = (-(Number(p.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = 2 / (r - l);
  const sy = 2 / (t - b);
  const sz = -2 / (f - n);
  const m = new Float32Array(16);
  m[0] = sx * c;
  m[1] = sy * s;
  m[4] = -sx * s;
  m[5] = sy * c;
  m[10] = sz;
  m[12] = sx * (-c * px + s * py) - (r + l) / (r - l);
  m[13] = sy * (-s * px - c * py) - (t + b) / (t - b);
  m[14] = -sz * pz - (f + n) / (f - n);
  m[15] = 1;
  return m;
}

/** Where a point at (x, y) metres from the origin is on the map's container, in CSS px, with the frame's matrix */
export function onScreen(m: Float32Array, x: number, y: number, width: number, height: number) {
  return { x: ((m[0] * x + m[4] * y + m[12] + 1) / 2) * width, y: ((1 - (m[1] * x + m[5] * y + m[13])) / 2) * height };
}

/** Points in metres from the origin, from 高德 itself so they sit exactly where it draws the map */
export function coordsOf(cc: AMapNS, origin: [number, number], lngLats: [number, number][]) {
  cc.setCenter(origin);
  const xy = new Float64Array(lngLats.length * 2);
  if (!lngLats.length) return xy;
  const coords: AMapNS[] = cc.lngLatsToCoords(lngLats);
  coords.forEach((c, i) => {
    xy[i * 2] = Array.isArray(c) ? c[0] : c.x;
    xy[i * 2 + 1] = Array.isArray(c) ? c[1] : c.y;
  });
  return xy;
}

/** How far (metres) the middle of the view is from an origin */
export function offFrom(map: AMapNS, cc: AMapNS, origin: [number, number]) {
  const c = map.getCenter();
  cc.setCenter(origin);
  const [d] = cc.lngLatsToCoords([[c.getLng(), c.getLat()]]);
  return Math.hypot(Array.isArray(d) ? d[0] : d.x, Array.isArray(d) ? d[1] : d.y);
}

export type GlState = ReturnType<typeof saveState>;

/** Everything a layer may change in 高德's state during its frame */
export function saveState(gl: WebGLRenderingContext, vao: Vao) {
  const gl2 = isGl2(gl) ? gl : null;
  const unit = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0);
  return {
    program: gl.getParameter(gl.CURRENT_PROGRAM),
    vao: vao.current(),
    buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
    unit,
    texture: gl.getParameter(gl.TEXTURE_BINDING_2D),
    // a WebGL 2 sampler object on unit 0 would override the layers' own filtering
    sampler: gl2 ? gl2.getParameter(gl2.SAMPLER_BINDING) : null,
    blend: gl.isEnabled(gl.BLEND),
    depth: gl.isEnabled(gl.DEPTH_TEST),
    stencil: gl.isEnabled(gl.STENCIL_TEST),
    scissor: gl.isEnabled(gl.SCISSOR_TEST),
    cull: gl.isEnabled(gl.CULL_FACE),
    src: gl.getParameter(gl.BLEND_SRC_RGB),
    dst: gl.getParameter(gl.BLEND_DST_RGB),
    srcA: gl.getParameter(gl.BLEND_SRC_ALPHA),
    dstA: gl.getParameter(gl.BLEND_DST_ALPHA),
    eq: gl.getParameter(gl.BLEND_EQUATION_RGB),
    eqA: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
    clear: gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array,
  };
}

/** The usual setting for a layer's drawing: premultiplied colour over what is there, nothing else in the way */
export function layerState(gl: WebGLRenderingContext, s: GlState) {
  if (s.sampler) (gl as WebGL2RenderingContext).bindSampler(0, null);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.CULL_FACE);
  gl.colorMask(true, true, true, true);
}

export function restoreState(gl: WebGLRenderingContext, vao: Vao, s: GlState) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer);
  gl.activeTexture(gl.TEXTURE0);
  if (s.sampler) (gl as WebGL2RenderingContext).bindSampler(0, s.sampler);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  gl.activeTexture(s.unit);
  vao.bind(s.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.buffer);
  gl.useProgram(s.program);
  if (s.blend) gl.enable(gl.BLEND);
  else gl.disable(gl.BLEND);
  gl.blendFuncSeparate(s.src, s.dst, s.srcA, s.dstA);
  gl.blendEquationSeparate(s.eq, s.eqA);
  if (s.depth) gl.enable(gl.DEPTH_TEST);
  if (s.stencil) gl.enable(gl.STENCIL_TEST);
  if (s.scissor) gl.enable(gl.SCISSOR_TEST);
  if (s.cull) gl.enable(gl.CULL_FACE);
  gl.colorMask(s.mask[0], s.mask[1], s.mask[2], s.mask[3]);
  gl.clearColor(s.clear[0], s.clear[1], s.clear[2], s.clear[3]);
  gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3]);
}
