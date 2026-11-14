import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TASK_MAX, TICKETS_CAP, type PassState, type Task } from "@/lib/passes";
import { layout, Tasks } from "./Passes";

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
