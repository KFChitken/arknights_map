/**
 * Whether this browser lets the page draw with the graphics card (WebGL), which every map here needs: ours
 * (MapLibre), 高德's and 腾讯's. Some browsers never do, and Chrome and the browsers built on it stop letting a
 * site do so once its page was open when the graphics card hung or reset, until the browser is closed and
 * opened again (2026-11-15: a map that cannot start took the whole page down, which then showed black on every
 * visit).
 */
export function webglWorks(): boolean {
  for (const kind of ["webgl2", "webgl"] as const) {
    try {
      // a canvas of its own for each: one that was asked for a context and given none keeps no mode
      const gl = document.createElement("canvas").getContext(kind) as WebGLRenderingContext | null;
      if (!gl) continue;
      // let it go at once: a page may hold only so many, and the map makes its own
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch {
      // a browser that throws instead of answering null: the next kind, or none
    }
  }
  return false;
}

/**
 * Tell onLost when what a map drew is lost (a graphics card that hung or reset takes every WebGL drawing on the
 * page with it), for any canvas inside el, the maps' own included: their events do not bubble, so they are heard
 * on the way down. A map taken off the page loses its drawing too, but only once its canvas is out of the page,
 * where nothing inside el hears of it. Returns the undo.
 */
export function onDrawingLost(el: HTMLElement, onLost: () => void) {
  const lost = (e: Event) => {
    if (e.target instanceof HTMLCanvasElement && e.target.isConnected) onLost();
  };
  el.addEventListener("webglcontextlost", lost, true);
  return () => el.removeEventListener("webglcontextlost", lost, true);
}
