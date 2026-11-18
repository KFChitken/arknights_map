import type { Map as MaplibreMap } from "maplibre-gl";
import { isListening, listenTap } from "@/components/app/listening";
import {
  offered,
  roomStageNow,
  stageNow,
  type AmapStage,
  type DiscoStage,
  type MaplibreStage,
  type RoomStage,
  type StageDancer,
} from "@/components/map/discoStage";
import type { RoachGl } from "@/components/map/roachGl";
import { readDance } from "@/lib/dance";
import { amapDance } from "./amapDance";
import { danceTraits, FREE_STEP, freeAmp, JUMP, liteMove, nextBar, planOf, stepAt, WILD, wildMove, type Plan, type Step } from "./choreo";
import { beatAt, FREE_S, pictureTime, SongClock } from "./clock";
import { BACK_MS, fpsCap, GearWatch, modeOf, type Mode } from "./gear";
import { type DanceNow, STANDING } from "./glsl";
import { danceLayer, dimLayer } from "./maplibreDance";
import { DanceMarks } from "./marks";
import { BALL_UP, overlay, type Overlay } from "./overlay";

/**
 * 听歌's disco on this page (src/lib/disco.ts fetches it, src/components/app/DiscoHost.tsx starts it): one loop of
 * frames, 30 a second at most (20 in 省电版), that reads where the song is (listening.ts listenTap), works out the dance
 * (choreo.ts) and hands it to the map on screen (src/components/map/discoStage.ts), the ball and lights (overlay.ts)
 * and the roaches drawn as page elements (marks.ts). In 一起听 the map's roaches stand, and the room's own stage
 * (src/components/app/ListenStage.tsx) dances in their place. It comes in once the song really sounds; it goes when it
 * is no longer wanted, or two seconds after the song stops (the next song keeps it). Nothing is sent anywhere.
 */

export type DiscoWish = {
  /** Wanted: chosen, open to the player, 听歌 shown, no 舟友的酒 on */
  want: boolean;
  /** Less motion asked for: the lights alone, still */
  still: boolean;
  /** Everyone on the map dances (listening alone); not in 一起听, where the room's own stage dances in their place */
  crowd: boolean;
};

export type Disco = {
  set: (w: DiscoWish) => void;
  /** Something of the player changed: look again now */
  poke: () => void;
  /** Gone at once, everything back as it was */
  destroy: () => void;
};

/** The map darkens over this long; the ball comes down in DROP_MS, bouncing at the bottom */
const IN_MS = 600;
const DROP_MS = 700;
/** Going: the lights fade over OUT_MS, the ball goes up in RISE_MS */
const OUT_MS = 900;
const RISE_MS = 1200;
/** Stopped this long (paused, the album over), it goes; played again within it, it dances on */
const PAUSE_MS = 2000;
/** The roaches ease into the dance and out of it (to standing) over about this long */
const DANCE_MS = 250;
/** Waiting for the song to sound, it looks this often */
const POLL_MS = 400;
/** Where the GPU cannot darken the map under its roaches, a page element darkens the whole of it, this much fainter */
const PAGE_DIM = 0.6;
/** In 一起听 the page element darkens the whole map this much, its roaches with it (they stand, the stage dancing) */
const ROOM_DIM = 0.8;
/** Songs' dances kept, by their tables */
const PLANS_KEPT = 6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A step toward dancing (1) or standing (0), there over about DANCE_MS */
const toward = (v: number, on: boolean, dt: number) => {
  const to = on ? 1 : 0;
  const next = v + (to - v) * Math.min(1, dt / DANCE_MS);
  return Math.abs(to - next) < 0.002 ? to : next;
};
const ease = (k: number) => (1 - Math.cos(Math.PI * clamp01(k))) / 2;
const easeIn = (k: number) => clamp01(k) ** 2;
/** Over the end and back: the ball's bounce as it stops */
const backOut = (k: number) => {
  const c = 1.70158;
  const x = clamp01(k) - 1;
  return 1 + (c + 1) * x ** 3 + c * x ** 2;
};
const frac = (v: number) => v - Math.floor(v);

/** A song's table as danced: its plan (beats), or how loud each second is (none to dance to), and where its smaller copy is */
type SongDance = { plan: Plan | null; secs: Uint8Array | null; liteS: number };
const NO_DANCE: SongDance = { plan: null, secs: null, liteS: 0 };

/** How a map is danced on: the frame asked for, whether the roaches can dance there, everything taken away */
type Floor = {
  stage: DiscoStage;
  dances: () => boolean;
  /** This frame drawn as mode has it (changed: what the GPU draws is not as in the last); whether the GPU darkens the map (else the page does) */
  frame: (mode: Mode, changed: boolean) => boolean;
  leave: () => void;
};

export function startDisco(host: HTMLElement, opts: { onShown: (on: boolean) => void }): Disco {
  let wish: DiscoWish = { want: false, still: false, crowd: true };
  let phase: "off" | "on" | "out" = "off";
  let phaseAt = 0;
  // what the phase started from (the lights, the ball), and where they are now
  let shownFrom = 0;
  let ballFrom = BALL_UP;
  let shown = 0;
  let ballY = BALL_UP;
  let danceOn = 0;
  let stageOn = 0;
  let pausedAt: number | null = null;
  // dancing starts all together on the next bar of the song it was turned on to; any other song at once
  let startSong: string | null = null;
  let startBeat = -Infinity;
  // the lights' own clock: on with the beats, slowly by itself without
  let pace = 0;
  let paceWas: { song: string | null; onBeat: boolean; v: number } | null = null;
  let songT = 0;
  let drewWas = "";
  let raf = 0;
  let poll = 0;
  let last = 0;
  let dead = false;
  let floor: Floor | null = null;
  let ov: Overlay | null = null;
  const clock = new SongClock();
  const gear = new GearWatch();
  const marks = new DanceMarks();
  const now: DanceNow = { ...STANDING };
  // 一起听's stage: the one drawn (put back when it goes), how faded in, and its roaches' dance (the map's, on for them)
  const stageMarks = new DanceMarks();
  let stageWas: RoomStage | null = null;
  let stageFade = "";
  const stageN: DanceNow = { ...STANDING };
  const plans = new Map<string, SongDance>();

  const danceOf = (text: string | null): SongDance => {
    if (!text) return NO_DANCE;
    let d = plans.get(text);
    if (d) {
      plans.delete(text);
      plans.set(text, d);
      return d;
    }
    const t = readDance(text);
    d = !t ? NO_DANCE : t.none ? { plan: null, secs: t.secs, liteS: 0 } : { plan: planOf(t), secs: null, liteS: t.liteS };
    plans.set(text, d);
    if (plans.size > PLANS_KEPT) plans.delete(plans.keys().next().value!);
    return d;
  };

  // ---- the maps ----

  const amapFloor = (s: AmapStage): Floor => {
    let broken = false;
    const painter = amapDance(
      () => now,
      (why) => {
        broken = true;
        console.warn("disco:", why);
      },
    );
    let on: RoachGl | null = null;
    let handsFor: RoachGl | null = null;
    const put = (gl: RoachGl | null) => {
      if (gl === on) return;
      try {
        on?.setDance(null);
      } catch {}
      on = gl;
      gl?.setDance(painter);
    };
    const dances = () => !broken && Boolean(s.gl()) && s.look() === "cartoon" && s.crowd() !== "lite";
    return {
      stage: s,
      dances,
      frame(mode, changed) {
        const gl = broken ? null : s.gl();
        put(gl);
        // the hoods' sleeves up, drawn once for each layer (a new one with each look)
        if (gl && mode.dance && handsFor !== gl) {
          handsFor = gl;
          s.hands()
            .then((urls) => (on === gl ? gl.setHands(urls) : undefined))
            .catch(() => {});
        }
        if (changed) s.redraw();
        return Boolean(gl);
      },
      leave() {
        put(null);
        painter.free();
        try {
          s.redraw();
        } catch {}
      },
    };
  };

  const maplibreFloor = (s: MaplibreStage): Floor => {
    let broken = false;
    const fail = (why: string) => {
      broken = true;
      console.warn("disco:", why);
    };
    const dim = dimLayer(() => now, fail);
    const dance = danceLayer(() => now, fail);
    let map: MaplibreMap | null = null;
    let held = false;
    let seq = -1;
    const has = (id: string) => {
      try {
        return Boolean(map?.getLayer(id));
      } catch {
        return false;
      }
    };
    const hold = (on: boolean) => {
      if (held === on) return;
      held = on;
      dance.setDrawn(on);
      try {
        s.hold(on);
      } catch {}
    };
    const drop = () => {
      hold(false);
      for (const id of [dance.id, dim.id]) {
        try {
          if (has(id)) map!.removeLayer(id);
        } catch {}
      }
    };
    const dances = () => !broken && s.look() === "cartoon" && s.crowd() !== "lite";
    return {
      stage: s,
      dances,
      frame(mode, changed) {
        const m = s.map();
        // the map made again: everything on the new one
        if (m !== map) {
          drop();
          map = m;
          seq = -1;
        }
        if (!m) return false;
        if (broken) {
          drop();
          return false;
        }
        try {
          if (!has(dim.id) && has(s.before.dim)) m.addLayer(dim, s.before.dim);
          if (mode.dance && dances()) {
            if (!has(dance.id) && has(s.before.dance)) m.addLayer(dance, s.before.dance);
            const d = s.dancers();
            if (d.seq !== seq) {
              seq = d.seq;
              dance.setDancers(d.list, d.seq);
            }
            // the roaches' own layers see-through only once the dancers can stand in for them
            if (has(dance.id) && dance.ready()) hold(true);
          } else hold(false);
        } catch (e) {
          fail(e instanceof Error ? e.message : "layers");
          drop();
          return false;
        }
        if (changed) m.triggerRepaint();
        return has(dim.id);
      },
      leave() {
        drop();
        dim.free();
        dance.free();
        try {
          map?.triggerRepaint();
        } catch {}
        map = null;
      },
    };
  };

  /** The map on screen danced on (another one shown: that one); kept while none is shown, drawn only while one is */
  const floorNow = () => {
    const s = stageNow();
    if (floor && !offered(floor.stage)) {
      floor.leave();
      floor = null;
      marks.reset();
    }
    if (s && s !== floor?.stage) {
      floor?.leave();
      marks.reset();
      floor = s.kind === "amap" ? amapFloor(s) : maplibreFloor(s);
    }
    return s ? floor : null;
  };

  // ---- 一起听's stage ----

  /** A roach of the stage with its sleeves up (its second copy shown), or down */
  const sleeves = (d: StageDancer, up: boolean) => {
    if (d.el.classList.contains("up") !== up) d.el.classList.toggle("up", up);
  };
  /**
   * The stage this frame: faded in and out with the lights; its roaches, while they dance, as the map's would (each its
   * own part of the dance, the wave along the stage), every other one with its sleeves up, and all of them at the top
   * of a climax's big jumps (as the map's, glsl.ts danceVert); standing, as they were
   */
  const drawStage = (s: RoomStage | null) => {
    if (s !== stageWas) leaveStage();
    stageWas = s;
    if (!s) return;
    const fade = shown.toFixed(3);
    if (fade !== stageFade) {
      stageFade = fade;
      s.el.style.opacity = fade;
    }
    const list = s.dancers();
    if (stageOn <= 0.001 || !list.length) {
      stageMarks.reset();
      for (const d of list) sleeves(d, false);
      return;
    }
    Object.assign(stageN, now);
    stageN.on = stageOn;
    const r = s.el.getBoundingClientRect();
    stageMarks.draw(
      list.map((d) => ({ el: d.el, kind: "mine" as const, seed: d.seed, size: d.size })),
      stageN,
      { left: r.left, width: r.width },
    );
    const p = frac(stageN.beat);
    const climax = stageN.hands * stageOn > 0.5 && stageN.mix > 0.5 && Math.floor(stageN.beat) % 2 === 0 && p > 0.12 && p < 0.62;
    for (const d of list) {
      const b = stageN.b === WILD ? wildMove(danceTraits(d.seed), stageN.beat) : stageN.b;
      sleeves(d, d.sleeves && stageOn > 0.5 && (d.alt || (climax && b === JUMP)));
    }
  };
  /** The stage as it was: its roaches standing, sleeves down, faded out (it goes with the lights) */
  const leaveStage = () => {
    stageMarks.reset();
    if (stageWas) {
      for (const d of stageWas.dancers()) sleeves(d, false);
      stageWas.el.style.opacity = "0";
    }
    stageWas = null;
    stageFade = "";
  };

  // ---- coming in and going ----

  const loop = () => {
    if (!raf && !dead) raf = requestAnimationFrame(tick);
  };
  const stopPoll = () => {
    window.clearTimeout(poll);
    poll = 0;
  };
  /** Waiting to come in: the song sounding, on a map on screen */
  const check = () => {
    stopPoll();
    if (dead || phase !== "off" || !wish.want || !isListening()) return;
    if (listenTap()?.sounding && stageNow()) loop();
    else poll = window.setTimeout(check, POLL_MS);
  };

  const toOn = (t: number) => {
    if (phase === "off") {
      ov = overlay(host);
      opts.onShown(true);
      gear.rest(t, BACK_MS);
      shownFrom = 0;
      ballFrom = BALL_UP;
    } else {
      shownFrom = shown;
      ballFrom = ballY;
    }
    phase = "on";
    phaseAt = t;
    pausedAt = null;
    startSong = null;
  };
  const toOut = (t: number) => {
    phase = "out";
    phaseAt = t;
    shownFrom = shown;
    ballFrom = ballY;
  };
  /** Everything taken away, at once */
  const finish = () => {
    window.cancelAnimationFrame(raf);
    raf = 0;
    floor?.leave();
    floor = null;
    marks.reset();
    leaveStage();
    ov?.remove();
    ov = null;
    const was = phase !== "off";
    phase = "off";
    shown = 0;
    ballY = BALL_UP;
    danceOn = 0;
    stageOn = 0;
    drewWas = "";
    Object.assign(now, STANDING);
    if (was) opts.onShown(false);
  };

  // ---- each frame ----

  const tick = (t: number) => {
    raf = 0;
    if (dead) return;
    raf = requestAnimationFrame(tick);
    if (last && t - last < 1000 / fpsCap(gear.gear) - 3) return;
    const dt = last ? Math.min(250, t - last) : 16;
    last = t;
    try {
      frame(t, dt);
    } catch (e) {
      // never the page's undoing: the disco stops here, for this page
      console.warn("disco:", e);
      dead = true;
      finish();
    }
  };

  const frame = (t: number, dt: number) => {
    const tap = listenTap();
    const going = isListening();
    const song = tap?.song ?? null;
    const d = danceOf(tap?.dance ?? null);
    const plan = d.plan;
    if (tap) songT = clock.at(song, pictureTime(tap.at, tap.lite && plan ? d.liteS : 0), tap.rate, tap.sounding, t);
    const raw = plan ? beatAt(plan.beats, songT, plan.bpm) - plan.first : Number.NaN;
    const onBeat = plan !== null && raw >= 0 && raw < plan.end + 1;
    const step: Step = plan ? stepAt(plan, raw) : { ...FREE_STEP, amp: freeAmp(d.secs, songT) };

    // in, out, and back in
    if (phase === "off" || phase === "out") {
      if (wish.want && going && tap?.sounding && stageNow()) toOn(t);
      else if (phase === "off") {
        window.cancelAnimationFrame(raf);
        raf = 0;
        return check();
      }
    } else if (!wish.want) toOut(t);
    else if (!going) {
      pausedAt ??= t;
      if (t - pausedAt >= PAUSE_MS) toOut(t);
    } else pausedAt = null;
    if (phase === "on" && startSong === null && song) {
      startSong = song;
      startBeat = plan && raw >= 0 ? nextBar(plan, raw) : -Infinity;
    }
    if (song !== startSong) startBeat = -Infinity;

    const k = t - phaseAt;
    if (phase === "on") {
      shown = shownFrom + (1 - shownFrom) * ease(k / IN_MS);
      ballY = wish.still ? 0 : ballFrom + (0 - ballFrom) * backOut(k / DROP_MS);
    } else {
      shown = shownFrom * (1 - ease(k / OUT_MS));
      ballY = wish.still ? ballY : ballFrom + (BALL_UP - ballFrom) * easeIn(k / RISE_MS);
      if (k >= Math.max(OUT_MS, RISE_MS)) {
        finish();
        return check();
      }
    }

    // the lights' clock, on without jumps as the song goes from no beat to beats, or to another song
    const paceNow = onBeat ? raw : songT / FREE_S;
    if (paceWas && paceWas.song === song && paceWas.onBeat === onBeat) pace += Math.max(-1, Math.min(1, paceNow - paceWas.v));
    paceWas = { song, onBeat, v: paceNow };

    const f = floorNow();
    if (!f) return;
    const mode = modeOf(wish.still, gear.gear, f.dances());
    // in 一起听 the map's roaches stand, and the room's stage dances in their place: page elements, which can wherever
    // anything dances (not with less motion asked for, nor on a phone down to the lights alone)
    const room = wish.crowd ? null : roomStageNow();
    const crowd: Mode = wish.crowd ? mode : { ...mode, dance: false };
    const stageDances = room !== null && modeOf(wish.still, gear.gear, true).dance;
    const lite = mode.fx !== "full";
    const ready = phase === "on" && Boolean(tap?.sounding) && !(onBeat && raw < startBeat - 0.001);
    danceOn = toward(danceOn, ready && crowd.dance, dt);
    stageOn = toward(stageOn, ready && stageDances, dt);

    now.beat = plan && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    now.free = songT / FREE_S;
    now.on = crowd.dance ? danceOn : 0;
    now.a = lite ? liteMove(step.a) : step.a;
    now.b = lite ? liteMove(step.b) : step.b;
    now.mix = step.mix;
    now.amp = step.amp;
    now.hands = !lite && step.climax ? 1 : 0;
    now.drop = !lite && step.drop ? 1 : 0;
    now.light = crowd.dance && mode.fx === "full" ? shown * (0.5 + 0.5 * step.level) : 0;
    now.lightBeat = onBeat ? raw : pace;
    now.pulse = onBeat ? 1 : 0;
    // the GPU darkens the map under the roaches where it can (the map's own frame reads it, after this one), and is
    // asked for a frame only when what it draws changes: dancing, the floor lights, the darkening coming or going; in
    // 一起听 the page darkens all of it instead, the standing roaches too
    now.dim = wish.crowd ? shown : 0;
    const drew = `${now.on}|${now.light}|${now.dim}`;
    const changed = now.on > 0 || now.light > 0 || drew !== drewWas;
    drewWas = drew;
    const gpuDim = f.frame(crowd, changed);
    if (!gpuDim) now.dim = 0;

    ov?.draw({
      shown,
      ballY,
      ballOpacity: wish.still ? shown : 1,
      swing: wish.still ? 0 : Math.sin(t / 900) * 2.2,
      fx: mode.fx,
      onBeat,
      phase: onBeat ? frac(raw) : 0,
      beat: onBeat ? raw : pace,
      pace,
      level: step.level,
      drop: now.drop > 0,
      dim: !wish.crowd ? shown * ROOM_DIM : gpuDim ? 0 : shown * PAGE_DIM,
    });

    if (now.on > 0.001) {
      const list = f.stage.marks().list;
      if (list.length) {
        const r = host.getBoundingClientRect();
        marks.draw(list, now, { left: r.left, width: r.width });
      } else marks.reset();
    } else marks.reset();
    drawStage(room);
    // the frames counted while anyone dances, the map's or the stage's
    if ((now.on > 0.001 || stageOn > 0.001) && document.visibilityState === "visible") gear.frame(t);
  };

  const seen = () => {
    if (document.visibilityState !== "visible") return;
    last = 0;
    gear.rest(performance.now(), BACK_MS);
    if (phase === "off") check();
  };
  document.addEventListener("visibilitychange", seen);

  return {
    set(w) {
      if (dead) return;
      wish = w;
      if (phase === "off") check();
      else loop();
    },
    poke() {
      if (dead) return;
      if (phase === "off") check();
      else loop();
    },
    destroy() {
      if (dead) return;
      dead = true;
      stopPoll();
      document.removeEventListener("visibilitychange", seen);
      finish();
    },
  };
}
