import { describe, expect, it, vi } from "vitest";
import type { InkPoint } from "@/lib/siTiles";
import type { Near } from "@/lib/stackPick";
import { tapNear } from "./stackTap";
import type { StackHit } from "./types";

const at = { lng: 118.2, lat: 29.9 };
const opens = () => ({ onRoachClick: vi.fn(), onMineClick: vi.fn(), onInkClick: vi.fn(), onStackClick: vi.fn() });
const ink = { lng: 118.2, lat: 29.9, look: 0, state: 0, size: 1 } as unknown as InkPoint;
const near = (...hits: [StackHit, number][]): Near<StackHit>[] => hits.map(([ref, d]) => ({ ref, d }));

describe("a tap close up", () => {
  it("offers those lying on top of each other, nearest the finger first, and opens none of them", () => {
    const p = opens();
    const hits = near([{ kind: "roach", id: "a" }, 9], [{ kind: "mine", id: "m" }, 2], [{ kind: "ink", ink }, 30]);
    expect(tapNear(p, hits, at)).toBe(true);
    expect(p.onStackClick).toHaveBeenCalledWith({ hits: [{ kind: "mine", id: "m" }, { kind: "roach", id: "a" }, { kind: "ink", ink }], at });
    expect(p.onRoachClick).not.toHaveBeenCalled();
    expect(p.onMineClick).not.toHaveBeenCalled();
  });

  it("opens the one clearly nearest as a tap on it alone opens it", () => {
    const p = opens();
    expect(tapNear(p, near([{ kind: "roach", id: "a" }, 20], [{ kind: "roach", id: "b" }, 3]), at)).toBe(true);
    expect(p.onRoachClick).toHaveBeenCalledWith("b");
    expect(p.onStackClick).not.toHaveBeenCalled();

    const q = opens();
    tapNear(q, near([{ kind: "mine", id: "m" }, 0]), at);
    expect(q.onMineClick).toHaveBeenCalledWith("m");

    const r = opens();
    tapNear(r, near([{ kind: "myInk" }, 1], [{ kind: "ink", ink }, 15]), at);
    expect(r.onInkClick).toHaveBeenCalledWith({ kind: "mine" });

    const s = opens();
    tapNear(s, near([{ kind: "ink", ink }, 4]), at);
    expect(s.onInkClick).toHaveBeenCalledWith({ kind: "other", ink });
  });

  it("opens the nearest where the page offers no list", () => {
    const p = { ...opens(), onStackClick: undefined };
    expect(tapNear(p, near([{ kind: "roach", id: "a" }, 5], [{ kind: "roach", id: "b" }, 4]), at)).toBe(true);
    expect(p.onRoachClick).toHaveBeenCalledWith("b");
  });

  it("leaves a tap on nothing to the map", () => {
    const p = opens();
    expect(tapNear(p, [], at)).toBe(false);
    expect(p.onStackClick).not.toHaveBeenCalled();
    expect(p.onRoachClick).not.toHaveBeenCalled();
  });
});
