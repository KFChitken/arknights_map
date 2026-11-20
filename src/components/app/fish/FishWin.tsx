"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { fmt, T } from "@/i18n";
import { CASTS_A_DAY } from "@/lib/fish/rules";
import type { RoachStyle } from "@/lib/types";
import { usePondView } from "../squad/SquadPond";
import { useSquadRoom } from "../squad/squading";
import { squadDing, useSquadMuted } from "../squad/squadSound";
import Fish, { type PondView } from "./Fish";
import { boxOf, dragOf, dropOf, goesOnLeaving, NO_PLACE, sceneOf, TAP_PX, WIDE, type Place } from "./winPlace";
import { bigFishWin, dropFishWin, hideFishWin, setFishLine, smallFishWin, useFishWin } from "./winStore";
import "./fish.css";

/**
 * 钓鳞's small window (the design's FishWin and FishWinPhone): over the map, never in its way (the map moves and taps
 * as before), above the bars, sheets and drawers, under the dialogs that must be answered and the toast. Dragged by its
 * title bar anywhere in the page and kept there, each device its own (localStorage); a computer's opens first at the
 * bottom right, with a word above it till it is first dragged; a phone's sits against the left or right edge, between
 * the search bar and the bars at the foot. – makes it small: a strip on a computer, a ball against the edge on a phone,
 * dragged as well, bitten yellow and shaking, a tap opening it again (and pulling at the bite). ✕ only hides it: the
 * line stays in the water, and 咕咚 is still heard. Where it stands is worked out in winPlace.ts.
 *
 * Which scene: the line's while one is in the water, else 卫戍池塘 in a room of 一起卫戍 and the bank out of one. A
 * room joined or left with a line in the water: a yellow bar says the scene changes once this line is done, and it
 * does then, with a word over it; out of a room with no 钓鳞 of one's own (FISH), it goes once its line is done.
 */

const PLACE_KEY = "fish.win";
function readPlace(): Place {
  try {
    const v = JSON.parse(window.localStorage.getItem(PLACE_KEY) ?? "null") as Partial<Place> | null;
    return { pc: v?.pc ?? null, phone: v?.phone ?? null, dragged: Boolean(v?.dragged) };
  } catch {
    return NO_PLACE;
  }
}
function keepPlace(p: Place) {
  try {
    window.localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  } catch {
    // remembered for no longer than the page
  }
}

/** The page's size, as it changes */
function useViewport() {
  const [size, setSize] = useState(() => (typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/** 卫戍池塘 with the line still in it once one has left the room: the pond alone */
const BARE_POND: PondView = { seats: [], flags: [], fire: false, school: false, fishing: "", schoolBadge: null, tally: "", toast: null };

export default function FishWin({
  look,
  holder,
  fishOk,
  onRefused,
  onPasses,
}: {
  look: { color: string; avatar: string; style?: RoachStyle };
  holder: string;
  /** The bank is open to the player (FISH): else the window is 卫戍池塘's alone */
  fishOk: boolean;
  onRefused: (e: unknown) => void;
  onPasses: (p: { tickets: number; dot: boolean }) => void;
}) {
  const win = useFishWin();
  const room = useSquadRoom();
  const inRoom = Boolean(room);
  const pondNow = usePondView();
  const muted = useSquadMuted();
  const vp = useViewport();
  const wide = vp.w >= WIDE;
  const [place, setPlace] = useState<Place>(readPlace);
  // a drag on its way: where it started, where the window was, and whether it moved yet
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const tapRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { scene, pending } = sceneOf(win.line, inRoom);
  // a scene changed while the window shows: said over it a moment (and no more once it is hidden)
  const was = useRef(scene);
  useEffect(() => {
    if (win.mode === "hidden") setNotice(null);
    if (was.current === scene) return;
    was.current = scene;
    if (win.mode !== "hidden") setNotice(scene === "pond" ? T.fish.win.inPond : T.fish.win.inPier);
  }, [scene, win.mode]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2_600);
    return () => window.clearTimeout(t);
  }, [notice]);
  // out of the room with the bank not open to them: gone once its line is done
  useEffect(() => {
    if (goesOnLeaving({ kept: win.kept, fishOk, inRoom, line: win.line })) dropFishWin();
  }, [win.kept, fishOk, inRoom, win.line]);

  if (!win.kept) return null;
  const small = win.mode === "small";
  const pond = scene === "pond" ? (pondNow ?? BARE_POND) : undefined;
  const winLook = { wide, small, inRoom };
  const box = boxOf(vp, place, winLook, dragX);

  const down = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button") && !(e.currentTarget as HTMLElement).classList.contains("fw-ball")) return;
    drag.current = { px: e.clientX, py: e.clientY, x: box.left, y: box.top, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) <= TAP_PX) return;
    d.moved = true;
    const next = dragOf(vp, place, winLook, d, dx, dy);
    setPlace(next.place);
    setDragX(next.dragX);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // the ball, tapped: opened (and the pull, at the bite)
    if (!d.moved) {
      if (small && !wide) tapRef.current?.();
      return;
    }
    const next = dropOf(vp, place, winLook, box);
    setDragX(null);
    setPlace(next);
    keepPlace(next);
  };
  const drags = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  const title = scene === "pond" ? T.fish.pond.title : T.fish.title;
  const sub = scene === "pond" ? (pondNow?.fishing ?? "") : T.fish.place;
  const style: CSSProperties = { left: box.left, top: box.top, width: box.w };
  const fish = (
    <Fish
      key="fish"
      look={look}
      pond={pond}
      holder={holder}
      view={small ? "small" : "open"}
      awake={win.mode === "open"}
      phone={!wide}
      pending={pending}
      notice={notice}
      onRefused={onRefused}
      onPasses={onPasses}
      onLine={setFishLine}
      onBite={() => {
        // 卫戍池塘's out loud as before; the bank's when the window is put away
        if (!muted && (scene === "pond" || win.mode !== "open")) squadDing();
      }}
      onExpand={bigFishWin}
      tapRef={tapRef}
    />
  );
  return (
    <>
      <div
        className={`fish-root fish-win ${wide ? "pc" : "phone"}${small ? (wide ? " strip" : " fw-ball") : ""}${box.atLeft ? " at-left" : ""}${win.bite ? " bite" : ""}${win.line ? " lined" : ""}${dragX !== null ? " dragging" : ""}`}
        style={style}
        hidden={win.mode === "hidden"}
        role="dialog"
        aria-label={title}
        {...(small && !wide ? drags : {})}
      >
        {!small && (
          <div className="fw-bar" {...drags} aria-label={T.fish.win.drag}>
            <span className="grip" aria-hidden="true">
              ⋮⋮
            </span>
            <b>{title}</b>
            <small>{sub}</small>
            {wide && win.casts !== null && <span className="casts">{fmt(T.fish.win.casts, { n: win.casts, max: CASTS_A_DAY })}</span>}
            <button type="button" className="tb" onClick={smallFishWin} aria-label={T.fish.win.small}>
              –
            </button>
            <button type="button" className="tb" onClick={hideFishWin} aria-label={T.fish.win.close}>
              ✕
            </button>
          </div>
        )}
        {small && wide && (
          <span className="grip strip-grip" {...drags} aria-label={T.fish.win.drag}>
            ⋮⋮
          </span>
        )}
        {fish}
      </div>
      {wide && !small && win.mode === "open" && !place.dragged && (
        <span className="fw-hint" style={{ left: box.left + 10, top: Math.max(0, box.top - 28) }}>
          {T.fish.win.hint} ↓
        </span>
      )}
    </>
  );
}
