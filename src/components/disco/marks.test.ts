import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoMark } from "@/components/map/discoStage";
import { BOB, danceTraits, JUMP, WAVE, WILD, wildMove } from "./choreo";
import { type DanceNow, STANDING } from "./glsl";
import { DanceMarks, markPose } from "./marks";

const dancing = (over: Partial<DanceNow> = {}): DanceNow => ({ ...STANDING, on: 1, a: BOB, b: BOB, mix: 1, amp: 1, beat: 0.3, ...over });
const traits = danceTraits(12345);
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("markPose", () => {
  it("stands as ever while nobody dances", () => {
    for (const kind of ["main", "mine", "guide"] as const) near(markPose(kind, { ...STANDING }, 0.5, traits), [0, 0, 0, 1, 1]);
  });

  it("has the guides only nod, at 0.6 of the crowd's bob, whatever the crowd dances", () => {
    for (const move of [BOB, JUMP, WAVE, WILD]) {
      for (let beat = 0; beat < 4; beat += 0.1) {
        const n = dancing({ a: move, b: move, beat });
        const [x, y, tilt, w, h] = markPose("guide", n, 0.5, traits);
        expect(x).toBe(0);
        expect(tilt).toBe(0);
        const bob = markPose("mine", { ...n, a: BOB, b: BOB }, 0.5, traits);
        expect(y).toBeCloseTo(bob[1] * 0.6, 6);
        expect(w - 1).toBeCloseTo((bob[3] - 1) * 0.6, 6);
        expect(h - 1).toBeCloseTo((bob[4] - 1) * 0.6, 6);
      }
    }
  });

  it("has your main roach dance a little bigger than the others", () => {
    const n = dancing({ a: JUMP, b: JUMP, beat: 0.3 });
    expect(markPose("main", n, 0.5, traits)[1] / markPose("mine", n, 0.5, traits)[1]).toBeCloseTo(1.15, 6);
  });

  it("in the wave, has those further right go later", () => {
    const n = dancing({ a: WAVE, b: WAVE, beat: 2.3 });
    near(markPose("mine", n, 1, traits), markPose("mine", { ...n, beat: 2.3 - 0.9 }, 0, traits));
    expect(markPose("mine", n, 1, traits)).not.toEqual(markPose("mine", n, 0, traits));
  });

  it("in 群魔乱舞, has each dance the move its own traits pick, as the shaders do", () => {
    for (const seed of [1, 777, 99_999, 4_000_000_000]) {
      const t = danceTraits(seed);
      const n = dancing({ a: WILD, b: WILD, beat: 21.3 });
      const own = wildMove(t, 21.3);
      near(markPose("mine", n, 0.5, t), markPose("mine", { ...n, a: own, b: own }, 0.5, t));
    }
  });

  it("has everyone hop on the climax's first beat", () => {
    const n = dancing({ a: BOB, b: BOB, beat: 0.3 });
    expect(markPose("mine", { ...n, drop: 1 }, 0.5, traits)[1]).toBeLessThan(markPose("mine", n, 0.5, traits)[1]);
  });
});

/** A page element as DanceMarks uses it: its style as written, and how many times it was written */
type Fake = { style: Map<string, string>; writes: number; el: HTMLElement };
function fakeEl(inner?: Fake): Fake {
  const style = new Map<string, string>();
  const it: Fake = {
    style,
    writes: 0,
    el: {
      isConnected: true,
      style: {
        setProperty: (k: string, v: string) => {
          it.writes++;
          style.set(k, v);
        },
        removeProperty: (k: string) => style.delete(k),
      },
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 48, height: 48, right: 148, bottom: 148 }),
      querySelector: (q: string) => (inner && q.startsWith(":scope > img") ? inner.el : null),
    } as unknown as HTMLElement,
  };
  return it;
}

const box = { left: 0, width: 400 };

describe("DanceMarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves your roaches by transform alone, about their feet, and puts them back as they were", () => {
    const a = fakeEl();
    const marks = new DanceMarks();
    marks.draw([{ el: a.el, kind: "main", seed: 1, size: 48 }], dancing({ a: JUMP, b: JUMP }), box);
    expect(a.style.get("transform")).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) rotate\(-?[\d.]+deg\) scale\(-?[\d.]+, -?[\d.]+\)$/);
    expect(a.style.get("transform-origin")).toBe("50% 92%");
    // your main roach a third as big again
    expect(a.style.get("transform")).toContain("scale(1.");
    marks.reset();
    expect(a.style.size).toBe(0);
  });

  it("writes only what changed, and puts back at once one that is no longer there to dance", () => {
    const a = fakeEl();
    const b = fakeEl();
    const marks = new DanceMarks();
    const n = dancing({ a: JUMP, b: JUMP });
    const list: DiscoMark[] = [
      { el: a.el, kind: "mine", seed: 1, size: 48 },
      { el: b.el, kind: "mine", seed: 2, size: 48 },
    ];
    marks.draw(list, n, box);
    const writes = a.writes;
    marks.draw(list, n, box);
    expect(a.writes).toBe(writes);
    marks.draw(list.slice(0, 1), n, box);
    expect(b.style.size).toBe(0);
    expect(a.style.size).toBe(2);
  });

  it("moves a guide's picture by translate and scale alone, which keep her own turn; and not at all where the browser has none", () => {
    const pic = fakeEl();
    const guide = fakeEl(pic);
    const marks = new DanceMarks();
    const list: DiscoMark[] = [{ el: guide.el, kind: "guide", seed: 0, size: 0 }];
    marks.draw(list, dancing(), box);
    expect(pic.style.size).toBe(0);

    vi.stubGlobal("CSS", { supports: () => true });
    const later = new DanceMarks();
    later.draw(list, dancing(), box);
    expect(pic.style.has("transform")).toBe(false);
    expect(pic.style.get("translate")).toMatch(/^0px -?[\d.]+px$/);
    expect(pic.style.get("scale")).toMatch(/^[\d.]+ [\d.]+$/);
    expect(guide.style.size).toBe(0);
    later.reset();
    expect(pic.style.size).toBe(0);
  });
});
