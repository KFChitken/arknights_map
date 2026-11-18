"use client";

import { useEffect, useRef } from "react";
import { offerRoomFar, stageNow, type FarFrame, type MapCamera } from "@/components/map/discoStage";
import { fmt, T } from "@/i18n";
import type { ListenRoom } from "@/lib/listen";
import { farPeople, farView, freeFrames, sameView, type FarPerson, type Rect } from "@/lib/listenFar";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { GLOW, roachDataUrl } from "@/lib/roachSvg";
import type { LngLat, MapView } from "@/lib/types";
import type { Friend } from "@/lib/world/types";
import { readSpot } from "./listenSpot";
import "./listenFar.css";

/** Flying out, framing again (someone came or went, the buttons moved), flying back (ms) */
const OUT_MS = 1600;
const AGAIN_MS = 900;
const BACK_MS = 1200;
/** Framing a few close together, never in closer than this */
const MOST_ZOOM = 15;
/** The buttons, the stage's edge and the frame looked at again this often (ms) */
const LOOK_MS = 500;
/** A note takes this many beats from the host to each */
const TRAVEL = 3.5;
/** The frame clear of the edge the stage stands on (listenSpot.ts) by this much more; the line at the bottom left over it, and in (px) */
const OVER_EDGE = 20;
const LINE_UP = 10;
const LINE_IN = 12;
/** The notes fade in over this long once the map has landed (ms) */
const NOTES_MS = 400;
/** Not framed again for this long after a hand on the map (ms): never pulled from under a finger */
const HAND_MS = 2000;
/** What the frame keeps clear of: the buttons of each layout over the map, 💬 and 舞台 | 拉远, the player, the map's own */
const IN_THE_WAY = [
  ".chrome .glass",
  "[data-chrome-top]",
  "[data-chrome-side]",
  "[data-chrome-bottom]",
  ".lm-chat",
  ".lm-strip",
  ".lf-mode",
  ".sq-bar",
  ".listen-float",
  ".maplibregl-ctrl-group",
].join(", ");
/** A hand on the map */
const HANDS = ["pointerdown", "wheel", "touchstart"] as const;
const COLORS = ["#ff4fd8", "#3fd0ff", "#ffd23f"];
const FONT = "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
const LABEL = `700 11px ${FONT}`;
const SMALL = `600 11px ${FONT}`;
/** A name no longer than this many characters (and …) */
const NAME_MAX = 10;

type Props = {
  room: ListenRoom;
  /** Your main roach (none out: you are not drawn) */
  main: LngLat | null;
  /** Your list of 触须之交, where each of them in the room is found (RoomMember.friendId) */
  friends: Friend[];
  /** The disco turned off: back at once, as the lights go */
  leaving: boolean;
  /** Out ("on"), flying back ("back"), over ("off"): MapApp.tsx hides the map's roaches and asks for nothing meanwhile */
  onFar: (state: "on" | "back" | "off") => void;
};

/** Each 拉远 to come out on this page: one going back by itself does not call off one that came after it */
let farSeq = 0;
/** Where the map is flying back to from a 拉远 just over: one out again meanwhile goes back there in its turn */
let returningTo: MapView | null = null;

/**
 * 一起听's 拉远, while 听歌's disco is out in a room and 拉远 is picked (DiscoHost.tsx): the map's roaches away (and
 * nothing of the area asked for, MapApp.tsx), the map flies out to frame you and your 触须之交 in the room where their
 * main roaches are (src/lib/listenFar.ts), in the part of it no buttons are over, and a canvas over it draws each of
 * you glowing, bobbing on the beat, with your names (any that do not fit at its edge, an arrow pointing where they
 * are); a note leaves the host for each of the others on every beat (from you, where the host is not drawn), and those
 * not drawn go round you as notes, 「还有 n 位附近的舟P」. With nobody of yours there it does not fly. Off again (the disco, the song, 舞台, the room over), the map flies back where it was,
 * unless it was moved by hand meanwhile. In 省电版, the lights alone or with less motion asked for, it goes at once and
 * the notes stand. The disco (src/components/disco/engine.ts) draws it each frame, faded with its lights; it takes no
 * taps, and says nothing to a screen reader (the room's people are in the player).
 */
export default function ListenFar(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const now = useRef(props);
  useEffect(() => {
    now.current = props;
  });
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const far = farOn(cv, () => now.current);
    const back = offerRoomFar({ draw: far.draw });
    // a hand on the map (the canvas takes no taps: they go through to it): dragged or zoomed, maybe
    const wrap = cv.parentElement;
    const touch = () => far.touch();
    const opts = { capture: true, passive: true };
    for (const e of HANDS) wrap?.addEventListener(e, touch, opts);
    return () => {
      for (const e of HANDS) wrap?.removeEventListener(e, touch, opts);
      back();
      far.leave();
    };
  }, []);
  return <canvas ref={canvas} className="lf-canvas" aria-hidden="true" />;
}

function farOn(cv: HTMLCanvasElement, get: () => Props) {
  // out (in) or not (idle: comes out with the next frame; out: gone back, until the disco is on again)
  let phase: "idle" | "in" | "out" = "idle";
  let seq = 0;
  // where the map was; where 拉远 sent it last, when, and the part of the screen and the people that was for; flying
  // there until; landed; a hand on the map last; moved by hand (not to be sent anywhere again, nor back)
  let saved: MapView | null = null;
  let aimed: MapView | null = null;
  let aimedAt = 0;
  let aimKey = "";
  let frame: Rect | null = null;
  let until = 0;
  let landed = true;
  let touchedAt = -Infinity;
  let moved = false;
  let moving = true;
  // the screen as last looked at: the part of the map clear of the stage's edge, the buttons over it, the biggest part
  // clear of both (where the map is not sent anywhere), the line's place
  let lookedAt = -Infinity;
  let box: Rect | null = null;
  let inTheWay: Rect[] = [];
  let spare: Rect | null = null;
  let line = { x: LINE_IN, y: 0 };
  let notes = 0;
  let last = 0;
  const pictures = new Map<string, HTMLImageElement>();
  const sprites = new Map<string, HTMLCanvasElement>();

  /** The buttons over the map and the edge the stage stands on, in the map's own px */
  const look = () => {
    const wrap = document.querySelector(".map-wrap")?.getBoundingClientRect();
    if (!wrap || !wrap.width || !wrap.height) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spot = readSpot();
    const edge = vh - spot.bottom - wrap.top;
    // the player open across a phone leaves nothing beside it: the whole width, under what is over the map
    const wide = spot.width >= 120;
    const left = wide ? spot.left - wrap.left : 0;
    const right = wide ? spot.left + spot.width - wrap.left : wrap.width;
    box = { left, top: 0, right, bottom: Math.max(0, edge - OVER_EDGE) };
    inTheWay = [...document.querySelectorAll<HTMLElement>(IN_THE_WAY)]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh)
      .map((r) => ({ left: r.left - wrap.left, top: r.top - wrap.top, right: r.right - wrap.left, bottom: r.bottom - wrap.top }));
    spare = freeFrames(box, inTheWay).reduce<Rect | null>((a, r) => (!a || area(r) > area(a) ? r : a), null) ?? box;
    line = { x: left + LINE_IN, y: edge - LINE_UP };
  };

  const enter = (cam: MapCamera) => {
    phase = "in";
    seq = ++farSeq;
    saved = returningTo ?? cam.view();
    returningTo = null;
    aimed = null;
    aimKey = "";
    frame = null;
    landed = true;
    touchedAt = -Infinity;
    moved = false;
    notes = 0;
    lookedAt = -Infinity;
    get().onFar("on");
  };

  /** You and your 触须之交 framed where no buttons are, again as they or the buttons move; never once moved by hand */
  const aim = (cam: MapCamera, placed: FarPerson[], t: number) => {
    if (moved || t - touchedAt < HAND_MS || !box || !placed.some((p) => !p.mine)) return;
    const size = cam.size();
    if (!size || !size.w || !size.h) return;
    const round = (v: number) => Math.round(v / 16);
    const key = JSON.stringify([
      placed.map((p) => [p.h, p.lng, p.lat]),
      [box.left, box.top, box.right, box.bottom].map(round),
      inTheWay.map((r) => [r.left, r.top, r.right, r.bottom].map(round)),
      size.w,
      size.h,
    ]);
    if (key === aimKey) return;
    aimKey = key;
    const you = placed.find((p) => p.mine) ?? null;
    const got = farView(placed, box, inTheWay, size, cam.zooms(), MOST_ZOOM, you);
    if (!got) return;
    frame = got.frame;
    // framed again where it is already (a button moved a little): left there
    if (aimed && landed && sameView(got.view, aimed, size)) return;
    const ms = moving ? (aimed ? AGAIN_MS : OUT_MS) : 0;
    cam.go(got.view, ms);
    aimed = got.view;
    aimedAt = t;
    // a map may glide there in two steps (腾讯's, far): taken as landed after both
    until = t + ms * 2 + 300;
    landed = false;
  };

  /**
   * Back where the map was, unless it was moved by hand since it was sent out (a hand on it while it flew counts); the
   * area asked for once it has landed
   */
  const leave = () => {
    if (phase !== "in") return;
    phase = "out";
    const mine = seq;
    const off = () => {
      if (mine !== farSeq) return;
      returningTo = null;
      get().onFar("off");
    };
    const cam = stageNow()?.camera;
    const at = cam?.view();
    const size = cam?.size();
    const stayed = Boolean(aimed && at && size && !moved && (landed ? sameView(at, aimed, size) : touchedAt < aimedAt));
    if (!cam || !saved || !stayed) return off();
    const ms = moving ? BACK_MS : 0;
    cam.go(saved, ms);
    returningTo = saved;
    get().onFar("back");
    window.setTimeout(off, ms * 2 + 300);
  };

  /** A roach's picture as the page draws it, made once for each look */
  const pictureOf = (p: FarPerson, px: number) => {
    const opts = { avatar: p.avatar, mine: p.mine, friend: p.friend };
    const key = JSON.stringify([p.color, opts, Math.ceil(px / 8)]);
    let im = pictures.get(key);
    if (!im) {
      const made = new Image();
      im = made;
      pictures.set(key, made);
      if (usesPicture(opts)) {
        roachIconUrl(p.color, opts, Math.ceil(px / 8) * 16)
          .then((u) => (made.src = u))
          .catch(() => {});
      } else made.src = roachDataUrl(p.color, opts);
    }
    return im;
  };

  /** A note, glowing: ♪ or ♫ by its beat, its colour going round three */
  const noteOf = (n: number, glow: boolean) => {
    const k = ((n % 6) + 6) % 6;
    const key = `${k}${glow ? "g" : ""}`;
    let s = sprites.get(key);
    if (!s) {
      s = document.createElement("canvas");
      s.width = 64;
      s.height = 64;
      const c = s.getContext("2d");
      if (c) {
        c.scale(2, 2);
        c.font = `bold 16px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = COLORS[k % 3];
        if (glow) {
          c.shadowColor = COLORS[k % 3];
          c.shadowBlur = 10;
        }
        c.fillText(k % 2 ? "♪" : "♫", 16, 16);
      }
      sprites.set(key, s);
    }
    return s;
  };

  const draw = (f: FarFrame) => {
    const t = performance.now();
    const dt = last ? Math.min(250, t - last) : 16;
    last = t;
    moving = f.moving;
    const p = get();
    if (p.leaving) leave();
    else if (phase === "out") phase = "idle";
    const cam = stageNow()?.camera;
    if (!cam) return;
    if (phase === "idle") enter(cam);
    if (t - lookedAt >= LOOK_MS) {
      lookedAt = t;
      look();
    }
    const { placed, others } = farPeople(p.room, p.main, p.friends);
    if (phase === "in") {
      const v = cam.view();
      const size = cam.size();
      // landed: there (to a few px), or the time it takes up
      const hand = touchedAt > aimedAt;
      if (!landed && aimed && (t >= until || (v && size && sameView(v, aimed, size)))) {
        landed = true;
        // stopped short by a hand on the map; or landed, where the map came to taken as where it was sent (a map
        // keeps the world in its frame its own way)
        if (hand && v && size && !sameView(v, aimed, size)) moved = true;
        else aimed = v ?? aimed;
      } else if (landed && aimed && hand && !moved && v && size && !sameView(v, aimed, size)) moved = true;
      aim(cam, placed, t);
    }
    notes = Math.min(1, Math.max(0, notes + (landed ? 1 : -1) * (dt / NOTES_MS)));
    paint(f, cam, placed, others);
  };

  const paint = (f: FarFrame, cam: MapCamera, placed: FarPerson[], others: number) => {
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (f.shown <= 0.001) return;
    const seen = f.shown;

    const pts = placed.flatMap((p) => {
      const at = cam.at(p.lng, p.lat);
      return at ? [{ p, x: at.x, y: at.y, rx: at.x, ry: at.y, off: false, text: "", lx: 0, ly: 0 }] : [];
    });
    const rs = Math.max(30, Math.min(46, W / 9));
    const gap = rs * 0.9;
    // all within the part of the screen framed (clear of the buttons; where the map was not sent anywhere, the biggest
    // such part): those further off than a little brought in to its edge, an arrow there pointing where they are
    const fr = frame ?? spare ?? { left: 0, top: 0, right: W, bottom: H };
    const inside = { left: fr.left + rs / 2 + 2, right: fr.right - rs / 2 - 2, top: fr.top + rs, bottom: fr.bottom - 20 };
    // (room left beside those for the arrow)
    const roomy = { left: inside.left + 14, right: inside.right - 14, top: inside.top + 10, bottom: inside.bottom - 10 };
    for (const q of pts) {
      q.off = Math.max(inside.left - q.x, q.x - inside.right, inside.top - q.y, q.y - inside.bottom) > gap;
      if (!q.off) continue;
      q.x = Math.max(roomy.left, Math.min(roomy.right, q.x));
      q.y = Math.max(roomy.top, Math.min(roomy.bottom, q.y));
    }
    apart(pts, gap, inside);

    // the music: a note on each beat from the host (from you, where the host is not drawn) to each of the others
    const from = pts.find((q) => q.p.host) ?? pts.find((q) => q.p.mine) ?? pts[0];
    if (from && notes > 0.001) {
      for (const q of pts) {
        if (q === from) continue;
        const mx = (from.x + q.x) / 2;
        const my = (from.y + q.y) / 2 - Math.hypot(q.x - from.x, q.y - from.y) * 0.28;
        const along = (u: number): [number, number] => [
          (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * mx + u * u * q.x,
          (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * my + u * u * q.y,
        ];
        c.globalAlpha = seen * notes;
        c.strokeStyle = "rgba(255, 79, 216, 0.35)";
        c.setLineDash([3, 6]);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(from.x, from.y);
        c.quadraticCurveTo(mx, my, q.x, q.y);
        c.stroke();
        c.setLineDash([]);
        if (f.moving) {
          for (let n = Math.floor(f.beat - TRAVEL) + 1; n <= Math.floor(f.beat); n++) {
            const u = (f.beat - n) / TRAVEL;
            if (u < 0 || u > 1) continue;
            const [x, y] = along(u);
            c.globalAlpha = seen * notes * Math.min(1, u * 5, (1 - u) * 5);
            c.drawImage(noteOf(n, true), x - 16, y - 16, 32, 32);
          }
        } else {
          // standing, lit
          for (const [k, u] of [0.25, 0.5, 0.75].entries()) {
            const [x, y] = along(u);
            c.globalAlpha = seen * notes;
            c.drawImage(noteOf(k, true), x - 16, y - 16, 32, 32);
          }
        }
      }
    }

    // each of you: a glow in TA's colour, TA's roach on it bobbing on the beat
    const bob = f.moving && notes > 0.5 ? Math.abs(Math.sin(f.beat * Math.PI)) * 5 : 0;
    c.globalAlpha = seen;
    for (const q of pts) {
      const glow = GLOW[q.p.color] ?? "#ffffff";
      const halo = c.createRadialGradient(q.x, q.y, 2, q.x, q.y, rs);
      halo.addColorStop(0, `${glow}aa`);
      halo.addColorStop(1, `${glow}00`);
      c.fillStyle = halo;
      c.beginPath();
      c.arc(q.x, q.y, rs, 0, Math.PI * 2);
      c.fill();
      const im = pictureOf(q.p, rs);
      if (im.complete && im.naturalWidth) c.drawImage(im, q.x - rs / 2, q.y - rs * 0.8 - bob, rs, rs);
      if (q.off) {
        const a = Math.atan2(q.ry - q.y, q.rx - q.x);
        c.save();
        c.translate(q.x + Math.cos(a) * (rs / 2 + 5), q.y - rs * 0.3 + Math.sin(a) * (rs / 2 + 5));
        c.rotate(a);
        c.beginPath();
        c.moveTo(6, 0);
        c.lineTo(-3, -5.5);
        c.lineTo(-3, 5.5);
        c.closePath();
        c.fillStyle = "#fff";
        c.shadowColor = "#000";
        c.shadowBlur = 3;
        c.fill();
        c.restore();
      }
    }

    // the names under each, yours first and the line about the others under it; over it (or further off) where one
    // would be over another name or roach, and within the frame
    const rest = others > 0 ? fmt(T.listen.far.others, { n: others }) : "";
    type Pt = (typeof pts)[number];
    const textBox = (x: number, y: number, w: number): Rect => ({ left: x - w / 2, right: x + w / 2, top: y - 11, bottom: y + 3 });
    const taken: { r: Rect; of: Pt | null }[] = pts.map((q) => ({
      r: { left: q.x - rs / 2, right: q.x + rs / 2, top: q.y - rs * 0.8, bottom: q.y + rs * 0.2 },
      of: q,
    }));
    const free = (r: Rect, own: Pt | null) =>
      r.top >= fr.top &&
      r.bottom <= fr.bottom &&
      !taken.some((o) => o.of !== own && o.r.left < r.right + 3 && o.r.right > r.left - 3 && o.r.top < r.bottom + 1 && o.r.bottom > r.top - 1);
    const within = (x: number, w: number) => Math.min(Math.max(x, fr.left + w / 2 + 4), fr.right - w / 2 - 4);
    // (a name may go over the top of its own roach's picture, not the line about the others)
    const place = (q: Pt, w: number, tries: number[], own: Pt | null = q) => {
      const x = within(q.x, w);
      const y = tries.find((ty) => free(textBox(x, ty, w), own)) ?? tries[0];
      taken.push({ r: textBox(x, y, w), of: null });
      return { x, y };
    };
    const order = [...pts].sort((a, b) => Number(b.p.mine) - Number(a.p.mine));
    let restAt: { x: number; y: number } | null = null;
    for (const q of order) {
      c.font = LABEL;
      q.text = q.p.mine ? T.listen.stage.you : short(q.p.name);
      const top = q.y - rs * 0.8;
      const at = place(q, c.measureText(q.text).width, [q.y + 16, top - 8, q.y + 31, top - 22]);
      q.lx = at.x;
      q.ly = at.y;
      if (q.p.mine && rest) {
        c.font = SMALL;
        restAt = place(q, c.measureText(rest).width, [q.ly + 15, q.ly - 15, top - 8, top - 22, q.y + 31, q.y + 46], null);
      }
    }
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.shadowColor = "#000";
    c.shadowBlur = 4;
    c.fillStyle = "#fff";
    c.font = LABEL;
    for (const q of order) c.fillText(q.text, q.lx, q.ly);

    // those not drawn: notes going round you
    const me = pts.find((q) => q.p.mine);
    if (rest && me && restAt) {
      c.shadowBlur = 0;
      c.globalAlpha = seen * Math.max(notes, 0.35);
      const turn = f.moving ? (f.beat / 4) * Math.PI * 2 : 0;
      for (let i = 0; i < 6; i++) {
        const a = turn + (i * Math.PI) / 3;
        c.drawImage(noteOf(i, false), me.x + Math.cos(a) * rs * 0.95 - 11, me.y - rs * 0.35 + Math.sin(a) * rs * 0.6 - 11, 22, 22);
      }
      c.globalAlpha = seen;
      c.shadowBlur = 4;
      c.font = SMALL;
      c.fillStyle = "rgba(255, 255, 255, 0.85)";
      c.fillText(rest, restAt.x, restAt.y);
    }

    // what this is, at the bottom left over the stage's edge (and over 💬 and 舞台 | 拉远, where they stand there)
    c.textAlign = "left";
    c.font = LABEL;
    const lw = c.measureText(T.listen.far.line).width;
    let ly = line.y;
    for (let i = 0; i < 4; i++) {
      const hit = inTheWay.find((r) => r.left < line.x + lw && r.right > line.x && r.top < ly + 4 && r.bottom > ly - 12);
      if (!hit) break;
      ly = hit.top - 6;
    }
    c.shadowBlur = 3;
    c.fillStyle = "rgba(255, 255, 255, 0.7)";
    c.fillText(T.listen.far.line, line.x, ly);
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  };

  return {
    draw,
    leave,
    touch: () => {
      if (phase === "in") touchedAt = performance.now();
    },
  };
}

/**
 * Roaches closer than gap (px) moved apart to be told apart, as the world drawn out puts a whole city on a few px:
 * each two pushed off each other along the line between them (side by side where they are on the same spot); and
 * any out of inside (pushed out, past the frame's edge where not all fit, or off the map moved by hand) brought in to
 * its edge
 */
function apart(pts: { x: number; y: number }[], gap: number, inside: Rect) {
  const pull = (q: { x: number; y: number }) => {
    q.x = Math.max(inside.left, Math.min(inside.right, q.x));
    q.y = Math.max(inside.top, Math.min(inside.bottom, q.y));
  };
  pts.forEach(pull);
  for (let round = 0; round < 6; round++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d >= gap - 0.5) continue;
        const [ux, uy] = d > 0.5 ? [(b.x - a.x) / d, (b.y - a.y) / d] : [1, 0];
        const push = (gap - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    pts.forEach(pull);
    if (!moved) return;
  }
}

const area = (r: Rect) => (r.right - r.left) * (r.bottom - r.top);

const short = (name: string) => {
  const chars = [...name];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join("")}…` : name;
};
