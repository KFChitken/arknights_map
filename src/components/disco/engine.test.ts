import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AmapStage, type FarFrame, offerRoomFar, offerRoomStage, offerStage, type StageDancer } from "@/components/map/discoStage";
import type { RoachGl } from "@/components/map/roachGl";
import { BOB, FREE, SWAY } from "./choreo";
import { startDisco } from "./engine";
import type { DanceNow } from "./glsl";
import type { OverlayFrame } from "./overlay";

// 听歌's disco on a page, with the song, the ball and lights and the map's GPU layer stood in for: when it comes in and
// goes, when everyone starts dancing, and what it does on a slow phone, with less motion, or where nobody can dance

/** The song in the element: going (playing or starting), sounding, where it was (s) and at what time of the page (ms) */
const song = vi.hoisted(() => ({ going: false, sounding: false, at: 0, from: 0, dance: null as string | null, broken: false }));
/** The page's time (ms), as each frame is given it */
const clock = vi.hoisted(() => ({ t: 1000 }));
/** What was drawn: the lights' frames, how often they were put up and taken away; the dance as the GPU layer reads it */
const drawn = vi.hoisted(() => ({ frames: [] as OverlayFrame[], made: 0, removed: 0, now: null as (() => DanceNow) | null, freed: 0 }));

vi.mock("@/components/app/listening", () => ({
  isListening: () => song.going,
  listenTap: () => {
    if (song.broken) throw new Error("broken");
    const at = song.sounding ? song.at + (clock.t - song.from) / 1000 : song.at;
    return { song: "s1", dance: song.dance, lite: false, at, rate: 1, sounding: song.sounding };
  },
}));
vi.mock("./overlay", () => ({
  BALL_UP: -120,
  overlay: () => {
    drawn.made++;
    return { draw: (f: OverlayFrame) => void drawn.frames.push({ ...f }), remove: () => void drawn.removed++ };
  },
}));
vi.mock("./amapDance", () => ({
  amapDance: (now: () => DanceNow) => {
    drawn.now = now;
    return { free: () => void drawn.freed++ };
  },
}));
vi.mock("./maplibreDance", () => ({ dimLayer: () => ({}), danceLayer: () => ({}) }));

/** 120 beats a minute from 1 s in, bars of four from the first beat, each beat as loud as 5: bobbing and swaying */
const BEATS = JSON.stringify({ v: 1, bpm: 120, bar: 0, t: ["100", ...Array<string>(199).fill("50")].join(","), e: "5".repeat(200) });
/** A song with no beat to dance to, as loud as 5 each second */
const NO_BEATS = JSON.stringify({ v: 1, none: "tempo", s: "5".repeat(120) });

const rafs = new Map<number, FrameRequestCallback>();
let ids = 0;

/** The page drawing at fps for ms */
function run(ms: number, fps = 60) {
  const end = clock.t + ms;
  while (clock.t < end - 0.001) {
    clock.t += 1000 / fps;
    vi.advanceTimersByTime(1000 / fps);
    const due = [...rafs.values()];
    rafs.clear();
    for (const cb of due) cb(clock.t);
  }
}
const position = () => (song.sounding ? song.at + (clock.t - song.from) / 1000 : song.at);
/** The disco on the page; told each time the player changes, as DiscoHost.tsx tells it */
let disco: ReturnType<typeof startDisco> | null = null;
function play(at = position()) {
  Object.assign(song, { going: true, sounding: true, at, from: clock.t });
  disco?.poke();
}
function pause() {
  Object.assign(song, { at: position(), from: clock.t, going: false, sounding: false });
  disco?.poke();
}
const last = () => drawn.frames[drawn.frames.length - 1];
const dance = () => drawn.now!();

let gl: { setDance: ReturnType<typeof vi.fn>; setHands: ReturnType<typeof vi.fn> };
let crowd: "all" | "lite" | "off";
let withdraw: () => void;
function stage(over: Partial<AmapStage> = {}) {
  gl = { setDance: vi.fn(), setHands: vi.fn() };
  withdraw = offerStage({
    kind: "amap",
    shown: () => true,
    look: () => "cartoon",
    crowd: () => crowd,
    marks: () => ({ seq: 0, list: [] }),
    gl: () => gl as unknown as RoachGl,
    hands: () => Promise.resolve([]),
    redraw: () => {},
    camera: {
      view: () => ({ lng: 121.47, lat: 31.23, zoom: 10 }),
      size: () => ({ w: 400, h: 800 }),
      zooms: () => [2, 18],
      go: () => {},
      at: () => ({ x: 0, y: 0 }),
    },
    ...over,
  });
}
const host = { getBoundingClientRect: () => ({ left: 0, width: 400 }) } as unknown as HTMLElement;
let onShown: ReturnType<typeof vi.fn<(on: boolean) => void>>;
function start(still = false, alone = true) {
  disco = startDisco(host, { onShown });
  disco.set({ want: true, still, crowd: alone });
  return disco;
}

/** A page element as the stage's are moved: its inline style (what was set on it), its classes */
function element() {
  const props = new Map<string, string>();
  const classes = new Set<string>();
  const el = {
    style: { opacity: "", setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) },
    classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
    isConnected: true,
    offsetWidth: 46,
    getBoundingClientRect: () => ({ left: 100, width: 300, top: 500, height: 80 }),
  };
  return { el: el as unknown as HTMLElement, props, classes };
}
/** 一起听's stage with n roaches up (ListenStage.tsx), the hood each (its copy with the sleeves up) */
function roomStage(n: number) {
  const root = element();
  const figs = Array.from({ length: n }, () => element());
  const list: StageDancer[] = figs.map((f, i) => ({ el: f.el, seed: 7 * i + 3, size: 46, sleeves: true, alt: i % 2 === 1 }));
  const back = offerRoomStage({ el: root.el, dancers: () => list });
  return { root, figs, back };
}
/** 一起听's 拉远 (ListenFar.tsx): each frame it was given */
function roomFar() {
  const frames: FarFrame[] = [];
  const back = offerRoomFar({ draw: (f) => void frames.push({ ...f }) });
  return { frames, back, last: () => frames[frames.length - 1] };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  rafs.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafs.set(++ids, cb);
    return ids;
  });
  vi.stubGlobal("window", {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    cancelAnimationFrame: (id: number) => rafs.delete(id),
  });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
  Object.assign(song, { going: false, sounding: false, at: 0, from: 0, dance: BEATS, broken: false });
  Object.assign(drawn, { frames: [], made: 0, removed: 0, now: null, freed: 0 });
  clock.t = 1000;
  crowd = "all";
  onShown = vi.fn<(on: boolean) => void>();
  stage();
});
afterEach(() => {
  disco?.destroy();
  disco = null;
  withdraw();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("听歌's disco coming in and going", () => {
  it("waits for the song to really sound; then the ball comes down and the map darkens", () => {
    start();
    // tapped play, the song still loading
    Object.assign(song, { going: true, sounding: false, at: 3, from: clock.t });
    disco!.poke();
    run(1500);
    expect(drawn.made).toBe(0);
    expect(onShown).not.toHaveBeenCalled();
    play(3);
    run(500);
    expect(drawn.made).toBe(1);
    expect(onShown).toHaveBeenCalledWith(true);
    run(800);
    expect(last().shown).toBeCloseTo(1, 3);
    expect(last().ballY).toBeCloseTo(0, 3);
    expect(last().fx).toBe("full");
    expect(last().onBeat).toBe(true);
    expect(dance().dim).toBeCloseTo(1, 3);
    expect(gl.setDance).toHaveBeenCalledTimes(1);
  });

  it("starts everyone dancing all together on the next bar of the song it was turned on to", () => {
    start();
    // 3.25 s in, drawn 50 ms behind: beat 4.4, so the bar from beat 8 (5 s in)
    play(3.25);
    run(1600);
    expect(dance().on).toBe(0);
    run(900);
    expect(dance().on).toBeGreaterThan(0.9);
    expect(dance().beat).toBeCloseTo((position() - 0.05 - 1) / 0.5, 1);
    // into the first phrase's move from the free sway, a beat after it starts
    expect([BOB, SWAY]).toContain(dance().b);
    expect(dance().mix).toBe(1);
  });

  it("goes two seconds after the song stops; played again within them, it dances on", () => {
    start();
    play(10);
    run(1000);
    pause();
    run(1500);
    expect(last().shown).toBeCloseTo(1, 3);
    play();
    run(2500);
    expect(drawn.removed).toBe(0);
    pause();
    run(2100);
    expect(last().shown).toBeLessThan(1);
    expect(drawn.removed).toBe(0);
    run(1300);
    expect(drawn.removed).toBe(1);
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(gl.setDance).toHaveBeenLastCalledWith(null);
    expect(drawn.freed).toBe(1);
  });

  it("goes when no longer wanted (舟友的酒, its switch off), and comes back when wanted again", () => {
    const d = start();
    play(10);
    run(3000);
    d.set({ want: false, still: false, crowd: true });
    run(1300);
    expect(drawn.removed).toBe(1);
    expect(onShown).toHaveBeenLastCalledWith(false);
    d.set({ want: true, still: false, crowd: true });
    run(500);
    expect(drawn.made).toBe(2);
    expect(onShown).toHaveBeenLastCalledWith(true);
  });

  it("is taken away at once (the site gone gray)", () => {
    const d = start();
    play(10);
    run(1000);
    d.destroy();
    expect(drawn.removed).toBe(1);
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(rafs.size).toBe(0);
    play();
    d.set({ want: true, still: false, crowd: true });
    run(1000);
    expect(drawn.made).toBe(1);
  });

  it("stops for the page at an error in a frame, everything back as it was", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = start();
    play(10);
    run(1000);
    song.broken = true;
    run(100);
    expect(drawn.removed).toBe(1);
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(gl.setDance).toHaveBeenLastCalledWith(null);
    expect(warn).toHaveBeenCalled();
    song.broken = false;
    d.set({ want: true, still: false, crowd: true });
    d.poke();
    run(1000);
    expect(drawn.made).toBe(1);
  });
});

describe("what it draws", () => {
  it("sways slowly to a song with no beats, at once, the lights going round with no beat to them", () => {
    song.dance = NO_BEATS;
    start();
    play(10);
    run(1500);
    expect(dance().on).toBeGreaterThan(0.9);
    expect(dance().a).toBe(FREE);
    expect(dance().pulse).toBe(0);
    expect(drawn.frames.every((f) => !f.onBeat)).toBe(true);
  });

  it("only lights where less motion is asked for: the ball there at once and still, nobody dancing", () => {
    start(true);
    play(10);
    run(100);
    expect(last().ballY).toBe(0);
    run(3000);
    expect(drawn.frames.every((f) => f.swing === 0 && f.fx === "still")).toBe(true);
    expect(dance().on).toBe(0);
  });

  it("lights only where the map cannot draw its roaches dancing: 轻量's piles, or no GPU layer (the page then darkens the map)", () => {
    crowd = "lite";
    start();
    play(10);
    run(3000);
    expect(dance().on).toBe(0);
    expect(last().fx).toBe("full");
    expect(last().dim).toBe(0);

    withdraw();
    stage({ gl: () => null });
    crowd = "all";
    Object.assign(drawn, { frames: [], now: null });
    start();
    play(10);
    run(3000);
    expect(last().dim).toBeCloseTo(0.6, 3);
  });

  it("steps down to 省电版 on a slow phone, then to the lights alone, never back up", () => {
    start();
    play(10);
    run(15_000, 12);
    const fx = drawn.frames.map((f) => f.fx);
    const lite = fx.indexOf("lite");
    const calm = fx.indexOf("calm");
    expect(lite).toBeGreaterThan(0);
    expect(calm).toBeGreaterThan(lite);
    expect(fx.slice(lite).includes("full")).toBe(false);
    expect(fx.slice(calm).every((f) => f === "calm")).toBe(true);
    expect(dance().on).toBe(0);
    run(10_000, 60);
    expect(last().fx).toBe("calm");
  });
});

describe("一起听's stage", () => {
  it("in a room the map's roaches stand, darkened, the ball and lights as ever; the room's stage dances in their place", () => {
    const st = roomStage(3);
    start(false, false);
    play(10);
    run(3000);
    // the map: darkened all over by the page, its roaches too, nobody dancing on it, no lights at their feet
    expect(last().dim).toBeCloseTo(0.8, 3);
    expect(dance().dim).toBe(0);
    expect(dance().on).toBe(0);
    expect(dance().light).toBe(0);
    expect(last().fx).toBe("full");
    expect(last().ballY).toBeCloseTo(0, 3);
    // the stage: in with the lights, each roach moved about its feet, every other one with its sleeves up
    expect(st.root.el.style.opacity).toBe("1.000");
    for (const f of st.figs) {
      expect(f.props.get("transform")).toMatch(/^translate\(/);
      expect(f.props.get("transform-origin")).toBe("50% 92%");
    }
    expect(st.figs.map((f) => f.classes.has("up"))).toEqual([false, true, false]);
    st.back();
  });

  it("stands with less motion asked for: the lights alone, and the stage there with them", () => {
    const st = roomStage(2);
    start(true, false);
    play(10);
    run(3000);
    expect(st.root.el.style.opacity).toBe("1.000");
    expect(st.figs.every((f) => !f.props.has("transform") && !f.classes.has("up"))).toBe(true);
    expect(last().fx).toBe("still");
    st.back();
  });

  it("goes with the lights: its roaches standing again, sleeves down, and it faded out", () => {
    const st = roomStage(2);
    start(false, false);
    play(10);
    run(3000);
    expect(st.figs[1].classes.has("up")).toBe(true);
    pause();
    run(3500);
    expect(drawn.removed).toBe(1);
    expect(st.root.el.style.opacity).toBe("0");
    expect(st.figs.every((f) => !f.props.has("transform") && !f.classes.has("up"))).toBe(true);
    st.back();
  });

  it("dances where the map cannot draw its roaches dancing (轻量's piles): page elements can", () => {
    crowd = "lite";
    const st = roomStage(2);
    start(false, false);
    play(10);
    run(3000);
    expect(dance().on).toBe(0);
    expect(st.figs.every((f) => f.props.has("transform"))).toBe(true);
    st.back();
  });

  it("steps down on a slow phone while only the stage dances, and stands at the lights alone", () => {
    const st = roomStage(2);
    start(false, false);
    play(10);
    run(15_000, 12);
    expect(last().fx).toBe("calm");
    expect(st.figs.every((f) => !f.props.has("transform") && !f.classes.has("up"))).toBe(true);
    expect(st.root.el.style.opacity).toBe("1.000");
    st.back();
  });

  it("is danced only in a room: alone, the map's roaches dance as ever", () => {
    const st = roomStage(2);
    start();
    play(10);
    run(3000);
    expect(dance().on).toBeGreaterThan(0.9);
    expect(st.figs.every((f) => !f.props.has("transform"))).toBe(true);
    expect(st.root.el.style.opacity).toBe("");
    st.back();
  });
});

describe("一起听's 拉远", () => {
  it("is drawn in the stage's place each frame with the lights, the beat and its notes going; the ball with no beams", () => {
    const st = roomStage(2);
    const far = roomFar();
    start(false, false);
    play(10);
    run(3000);
    expect(far.last().shown).toBeCloseTo(1, 3);
    expect(far.last().moving).toBe(true);
    expect(far.last().beat).toBeCloseTo(last().beat, 6);
    expect(last().fx).toBe("lite");
    expect(last().dim).toBeCloseTo(0.8, 3);
    // the map's roaches stand, and no stage is drawn
    expect(dance().on).toBe(0);
    expect(st.root.el.style.opacity).toBe("");
    expect(st.figs.every((f) => !f.props.has("transform"))).toBe(true);
    far.back();
    st.back();
  });

  it("stands with less motion asked for: its notes lit, not going", () => {
    const far = roomFar();
    start(true, false);
    play(10);
    run(3000);
    expect(far.last().shown).toBeCloseTo(1, 3);
    expect(far.last().moving).toBe(false);
    expect(last().fx).toBe("still");
    far.back();
  });

  it("steps down on a slow phone to 省电版 and no further, its notes standing there", () => {
    const far = roomFar();
    start(false, false);
    play(10);
    run(15_000, 12);
    expect(last().fx).toBe("lite");
    expect(far.last().moving).toBe(false);
    far.back();
  });

  it("goes with the lights, faded out with them", () => {
    const far = roomFar();
    start(false, false);
    play(10);
    run(3000);
    pause();
    run(3500);
    expect(drawn.removed).toBe(1);
    const shown = far.frames.map((f) => f.shown);
    expect(Math.min(...shown.slice(-10))).toBeLessThan(0.05);
    far.back();
  });

  it("is drawn only in a room: alone the map's roaches dance as ever", () => {
    const far = roomFar();
    start();
    play(10);
    run(3000);
    expect(far.frames).toHaveLength(0);
    expect(dance().on).toBeGreaterThan(0.9);
    expect(last().fx).toBe("full");
    far.back();
  });
});
