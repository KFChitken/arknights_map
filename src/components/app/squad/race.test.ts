import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  RACE_BASE,
  RACE_LEAD_MS,
  RACE_M,
  RACE_MAX_MS,
  RACE_OBS_FROM,
  RACE_OBS_GAP,
  RACE_OBS_TO,
  RACE_PER_TAP,
  raceObstacles,
  raceOrder,
  raceRun,
  type RaceData,
  type RaceEnd,
  type RaceMode,
  type RaceObstacle,
} from "@/lib/squadMode";
import { RaceView, laneOf, racePhase, raceStatus, raceTip } from "./SquadRace";
import { forgetSquadPage, heardSquad, loadSquadRoom, squadRaceJump, squadRaceTap, squadRoomNow } from "./squading";

const NOW = Date.parse("2026-11-20T13:00:00+08:00");
const member = (h: number, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流", "漏勺本勺", "小龙"][h] ?? `人机 ${-h}`,
  host: h === 1,
  you: h === 1,
  friend: false,
  inGame: true,
  pose: 0,
  avatar: "hood",
  color: "cyan",
  core: 0,
  strategy: null,
  extras: [],
  ...more,
});
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
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
  members: [member(1), member(2), member(3), member(4)],
  wentAt: null,
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
  mode: null,
  endsAt: NOW + 3_600_000,
  endsWhy: "idle",
  declared: false,
  invited: [],
  hear: true,
  listen: null,
  now: NOW,
  ...more,
});
const BOTS = [
  { h: -100, no: 1, avatar: "imp", color: "red" },
  { h: -101, no: 2, avatar: "gugu", color: "blue" },
  { h: -102, no: 3, avatar: "hood", color: "cyan" },
];
/** You (h 1) and 企鹅物流 (h 2) with two of its own 人机, starting at NOW, no obstacles unless given */
const race = (more: Partial<RaceMode> = {}): RaceMode => ({
  kind: "race",
  by: 1,
  at: NOW - RACE_LEAD_MS,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  endsAt: NOW + 40_000,
  until: NOW + 40_000,
  start: NOW,
  seed: 3,
  lanes: [1, 2, -100, -101].map((h) => ({ h, taps: [], jumps: [] })),
  obs: [],
  bots: BOTS,
  ...more,
});
/** 加油 at full rate (two each quarter second) from a time on */
const flatOut = (from: number, n = 120): [number, number][] => Array.from({ length: n }, (_, k) => [from + k * 250, 2]);
const nothing = () => {};
function view(r: SquadRoom, now: number, rate = 0) {
  return renderToStaticMarkup(
    createElement(RaceView, {
      room: r,
      mode: r.mode as RaceMode,
      now,
      rate,
      busy: false,
      msg: null,
      onClose: nothing,
      onTap: nothing,
      onJump: nothing,
      onJoin: nothing,
      onLeave: nothing,
      onAgain: nothing,
    }),
  );
}

describe("the race's rule", () => {
  const plain = (lanes: RaceData["lanes"], obs: RaceObstacle[] = []): Pick<RaceData, "seed" | "start" | "lanes" | "obs"> => ({ seed: 3, start: NOW, lanes, obs });

  it("lays out its five obstacles from the seed, apart and between the marks, the same each time", () => {
    const obs = raceObstacles(12345);
    expect(obs.map((o) => o.k).sort()).toEqual(["bar", "potion", "slug", "water", "water"]);
    expect(obs.every((o) => o.m >= RACE_OBS_FROM && o.m <= RACE_OBS_TO)).toBe(true);
    for (let i = 1; i < obs.length; i++) expect(obs[i].m - obs[i - 1].m).toBeGreaterThanOrEqual(RACE_OBS_GAP - 1);
    expect(raceObstacles(12345)).toEqual(obs);
    expect(raceObstacles(54321)).not.toEqual(obs);
  });

  it("runs a player at 7 m/s and 2.4 more for each 加油 in the last second, six at most, coming up to it smoothly", () => {
    const slow = raceRun(plain([{ h: 1, taps: [], jumps: [] }]), NOW + 10_000);
    expect(slow.v[0]).toBeCloseTo(RACE_BASE, 3);
    expect(slow.x[0]).toBeGreaterThan(66);
    expect(slow.x[0]).toBeLessThan(70);
    const fast = raceRun(plain([{ h: 1, taps: flatOut(NOW), jumps: [] }]), NOW + 10_000);
    expect(fast.v[0]).toBeCloseTo(RACE_BASE + 6 * RACE_PER_TAP, 2);
    // more than six a second count as six
    const batches = (n: number) => Array.from({ length: 40 }, (_, k): [number, number] => [NOW + k * 250, n]);
    const six = raceRun(plain([{ h: 1, taps: batches(6), jumps: [] }]), NOW + 10_000);
    const ten = raceRun(plain([{ h: 1, taps: batches(10), jumps: [] }]), NOW + 10_000);
    expect(ten.x[0]).toBe(six.x[0]);
    // in at 300 m: its time kept, no further
    const done = raceRun(plain([{ h: 1, taps: flatOut(NOW), jumps: [] }]), NOW + RACE_MAX_MS);
    expect(done.x[0]).toBe(RACE_M);
    expect(done.done[0]).toBeGreaterThan(13_000);
    expect(done.over).toBe(true);
  });

  it("slows one on 白开水, stops one at 源石虫 and 近卫局路障, speeds one with 理智顶液, unless in the air", () => {
    const lane = (jumps: number[] = []) => ({ h: 1, taps: [], jumps });
    const at = (obs: RaceObstacle[], jumps?: number[]) => raceRun(plain([lane(jumps)], obs), NOW + 8_000).x[0];
    const free = at([]);
    expect(at([{ m: 20, k: "water" }])).toBeLessThan(free - 2);
    expect(at([{ m: 20, k: "slug" }])).toBeLessThan(free - 3);
    expect(at([{ m: 20, k: "bar" }])).toBeLessThan(at([{ m: 20, k: "slug" }]));
    expect(at([{ m: 20, k: "potion" }])).toBeGreaterThan(free + 8);
    // where it meets the obstacle: jump just before
    const meet = raceRun(plain([lane()], [{ m: 20, k: "bar" }]), NOW + 8_000).last[0]!;
    expect(meet).toMatchObject({ k: "bar", jumped: false });
    const jump = NOW + meet.t - 200;
    expect(at([{ m: 20, k: "bar" }], [jump])).toBeCloseTo(free, 0);
    expect(raceRun(plain([lane([jump])], [{ m: 20, k: "bar" }]), NOW + 8_000).last[0]).toMatchObject({ k: "bar", jumped: true });
    expect(at([{ m: 20, k: "potion" }], [jump])).toBeCloseTo(free, 0);
  });

  it("runs the 人机 by the seed alone, the same everywhere, and orders those in by time, then the rest by metres", () => {
    const bots = plain([
      { h: -100, taps: [], jumps: [] },
      { h: -101, taps: [], jumps: [] },
    ], raceObstacles(3));
    const a = raceRun(bots, NOW + 9_000);
    expect(raceRun(bots, NOW + 9_000)).toEqual(a);
    expect(raceRun({ ...bots, seed: 4 }, NOW + 9_000).x).not.toEqual(a.x);
    expect(a.x[0]).toBeGreaterThan(80);
    expect(raceOrder({ x: [300, 120, 300, 200], done: [15_000, null, 14_000, null] })).toEqual([2, 0, 3, 1]);
  });
});

describe("企鹅物流急件赛's card", () => {
  it("counts down to its start, then says your place and the metres left, the clock, and where all four are", () => {
    const r = room({ mode: race() });
    const lead = view(r, NOW - 2_200);
    expect(lead).toContain("企鹅物流急件赛 · 2 人");
    expect(lead).toContain("<b>3 秒后开跑</b>");
    expect(lead).toContain('<button type="button" class="jump" disabled="">跳</button>');
    const m = race({ lanes: [{ h: 1, taps: flatOut(NOW), jumps: [] }, { h: 2, taps: [], jumps: [] }, { h: -100, taps: [], jumps: [] }, { h: -101, taps: [], jumps: [] }] });
    const going = view(room({ mode: m }), NOW + 5_000, 4);
    expect(racePhase(m, raceRun(m, NOW + 5_000), NOW + 5_000)).toBe("run");
    expect(going).toMatch(/<b>第 1 · 离大帝还有 \d+ m<\/b>/);
    expect(going).toContain('<span class="clock">0:05</span>');
    expect(going).toContain('<button type="button" class="cheer">加油！</button>');
    expect(going.match(/<i class="on"><\/i>/g)).toHaveLength(4);
    expect(going.match(/class="dot/g)).toHaveLength(4);
    expect(going).toContain('class="dot you"');
    // its own 人机 named as the room's
    expect(laneOf(room({ mode: m }), m, -100)).toMatchObject({ name: "人机 1", bot: true });
  });

  it("says what happened at an obstacle over your roach a moment", () => {
    const m = race({ obs: [{ m: 20, k: "slug" }] });
    const met = raceRun(m, NOW + 8_000).last[0]!.t;
    expect(raceTip(raceRun(m, NOW + met + 500), 0)).toBe("被源石虫挡住了");
    expect(view(room({ mode: m }), NOW + met + 500)).toContain("被源石虫挡住了");
    expect(raceTip(raceRun(m, NOW + met + 2_000), 0)).toBeNull();
  });

  it("asks one watching to join for the next race, and tells one who asked they are in it", () => {
    const m = race({ in: [{ h: 2, combo: 0 }], by: 2, lanes: [2, -100, -101, -102].map((h) => ({ h, taps: [], jumps: [] })) });
    const watching = view(room({ mode: m }), NOW + 3_000);
    expect(watching).toContain("你在围观这一场，加入以后下一场开跑时就在里面");
    expect(watching).toContain(">下一场加入</button>");
    expect(watching).toMatch(/<b>跑在最前面的离大帝还有 \d+ m<\/b>/);
    const asked = view(room({ mode: { ...m, in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] } }), NOW + 3_000);
    expect(asked).toContain("下一场开跑时你就在里面");
    expect(asked).toContain("不跑了，去围观");
  });

  it("waits for the server's word at the end, then gives its order, times, the crown, and 再来一场", () => {
    const m = race({ lanes: [{ h: 1, taps: flatOut(NOW), jumps: [] }, { h: 2, taps: [], jumps: [] }, { h: -100, taps: [], jumps: [] }, { h: -101, taps: [], jumps: [] }] });
    expect(view(room({ mode: m }), NOW + RACE_MAX_MS + 100)).toContain("<b>终点核对中…</b>");
    const end: RaceEnd = { at: NOW + RACE_MAX_MS, order: [0, 2, 3, 1], times: [14_600, null, 18_900, 19_400], metres: [300, 210, 300, 300] };
    const ended = room({ mode: { ...m, end } });
    expect(raceStatus(ended, ended.mode as RaceMode, raceRun(m, NOW + RACE_MAX_MS), NOW + RACE_MAX_MS + 100)).toBe("你第一个签收！小冠戴 1 分钟");
    const html = view(ended, NOW + RACE_MAX_MS + 100);
    expect(html).toContain("<h3>这一场</h3>");
    expect(html).toContain('<span class="pn">第 1</span>');
    expect(html).toContain('<span class="nm">你</span><em class="cr">小冠</em><b>14.6 秒</b>');
    expect(html).toContain('<span class="nm">企鹅物流</span><b>没跑完 · 210 m</b>');
    expect(html).toContain('<button type="button" class="again">再来一场</button>');
    expect(html).toContain('<svg class="crown"');
    // the server's order, whatever this page's own run says
    const other: RaceEnd = { ...end, order: [2, 0, 3, 1] };
    const theirs = room({ mode: { ...m, end: other } });
    expect(raceStatus(theirs, theirs.mode as RaceMode, raceRun(m, NOW + RACE_MAX_MS), NOW + RACE_MAX_MS)).toBe("人机 1 第一个签收！ 你第 2");
    // alone: no crown
    const alone = room({ mode: { ...m, in: [{ h: 1, combo: 0 }], lanes: [1, -100, -101, -102].map((h, i) => ({ h, taps: i ? [] : flatOut(NOW), jumps: [] })), end } });
    const practice = view(alone, NOW + RACE_MAX_MS + 100);
    expect(practice).toContain("一个人自己练，不戴小冠");
    expect(practice).not.toContain('class="cr"');
  });
});

describe("the race on the page", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function server(r: SquadRoom, answer: (body: Record<string, unknown>) => { status: number; json: unknown }) {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const later: (() => void)[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: (f: () => void) => {
        later.push(f);
        return later.length;
      },
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      const res = answer(body);
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return { sent, later };
  }

  it("sends your 加油 each quarter second as one count, 跳 at once, both in your lane here at once; the others' as the room tells them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 2_000);
    const { sent, later } = server(room({ mode: race(), now: NOW + 2_000 }), (b) => ({ status: 200, json: { now: NOW + 2_000, h: 1, ...("jump" in b ? { jump: b.at } : { tap: [b.at, b.tap] }) } }));
    await loadSquadRoom();
    squadRaceTap();
    squadRaceTap();
    squadRaceTap();
    expect(sent.filter((s) => s.url === "/api/squad/run")).toHaveLength(0);
    // the quarter second is up
    later.splice(0).forEach((f) => f());
    expect((squadRoomNow()!.mode as RaceMode).lanes[0].taps).toEqual([[NOW + 2_000, 3]]);
    await Promise.resolve();
    expect(sent.find((s) => s.url === "/api/squad/run")?.body).toEqual({ tap: 3, at: NOW + 2_000 });
    vi.setSystemTime(NOW + 2_300);
    await squadRaceJump();
    expect((squadRoomNow()!.mode as RaceMode).lanes[0].jumps).toEqual([NOW + 2_300]);
    expect(sent.at(-1)?.body).toEqual({ jump: true, at: NOW + 2_300 });
    // the room's tell: 企鹅物流's into TA's lane; yours (already in) not twice
    heardSquad(JSON.stringify({ t: "race", room: "r1", items: [{ h: 2, tap: [NOW + 2_100, 4] }, { h: 1, tap: [NOW + 2_000, 3] }, { h: 2, jump: NOW + 2_200 }] }));
    const lanes = (squadRoomNow()!.mode as RaceMode).lanes;
    expect(lanes[1]).toEqual({ h: 2, taps: [[NOW + 2_100, 4]], jumps: [NOW + 2_200] });
    expect(lanes[0].taps).toEqual([[NOW + 2_000, 3]]);
  });
});
