import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { dockFolded, dockTabs, keepDockFolded, readyOf, tabAtRound, tileTap } from "./dockState";
import SquadDock from "./SquadDock";
import SquadMateCard from "./SquadMateCard";
import { Bubble } from "./SquadRoach";

afterEach(() => vi.unstubAllGlobals());

/** A browser's storage, kept in a map; broken: every read and write throws (a private window, storage off) */
function storage(broken = false) {
  const kept = new Map<string, string>();
  const no = () => {
    throw new Error("storage off");
  };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: broken ? no : (k: string) => kept.get(k) ?? null,
      setItem: broken ? no : (k: string, v: string) => void kept.set(k, v),
      removeItem: broken ? no : (k: string) => void kept.delete(k),
    },
  });
  return kept;
}

describe("the panel of the bar of a round on a computer", () => {
  it("stays folded on this computer once folded, open where nothing says, and does no harm where storage is off", () => {
    const kept = storage();
    expect(dockFolded()).toBe(false);
    keepDockFolded(true);
    expect(kept.get("squad.dock")).toBe("0");
    expect(dockFolded()).toBe(true);
    keepDockFolded(false);
    expect(kept.has("squad.dock")).toBe(false);
    expect(dockFolded()).toBe(false);
    storage(true);
    expect(() => keepDockFolded(true)).not.toThrow();
    expect(dockFolded()).toBe(false);
  });

  it("turns to 这局 as a round starts only when it is open and the player marked no strategy for it", () => {
    expect(tabAtRound(false, true)).toBe("round");
    expect(tabAtRound(true, true)).toBeNull();
    expect(tabAtRound(false, false)).toBeNull();
  });

  it("has your tile open 这局, or stop picking; a teammate's be the one picked, or open TA's card", () => {
    expect(tileTap(true, false)).toBe("round");
    expect(tileTap(true, true)).toBe("cancel");
    expect(tileTap(false, true)).toBe("pick");
    expect(tileTap(false, false)).toBe("card");
  });

  it("while the room waits, has your tile open the room's sheet, 说话 and 动作 alone, and says who is ready", () => {
    expect(tileTap(true, false, true)).toBe("sheet");
    expect(tileTap(true, true, true)).toBe("cancel");
    expect(tileTap(false, false, true)).toBe("card");
    expect(tileTap(false, true, true)).toBe("pick");
    expect(dockTabs(true)).toEqual(["say", "act", "round", "play"]);
    expect(dockTabs(false)).toEqual(["say", "act", "play"]);
    expect(readyOf({ you: true, host: true, inGame: false })).toEqual({ text: "你是房主", ok: false });
    expect(readyOf({ you: false, host: true, inGame: false })).toEqual({ text: "房主不用准备", ok: false });
    expect(readyOf({ you: false, host: false, inGame: true })).toEqual({ text: "✓ 准备好了", ok: true });
    expect(readyOf({ you: true, host: false, inGame: false })).toEqual({ text: "还没准备", ok: false });
  });

  const me: SquadMember = { h: 1, name: "晚昼", host: true, you: true, friend: false, inGame: true, pose: 0, core: 1, strategy: null, extras: [], avatar: "hood", color: "cyan" };
  const room = { state: "go", host: true, members: [me, { ...me, h: 2, name: "红豆", host: false, you: false }], listen: null, hear: true } as unknown as SquadRoom;
  const dock = (more: { folded?: boolean; tab?: "say" | "act" | "round"; picking?: "five" | null; unseen?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(SquadDock, {
        room,
        tab: more.tab ?? "say",
        folded: more.folded ?? false,
        unseen: more.unseen ?? false,
        picking: more.picking ?? null,
        onTab: () => {},
        onFold: () => {},
        onPick: () => {},
        onError: () => {},
      }),
    );

  it("shows its tabs with the page under them, or the tabs alone folded; 这局's dot while it was not looked at", () => {
    const open = dock();
    expect(open).toContain('aria-label="收起面板，只留格子"');
    expect(open).toContain('role="tabpanel"');
    expect(open).toContain("局内");
    const folded = dock({ folded: true, unseen: true });
    expect(folded).toContain('aria-label="展开面板"');
    expect(folded).not.toContain('role="tabpanel"');
    expect(folded).toContain('<span class="dot" aria-hidden="true"></span>');
  });

  it("leaves 这局 out of the tabs while the room waits", () => {
    const waiting = renderToStaticMarkup(
      createElement(SquadDock, {
        room: { ...room, state: "wait" } as SquadRoom,
        tab: "say",
        folded: false,
        unseen: false,
        picking: null,
        onTab: () => {},
        onFold: () => {},
        onPick: () => {},
        onError: () => {},
      }),
    );
    expect(waiting).toContain(">动作</button>");
    expect(waiting).not.toContain("这局");
    // 说话 starts on 组队 while waiting
    expect(waiting).toContain('aria-selected="true" class="on">组队</button>');
    expect(dock()).toContain(">这局");
  });

  it("has 动作 say which teammate to tap on the tiles while one is picked, with 算了", () => {
    expect(dock({ tab: "act" })).toContain(">击掌</button>");
    const picking = dock({ tab: "act", picking: "five" });
    expect(picking).toContain("点上面一位队友击掌");
    expect(picking).toContain(">算了</button>");
    expect(picking).not.toContain(">贴贴</button>");
  });

  it("says a line inside the speaker's own tile, 「对 X」 over it when it is to one", () => {
    const now = Date.now();
    const inside = renderToStaticMarkup(createElement(Bubble, { line: { key: 1, h: 2, p: 14, at: now }, lift: 28, side: "in" }));
    expect(inside).toContain('class="sq-bub in"');
    expect(inside).toContain("大的来了");
    expect(inside).not.toContain("--lift");
    const toYou = renderToStaticMarkup(createElement(Bubble, { line: { key: 2, h: 2, p: 14, at: now, to: 1 }, side: "in", to: me }));
    expect(toYou).toContain('<small class="sq-bto">对你</small>');
  });

  it("gives a teammate's card 击掌 and 贴贴 where the bar asks for them", () => {
    const card = (onMove?: (m: "five" | "hug") => void) =>
      renderToStaticMarkup(
        createElement(SquadMateCard, {
          m: room.members[1],
          host: true,
          staff: false,
          playing: true,
          art: null,
          busy: false,
          className: "on-bar beside",
          onMove,
          onTouch: () => {},
          onKick: () => {},
          onSafety: () => {},
          onBot: () => {},
          onClose: () => {},
        }),
      );
    expect(card(() => {})).toContain('<div class="sq-mmove">');
    expect(card()).not.toContain("sq-mmove");
    // while the room waits: TA's strategy and 对 TA 说 first, then 击掌 and 贴贴
    const waiting = renderToStaticMarkup(
      createElement(SquadMateCard, {
        m: room.members[1],
        host: true,
        staff: false,
        playing: false,
        art: null,
        busy: false,
        className: "on-bar beside",
        me,
        onSay: () => {},
        onMove: () => {},
        onTouch: () => {},
        onKick: () => {},
        onSafety: () => {},
        onBot: () => {},
        onClose: () => {},
      }),
    );
    expect(waiting.indexOf('class="sq-sayto"')).toBeGreaterThan(0);
    expect(waiting.indexOf('class="sq-mmove"')).toBeGreaterThan(waiting.indexOf('class="sq-sayto"'));
    expect(waiting).toContain(">请出去</button>");
  });
});
