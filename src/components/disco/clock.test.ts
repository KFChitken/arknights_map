import { describe, expect, it } from "vitest";
import { readDance } from "@/lib/dance";
import { beatAt, DISCO_LAG_S, pictureTime, SongClock } from "./clock";

const beats = Float64Array.from([0.5, 1, 1.5, 2, 2.5, 3]);

describe("beatAt", () => {
  it("finds the beat a time is at, and how far on to the next", () => {
    expect(beatAt(beats, 0.5, 120)).toBe(0);
    expect(beatAt(beats, 0.75, 120)).toBeCloseTo(0.5);
    expect(beatAt(beats, 2.6, 120)).toBeCloseTo(4.2);
    expect(beatAt(beats, 3, 120)).toBe(5);
  });

  it("goes on at the first and last beats' pace before and after them", () => {
    expect(beatAt(beats, 0, 120)).toBeCloseTo(-1);
    expect(beatAt(beats, 4, 120)).toBeCloseTo(7);
    // one beat alone: the tempo's
    expect(beatAt(Float64Array.from([2]), 2.25, 120)).toBeCloseTo(0.5);
    expect(Number.isNaN(beatAt(new Float64Array(0), 1, 120))).toBe(true);
  });

  it("follows beats that are not evenly spaced, as a table read gives them", () => {
    const t = readDance(JSON.stringify({ v: 1, bpm: 100, bar: 0, t: "50,60,60,61,59", e: "55555" }));
    if (!t || t.none) throw new Error("table");
    expect(Array.from(t.beats)).toEqual([0.5, 1.1, 1.7, 2.31, 2.9]);
    expect(beatAt(t.beats, 2.31 + 0.295, 100)).toBeCloseTo(3.5);
  });
});

describe("pictureTime", () => {
  it("is the song's own time while its smaller copy plays, a little behind for what is heard", () => {
    expect(pictureTime(10, 0)).toBeCloseTo(10 - DISCO_LAG_S);
    expect(pictureTime(10, -0.085)).toBeCloseTo(10 - 0.085 - DISCO_LAG_S);
  });
});

describe("SongClock", () => {
  it("goes on by itself between readings that are the same while the song sounds", () => {
    const c = new SongClock();
    expect(c.at("a", 10, 1, true, 1000)).toBe(10);
    // the browser has not moved currentTime on: the clock has
    expect(c.at("a", 10, 1, true, 1100)).toBeCloseTo(10.1);
    expect(c.at("a", 10, 1, true, 1200)).toBeCloseTo(10.2);
    // but not for ever
    expect(c.at("a", 10, 1, true, 5000)).toBeLessThanOrEqual(10.6 + 1e-9);
  });

  it("drifts back to the element gently, never stepping back", () => {
    const c = new SongClock();
    c.at("a", 10, 1, true, 1000);
    const a = c.at("a", 10, 1, true, 1033);
    // the element says a little less than the clock had: eased towards it
    const b = c.at("a", 10.02, 1, true, 1066);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(a + 0.033);
  });

  it("holds where the element is while held, and jumps with a seek or another song", () => {
    const c = new SongClock();
    c.at("a", 10, 1, true, 1000);
    expect(c.at("a", 10.2, 1, false, 1500)).toBe(10.2);
    expect(c.at("a", 10.2, 1, false, 2500)).toBe(10.2);
    // a seek, sounding again
    c.at("a", 30, 1, true, 3000);
    expect(c.at("a", 30, 1, true, 3033)).toBeCloseTo(30.033);
    expect(c.at("b", 0, 1, true, 3066)).toBe(0);
  });

  it("goes at the element's rate", () => {
    const c = new SongClock();
    c.at("a", 10, 2, true, 1000);
    expect(c.at("a", 10, 2, true, 1100)).toBeCloseTo(10.2);
  });
});
