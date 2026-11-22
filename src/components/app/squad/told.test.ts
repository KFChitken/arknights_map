import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import type { SquadFire } from "@/lib/squadFire";
import { forgetSquadPage, heardSquad, loadSquadRoom, setSquadInGame, squadAddWood, squadFloatsNow, squadRoomNow } from "./squading";

// A stick on a room's fire and someone's 准备, as the room is told them: taken as they are, the room read again only
// where the page cannot be sure of them

const NOW = Date.parse("2026-11-22T13:00:00+08:00");
const member = (h: number, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流", "漏勺本勺"][h] ?? `人机 ${-h}`,
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
const fire = (more: Partial<SquadFire> = {}): SquadFire => ({ level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0, ...more });
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "wait",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW - 60_000,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2), member(3)],
  wentAt: null,
  waitedAt: NOW - 120_000,
  fire: fire(),
  stack: { round: 1, at: NOW, n: 0, sum: 0, top: [], swingAt: NOW, best: 0, busy: [] },
  mode: null,
  endsAt: NOW + 840_000,
  endsWhy: "idle",
  declared: false,
  invited: [],
  hear: true,
  listen: null,
  now: NOW,
  ...more,
});

describe("a stick on the fire and 准备, as the room is told them", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
  });

  /** A page (its words, timers that never go off) and the server: the room as it has it to each read, counted; other asks answered as given */
  function serve(r: () => SquadRoom, answers: Record<string, () => unknown> = {}) {
    const reads = { n: 0 };
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/api/squad/room") {
        reads.n += 1;
        return new Response(JSON.stringify({ room: r(), now: NOW }));
      }
      const op = url.replace("/api/squad/", "");
      return new Response(JSON.stringify(answers[op]?.() ?? { now: NOW }));
    });
    return reads;
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((done) => setTimeout(done, 0));
  };
  const tell = async (what: Record<string, unknown>) => {
    heardSquad(JSON.stringify({ t: "room", room: "r1", what }));
    await settle();
  };
  const floats = () => squadFloatsNow().map((f) => f.text);
  const ready = () => squadRoomNow()!.members.map((m) => m.inGame);

  it("puts a stick on the fire it has as told, the room not read; the same again (its own, as its answer brought it) is nothing new", async () => {
    const reads = serve(() => room());
    await loadSquadRoom();
    expect(reads.n).toBe(1);
    // never lit: was null
    const first = fire({ level: 1, at: NOW + 1_000, by: 2, top: 1 });
    await tell({ kind: "fire", h: 2, fire: first, was: null });
    expect(squadRoomNow()!.fire).toEqual(first);
    const second = fire({ level: 2, at: NOW + 2_000, by: 3, top: 2 });
    await tell({ kind: "fire", h: 3, fire: second, was: first.at });
    expect(squadRoomNow()!.fire).toEqual(second);
    await tell({ kind: "fire", h: 3, fire: second, was: first.at });
    expect(squadRoomNow()!.fire).toEqual(second);
    expect(reads.n).toBe(1);
    expect(floats()).toEqual([]);
  });

  it("reads the room again at a stick on another fire than it has, and at one told without the fire (by a server of before)", async () => {
    const lit = fire({ level: 3, at: NOW - 5_000, by: 2, top: 3 });
    let now = room({ fire: lit });
    const reads = serve(() => now);
    await loadSquadRoom();
    // the stick told before this one is not here yet
    const later = fire({ level: 5, at: NOW + 2_000, by: 3, top: 5 });
    now = room({ fire: later });
    await tell({ kind: "fire", h: 3, fire: later, was: NOW + 1_000 });
    expect(reads.n).toBe(2);
    expect(squadRoomNow()!.fire).toEqual(later);
    // told as never lit, lit here
    await tell({ kind: "fire", h: 2, fire: fire({ level: 1, at: NOW + 3_000, by: 2, top: 5 }), was: null });
    expect(reads.n).toBe(3);
    expect(squadRoomNow()!.fire).toEqual(later);
    await tell({ kind: "fire", h: 2 });
    expect(reads.n).toBe(4);
    expect(floats()).toEqual([]);
  });

  it("takes 准备 on and off as told in the state, key and wait it has, with when the room ends; 「X 准备好了」 at once, not for your own or one off", async () => {
    const now = room();
    const reads = serve(() => now);
    await loadSquadRoom();
    const kept = { state: "wait", keyAt: now.keyAt, waitedAt: now.waitedAt };
    await tell({ kind: "game", h: 2, endsAt: NOW + 900_000, endsWhy: "idle", ...kept });
    expect(squadRoomNow()).toMatchObject({ endsAt: NOW + 900_000, endsWhy: "idle" });
    expect(ready()).toEqual([false, true, false]);
    expect(floats()).toEqual(["企鹅物流 准备好了"]);
    await tell({ kind: "unready", h: 2, endsAt: NOW + 910_000, endsWhy: "idle", ...kept });
    expect(squadRoomNow()!.endsAt).toBe(NOW + 910_000);
    expect(ready()).toEqual([false, false, false]);
    // your own: taken, nothing said
    await tell({ kind: "game", h: 1, endsAt: NOW + 920_000, endsWhy: "idle", ...kept });
    expect(ready()).toEqual([true, false, false]);
    // so already (its own answer, or the room read since, brought it): nothing changed; another's still said
    await tell({ kind: "game", h: 1, endsAt: NOW + 930_000, endsWhy: "idle", ...kept });
    await tell({ kind: "game", h: 3, endsAt: NOW + 940_000, endsWhy: "idle", ...kept });
    await tell({ kind: "game", h: 3, endsAt: NOW + 950_000, endsWhy: "idle", ...kept });
    expect(squadRoomNow()!.endsAt).toBe(NOW + 940_000);
    expect(ready()).toEqual([true, false, true]);
    expect(reads.n).toBe(1);
    expect(floats()).toEqual(["企鹅物流 准备好了", "漏勺本勺 准备好了", "漏勺本勺 准备好了"]);
  });

  it("reads the room again at a 准备 in another state, key or wait, of one it does not know, and at one told without when it ends", async () => {
    let now = room();
    const reads = serve(() => now);
    await loadSquadRoom();
    const before = { state: "wait", keyAt: now.keyAt, waitedAt: now.waitedAt };
    const ends = { endsAt: NOW + 900_000, endsWhy: "idle" };
    // a new key (everyone ready again), read; a 准备 told from the key before it: the room as it has it, read again
    now = room({ keyAt: NOW });
    await tell({ kind: "key" });
    expect(reads.n).toBe(2);
    await tell({ kind: "game", h: 2, ...ends, ...before });
    expect(reads.n).toBe(3);
    expect(ready()).toEqual([false, false, false]);
    // from another wait (a round over between) or state (one playing since); of one not here yet
    await tell({ kind: "unready", h: 2, ...ends, ...before, keyAt: NOW, waitedAt: NOW });
    expect(reads.n).toBe(4);
    await tell({ kind: "unready", h: 2, ...ends, ...before, keyAt: NOW, state: "go" });
    expect(reads.n).toBe(5);
    await tell({ kind: "game", h: 4, ...ends, ...before, keyAt: NOW });
    expect(reads.n).toBe(6);
    // by a server of before: read, then said
    now = room({ keyAt: NOW, members: [member(1), member(2), member(3, { inGame: true })] });
    await tell({ kind: "game", h: 3 });
    expect(reads.n).toBe(7);
    expect(ready()).toEqual([false, false, true]);
    // a 准备 told and read again says so as ever, from the room read
    expect(floats()).toEqual(["企鹅物流 准备好了", "漏勺本勺 准备好了"]);
  });

  it("reads the room once more after a read under way as one is told, and after an answer to its own ask made before one taken", async () => {
    let now = room();
    const reads = serve(() => now, { game: () => ({ room: now, now: NOW }) });
    await loadSquadRoom();
    // a read under way: its room may be from before the stick, so the room is read once more after it
    const lit = fire({ level: 1, at: NOW + 1_000, by: 2, top: 1 });
    const reading = loadSquadRoom();
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "fire", h: 2, fire: lit, was: null } }));
    now = room({ fire: lit });
    await reading;
    await settle();
    expect(reads.n).toBe(3);
    expect(squadRoomNow()!.fire).toEqual(lit);
    // 准备 asked for, and someone's told while its answer is out: the room read again once it is in
    now = room({ fire: lit, members: [member(1, { inGame: true }), member(2), member(3)] });
    const asked = setSquadInGame(true);
    const kept = { state: "wait", keyAt: now.keyAt, waitedAt: now.waitedAt };
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "game", h: 3, endsAt: NOW + 900_000, endsWhy: "idle", ...kept } }));
    expect(ready()).toEqual([false, false, true]);
    now = room({ fire: lit, members: [member(1, { inGame: true }), member(2), member(3, { inGame: true })] });
    await asked;
    await settle();
    expect(reads.n).toBe(4);
    expect(ready()).toEqual([true, false, true]);
    // nothing told meanwhile: the answer as it is
    await setSquadInGame(false);
    await settle();
    expect(reads.n).toBe(4);
  });

  it("puts its own stick on as its answer has it, unless the room told of another meanwhile", async () => {
    const mine = fire({ level: 1, at: NOW + 1_000, by: 1, top: 1 });
    const reads = serve(() => room(), { fire: () => ({ now: NOW, fire: mine, up: true, wood: 2, woodAt: NOW }) });
    await loadSquadRoom();
    await squadAddWood();
    expect(squadRoomNow()!.fire).toEqual(mine);
    expect(squadRoomNow()!.members[0]).toMatchObject({ wood: 2, woodAt: NOW });
    // another's stick on it, told while this one's answer is out: that one stays, the hand as answered
    const theirs = fire({ level: 2, at: NOW + 2_000, by: 2, top: 2 });
    const adding = squadAddWood();
    heardSquad(JSON.stringify({ t: "room", room: "r1", what: { kind: "fire", h: 2, fire: theirs, was: mine.at } }));
    await adding;
    expect(squadRoomNow()!.fire).toEqual(theirs);
    expect(reads.n).toBe(1);
  });
});
