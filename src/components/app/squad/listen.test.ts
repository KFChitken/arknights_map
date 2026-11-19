import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SquadListen, SquadMember, SquadRoom } from "@/lib/squad";
import { ListenAsk, ListenNote, ListenRow, listenWords, squadSentWords } from "./SquadListen";

const LOOK = { avatar: "hood", color: "cyan" };
const member = (h: number, name: string, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name,
  host: false,
  you: false,
  friend: false,
  inGame: true,
  pose: 0,
  core: 1,
  strategy: null,
  extras: [],
  ...LOOK,
  ...more,
});
const on = (more: Partial<SquadListen> = {}): SquadListen => ({ room: "L1", song: "Song 1", playing: true, n: 3, ours: 2, out: [3], you: "in", ...more });
/** The room as the host (you: 1) or a teammate (you: 2) sees it: 晚昼 hosts, 红豆 and 小刻 in it, a 人机 too */
const room = (you: 1 | 2, listen: SquadListen | null, more: Partial<SquadRoom> = {}) =>
  ({
    host: you === 1,
    hear: true,
    listen,
    members: [member(1, "晚昼", { host: true, you: you === 1 }), member(2, "红豆", { you: you === 2 }), member(3, "小刻"), member(-1, "人机 1", { bot: true })],
    ...more,
  }) as SquadRoom;
const row = (r: SquadRoom) => renderToStaticMarkup(createElement(ListenRow, { room: r, onListen: () => {}, onToast: () => {} }));
const note = (r: SquadRoom) => renderToStaticMarkup(createElement(ListenNote, { room: r, onListen: () => {}, onCard: () => {} }));
const card = (r: SquadRoom) => renderToStaticMarkup(createElement(ListenAsk, { room: r, onListen: () => {}, onToast: () => {}, onClose: () => {} }));

describe("卫戍的一起听 in the room's sheet", () => {
  it("asks the host to invite everyone while it is not on, and says nothing to anyone else", () => {
    const host = row(room(1, null));
    expect(host).toContain("<b>一起听</b>");
    expect(host).toContain("用听歌的播放器，大家同一秒听同一首");
    expect(host).toContain(">邀请大家一起听</button>");
    expect(row(room(2, null))).toBe("");
  });

  it("tells the host what it plays, how many of the room listen, who said 下次吧, and that 人机 do not", () => {
    const out = row(room(1, on({ later: [3], uninvited: [] })));
    expect(out).toContain("一起听中 · Song 1");
    expect(out).toContain("2/3 人在听 · 小刻 点了下次吧 · 人机不听歌");
    expect(out).toContain(">打开</button>");
    // no 人机, nobody's 下次吧
    expect(row(room(1, on({ later: [] }), { members: [member(1, "晚昼", { host: true, you: true }), member(2, "红豆")] }))).toContain("<small>2/2 人在听</small>");
  });

  it("gives one invited 一起听 and 下次吧, saying not joining is fine; one in it 打开; anyone else 加入", () => {
    const invited = row(room(2, on({ you: "invited", invite: "i1" })));
    expect(invited).toContain("晚昼 邀请大家一起听");
    expect(invited).toContain("《Song 1》 · 现在 3 人在听");
    expect(invited).toContain(">一起听</button>");
    expect(invited).toContain(">下次吧</button>");
    expect(invited).toContain("不加入也行：你自己听你的，或者不听。");
    const inIt = row(room(2, on()));
    expect(inIt).toContain("跟着房主在听 · 3 人");
    expect(inIt).toContain(">打开</button>");
    const out = row(room(2, on({ you: "out" })));
    expect(out).toContain("晚昼 在开一起听");
    expect(out).toContain("Song 1 · 3 人在听");
    expect(out).toContain(">加入</button>");
  });

  it("shows nothing at all to one 听歌 is closed to", () => {
    expect(row(room(1, null, { hear: false }))).toBe("");
    expect(row(room(2, on(), { hear: false }))).toBe("");
    expect(note(room(2, on(), { hear: false }))).toBe("");
  });
});

describe("♪ on the bar of a round", () => {
  it("is plain while it is not on, teal with how many while you are in, and 加入 while you are not", () => {
    expect(note(room(1, null))).toMatch(/class="sq-note"[^>]*>♪<\/button>/);
    expect(note(room(2, on()))).toMatch(/class="sq-note in"[^>]*>♪ 3<\/button>/);
    expect(note(room(2, on({ you: "invited", invite: "i1" })))).toMatch(/class="sq-note join"[^>]*>♪ 加入<\/button>/);
  });

  it("opens a card: to the host, the invitation for the room; to anyone else, the way in", () => {
    const host = card(room(1, null));
    expect(host).toContain("你是房主：请卫戍房间里的人一起听你放的歌。人机不听歌。");
    expect(host).toContain(">邀请大家一起听</button>");
    expect(host).toContain(">先不</button>");
    const mate = card(room(2, on({ you: "out" })));
    expect(mate).toContain("晚昼 在开一起听");
    expect(mate).toContain("不加入也行：你自己听你的，或者不听。");
    expect(mate).toContain(">加入</button>");
    // in it already: no card
    expect(card(room(2, on()))).toBe("");
  });
});

describe("what an invitation of the room came to", () => {
  it("says nobody was there, all went, or how many did not and why", () => {
    expect(squadSentWords([])).toBe("房间里还没有别人（人机不听歌）");
    expect(squadSentWords([{ id: "2", ok: true }])).toContain("邀请发出去了");
    expect(squadSentWords([{ id: "2", ok: true }, { id: "3", ok: false, why: "TA 现在用不了听歌。" }])).toBe("有 1 位没发出去：TA 现在用不了听歌。");
    expect(listenWords(room(2, null), null)).toBeNull();
  });
});
