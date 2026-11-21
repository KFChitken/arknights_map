import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadListRoom, SquadMember, SquadRoom } from "@/lib/squad";
import { MemberTile, RoomCard } from "./SquadSheet";
import { forgetSquadPage, heardSquad, loadSquadRoom, squadFloatsNow, squadNoticeNow, squadRoomNow } from "./squading";

// 暂离 on the page: the list's seats and rooms, a tile in the room, and what the room is told of it

const NOW = Date.parse("2026-11-21T15:00:00+08:00");
const MIN = 60_000;
const LOOK = { avatar: "hood", color: "cyan" };
const listRoom = (more: Partial<SquadListRoom> = {}): SquadListRoom => ({
  id: "r1",
  host: { name: "小龙", friend: false, ...LOOK },
  server: "cn",
  level: 3,
  tags: [],
  state: "wait",
  friendsOnly: false,
  seats: [
    { role: "host", core: 0, strategy: null, ...LOOK },
    { role: "mate", core: 0, strategy: null, afk: true, ...LOOK },
  ],
  at: NOW - 20 * MIN,
  keyAt: NOW - 3 * MIN,
  friend: false,
  mine: false,
  music: false,
  ...more,
});
const member = (h: number, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流", "漏勺本勺"][h] ?? "",
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
  members: [member(1), member(2), member(3)],
  wentAt: null,
  waitedAt: NOW - 30 * MIN,
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

describe("暂离 on the list", () => {
  const card = (r: SquadListRoom) =>
    renderToStaticMarkup(createElement(RoomCard, { room: r, now: NOW, busy: false, art: null, myStrategy: null, onJoin: () => {}, onBack: () => {} }));

  it("grays a seat 暂离 and says so on it; says 房主暂离 under a room whose host is", () => {
    const out = card(listRoom());
    expect(out.match(/class="sq-seat afk"/g)).toHaveLength(1);
    expect(out).toContain('<i class="afkt">暂离</i>');
    expect(out).not.toContain("房主暂离");
    expect(card(listRoom({ hostAfk: true }))).toContain('<small class="afk">房主暂离</small>');
  });
});

describe("暂离 on a tile in the room", () => {
  const tile = (m: SquadMember, more: { afk?: number | null; building?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(MemberTile, { m, art: null, playing: false, lift: 0, open: false, onCore: () => {}, onStrategy: () => {}, onMenu: () => {}, ...more }),
    );

  it("grays the tile and says for how long, in whole minutes, before anything else it would say", () => {
    const out = tile(member(2), { afk: 12 * MIN + 59_000, building: true });
    expect(out).toContain('class="sq-tile afk"');
    expect(out).toContain('<span class="dz afkt">暂离 12 分钟</span>');
    expect(out).not.toContain("在搭");
    expect(tile(member(2))).not.toContain("afk");
  });
});

describe("暂离, as the room hears it", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
  });

  /** A page (its words, timers that never go off) and the room as the server has it, to every ask */
  function serve(answer: () => { room: SquadRoom | null; out?: "away" }) {
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url === "/api/squad/room" ? { ...answer(), now: Date.now() } : { now: Date.now() })));
  }
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((done) => setTimeout(done, 0));
  };
  const awayOf = (h: number) => squadRoomNow()?.members.find((m) => m.h === h)?.away;

  it("takes one going away and coming back as told, without reading the room again", async () => {
    let asked = 0;
    serve(() => {
      asked += 1;
      return { room: room() };
    });
    await loadSquadRoom();
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "here", h: 2, away: NOW - 11 * MIN } }));
    expect(awayOf(2)).toBe(NOW - 11 * MIN);
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "here", h: 2, away: null } }));
    expect(awayOf(2)).toBeUndefined();
    await settle();
    expect(asked).toBe(1);
  });

  it("floats the room handed on for its host being 暂离, to you in your own words", async () => {
    let now = room({ host: false, members: [member(1, { host: false }), member(2, { host: true }), member(3)] });
    serve(() => ({ room: now }));
    await loadSquadRoom();
    now = room({ host: false, members: [member(1, { host: false }), member(2), member(3, { host: true })] });
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "host", h: 3, afk: true } }));
    await settle();
    expect(squadFloatsNow().map((f) => f.text)).toEqual(["房主暂离，房间交给了 漏勺本勺"]);
    now = room();
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "host", h: 1, afk: true } }));
    await settle();
    expect(squadFloatsNow().map((f) => f.text).at(-1)).toBe("房主暂离，你成了房主");
  });

  it("says why one is out: taken out for it, or the room over as its host was", async () => {
    serve(() => ({ room: room() }));
    await loadSquadRoom();
    heardSquad(JSON.stringify({ t: "you", room: "r1", why: "away" }));
    expect(squadRoomNow()).toBeNull();
    expect(squadNoticeNow()).toBe("你离开太久，已经退出房间");
    await loadSquadRoom();
    heardSquad(JSON.stringify({ t: "end", room: "r1", why: "away" }));
    expect(squadNoticeNow()).toBe("房主离开太久，房间自动结束了");
  });

  it("says so as the page comes back to find it was taken out meanwhile; nothing to a page not in the room", async () => {
    let answer: { room: SquadRoom | null; out?: "away" } = { room: room() };
    serve(() => answer);
    await loadSquadRoom();
    answer = { room: null, out: "away" };
    await loadSquadRoom();
    expect(squadRoomNow()).toBeNull();
    expect(squadNoticeNow()).toBe("你离开太久，已经退出房间");
    forgetSquadPage();
    serve(() => answer);
    await loadSquadRoom();
    expect(squadNoticeNow()).toBeNull();
  });
});
