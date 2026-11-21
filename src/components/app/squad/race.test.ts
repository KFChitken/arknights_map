import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  RACE_BASE,
  RACE_JUMP_MS,
  RACE_LEAD_MS,
  RACE_M,
  RACE_MAX_MS,
  RACE_REPORT_MS,
  RACE_OBS_FROM,
  RACE_OBS_GAP,
  RACE_OBS_TO,
  RACE_PER_TAP,
  raceJumps,
  raceObstacles,
  raceOrder,
  raceRun,
  type RaceData,
  type RaceEnd,
  type RaceMode,
  type RaceObstacle,
} from "@/lib/squadMode";
import { RACE_BACK_M, RaceView, laneOf, raceDrawnAt, raceDrawnFrom, racePhase, racePredicted, raceStatus, raceTip } from "./SquadRace";
import { forgetSquadPage, heardSquad, loadSquadRoom, squadRaceJump, squadRaceSeen, squadRaceTap, squadRoomNow } from "./squading";

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
  begun: NOW - RACE_LEAD_MS,
  played: 0,
  next: [],
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

  it("counts a 跳 only once the one before has landed, so one sent twice changes nothing", () => {
    expect(raceJumps([NOW + 900, NOW + 100, NOW + 300, NOW + 100 + RACE_JUMP_MS])).toEqual([NOW + 100, NOW + 100 + RACE_JUMP_MS]);
    const once = plain([{ h: 1, taps: flatOut(NOW), jumps: [NOW + 2_000] }], [{ m: 55, k: "slug" }]);
    const twice = plain([{ h: 1, taps: flatOut(NOW), jumps: [NOW + 2_000, NOW + 2_200] }], [{ m: 55, k: "slug" }]);
    for (const t of [NOW + 2_300, NOW + 2_700, NOW + 6_000]) expect(raceRun(twice, t)).toEqual(raceRun(once, t));
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

  it("leaves one not in the round to watch it (下一局算我), and tells one who asked they are in the next", () => {
    const m = race({ in: [{ h: 2, combo: 0 }], by: 2, lanes: [2, -100, -101, -102].map((h) => ({ h, taps: [], jumps: [] })) });
    const watching = view(room({ mode: m }), NOW + 3_000);
    expect(watching).toContain(">这局先围观 · 下一局算我</button>");
    expect(watching).toMatch(/<b>跑在最前面的离大帝还有 \d+ m<\/b>/);
    const asked = view(room({ mode: { ...m, next: [1] } }), NOW + 3_000);
    expect(asked).toContain('<p class="qline">排进下一局了：这局跑完你就在里面</p>');
    expect(asked).not.toContain("下一局算我</button>");
    expect(asked).not.toContain("不跑了，去围观");
  });

  it("waits for the server's word at the end, then gives its order, times and the crown (再来一局 is its initiator's, once it waits again)", () => {
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
    expect(html).not.toContain("再来一场");
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

  /**
   * A page whose own timers go off as its clock is moved on (go), the room read as given, and the server answering a
   * report as given (else keeping all of it)
   */
  function page(r: () => SquadRoom, answer: (body: Record<string, unknown>) => { status: number; json?: unknown } = () => ({ status: 200 })) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    let id = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: (fn: () => void, ms = 0) => {
        timers.set(++id, { at: Date.now() + ms, fn });
        return id;
      },
      clearTimeout: (k: number) => void timers.delete(k),
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: { ...r(), now: Date.now() }, now: Date.now() }));
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url === "/api/squad/run") sent.push(body);
      const res = answer(body);
      return new Response(JSON.stringify(res.json ?? { now: Date.now(), taps: body.taps, jumps: body.jumps }), { status: res.status });
    });
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((done) => setTimeout(done, 0));
    };
    /** The clock moved on to t, each timer due by then gone off in turn, and what they started let finish */
    const go = async (t: number) => {
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= t).sort((p, q) => p[1].at - q[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        vi.setSystemTime(Math.max(Date.now(), due[1].at));
        due[1].fn();
        await settle();
      }
      vi.setSystemTime(t);
      await settle();
    };
    return { sent, go, settle };
  }
  const lane = (h: number) => (squadRoomNow()!.mode as RaceMode).lanes.find((l) => l.h === h)!;

  it("counts your 加油 by the quarter second into your lane at once, and reports them with your 跳s every two seconds", async () => {
    const { sent, go } = page(() => room({ mode: race() }));
    await loadSquadRoom();
    await go(NOW + 1_000);
    squadRaceTap();
    squadRaceTap();
    squadRaceTap();
    expect(lane(1).taps).toEqual([]);
    // the quarter second is up: in your lane at once, and the first report goes
    await go(NOW + 1_250);
    expect(lane(1).taps).toEqual([[NOW + 1_250, 3]]);
    expect(sent).toEqual([{ taps: [[NOW + 1_250, 3]], jumps: [] }]);
    // more within the next two seconds: in your lane each at once, reported together
    for (const t of [NOW + 1_600, NOW + 2_100]) {
      await go(t);
      squadRaceTap();
    }
    await go(NOW + 2_200);
    squadRaceJump();
    expect(lane(1).jumps).toEqual([NOW + 2_200]);
    // still in the air: nothing
    await go(NOW + 2_300);
    squadRaceJump();
    expect(lane(1).jumps).toEqual([NOW + 2_200]);
    expect(lane(1).taps).toEqual([
      [NOW + 1_250, 3],
      [NOW + 1_850, 1],
    ]);
    expect(sent).toHaveLength(1);
    await go(NOW + 1_250 + RACE_REPORT_MS);
    expect(lane(1).taps.at(-1)).toEqual([NOW + 2_350, 1]);
    expect(sent).toEqual([
      { taps: [[NOW + 1_250, 3]], jumps: [] },
      {
        taps: [
          [NOW + 1_850, 1],
          [NOW + 2_350, 1],
        ],
        jumps: [NOW + 2_200],
      },
    ]);
  });

  it("keeps a report that failed for the next, and puts what the server has not got back into your lane as the room is read again", async () => {
    let fail = true;
    const kept: [number, number][] = [];
    const { sent, go } = page(
      () => room({ mode: race({ lanes: [{ h: 1, taps: [...kept], jumps: [] }, ...race().lanes.slice(1)] }) }),
      (body) => {
        if (fail) return { status: 503, json: { error: "忙" } };
        kept.push(...(body.taps as [number, number][]));
        return { status: 200 };
      },
    );
    await loadSquadRoom();
    await go(NOW + 1_000);
    squadRaceTap();
    await go(NOW + 1_250);
    expect(sent).toHaveLength(1);
    // the room read again (the server has none of it): yours back in your lane
    await loadSquadRoom();
    expect(lane(1).taps).toEqual([[NOW + 1_250, 1]]);
    squadRaceTap();
    await go(NOW + 1_500);
    fail = false;
    await go(NOW + 1_250 + RACE_REPORT_MS);
    expect(sent.at(-1)).toEqual({
      taps: [
        [NOW + 1_250, 1],
        [NOW + 1_500, 1],
      ],
      jumps: [],
    });
    // kept now: read again, each once
    await loadSquadRoom();
    expect(lane(1).taps).toEqual([
      [NOW + 1_250, 1],
      [NOW + 1_500, 1],
    ]);
  });

  it("reports at once, saying you are in, as your roach signs in", async () => {
    const near = race({ lanes: [{ h: 1, taps: flatOut(NOW - 1_000, 60), jumps: [] }, ...race().lanes.slice(1)] });
    const { sent, go } = page(() => room({ mode: near }));
    await loadSquadRoom();
    const done = raceRun(near, NOW + RACE_MAX_MS).done[0]!;
    // one 加油 a little before it signs in: reported, then in as it is
    await go(NOW + done - 600);
    squadRaceTap();
    await go(NOW + done - 300);
    expect(sent).toHaveLength(1);
    await go(NOW + done + 250);
    expect(sent.at(-1)).toEqual({ taps: [], jumps: [], in: true });
    expect(sent).toHaveLength(2);
  });

  it("takes the others' reports into their lanes once each, known up to the server's now then; yours are in already", async () => {
    page(() => room({ mode: race() }));
    await loadSquadRoom();
    expect(squadRaceSeen(NOW, 2)).toBe(NOW);
    const tell = { t: "race", room: "r1", items: [{ h: 2, taps: [[NOW + 1_100, 4]], jumps: [NOW + 1_200], upTo: NOW + 2_000 }, { h: 1, taps: [[NOW + 1_000, 3]], jumps: [], upTo: NOW + 2_000 }] };
    heardSquad(JSON.stringify(tell));
    heardSquad(JSON.stringify(tell));
    expect(lane(2)).toEqual({ h: 2, taps: [[NOW + 1_100, 4]], jumps: [NOW + 1_200] });
    expect(lane(1).taps).toEqual([]);
    expect(squadRaceSeen(NOW, 2)).toBe(NOW + 2_000);
  });
});

describe("the others' roaches between their reports", () => {
  it("run on from as far as they are known at their last second's pace, drawn only", () => {
    const taps: [number, number][] = [
      [NOW + 500, 2],
      [NOW + 1_250, 2],
      [NOW + 1_500, 1],
      [NOW + 1_750, 1],
      [NOW + 2_000, 2],
    ];
    const mode = race({ lanes: [{ h: 1, taps: [], jumps: [] }, { h: 2, taps, jumps: [] }, ...race().lanes.slice(2)] });
    const drawn = racePredicted(mode, 1, () => NOW + 2_000, NOW + 3_000);
    // its last second: 6 in all, a count of 1.5 each quarter second on
    expect(drawn.lanes[1].taps).toEqual([...taps, [NOW + 2_250, 1.5], [NOW + 2_500, 1.5], [NOW + 2_750, 1.5], [NOW + 3_000, 1.5]]);
    expect(mode.lanes[1].taps).toEqual(taps);
    // yours and the 人机's as they are; one known up to now, as it is
    expect(drawn.lanes[0]).toBe(mode.lanes[0]);
    expect(drawn.lanes[2]).toBe(mode.lanes[2]);
    expect(racePredicted(mode, 1, () => NOW + 3_000, NOW + 3_000).lanes[1]).toBe(mode.lanes[1]);
    // running on at that pace, as if the counts had come
    const run = raceRun(drawn, NOW + 3_000);
    expect(run.x[1]).toBeGreaterThan(raceRun(mode, NOW + 3_000).x[1]);
  });

  it("ease to where a report puts them, never back unless more than 5 m ahead", () => {
    // behind: caught up in about half a second, never past
    const behind = raceDrawnFrom(40, 46, NOW);
    expect(raceDrawnAt(behind, 46, NOW)).toBe(40);
    expect(raceDrawnAt(behind, 50, NOW + 250)).toBeGreaterThan(47);
    expect(raceDrawnAt(behind, 50, NOW + 250)).toBeLessThan(50);
    expect(raceDrawnAt(behind, 55, NOW + 600)).toBeCloseTo(55, 0);
    // a little ahead: waits where it is till its lane comes up to it
    const ahead = raceDrawnFrom(50, 47, NOW);
    expect(raceDrawnAt(ahead, 47, NOW + 100)).toBe(50);
    expect(raceDrawnAt(ahead, 49.5, NOW + 300)).toBe(50);
    expect(raceDrawnAt(ahead, 51, NOW + 400)).toBe(51);
    // far ahead: back, eased
    const far = raceDrawnFrom(50, 50 - RACE_BACK_M - 1, NOW);
    expect(raceDrawnAt(far, 44, NOW + 100)).toBeLessThan(50);
    expect(raceDrawnAt(far, 44, NOW + 700)).toBeCloseTo(44, 0);
  });
});
