import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AmapStage, offerStage } from "@/components/map/discoStage";
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
    ...over,
  });
}
const host = { getBoundingClientRect: () => ({ left: 0, width: 400 }) } as unknown as HTMLElement;
let onShown: ReturnType<typeof vi.fn<(on: boolean) => void>>;
function start(still = false) {
  disco = startDisco(host, { onShown });
  disco.set({ want: true, still });
  return disco;
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
    d.set({ want: false, still: false });
    run(1300);
    expect(drawn.removed).toBe(1);
    expect(onShown).toHaveBeenLastCalledWith(false);
    d.set({ want: true, still: false });
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
    d.set({ want: true, still: false });
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
    d.set({ want: true, still: false });
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
