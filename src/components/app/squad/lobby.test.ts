import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { RACE_LEAD_MS, type LobbyMode, type RaceMode } from "@/lib/squadMode";
import { LobbyView, lobbyButtons, lobbySeats } from "./SquadLobby";
import { stripOf } from "./SquadMini";
import { InviteLine, inviteOf, mayCall } from "./SquadModeInvite";
import { modeRow, PlayGrid } from "./SquadPlays";
import { dismissSquadMode, forgetSquadPage, heardSquad, lineWords, loadSquadRoom, squadFloatsNow, squadModeAskedNow, squadModeCardNow, squadRoomNow } from "./squading";

// 卫戍's matches waiting for people (发起人开局) and played round after round, on the page

const NOW = Date.parse("2026-11-21T09:00:00+08:00");
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
/** 企鹅物流急件赛 picked by 企鹅物流 (h 2) a minute ago, TA alone ready */
const lobby = (more: Partial<LobbyMode> = {}): LobbyMode => ({
  kind: "race",
  wait: true,
  by: 2,
  at: NOW - 60_000,
  in: [{ h: 2, combo: 0 }],
  played: 0,
  endsAt: NOW + 120_000,
  until: NOW + 120_000,
  ...more,
});
/** Its round begun by 企鹅物流 now, TA and you (h 1) in it */
const race = (more: Partial<RaceMode> = {}): RaceMode => ({
  kind: "race",
  by: 2,
  at: NOW - 60_000,
  begun: NOW,
  played: 0,
  next: [],
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  endsAt: NOW + 40_000,
  until: NOW + 40_000,
  start: NOW + RACE_LEAD_MS,
  seed: 0,
  lanes: [2, 1, -100, -101].map((h) => ({ h, taps: [], jumps: [] })),
  obs: [],
  bots: [
    { h: -100, no: 1, avatar: "imp", color: "red" },
    { h: -101, no: 2, avatar: "gugu", color: "gold" },
  ],
  ...more,
});
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "go",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2), member(3), member(4)],
  wentAt: NOW - 600_000,
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
const nothing = () => {};
const grid = (r: SquadRoom) =>
  renderToStaticMarkup(createElement(PlayGrid, { room: r, now: NOW, fish: "rest", busy: false, msg: null, onFish: nothing, onFire: nothing, onStack: nothing, onMode: nothing }));

describe("a match waiting, in 「玩」", () => {
  it("says how many are ready on its tile, readies one not ready, opens the card to one ready or its initiator; the others wait", () => {
    expect(modeRow(room({ mode: lobby() }), "race", NOW)).toEqual({ kind: "race", label: "等人 1/4", does: "ready", tag: "等人 1/4" });
    const ready = room({ mode: lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }) });
    expect(modeRow(ready, "race", NOW)).toEqual({ kind: "race", label: "等人 2/4", does: "look", tag: "等人 2/4" });
    expect(modeRow(room({ mode: lobby({ by: 1, in: [{ h: 1, combo: 0 }] }) }), "race", NOW).does).toBe("look");
    expect(modeRow(room({ mode: lobby() }), "dance", NOW)).toEqual({ kind: "dance", label: "等企鹅物流急件赛这局完（一次只能玩一个）", does: null });
    const html = grid(room({ mode: lobby() }));
    expect(html).toContain('<em class="tag join">等人 1/4</em>');
    expect(html).toContain('class="tile k-gift off"');
    expect(html).toContain('<p class="now">正在等人：企鹅物流急件赛（1/4 准备了）· 一次只能玩一个</p>');
  });

  it("while a round plays, asks one not in it for the next (下一局), and opens the card to those in it or the next", () => {
    expect(modeRow(room({ mode: race({ in: [{ h: 2, combo: 0 }] }) }), "race", NOW)).toEqual({ kind: "race", label: "下一局", does: "next", tag: "下一局" });
    expect(modeRow(room({ mode: race({ in: [{ h: 2, combo: 0 }], next: [1] }) }), "race", NOW).does).toBe("look");
    expect(modeRow(room({ mode: race() }), "race", NOW)).toEqual({ kind: "race", label: "在玩 · 打开", does: "look", tag: "在玩" });
  });
});

describe("the line asking one to a match", () => {
  it("asks one not ready while it waits, never its initiator or one ready; while a round plays, one neither in it nor in the next", () => {
    const m = lobby();
    expect(inviteOf(room({ mode: m }), null, null)).toBe(m);
    expect(inviteOf(room({ mode: lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }) }), null, null)).toBeNull();
    expect(inviteOf(room({ mode: lobby({ by: 1, in: [{ h: 1, combo: 0 }] }) }), null, null)).toBeNull();
    // put away (不了), or its card open: not for this match, round after round
    expect(inviteOf(room({ mode: m }), m.at, null)).toBeNull();
    expect(inviteOf(room({ mode: m }), null, m.at)).toBeNull();
    const playing = race({ in: [{ h: 2, combo: 0 }] });
    expect(inviteOf(room({ mode: playing }), null, null)).toBe(playing);
    expect(inviteOf(room({ mode: race({ in: [{ h: 2, combo: 0 }], next: [1] }) }), null, null)).toBeNull();
    expect(inviteOf(room({ mode: playing }), m.at, null)).toBeNull();
  });

  it("says who wants to play and how many are ready (准备), or that a round is on (下一局算我); without its initiator in the room, no name", () => {
    const html = (r: SquadRoom) => renderToStaticMarkup(createElement(InviteLine, { room: r, mode: r.mode!, busy: false, note: null, onJoin: nothing, onNo: nothing }));
    const waiting = html(room({ mode: lobby() }));
    expect(waiting).toContain('<b>企鹅物流</b> 想玩<b class="md">企鹅物流急件赛</b>（1/4 准备了），来吗？');
    expect(waiting).toContain(">准备</button>");
    expect(html(room({ mode: lobby(), members: [member(1), member(3)] }))).toContain('<b class="md">企鹅物流急件赛</b>在等人（1/4 准备了），来吗？');
    const playing = html(room({ mode: race({ in: [{ h: 2, combo: 0 }] }) }));
    expect(playing).toContain('<b>企鹅物流</b> 发起的<b class="md">企鹅物流急件赛</b>正在跑（1 人），下一局来吗？');
    expect(playing).toContain(">下一局算我</button>");
    const quiz = html(room({ mode: { ...race({ in: [{ h: 2, combo: 0 }] }), kind: "quiz", questions: [] } as unknown as SquadRoom["mode"], members: [member(1), member(3)] }));
    expect(quiz).toContain('<b class="md">凯尔希随堂测</b>正在答（1 人），下一局来吗？');
  });

  it("offers 来一起玩？ to a player not in the match, while one waits or plays, never to a 人机", () => {
    const bot = member(-1, { bot: true, host: false, you: false });
    const r = room({ mode: lobby(), members: [member(1), member(2), member(3), bot] });
    expect(mayCall(r, 3, NOW)).toBe(true);
    expect(mayCall(r, 2, NOW)).toBe(false);
    expect(mayCall(r, -1, NOW)).toBe(false);
    expect(mayCall(r, 1, NOW)).toBe(false);
    expect(mayCall(room({ mode: race({ next: [3] }) }), 3, NOW)).toBe(false);
    expect(mayCall(room(), 3, NOW)).toBe(false);
    expect(mayCall(room({ mode: lobby({ endsAt: NOW - 1 }) }), 3, NOW)).toBe(false);
  });
});

describe("a match's card while it waits", () => {
  it("seats those ready (its initiator first), the room's 人机 where the match has 人机, and the empty seats as they will be filled", () => {
    const bot = member(-1, { bot: true, host: false, you: false, name: "人机 1" });
    const r = room({ members: [member(1), member(2), member(3), bot] });
    const seats = lobbySeats(r, lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }));
    expect(seats.map((s) => (s.kind === "empty" ? "empty" : `${s.kind}:${s.m.h}${s.kind === "ready" && s.first ? "*" : ""}`))).toEqual(["ready:2*", "ready:1", "bot:-1", "empty"]);
    const html = (m: LobbyMode, rr = r) =>
      renderToStaticMarkup(createElement(LobbyView, { room: rr, mode: m, busy: false, msg: null, onClose: nothing, onMain: nothing, onShout: nothing, onOut: nothing }));
    const race2 = html(lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }));
    expect(race2).toContain("企鹅物流急件赛 · 等人");
    expect(race2).toContain("<small>发起人</small>");
    expect(race2).toContain("<b>你</b><small>准备好了</small>");
    expect(race2).toContain("<small>人机来跑</small>");
    expect(race2).toContain("<b>空位</b><small>空位 · 开跑时人机来</small>");
    expect(race2).toContain("空位人机来跑；一个人开就是自己练");
    const gift = html(lobby({ kind: "gift" }));
    expect(gift).toContain("<small>人机来传</small>");
    expect(gift).toContain("<small>空位 · 开始时人机来</small>");
    // 凯尔希随堂测 has no 人机: the room's sit nowhere, the empty seats are just that
    const quiz = html(lobby({ kind: "quiz" }));
    expect(quiz).not.toContain("人机来");
    expect(quiz.match(/<b>空位<\/b><small>空位<\/small>/g)).toHaveLength(3);
    expect(quiz).not.toContain("空位人机来跑；");
  });

  it("gives its initiator 开始 with how many and how many 人机 (自己练 alone, 再来一局 after a round), one ready the wait, one not ready 准备", () => {
    const you = (m: Partial<LobbyMode>) => lobbyButtons(room(), lobby({ by: 1, in: [{ h: 1, combo: 0 }], ...m }));
    expect(you({})).toEqual({ main: { text: "开始 · 自己练（3 个人机陪跑）", does: "start" }, shout: true, out: true, solo: true });
    expect(you({ kind: "quiz" }).main.text).toBe("开始 · 自己练");
    expect(you({ kind: "quiz" }).solo).toBe(false);
    const three = [1, 2, 3].map((h) => ({ h, combo: 0 }));
    expect(you({ in: three }).main.text).toBe("开始 · 3 人 + 1 个人机");
    expect(you({ in: [...three, { h: 4, combo: 0 }] }).main.text).toBe("开始 · 4 人");
    expect(you({ kind: "quiz", in: three }).main.text).toBe("开始 · 3 人");
    expect(you({ in: three, played: 1 }).main).toEqual({ text: "再来一局 · 3 人", does: "start" });
    // ready, waiting for the initiator; after a round, no 喊一声
    const ready = lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] });
    expect(lobbyButtons(room(), ready)).toEqual({ main: { text: "准备好了 · 等发起人开始", does: null }, shout: true, out: true, solo: false });
    expect(lobbyButtons(room(), { ...ready, played: 2 })).toEqual({ main: { text: "还在 · 等发起人点『再来一局』", does: null }, shout: false, out: true, solo: false });
    expect(lobbyButtons(room(), lobby())).toEqual({ main: { text: "准备", does: "ready" }, shout: true, out: false, solo: false });
  });

  it("shows on the small window's strip: 开始 to its initiator, 准备 to one not ready, nothing to one ready; 下一局算我 while a round plays", () => {
    expect(stripOf(room(), lobby({ by: 1, in: [{ h: 1, combo: 0 }] }), NOW)).toEqual({ kind: "race", text: "急件赛 · 等人 1/4", lit: false, acts: [{ act: "start", label: "开始", on: true }] });
    expect(stripOf(room(), lobby(), NOW).acts).toEqual([{ act: "join", label: "准备", on: true }]);
    expect(stripOf(room(), lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }), NOW).acts).toEqual([]);
    expect(stripOf(room(), race({ in: [{ h: 2, combo: 0 }] }), NOW).acts).toEqual([{ act: "join", label: "下一局算我", on: true }]);
    expect(stripOf(room(), race({ in: [{ h: 2, combo: 0 }], next: [1] }), NOW)).toMatchObject({ text: "急件赛 · 下一场你在里面", acts: [] });
  });
});

describe("a match's news, as the room hears it", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A page (its words, timers that never go off) and the room as the server has it, to every ask */
  function serve(r: () => SquadRoom) {
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url === "/api/squad/room" ? { room: r(), now: Date.now() } : { now: Date.now() })));
  }
  const tell = async (what: Record<string, unknown>) => {
    heardSquad(JSON.stringify({ t: "room", room: "r1", what }));
    // the room read again, then what it says
    for (let i = 0; i < 3; i++) await new Promise((done) => setTimeout(done, 0));
  };
  const floats = () => squadFloatsNow().map((f) => f.text);

  it("floats who picked it, readied and started it, who it was handed to and that it went; never what you did yourself", async () => {
    let now = room({ mode: lobby() });
    serve(() => now);
    await loadSquadRoom();
    const last = () => floats().at(-1);
    await tell({ kind: "mode", h: 2, on: true, lobby: "open", mode: "race" });
    expect(last()).toBe("企鹅物流 发起了企鹅物流急件赛");
    await tell({ kind: "mode", h: 3, on: true, lobby: "ready", mode: "race" });
    expect(last()).toBe("漏勺本勺 准备好了 · 企鹅物流急件赛");
    // your own: nothing new
    await tell({ kind: "mode", h: 1, on: true, lobby: "ready", mode: "race" });
    expect(floats()).toHaveLength(2);
    // 企鹅物流 left the room: TA's name from the room before
    now = room({ mode: lobby({ by: 3 }), members: [member(1), member(3), member(4)] });
    await tell({ kind: "mode", h: 2, by: 3, lobby: "hand", mode: "race" });
    expect(last()).toBe("企鹅物流 走了，漏勺本勺 成了发起人");
    now = room({ mode: lobby({ by: 1 }), members: [member(1), member(3), member(4)] });
    await tell({ kind: "mode", h: 3, by: 1, lobby: "hand", mode: "race" });
    expect(last()).toBe("漏勺本勺 走了，你成了发起人");
    now = room({ members: [member(1), member(3), member(4)] });
    await tell({ kind: "mode", h: 3, on: false, lobby: "gone", mode: "race" });
    expect(last()).toBe("没人准备，企鹅物流急件赛散了");
    await tell({ kind: "mode", on: false, lobby: "idle", mode: "gift" });
    expect(last()).toBe("W 的礼物等了 3 分钟没开，散了");
  });

  it("opens the card of one in a round as its initiator starts it, saying so to the room", async () => {
    let now = room({ mode: lobby({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }) });
    serve(() => now);
    await loadSquadRoom();
    now = room({ mode: race() });
    await tell({ kind: "mode", h: 2, on: true, lobby: "start", mode: "race" });
    expect(floats()).toEqual(["企鹅物流 点了开始，3 秒后开跑"]);
    expect(squadModeCardNow()).toBe(now.mode!.at);
    expect(squadRoomNow()?.mode).toMatchObject({ kind: "race", begun: NOW });
  });

  it("asks you again at someone's 喊一声 or 来一起玩？ to you, but not within 30 s of your 不了", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const m = lobby();
    serve(() => room({ mode: m }));
    await loadSquadRoom();
    const say = (items: { h: number; p: number; to?: number }[]) => heardSquad(JSON.stringify({ t: "say", room: "r1", items }));
    dismissSquadMode(m.at);
    vi.setSystemTime(NOW + 10_000);
    say([{ h: 2, p: 44 }]);
    expect(squadModeAskedNow()).toMatchObject({ at: m.at });
    vi.setSystemTime(NOW + 31_000);
    say([{ h: 2, p: 44 }]);
    expect(squadModeAskedNow()).toBeNull();
    // 来一起玩？ to another: not you
    dismissSquadMode(m.at);
    vi.setSystemTime(NOW + 70_000);
    say([{ h: 2, p: 45, to: 3 }]);
    expect(squadModeAskedNow()).toMatchObject({ at: m.at });
    say([{ h: 2, p: 45, to: 1 }]);
    expect(squadModeAskedNow()).toBeNull();
  });

  it("says 喊一声 as the match has it, and a match's in general once it is gone", async () => {
    serve(() => room({ mode: lobby({ kind: "gift" }) }));
    await loadSquadRoom();
    expect(lineWords(44)).toBe("来传 W 的礼物，差你一个！");
    expect(lineWords(45)).toBe("来一起玩？");
    serve(() => room());
    await loadSquadRoom();
    expect(lineWords(44)).toBe("来玩小游戏，差你一个！");
  });
});
