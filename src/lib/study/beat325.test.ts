import { afterEach, describe, expect, it, vi } from "vitest";
import { mulberry32 } from "../prng";
import {
  BASS,
  BEAT,
  BEAT_GROUPS,
  type BeatSong,
  type Chart,
  beatChart,
  beatResult,
  beatTune,
  missed,
  type Note,
  roundEnd,
  SING,
  type Tally,
  tallyStart,
  tapAt,
} from "./beat325";

const chartOf = (seed: number) => beatChart(mulberry32(seed));
/** Each note's place on the eighths */
const eighthsOf = (c: Chart) => c.notes.map((n) => n.at / (c.beat / 2));
/** A chart's passes, each its notes */
const passesOf = (c: Chart) => {
  const passes: Note[][] = [];
  for (const n of c.notes) (passes[n.pass] ??= []).push(n);
  return passes;
};
/** A chart of a note every beat from the third, and a tally that hit the first n and has these strays */
const plain = (notes: number): Chart => ({
  bpm: 120,
  beat: 500,
  bar: 0,
  notes: Array.from({ length: notes }, (_, i) => ({ at: 1000 + 500 * i, digit: 3, pass: 0, k: 0 })),
  end: 1000 + 500 * (notes - 1) + 1000,
});
const tallyOf = (c: Chart, hits: number, strays: number): Tally => ({ got: c.notes.map((_, i) => (i < hits ? 1 : 0)), strays });

describe("325 节拍's chart", () => {
  it("is the same for the same seed and another for another", () => {
    expect(chartOf(325)).toEqual(chartOf(325));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) seen.add(JSON.stringify(chartOf(seed).notes.map((n) => n.at)));
    expect(seen.size).toBe(50);
  });

  it("plays each pass as 3, 2, 5: groups of three, two and five notes in that order, an eighth apart in a group", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const c = chartOf(seed);
      const e = eighthsOf(c);
      for (const n of e) expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
      const passes = passesOf(c);
      expect(passes.length).toBeGreaterThanOrEqual(5);
      for (const pass of passes) {
        expect(pass.map((n) => n.digit)).toEqual(BEAT_GROUPS.flatMap((d) => Array<number>(d).fill(d)));
        expect(pass.map((n) => n.k)).toEqual([0, 1, 2, 0, 1, 0, 1, 2, 3, 4]);
        for (let i = 1; i < pass.length; i++) if (pass[i].digit === pass[i - 1].digit) expect(pass[i].at - pass[i - 1].at).toBeCloseTo(c.beat / 2, 6);
      }
    }
  });

  it("rests between groups and between passes as long as the list says, dealt afresh, a little less later on", () => {
    const groupRests = new Set<number>();
    const passRests = new Set<number>();
    const laterRests = new Set<number>();
    for (let seed = 1; seed <= 1000; seed++) {
      const c = chartOf(seed);
      const eighth = c.beat / 2;
      const rest = (a: Note, b: Note) => Math.round((b.at - a.at) / eighth) - 1;
      const passes = passesOf(c);
      for (const pass of passes)
        for (let i = 1; i < pass.length; i++) {
          if (pass[i].digit === pass[i - 1].digit) continue;
          const r = rest(pass[i - 1], pass[i]);
          expect(r).toBeGreaterThanOrEqual(BEAT.groupRest[0]);
          expect(r).toBeLessThanOrEqual(BEAT.groupRest[1]);
          groupRests.add(r);
        }
      for (let p = 1; p < passes.length; p++) {
        const end = passes[p - 1][passes[p - 1].length - 1];
        // a pass's rest in beats: a whole number of them, after its last note's eighth
        const r = rest(end, passes[p][0]) / 2;
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(BEAT.passRest[0]);
        expect(r).toBeLessThanOrEqual(BEAT.passRest[1] - (end.at > BEAT.ms / 2 ? 1 : 0));
        (end.at > BEAT.ms / 2 ? laterRests : passRests).add(r);
      }
    }
    expect([...groupRests].sort()).toEqual([1, 2, 3]);
    expect([...passRests].sort()).toEqual([2, 3, 4]);
    expect([...laterRests].sort()).toEqual([2, 3]);
  });

  it("leaves the first two beats empty: the first note lands on the third", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const c = chartOf(seed);
      expect(c.notes[0].at).toBeCloseTo(BEAT.leadBeats * c.beat, 6);
      for (const n of c.notes) expect(n.at).toBeGreaterThanOrEqual(BEAT.leadBeats * c.beat - 1e-6);
    }
  });

  it("is a tune of about 40 seconds at 112 to 120 beats a minute, over two beats after its last note", () => {
    const bpms = new Set<number>();
    let shortest = Infinity;
    for (let seed = 1; seed <= 1000; seed++) {
      const c = chartOf(seed);
      bpms.add(c.bpm);
      expect(c.bpm).toBeGreaterThanOrEqual(BEAT.bpm[0]);
      expect(c.bpm).toBeLessThanOrEqual(BEAT.bpm[1]);
      expect(c.beat).toBeCloseTo(60_000 / c.bpm, 9);
      expect(c.end).toBeCloseTo(c.notes[c.notes.length - 1].at + 2 * c.beat, 6);
      expect(c.end).toBeLessThanOrEqual(BEAT.ms);
      shortest = Math.min(shortest, c.end);
      for (let i = 1; i < c.notes.length; i++) expect(c.notes[i].at).toBeGreaterThan(c.notes[i - 1].at);
    }
    expect(bpms.size).toBe(BEAT.bpm[1] - BEAT.bpm[0] + 1);
    expect(shortest).toBeGreaterThan(30_000);
  });
});

describe("325 节拍's chart to a song", () => {
  type Clip = Pick<BeatSong, "beat" | "bar" | "first" | "ms">;
  const clipOf = (beat: number, bar: number, ms = 43_000, first = 1500): Clip => ({ beat, bar, first, ms });
  const songChart = (seed: number, clip: Clip) => beatChart(mulberry32(seed), clip);

  it("goes at the song's beat, each pass starting on a bar's first beat, the first after two empty beats", () => {
    for (const beat of [60_000 / 135, 500, 523.4, 60_000 / 100])
      for (const bar of [0, 1, 2, 3])
        for (let seed = 1; seed <= 150; seed++) {
          const c = songChart(seed, clipOf(beat, bar));
          expect([c.beat, c.bpm, c.bar]).toEqual([beat, 60_000 / beat, bar]);
          const passes = passesOf(c);
          expect(passes.length).toBeGreaterThanOrEqual(4);
          for (const pass of passes) {
            expect(pass.map((n) => n.digit)).toEqual(BEAT_GROUPS.flatMap((d) => Array<number>(d).fill(d)));
            const e = pass[0].at / (beat / 2);
            expect(Math.abs(e - Math.round(e))).toBeLessThan(1e-9);
            // on a beat, and that beat a bar's first
            expect(Math.round(e) % 2).toBe(0);
            expect((((Math.round(e) / 2 - bar) % 4) + 4) % 4).toBe(0);
          }
          // the first: on the first bar's first beat from the third beat on
          expect(passes[0][0].at / beat).toBeCloseTo(BEAT.leadBeats + ((((bar - BEAT.leadBeats) % 4) + 4) % 4), 6);
          // between passes: at least the fewest beats of rest (one fewer later on), then on to the next bar
          for (let p = 1; p < passes.length; p++) {
            const end = passes[p - 1][passes[p - 1].length - 1];
            const rest = Math.round((passes[p][0].at - end.at) / (beat / 2) - 1) / 2;
            const least = BEAT.passRest[0] - (end.at > BEAT.ms / 2 ? 1 : 0);
            expect(rest).toBeGreaterThanOrEqual(least);
            expect(rest).toBeLessThan(least + 4);
          }
          expect(c.end).toBeCloseTo(c.notes[c.notes.length - 1].at + 2 * beat, 6);
          expect(c.end).toBeLessThanOrEqual(BEAT.ms);
          // the next pass did not fit: at most its notes and a rest to the next bar short
          expect(c.end).toBeGreaterThan(BEAT.ms - 14 * beat);
        }
  });

  it("is the same for the same seed and song, and leaves the electronic tune's alone", () => {
    const clip = clipOf(480, 1);
    expect(songChart(9, clip)).toEqual(songChart(9, clip));
    expect(songChart(9, clip).notes).not.toEqual(songChart(10, clip).notes);
    expect(chartOf(9).bar).toBe(0);
    expect(beatChart(mulberry32(9), undefined)).toEqual(chartOf(9));
  });

  it("ends two beats before a short clip starts to fade out", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = songChart(seed, clipOf(500, 0, 32_000, 1000));
      expect(c.end).toBeLessThanOrEqual(32_000 - 1000 - BEAT.songFadeMs);
      expect(c.notes.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("can be played as any chart: each note hit, then the round passed", () => {
    const c = songChart(3, clipOf(470, 2));
    let s = tallyStart(c);
    for (const n of c.notes) s = tapAt(c, s, n.at - 20).tally;
    expect(beatResult(c, s)).toMatchObject({ hits: c.notes.length, won: true });
  });
});

describe("325 节拍's tune", () => {
  it("sings each note as its group says: 3 mi, 2 re, 5 sol, as long as it lasts", () => {
    expect(SING[3]).toBeCloseTo(659.26, 1);
    expect(SING[2]).toBeCloseTo(587.33, 1);
    expect(SING[5]).toBeCloseTo(783.99, 1);
    for (let seed = 1; seed <= 100; seed++) {
      const c = chartOf(seed);
      const lead = beatTune(c).filter((s) => s.what === "lead");
      expect(lead.map((s) => s.at)).toEqual(c.notes.map((n) => n.at));
      lead.forEach((s, i) => s.what === "lead" && expect(s.hz).toBe(SING[c.notes[i].digit]));
    }
  });

  it("keeps time from its first beat with a drum on every beat, a hi-hat every eighth and the bass, then closes", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = chartOf(seed);
      const tune = beatTune(c);
      for (let i = 1; i < tune.length; i++) expect(tune[i].at).toBeGreaterThanOrEqual(tune[i - 1].at);
      const last = c.notes[c.notes.length - 1].at;
      const crash = tune.filter((s) => s.what === "crash");
      expect(crash).toHaveLength(1);
      const close = crash[0].at;
      // a beat, the first after the last note's eighth, before the tune ends
      expect(close / c.beat).toBeCloseTo(Math.round(close / c.beat), 6);
      expect(close).toBeGreaterThanOrEqual(last + c.beat / 2 - 1e-6);
      expect(close).toBeLessThanOrEqual(last + c.beat + 1e-6);
      expect(close).toBeLessThan(c.end);
      const beats = Math.round(close / c.beat);
      const on = (what: string) => tune.filter((s) => s.what === what && s.at < close - 1e-6).map((s) => Math.round((s.at / c.beat) * 2) / 2);
      expect(on("kick")).toEqual(Array.from({ length: Math.ceil(beats / 2) }, (_, i) => 2 * i));
      expect(on("snare")).toEqual(Array.from({ length: Math.floor(beats / 2) }, (_, i) => 2 * i + 1));
      expect(on("hat")).toEqual(Array.from({ length: 2 * beats }, (_, i) => i / 2));
      const bass = tune.filter((s) => s.what === "bass" && s.at < close - 1e-6);
      expect(bass).toHaveLength(beats);
      bass.forEach((s, b) => s.what === "bass" && expect(s.hz).toBe(BASS[Math.floor(b / 4) % 4] * (b % 2 ? 2 : 1)));
      // the first two beats only keep time
      expect(tune.filter((s) => s.what === "lead" && s.at < 2 * c.beat - 1e-6)).toHaveLength(0);
      expect(tune.filter((s) => s.at < 2 * c.beat - 1e-6).map((s) => s.what)).toContain("kick");
    }
  });
});

describe("325 节拍's taps", () => {
  const c = chartOf(325);
  const first = c.notes[0].at;

  /** A note with a rest after it, the last of a pass: nothing but it within reach after it */
  const lone = c.notes.findIndex((n, i) => i > 0 && n.pass !== c.notes[i - 1].pass) - 1;

  it("hit a note within 100 ms of it, either way, and are 正好 within 45; a little further off, only early or late", () => {
    expect(c.notes[lone + 1].at - c.notes[lone].at).toBeGreaterThan(2 * BEAT.nearMs);
    // after the last note of a pass, and before the first of the next: a rest on that side of each
    for (const [i, d, did] of [
      [lone, 0, "exact"],
      [lone, BEAT.exactMs, "exact"],
      [lone + 1, -BEAT.exactMs, "exact"],
      [lone, BEAT.exactMs + 1, "hit"],
      [lone + 1, -BEAT.exactMs - 1, "hit"],
      [lone, BEAT.hitMs, "hit"],
      [lone + 1, -BEAT.hitMs, "hit"],
      [lone, BEAT.hitMs + 1, "late"],
      [lone + 1, -BEAT.hitMs - 1, "early"],
      [lone, BEAT.nearMs, "late"],
      [lone + 1, -BEAT.nearMs, "early"],
      [lone, BEAT.nearMs + 1, "stray"],
      [lone + 1, -BEAT.nearMs - 1, "stray"],
    ] as const) {
      const r = tapAt(c, tallyStart(c), c.notes[i].at + d);
      expect(r.did, `${d} ms`).toBe(did);
      expect(r.i).toBe(did === "stray" ? -1 : i);
      expect(r.tally.got[i]).toBe(did === "exact" ? 2 : did === "hit" ? 1 : 0);
      expect(r.tally.strays).toBe(did === "stray" ? 1 : 0);
    }
  });

  it("are late for a note let go before early for the next, and early for the next once that one is hit", () => {
    // two notes an eighth apart, and a tap 150 ms after the first: 100 or so before the second
    const t = c.notes[0].at + 150;
    expect(c.notes[1].at - t).toBeGreaterThan(BEAT.hitMs);
    expect(tapAt(c, tallyStart(c), t)).toMatchObject({ did: "late", i: 0 });
    const hit = tapAt(c, tallyStart(c), c.notes[0].at).tally;
    expect(tapAt(c, hit, t)).toMatchObject({ did: "early", i: 1 });
  });

  it("cost nothing a little off a note: the note can still be hit after", () => {
    // the first note after a rest
    const n = c.notes[lone + 1].at;
    const early = tapAt(c, tallyStart(c), n - 150);
    expect(early.did).toBe("early");
    expect(early.i).toBe(lone + 1);
    expect(early.tally).toEqual(tallyStart(c));
    const then = tapAt(c, early.tally, n + 10);
    expect(then.did).toBe("exact");
    expect(then.i).toBe(lone + 1);
  });

  it("hit the nearest note not hit yet, and a second tap on a note is a stray", () => {
    const second = c.notes[1].at;
    const r = tapAt(c, tallyStart(c), second - 20);
    expect(r.i).toBe(1);
    const n = c.notes[lone].at;
    const once = tapAt(c, tallyStart(c), n);
    const again = tapAt(c, once.tally, n + 10);
    expect(again.did).toBe("stray");
    expect(again.tally.strays).toBe(1);
    expect(again.tally.got).toEqual(once.tally.got);
  });

  it("count as strays only while the notes are coming: before them, in the empty beats, and after them, nothing", () => {
    const s = tallyStart(c);
    const last = c.notes[c.notes.length - 1].at;
    for (const t of [-500, 0, first - BEAT.nearMs - 1, last + BEAT.nearMs + 1, c.end]) {
      const r = tapAt(c, s, t);
      expect(r.did, `${t}`).toBe("off");
      expect(r.tally).toBe(s);
    }
    // between two passes, well away from both
    expect(tapAt(c, s, (c.notes[lone].at + c.notes[lone + 1].at) / 2).did).toBe("stray");
    // a tap on every eighth of the tune, notes or not: as many strays as there are eighths of rest, near enough
    let all = tallyStart(c);
    for (let t = 0; t < c.end; t += c.beat / 2) all = tapAt(c, all, t).tally;
    expect(beatResult(c, all)).toMatchObject({ hits: c.notes.length, won: false });
    expect(all.strays).toBeGreaterThan(0.8 * c.notes.length);
  });

  it("leave a note missed once it is past hitting, not before, and never a hit one", () => {
    const s = tallyStart(c);
    expect(missed(c, s, 0, first + BEAT.hitMs)).toBe(false);
    expect(missed(c, s, 0, first + BEAT.hitMs + 1)).toBe(true);
    expect(missed(c, tapAt(c, s, first).tally, 0, first + 10_000)).toBe(false);
  });
});

describe("325 节拍's round", () => {
  it("passes when hits less strays come to eight in ten of the notes", () => {
    const c = plain(70);
    expect(beatResult(c, tallyOf(c, 56, 0))).toMatchObject({ hits: 56, total: 70, won: true });
    expect(beatResult(c, tallyOf(c, 55, 0)).won).toBe(false);
    // each stray takes a hit back
    expect(beatResult(c, tallyOf(c, 57, 1)).won).toBe(true);
    expect(beatResult(c, tallyOf(c, 57, 2)).won).toBe(false);
    expect(beatResult(c, tallyOf(c, 70, 14)).won).toBe(true);
    expect(beatResult(c, tallyOf(c, 70, 15)).won).toBe(false);
    // 正好 counts as a hit
    expect(beatResult(c, { got: c.notes.map((_, i) => (i < 56 ? 2 : 0)), strays: 0 }).won).toBe(true);
  });

  it("names the strays when there are three or more, or any that cost the pass", () => {
    const c = plain(70);
    expect(beatResult(c, tallyOf(c, 70, 2)).strayNamed).toBe(false);
    expect(beatResult(c, tallyOf(c, 70, 3)).strayNamed).toBe(true);
    // two strays that cost it: 57 hits would pass
    expect(beatResult(c, tallyOf(c, 57, 2)).strayNamed).toBe(true);
    // one that does not: 40 hits fail anyway
    expect(beatResult(c, tallyOf(c, 40, 1)).strayNamed).toBe(false);
  });

  it("tells nothing when the page was put away: the round is void, neither passed nor failed", () => {
    const c = plain(70);
    expect(roundEnd(c, tallyOf(c, 70, 0), "hidden")).toBeNull();
    expect(roundEnd(c, tallyOf(c, 0, 0), "hidden")).toBeNull();
    expect(roundEnd(c, tallyOf(c, 70, 0), "played")).toEqual(beatResult(c, tallyOf(c, 70, 0)));
  });

  it("plays a whole chart through as a tap on each note passes it, and one a little off each fails it, costing nothing more", () => {
    const c = chartOf(7);
    let s = tallyStart(c);
    for (const n of c.notes) s = tapAt(c, s, n.at + 30).tally;
    expect(beatResult(c, s)).toMatchObject({ hits: c.notes.length, strays: 0, won: true, strayNamed: false });
    let off = tallyStart(c);
    for (const n of c.notes) off = tapAt(c, off, n.at + 120).tally;
    expect(beatResult(c, off)).toMatchObject({ hits: 0, strays: 0, won: false, strayNamed: false });
    // a tap every 90 ms the whole tune: every note hit, and it fails on the strays
    let spam = tallyStart(c);
    for (let t = 0; t < c.end; t += 90) spam = tapAt(c, spam, t).tally;
    expect(beatResult(c, spam)).toMatchObject({ hits: c.notes.length, won: false, strayNamed: true });
  });
});

describe("325 节拍's songs played lately, kept on this device", () => {
  function storage(keeps: boolean) {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (keeps ? (m.get(k) ?? null) : null),
      setItem: (k: string, v: string) => {
        if (!keeps) throw new Error("QuotaExceededError");
        m.set(k, v);
      },
      raw: m,
    };
  }
  // the module keeps what it played last for a browser that keeps nothing: a fresh copy for each test
  async function load() {
    vi.resetModules();
    return import("./beat325");
  }
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the last ten, the latest last, in the browser", async () => {
    const store = storage(true);
    vi.stubGlobal("localStorage", store);
    const { playedSong, recentSongs } = await load();
    expect(recentSongs()).toEqual([]);
    for (let k = 0; k < 15; k++) playedSong(`s${k}`);
    expect(recentSongs()).toEqual(Array.from({ length: BEAT.recentSongs }, (_, i) => `s${5 + i}`));
    // one played again goes last, once
    playedSong("s7");
    expect(recentSongs().at(-1)).toBe("s7");
    expect(recentSongs().filter((k) => k === "s7")).toHaveLength(1);
    // a fresh page reads them back; what is not a song's id is let go
    expect((await load()).recentSongs()).toHaveLength(BEAT.recentSongs);
    store.raw.set("zhoup.study.beatSongs", JSON.stringify(["a", 3, "bad id!", null, "b"]));
    expect((await load()).recentSongs()).toEqual(["a", "b"]);
    store.raw.set("zhoup.study.beatSongs", "{not json");
    expect((await load()).recentSongs()).toEqual([]);
  });

  it("keeps them while the page is open where the browser keeps nothing, and where there is no storage at all", async () => {
    vi.stubGlobal("localStorage", storage(false));
    const { playedSong, recentSongs } = await load();
    playedSong("a");
    playedSong("b");
    expect(recentSongs()).toEqual(["a", "b"]);
    expect((await load()).recentSongs()).toEqual([]);
    vi.stubGlobal("localStorage", undefined);
    const bare = await load();
    bare.playedSong("c");
    expect(bare.recentSongs()).toEqual(["c"]);
  });
});
