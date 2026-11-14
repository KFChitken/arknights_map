import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { passCharNamed } from "@/lib/passCatalog";
import { TASK_MAX, TICKETS_CAP, type PassState, type Task, type WishOwned } from "@/lib/passes";
import { Detail, layout, Peek, sampleWidth, Tasks, WishSlots } from "./Passes";

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
  ...more,
});
const tasksOf = (st: PassState) => renderToStaticMarkup(createElement(Tasks, { st, onClaim: () => {} }));
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
