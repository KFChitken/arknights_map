import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { extrasNow, isMove, isPhrase, isPose, mayStart, MOVES, movesTo, notYet, PHRASE_ROWS, POSES, readRound, ROUND_EXTRAS_MAX, sameStrategy, squadClash } from "./squad";

describe("一起卫戍's set lines", () => {
  it("go by numbers that never change: 开局's 25–31 and 局内's 32–35 after those of before, then 对 TA 说's 36–43", () => {
    for (let p = 1; p <= 43; p++) expect(isPhrase(p), String(p)).toBe(true);
    for (const p of [0, 44, 2.5, "1", null]) expect(isPhrase(p), String(p)).toBe(false);
    expect(PHRASE_ROWS.map(([row]) => row)).toEqual(["team", "open", "fight", "after", "music", "to"]);
    expect(PHRASE_ROWS.find(([row]) => row === "open")![1]).toEqual([25, 26, 27, 28, 29, 30, 31]);
    expect(PHRASE_ROWS.find(([row]) => row === "to")![1]).toEqual([36, 37, 38, 39, 40, 41, 42, 43]);
  });

  it("have each number once in a row, 28 in two rows as one line, and words for every number", () => {
    for (const [row, ids] of PHRASE_ROWS) expect(new Set(ids).size, row).toBe(ids.length);
    const rowsOf = (p: number) => PHRASE_ROWS.filter(([, ids]) => (ids as readonly number[]).includes(p)).map(([row]) => row);
    expect(rowsOf(28)).toEqual(["open", "fight"]);
    for (let p = 1; p <= 43; p++) if (p !== 28) expect(rowsOf(p), String(p)).toHaveLength(1);
    expect(T.squad.say.lines).toHaveLength(43);
    expect(T.squad.say.lines[10 - 1]).toBe("我是漏勺我是区");
    expect(T.squad.say.lines[30 - 1]).toBe("卫卫卫，能听到吗？！");
    for (const [row] of PHRASE_ROWS) expect(T.squad.say.rows[row], row).toBeTruthy();
  });
});

describe("starting a round (开始游戏)", () => {
  const host = { host: true, inGame: false, strategy: 18 };
  it("needs a teammate, everyone but the host ready, and no strategy twice; none (无偏好) clashes with nobody", () => {
    expect(mayStart(notYet([host]))).toBe(false);
    expect(notYet([host]).alone).toBe(true);
    const a = { host: false, inGame: false, strategy: 20 };
    expect(notYet([host, a]).notReady).toEqual([a]);
    const ready = { ...a, inGame: true };
    expect(mayStart(notYet([host, ready]))).toBe(true);
    const same = { host: false, inGame: true, strategy: 18 };
    expect(notYet([host, same]).clashes).toEqual([[host, same]]);
    expect(mayStart(notYet([host, same]))).toBe(false);
    const none = [{ host: false, inGame: true, strategy: null }, { host: false, inGame: true, strategy: null }];
    expect(squadClash(none)).toEqual([]);
    expect(mayStart(notYet([host, ...none]))).toBe(true);
    expect(sameStrategy(null, null)).toBe(false);
  });
});

describe("a round (这局)", () => {
  it("reads the 附加盟约 of a round: four at most, none twice, none not of the season; none given is none", () => {
    expect(readRound({ core: 1, strategy: null })).toEqual({ core: 1, strategy: null, extras: [] });
    expect(readRound({ core: 1, strategy: 46, extras: [1, 2, 3, 4] })).toEqual({ core: 1, strategy: 46, extras: [1, 2, 3, 4] });
    expect(ROUND_EXTRAS_MAX).toBe(4);
    expect(readRound({ core: 1, strategy: null, extras: [1, 2, 3, 4, 5] })).toBeNull();
    expect(readRound({ core: 1, strategy: null, extras: [2, 2] })).toBeNull();
    expect(readRound({ core: 1, strategy: null, extras: [999] })).toBeNull();
    expect(readRound({ core: 1, strategy: null, extras: "1" })).toBeNull();
    expect(readRound({ core: 99, strategy: null, extras: [] })).toBeNull();
    expect(extrasNow([1, 999, 2])).toEqual([1, 2]);
  });

  it("keeps three poses and three moves, two of them with a teammate", () => {
    expect([0, 1, 2].every(isPose)).toBe(true);
    expect([3, -1, "1", null].some(isPose)).toBe(false);
    expect(MOVES.filter(movesTo)).toEqual(["five", "hug"]);
    expect(isMove("wave") && !isMove("kick")).toBe(true);
    expect(T.squad.talk.poses).toHaveLength(POSES.length);
    expect(T.squad.fight.poses).toHaveLength(POSES.length);
    for (const m of MOVES) expect(T.squad.talk.moves[m]).toBeTruthy();
  });
});
