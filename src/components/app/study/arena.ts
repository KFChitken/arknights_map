"use client";

/**
 * The field the games that move the player's roach about are played on (Catch325.tsx, and the tracing game after it):
 * a canvas kept sharp at the screen's pixel ratio, a frame loop whose clock stands still while the page is put away, the
 * player's roach drawn standing and belly up, the obstacles drawn by hand (src/lib/study/field.ts), and a finger, the
 * mouse or the arrow keys moving it. Places and sizes in the games are in field widths, so a field plays the same on any
 * screen. Nothing drawn on it flashes.
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import { drawRoach } from "@/lib/roachImages";
import type { Obstacle } from "@/lib/study/field";
import type { Look } from "./games";

/** A canvas's size in CSS pixels, and the pixel ratio it is drawn at */
export type Size = { w: number; h: number; dpr: number };

/**
 * Keeps a canvas as many pixels as its box at the screen's pixel ratio, so it is sharp. Returns the box's size (0 by 0
 * until it is laid out); to draw in CSS pixels, setTransform(dpr, 0, 0, dpr, 0, 0) first.
 */
export function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      setSize((s) => (s.w === w && s.h === h && s.dpr === dpr ? s : { w, h, dpr }));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(canvas);
    return () => watch.disconnect();
  }, [ref]);
  return size;
}

/**
 * Calls frame(dt) at every screen refresh while on, dt the ms since the one before (at most 50, so a stall is not a
 * jump). While the page is put away it stops, and it goes on from where it was when the page is back.
 */
export function useFrames(on: boolean, frame: (dt: number) => void) {
  const call = useRef(frame);
  call.current = frame;
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(50, Math.max(0, now - last)) : 0;
      last = now;
      raf = requestAnimationFrame(tick);
      call.current(dt);
    };
    const start = () => {
      if (raf || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [on]);
}

/** The player's roach drawn standing and belly up, each px pixels square; null until drawn */
export function useRoachArt(look: Look, px: number): { stand: HTMLCanvasElement | null; belly: HTMLCanvasElement | null } {
  const [art, setArt] = useState<{ stand: HTMLCanvasElement | null; belly: HTMLCanvasElement | null }>({ stand: null, belly: null });
  const { color, avatar, style } = look;
  useEffect(() => {
    if (px < 8) return;
    let live = true;
    const opts = { avatar, look: style };
    Promise.all([drawRoach(color, opts, px), drawRoach(color, { ...opts, asleep: true }, px)]).then(
      ([stand, belly]) => live && setArt({ stand, belly }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [color, avatar, style, px]);
  return art;
}

/**
 * Where a finger or the mouse is on an element while it is pressed there (x, y in the element's CSS pixels; down
 * false when it is let go), until it is let go, even off the element. The page does not scroll, zoom or open a menu
 * under it: the element is also touch-action: none in the style sheet, and iOS's own pinch is stopped here.
 */
export function useDrag(ref: RefObject<HTMLElement | null>, on: boolean, move: (x: number, y: number, down: boolean) => void) {
  const call = useRef(move);
  call.current = move;
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    let held: number | null = null;
    const tell = (e: PointerEvent, down: boolean) => {
      const box = el.getBoundingClientRect();
      call.current(e.clientX - box.left, e.clientY - box.top, down);
    };
    const onDown = (e: PointerEvent) => {
      if (held !== null || e.button > 0) return;
      held = e.pointerId;
      try {
        // kept on the element off its edge; a pointer already gone cannot be
        el.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
      tell(e, true);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === held) tell(e, true);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      held = null;
      tell(e, false);
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", stop);
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", stop);
      el.removeEventListener("gesturestart", stop);
    };
  }, [ref, on]);
}

/** Which way the arrow keys held point while on: −1 left, 1 right, 0 neither (or both) */
export function useArrows(on: boolean): RefObject<number> {
  const dir = useRef(0);
  useEffect(() => {
    if (!on) return;
    const held = new Set<string>();
    const set = () => {
      dir.current = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      held.add(e.key);
      set();
    };
    const onUp = (e: KeyboardEvent) => {
      held.delete(e.key);
      set();
    };
    const onBlur = () => {
      held.clear();
      set();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      dir.current = 0;
    };
  }, [on]);
  return dir;
}

/** Whether motion is turned down, as the round starts */
export const calmNow = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** An obstacle, about 2r across, centred on x, y; heading: a paper plane's, in radians (0 is to the right) */
export function drawObstacle(ctx: CanvasRenderingContext2D, what: Obstacle, x: number, y: number, r: number, heading = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (what === "bomb") bomb(ctx, r);
  else if (what === "plane") plane(ctx, r, heading);
  else slug(ctx, r);
  ctx.restore();
}

const INK = "#1b1d22";

function bomb(ctx: CanvasRenderingContext2D, r: number) {
  // the fuse, out of a cap at the top right, and its spark: still, not flickering
  ctx.strokeStyle = "#8a6a3a";
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.moveTo(r * 0.42, -r * 0.42);
  ctx.quadraticCurveTo(r * 0.62, -r * 0.92, r * 0.9, -r * 0.82);
  ctx.stroke();
  star(ctx, r * 0.9, -r * 0.82, r * 0.26, "#ffb020");
  star(ctx, r * 0.9, -r * 0.82, r * 0.12, "#fff2b8");
  ctx.fillStyle = "#4a4f58";
  ctx.save();
  ctx.translate(r * 0.4, -r * 0.4);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-r * 0.2, -r * 0.13, r * 0.4, r * 0.26);
  ctx.restore();
  ctx.fillStyle = "#26282e";
  ctx.beginPath();
  ctx.arc(-r * 0.04, r * 0.1, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, -r * 0.18, r * 0.2, r * 0.11, -0.7, 0, Math.PI * 2);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const d = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

function plane(ctx: CanvasRenderingContext2D, r: number, heading: number) {
  ctx.rotate(heading);
  // a dart, nose first; its near wing a shade darker, folded down the middle
  ctx.strokeStyle = "#5b6270";
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.85, -r * 0.72);
  ctx.lineTo(-r * 0.42, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#d9dde4";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.42, 0);
  ctx.lineTo(-r * 0.85, r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function slug(ctx: CanvasRenderingContext2D, r: number) {
  // a round little slug facing left, a dark crystal on its back with an orange face
  ctx.strokeStyle = "#a85d2c";
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.fillStyle = "#f4ad74";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.22, r * 0.92, r * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e48f53";
  ctx.beginPath();
  ctx.ellipse(r * 0.05, r * 0.58, r * 0.7, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2e2a33";
  ctx.beginPath();
  ctx.moveTo(r * 0.08, -r * 0.82);
  ctx.lineTo(r * 0.5, -r * 0.42);
  ctx.lineTo(r * 0.4, r * 0.02);
  ctx.lineTo(-r * 0.1, r * 0.02);
  ctx.lineTo(-r * 0.26, -r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff9a3c";
  ctx.beginPath();
  ctx.moveTo(r * 0.08, -r * 0.82);
  ctx.lineTo(r * 0.5, -r * 0.42);
  ctx.lineTo(r * 0.16, -r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  for (const ex of [-r * 0.62, -r * 0.36]) {
    ctx.beginPath();
    ctx.arc(ex, r * 0.18, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
}
