import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { isPhrase, mayStart, notYet, PHRASE_ROWS, sameStrategy, squadClash } from "./squad";

describe("一起卫戍's set lines", () => {
  it("go by numbers that never change: 开局's 25–31 and 局内's 32–35 after those of before", () => {
    for (let p = 1; p <= 35; p++) expect(isPhrase(p), String(p)).toBe(true);
    for (const p of [0, 36, 2.5, "1", null]) expect(isPhrase(p), String(p)).toBe(false);
    expect(PHRASE_ROWS.map(([row]) => row)).toEqual(["team", "open", "fight", "after", "music"]);
    expect(PHRASE_ROWS.find(([row]) => row === "open")![1]).toEqual([25, 26, 27, 28, 29, 30, 31]);
  });

  it("have each number once in a row, 28 in two rows as one line, and words for every number", () => {
    for (const [row, ids] of PHRASE_ROWS) expect(new Set(ids).size, row).toBe(ids.length);
    const rowsOf = (p: number) => PHRASE_ROWS.filter(([, ids]) => (ids as readonly number[]).includes(p)).map(([row]) => row);
    expect(rowsOf(28)).toEqual(["open", "fight"]);
    for (let p = 1; p <= 35; p++) if (p !== 28) expect(rowsOf(p), String(p)).toHaveLength(1);
    expect(T.squad.say.lines).toHaveLength(35);
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
