import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { STREAM_DOWN_SAID_MS, streamDownSaid, streamDownSince, streamDropped, streamUp } from "../stream";
import { forgetSquadPage, loadSquadRoom, retrySquadRoom, squadRoomNow, squadStaleNow } from "./squading";

// the room not read again, and the page's live connection down: what the room's top says

const NOW = Date.parse("2026-11-21T15:00:00+08:00");
const member = (h: number): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流"][h] ?? "",
  host: h === 1,
  you: h === 1,
  friend: false,
  inGame: false,
  pose: 0,
  avatar: "hood",
  color: "cyan",
  core: 0,
  strategy: null,
  extras: [],
});
const room = (): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "wait",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2)],
  wentAt: null,
  waitedAt: NOW,
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
  stack: { round: 1, at: NOW, n: 0, sum: 0, top: [], swingAt: NOW, best: 0, busy: [] },
  mode: null,
  endsAt: NOW + 3_600_000,
  endsWhy: "idle",
  declared: false,
  invited: [],
  hear: true,
  listen: null,
  now: NOW,
});

describe("the room not read again", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** The page's window with its timers kept (what is due, after how long), and the server answering the room as given */
  function page(answers: (() => Response | Promise<Response>)[]) {
    const timers: { fn: () => void; ms: number }[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    let asked = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url !== "/api/squad/room") return new Response("{}");
      const next = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
      return next();
    });
    return { timers, asked: () => asked };
  }
  const ok = () => new Response(JSON.stringify({ room: room(), now: NOW }));
  const busy = () => new Response(JSON.stringify({ error: "慢点" }), { status: 429 });
  const down = () => Promise.reject(new TypeError("offline"));
  /** A timer due, run: its read, and the microtasks after it */
  const run = async (t: { fn: () => void }) => {
    t.fn();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it("tries again 5 s and then 15 s on, never sooner on a 429; then says so till a tap reads it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { timers, asked } = page([busy]);
    await expect(loadSquadRoom()).rejects.toThrow("慢点");
    expect(squadStaleNow()).toEqual({ at: NOW, gaveUp: false });
    expect(timers.map((t) => t.ms)).toEqual([5_000]);
    // another read failing meanwhile (a tell to the room) brings nothing sooner
    await expect(loadSquadRoom()).rejects.toThrow();
    expect(timers).toHaveLength(1);
    await run(timers[0]);
    expect(timers.map((t) => t.ms)).toEqual([5_000, 15_000]);
    expect(squadStaleNow()).toEqual({ at: NOW, gaveUp: false });
    await run(timers[1]);
    // stopped: said at the room's top, no more tries by itself
    expect(squadStaleNow()).toEqual({ at: NOW, gaveUp: true });
    expect(timers).toHaveLength(2);
    expect(asked()).toBe(4);
    // a tap still failing: as it was
    await retrySquadRoom();
    expect(squadStaleNow()).toMatchObject({ gaveUp: true });
    expect(timers).toHaveLength(2);
  });

  it("goes once the room is read, a tap's read too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const answers = [down, ok];
    const { timers } = page(answers);
    await expect(loadSquadRoom()).rejects.toThrow();
    expect(squadStaleNow()).toEqual({ at: NOW, gaveUp: false });
    await run(timers[0]);
    expect(squadStaleNow()).toBeNull();
    expect(squadRoomNow()?.id).toBe("r1");
    // given up, then a tap that reads it
    forgetSquadPage();
    const again = page([down, down, down, ok]);
    await expect(loadSquadRoom()).rejects.toThrow();
    await run(again.timers[0]);
    await run(again.timers[1]);
    expect(squadStaleNow()).toMatchObject({ gaveUp: true });
    await retrySquadRoom();
    expect(squadStaleNow()).toBeNull();
  });

  it("says nothing of a refusal that asking again would not mend", async () => {
    const { timers } = page([() => new Response(JSON.stringify({ error: "这里没有" }), { status: 404 })]);
    await expect(loadSquadRoom()).rejects.toThrow("这里没有");
    expect(squadStaleNow()).toBeNull();
    expect(timers).toHaveLength(0);
  });
});

describe("the page's live connection down", () => {
  afterEach(() => streamUp());

  it("is said once it has been down 3 s, not for a moment's drop, and goes as it opens again", () => {
    streamDropped(NOW);
    expect(streamDownSince()).toBe(NOW);
    // erring again while down keeps when it went
    streamDropped(NOW + 1_000);
    expect(streamDownSince()).toBe(NOW);
    expect(streamDownSaid(streamDownSince(), NOW + STREAM_DOWN_SAID_MS - 1)).toBe(false);
    expect(streamDownSaid(streamDownSince(), NOW + STREAM_DOWN_SAID_MS)).toBe(true);
    streamUp();
    expect(streamDownSince()).toBeNull();
    expect(streamDownSaid(null, NOW + 60_000)).toBe(false);
  });
});
