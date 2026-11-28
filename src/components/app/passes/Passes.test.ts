import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withLang } from "@/i18n/server";
import { passCharNamed } from "@/lib/passCatalog";
import { TASK_MAX, TICKETS_CAP, type FollowTask, type PassState, type Task, type WishOwned } from "@/lib/passes";
import { Detail, DrawButtons, Home, layout, Odds, Peek, PoolPick, poolLine, sampleWidth, Tasks, WishEditor, WishSlots } from "./Passes";

/** Room under a card for its name (Passes.tsx CAPTION) */
const CAPTION = 20;

describe("where the cards of a draw lie", () => {
  it("puts a single one in the middle, 5:9, at most 96 wide and else .38 of the box", () => {
    const one = layout(1, 366);
    expect(one.pos).toHaveLength(1);
    const [{ x, y, w }] = one.pos;
    expect(w).toBe(96);
    expect(2 * x + w).toBe(366);
    expect(one.h).toBe(y + Math.round(w * 1.8) + CAPTION);
    expect(layout(1, 200).pos[0].w).toBe(76);
  });

  it("puts ten in two rows of five, 5:9, the second under the first one's names, all inside the box", () => {
    for (const W of [296, 342, 366, 396]) {
      const { pos, h } = layout(10, W);
      expect(pos).toHaveLength(10);
      const w = pos[0].w;
      const tall = Math.round(w * 1.8);
      expect(pos.every((p) => p.w === w)).toBe(true);
      expect(Math.min(...pos.map((p) => p.x))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...pos.map((p) => p.x + w))).toBeLessThanOrEqual(W);
      expect(new Set(pos.slice(0, 5).map((p) => p.y)).size).toBe(1);
      expect(new Set(pos.slice(5).map((p) => p.y)).size).toBe(1);
      expect(pos[5].y).toBeGreaterThanOrEqual(pos[0].y + tall + CAPTION);
      expect(h).toBe(pos[5].y + tall + CAPTION);
    }
  });
});

const task = (t: Task, done: number, got: number) => ({ task: t, done, got, max: TASK_MAX[t] });
const state = (tasks: PassState["tasks"], more: Partial<PassState> = {}): PassState => ({
  tickets: 5,
  tasks,
  giftsIn: 0,
  wish: [],
  wishOpen: true,
  miss: 0,
  wishOwned: [],
  wishDrawn: [],
  plain: [],
  welcomed: false,
  nextDayAt: 0,
  worn: null,
  gifts: true,
  pool: "both",
  pools: false,
  follow: null,
  ...more,
});
const tasksOf = (st: PassState, userId = "u1") =>
  renderToStaticMarkup(createElement(Tasks, { st, userId, onClaim: () => {}, onFollow: async () => null }));
/** A row's little boxes, in order: g claimed, d done and not claimed yet, - not done */
const boxes = (html: string) =>
  [...html.matchAll(/<span class="gt-p" aria-hidden="true">(.*?)<\/span>/g)].map((m) =>
    [...m[1].matchAll(/<i class="(\w*)"><\/i>/g)].map((i) => i[1] || "-").join(""),
  );

describe("每日任务 on the 寻访 page", () => {
  it("makes a button of a row with tickets to claim, and says of the others how far they are", () => {
    const html = tasksOf(state([task("touch", 2, 1), task("declare", 2, 2), task("reply", 1, 1), task("npc", 0, 0)], { giftsIn: 2 }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('<button type="button" class="gt-r can" aria-label="碰一碰别人：领 1 张寻访券">');
    expect(html).toContain('<span class="gt-x can">领 1 张</span>');
    expect(html).toContain('<span class="gt-x ok">✓ 领完</span>');
    expect(html).toContain('<span class="gt-x">1 / 3</span>');
    expect(html).toContain('<span class="gt-x">0 / 2</span>');
    expect(html).toContain("今天领了<b>4</b>/ 10");
    expect(boxes(html)).toEqual(["gd-", "gg", "g--", "--", "gg-"]);
    expect(html).toContain("触须之交送的");
    expect(html).toContain("已到账 2 张");
  });

  it("claims only as many as fit under 50, says 满 50 张 when none do, and leaves out gifts while 触须之交 may not give them", () => {
    const tasks = [task("touch", 3, 0), task("declare", 0, 0), task("reply", 0, 0), task("npc", 0, 0)];
    expect(tasksOf(state(tasks, { tickets: TICKETS_CAP - 2 }))).toContain('aria-label="碰一碰别人：领 2 张寻访券"');
    const full = tasksOf(state(tasks, { tickets: TICKETS_CAP, gifts: false }));
    expect(full).not.toContain("<button");
    expect(full).toContain('<span class="gt-x full">满 50 张</span>');
    expect(full).not.toContain("触须之交送的");
  });
});

describe("关注 B 站领券 on the 寻访 page", () => {
  const f: FollowTask = { name: "Breeze青嵐", url: "https://space.bilibili.com/12345", got: false };
  /** What this device's storage keeps (blocked: it refuses, as a browser may) */
  const kept = (rows: Record<string, string>, blocked = false) =>
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => {
        if (blocked) throw new Error("blocked");
        return rows[k] ?? null;
      },
    });
  afterEach(() => vi.unstubAllGlobals());

  it("comes first in 每日任务 while it is on: the account, and 关注, which opens it in a new window", () => {
    const html = tasksOf(state([task("touch", 0, 0), task("declare", 0, 0)], { follow: f }));
    const at = html.indexOf('<div class="gt-follow">');
    expect(at).toBeGreaterThan(html.indexOf('class="gt-h"'));
    expect(at).toBeLessThan(html.indexOf("碰一碰别人"));
    expect(html).toContain('<span class="gf-t"><b>关注Breeze青嵐</b><small>一次性 · 10 张</small></span>');
    // no second line asking those who follow already to tap too (Breeze, 2026-11-22)
    expect(html).not.toContain("已关注");
    expect(html).toContain(
      '<a class="gf-go" href="https://space.bilibili.com/12345" target="_blank" rel="noopener noreferrer" aria-label="去 B 站关注Breeze青嵐（新窗口）">关注</a>',
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("领取");
    expect(html).toContain('<p class="gf-msg" role="status"></p>');
    // its tickets are not the day's: 今天领了 counts the tasks under it
    expect(html).toContain("今天领了<b>0</b>/ 10");
  });

  it("is 领取 where this device remembers 关注 tapped by this player, for this link", () => {
    kept({ "zhoup.passFollowWent.u1": f.url });
    const html = tasksOf(state([task("touch", 0, 0)], { follow: f }));
    expect(html).toContain('<button type="button" class="gf-go claim">领取</button>');
    expect(html).not.toContain("<a ");
    expect(html).toContain('<span class="gf-t"><b>关注Breeze青嵐</b><small>一次性 · 10 张</small></span>');
    // another player on this device, or a link changed since: 关注 again
    expect(tasksOf(state([task("touch", 0, 0)], { follow: f }), "u2")).toContain(">关注</a>");
    expect(tasksOf(state([task("touch", 0, 0)], { follow: { ...f, url: "https://space.bilibili.com/678" } }))).toContain(">关注</a>");
    // storage blocked: 关注, which works all the same
    kept({}, true);
    expect(tasksOf(state([task("touch", 0, 0)], { follow: f }))).toContain(">关注</a>");
  });

  it("says 已领 the day it was claimed, with neither 关注 nor 领取, and is not there while it is off", () => {
    kept({ "zhoup.passFollowWent.u1": f.url });
    const got = tasksOf(state([task("touch", 0, 0)], { follow: { ...f, got: true } }));
    expect(got).toContain('<div class="gt-follow got">');
    expect(got).toContain('<span class="gf-t"><b>关注Breeze青嵐</b><small>一次性 · 10 张</small></span><span class="gt-x ok">已领</span>');
    expect(got).not.toContain("gf-go");
    expect(tasksOf(state([task("touch", 0, 0)]))).not.toContain("gt-follow");
  });
});

describe("寻访一次 and 寻访十次", () => {
  const six = [1, 2, 3, 4, 5, 6];
  const buttons = (st: PassState, busy = false) =>
    renderToStaticMarkup(createElement(DrawButtons, { st, busy, onPull: () => {}, onEdit: () => {} }));

  it("may be pressed with a full wish list or an empty one, too few tickets dimming them", () => {
    for (const wish of [[], six]) {
      expect(buttons(state([], { wish, tickets: 5 })), String(wish.length)).toBe(
        '<div class="g-btns"><button class="">寻访一次<small>1 张</small></button><button class="y dim">寻访十次<small>10 张</small></button></div>',
      );
    }
    expect(buttons(state([], { wish: six }), true).match(/ disabled=""/g)).toHaveLength(2);
  });

  it("may not be pressed with 1 to 5 on the wish list: over them, how many more it wants or to empty it, and 改心愿单", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(buttons(state([], { wish: six.slice(0, n), tickets: 50 })), String(n)).toBe(
        `<p class="g-short">心愿单还差 ${6 - n} 位：放满 6 位才能寻访，不要心愿就全部拿掉。<button>改心愿单 ›</button></p>` +
          '<div class="g-btns"><button class="" disabled="">寻访一次<small>1 张</small></button>' +
          '<button class="y" disabled="">寻访十次<small>10 张</small></button></div>',
      );
    }
    const onEdit = vi.fn();
    type Line = ReactElement<{ children: [string, ReactElement<{ onClick: () => void }>] }>;
    const [line] = (DrawButtons({ st: state([], { wish: [1] }), busy: false, onPull: () => {}, onEdit }) as ReactElement<{ children: [Line] }>).props
      .children;
    line.props.children[1].props.onClick();
    expect(onEdit).toHaveBeenCalledOnce();
  });
});

describe("改心愿单", () => {
  const editor = (st: PassState) =>
    renderToStaticMarkup(
      createElement(WishEditor, { st, art: null, favourites: { arknights: [], endfield: [] }, onBack: () => {}, onSaved: () => {}, onRefused: () => {} }),
    );
  /** The note over the list, and 保存 with what it says under it */
  const note = (html: string) => html.match(/<p class="wl-note">(.*?)<\/p>/)?.[1];
  const save = (html: string) => html.match(/<button class="wl-save"[^>]*>保存<small>.*?<\/small><\/button>/)?.[0];
  const free = "放满 6 位才能寻访，不要心愿就一位也不放。没放满的时候改，不算今天那一次。";

  it("saves 6 or none: one kept with fewer cannot be saved as it is, and says how many more; a change while not full is free", () => {
    const short = editor(state([], { wish: [1, 2, 3] }));
    expect(note(short)).toBe(free);
    expect(save(short)).toBe('<button class="wl-save" disabled="">保存<small>还差 3 位</small></button>');
    const empty = editor(state([], { wish: [] }));
    expect(note(empty)).toBe(free);
    expect(save(empty)).toBe('<button class="wl-save" disabled="">保存<small>没放满时改，不算今天那一次</small></button>');
  });

  it("changes a full one once a site day", () => {
    const full = editor(state([], { wish: [1, 2, 3, 4, 5, 6] }));
    expect(note(full)).toBe("今天还能改 1 次，改了不影响保底已经数到第几次。");
    expect(save(full)).toBe('<button class="wl-save" disabled="">保存<small>保存后今天就不能再改了</small></button>');
    const locked = editor(state([], { wish: [1, 2, 3, 4, 5, 6], wishOpen: false }));
    expect(note(locked)).toBe("今天已经改过了，北京时间凌晨 4 点以后能再改。");
    expect(save(locked)).toBeUndefined();
    expect(locked).not.toContain("wl-search");
  });
});

describe("卡池 on the 寻访 page", () => {
  type Pick = ReactElement<{ children: ReactElement<{ "aria-checked": boolean; onClick: () => void; children: string }>[] }>;

  it("picks both games or one, the one picked checked, and says the wish list comes all the same", () => {
    const html = renderToStaticMarkup(createElement(PoolPick, { pool: "ef", onPick: () => {} }));
    expect(html).toContain('<b aria-hidden="true">卡池</b><div class="gp-sw" role="radiogroup" aria-label="卡池">');
    expect([...html.matchAll(/<button type="button" role="radio" aria-checked="(\w+)">(.*?)<\/button>/g)].map((m) => [m[2], m[1]])).toEqual([
      ["两边都抽", "false"],
      ["只抽方舟", "false"],
      ["只抽终末地", "true"],
    ]);
    expect(html).toContain("<p>卡池只影响不是心愿的那些，心愿单里的角色照样会出。</p>");

    const onPick = vi.fn();
    const buttons = ((PoolPick({ pool: "both", onPick }) as ReactElement<{ children: ReactElement[] }>).props.children[1] as Pick).props.children;
    expect(buttons.map((b) => b.props["aria-checked"])).toEqual([true, false, false]);
    buttons[1].props.onClick();
    expect(onPick).toHaveBeenCalledWith("ak");
  });

  it("says on the banner whom a draw picks from", () => {
    expect(poolLine("both")).toBe("475 位角色 · 每位概率一样");
    expect(poolLine("ak")).toBe("只抽方舟 · 441 位角色");
    expect(poolLine("ef")).toBe("只抽终末地 · 34 位角色");
  });

  const home = (st: PassState) =>
    renderToStaticMarkup(
      createElement(Home, {
        st,
        userId: "u1",
        art: null,
        msg: "",
        said: "",
        busy: false,
        bump: null,
        claimed: 0,
        pool: st.pool,
        hidden: false,
        onPull: () => {},
        onClaim: () => {},
        onFollow: async () => null,
        onPool: () => {},
        onPeek: () => {},
        onScreen: () => {},
        onGift: () => {},
        onClose: () => {},
      }),
    );

  it("counts the headhunts without a wish in English on the English site, one or more; Chinese as it was", () => {
    const wish = [1, 2, 3, 4, 5, 6];
    withLang("en", () => {
      expect(home(state([task("touch", 0, 0)], { wish, miss: 1 }))).toContain("<span><b>1</b> headhunt without a wish</span><span>A wish within <b>29</b> more</span>");
      expect(home(state([task("touch", 0, 0)], { wish, miss: 2 }))).toContain("<span><b>2</b> headhunts without a wish</span>");
    });
    expect(home(state([task("touch", 0, 0)], { wish, miss: 2 }))).toContain("<span>已经<b>2</b>次没出心愿</span><span>最晚再<b>28</b>次</span>");
  });

  it("is not there to pick while only both games' may be drawn from (PASS_POOLS not on), and is once one game's may", () => {
    const shut = home(state([task("touch", 0, 0)]));
    expect(shut).toContain("<span>475 位角色 · 每位概率一样</span>");
    expect(shut).not.toContain("g-pool");
    expect(shut).not.toContain("只抽");
    const open = home(state([task("touch", 0, 0)], { pools: true, pool: "ef" }));
    expect(open).toContain("<span>只抽终末地 · 34 位角色</span>");
    expect(open).toContain('<div class="g-pool">');
  });

  it("is told of in 概率说明 only once one game's may be picked: before, every draw is one in all 475", () => {
    const odds = (pools: boolean) => renderToStaticMarkup(createElement(Odds, { gifts: true, pools, onBack: () => {} }));
    const shut = odds(false);
    expect(shut).toContain("<p>每次寻访，每位角色抽到的机会都一样：1/475，约 0.21%。星级只印在通行证上，和机会没有关系。</p>");
    expect(shut).not.toContain("只抽");
    expect(shut).not.toContain("两边都抽");
    const open = odds(true);
    expect(open).toContain("<p>卡池两边都抽时，每次寻访每位角色抽到的机会都一样：1/475，约 0.21%。");
    expect(open).toContain("<p>卡池也可以只抽方舟或只抽终末地，在寻访页上随时能改");
  });
});

describe("a wish tapped on the 寻访 page", () => {
  const amiya = passCharNamed("arknights", "阿米娅")!;
  const exu = passCharNamed("arknights", "能天使")!;
  const admin = passCharNamed("endfield", "管理员")!;
  const owned = (charId: number, copies: number, no: number): WishOwned => ({ charId, copies, first: { id: 70 + no, no, at: Date.parse("2026-11-14T12:00:00+08:00") } });
  const peek = (id: number, st: PassState) =>
    renderToStaticMarkup(createElement(Peek, { id, st, art: null, holder: "柚子", onBack: () => {}, onTook: () => {}, onRefused: () => {} }));
  type Slot = ReactElement<{ "aria-label"?: string; className?: string; onClick?: (e: unknown) => void }>;

  it("makes a button of each place: a wish opens their pass, an empty place the wish list's editor", () => {
    const st = state([], { wish: [amiya.id, exu.id], wishOwned: [owned(exu.id, 1, 3)] });
    const onPeek = vi.fn();
    const onEdit = vi.fn();
    const html = renderToStaticMarkup(createElement(WishSlots, { st, art: null, onPeek, onEdit }));
    expect(html.match(/<button/g)).toHaveLength(6);
    expect(html).toContain('<button type="button" class="hw" aria-label="阿米娅：还没抽到，看样张">');
    expect(html).toContain('<button type="button" class="hw got" aria-label="能天使：看你的通行证">');
    expect(html.match(/<button type="button" class="hw empty" aria-label="空格子，改心愿单">/g)).toHaveLength(4);

    const slots = (WishSlots({ st, art: null, onPeek, onEdit }) as ReactElement<{ children: Slot[] }>).props.children;
    slots[1].props.onClick?.({ currentTarget: "the slot" });
    expect(onPeek).toHaveBeenCalledWith(exu.id, "the slot");
    slots[5].props.onClick?.({});
    expect(onEdit).toHaveBeenCalledOnce();
    // in the editor they stay as they were, each wish with its ✕
    const editor = renderToStaticMarkup(createElement(WishSlots, { st, art: null, onRemove: () => {} }));
    expect(editor).not.toContain('<button type="button" class="hw');
    expect(editor).toContain('<div class="hw got">');
  });

  it("shows one not drawn yet as 样张, both looks side by side, No.??????, no gold, nothing to wear, and only 返回", () => {
    for (const [c, marks] of [
      [amiya, ["①", "②"]],
      [admin, ["③", "④"]],
    ] as const) {
      const html = peek(c.id, state([], { wish: [c.id], wishDrawn: [{ charId: c.id, lastNo: 63 }] }));
      const looks = [...html.matchAll(/<div class="zc (\w+( \w+)?)"/g)].map((m) => m[1]);
      expect(looks).toEqual(c.game === "ak" ? ["ra", "ra rax"] : ["tag", "tag tagx"]);
      expect(html.match(/<small>No.<\/small>\?{6}</g)).toHaveLength(2);
      expect(html.match(/class="zsmp" aria-hidden="true">样张<small>SAMPLE<\/small>/g)).toHaveLength(2);
      expect(html).not.toContain("zfoil");
      expect(html).toContain("持证 ——");
      expect(html).toContain(`<figcaption>第一张 · 普通 ${marks[0]}</figcaption>`);
      expect(html).toContain(`<figcaption>第二张起 · 镭射 ${marks[1]}</figcaption>`);
      expect(html).toContain(`role="group" aria-label="${c.name}"`);
      expect(html).toContain('aria-label="回到寻访"');
      expect(html).toContain("还没抽到");
      expect(html).not.toContain("戴上");
      expect(html.match(/<button/g)).toHaveLength(2);
    }
  });

  it("draws the two 样张 as big as the screen leaves room for, side by side, from 118 and 160 wide up to half again", () => {
    expect(sampleWidth("ak", null)).toBe(118);
    expect(sampleWidth("ef", null)).toBe(160);
    for (const [width, height] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [420, 812],
    ]) {
      for (const game of ["ak", "ef"] as const) {
        const w = sampleWidth(game, { width, height });
        const [stands, tall] = game === "ef" ? [w * 0.644, w * 1.61] : [w, w * 1.61];
        expect(2 * stands + 12).toBeLessThanOrEqual(width - 32);
        expect(tall).toBeLessThanOrEqual(height - 250);
        expect(w).toBeGreaterThanOrEqual(game === "ef" ? 160 : 118);
        expect(w).toBeLessThanOrEqual(game === "ef" ? 240 : 177);
      }
    }
    expect(sampleWidth("ak", { width: 390, height: 844 })).toBe(173);
    expect(sampleWidth("ef", { width: 390, height: 844 })).toBe(240);
  });

  it("says how many the site has drawn, and of the gold first hundred how many are left while there are", () => {
    const words = (lastNo: number) =>
      peek(amiya.id, state([], { wish: [amiya.id], wishDrawn: lastNo ? [{ charId: amiya.id, lastNo }] : [] }))
        .match(/<p class="wd-note">(.*?)<\/p>/)![1]
        .replace(/<[^>]+>/g, "");
    expect(words(0)).toBe("这是样张，抽到以后印上你的名字和编号。全站已抽出 0 张，金色的前 100 号还剩 100 个。");
    expect(words(63)).toBe("这是样张，抽到以后印上你的名字和编号。全站已抽出 63 张，金色的前 100 号还剩 37 个。");
    expect(words(99)).toBe("这是样张，抽到以后印上你的名字和编号。全站已抽出 99 张，金色的前 100 号还剩 1 个。");
    expect(words(100)).toBe("这是样张，抽到以后印上你的名字和编号。全站已抽出 100 张。");
    expect(words(1287)).toBe("这是样张，抽到以后印上你的名字和编号。全站已抽出 1287 张。");
  });

  it("opens one the player has (just drawn too) as 我的通行证 does, at once, with ‹ back to 寻访; 镭射 from a second copy", () => {
    const one = peek(amiya.id, state([], { wish: [amiya.id], wishOwned: [owned(amiya.id, 1, 11)], wishDrawn: [{ charId: amiya.id, lastNo: 12 }] }));
    expect(one).not.toContain("zsmp");
    expect(one).toContain("<small>No.</small>000011");
    expect(one).toContain('aria-label="回到寻访"');
    expect(one).toContain('<button type="button" aria-pressed="false" disabled="">镭射 ②</button>');
    expect(one).toContain('<button type="button" class="y">戴上</button>');
    expect(one).toContain("再抽到一张这位，就能换成镭射版。");
    const two = peek(amiya.id, state([], { wish: [amiya.id], wishOwned: [owned(amiya.id, 2, 11)] }));
    expect(two).toContain('<button type="button" aria-pressed="true">镭射 ②</button>');
    expect(two).toContain('class="zc ra rax"');
    // from 我的通行证, ‹ goes back there
    const c = amiya;
    const fromWallet = renderToStaticMarkup(
      createElement(Detail, {
        o: { charId: c.id, copies: 1, no: 11, lastAt: 0, c },
        st: state([]),
        art: null,
        holder: "柚子",
        onBack: () => {},
        onTook: () => {},
        onRefused: () => {},
      }),
    );
    expect(fromWallet).toContain('aria-label="回到我的通行证"');
  });
});
