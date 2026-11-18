import { describe, expect, it } from "vitest";
import type { ListenRoom, RoomMember } from "./listen";
import {
  farPeople,
  farView,
  fitView,
  freeFrames,
  innerOf,
  latOf,
  lngOf,
  mercX,
  mercY,
  narrowest,
  onScreen,
  sameView,
  spanOf,
  worldPx,
  type Rect,
} from "./listenFar";
import type { LngLat } from "./types";
import type { Friend } from "./world/types";

// 一起听's 拉远 worked out: who is drawn where, the part of the map clear of the buttons, the view framing them in it,
// and whether the map was moved by hand

const SHANGHAI = { lng: 121.47, lat: 31.23 };
const LOS_ANGELES = { lng: -118.24, lat: 34.05 };
const BEIJING = { lng: 116.4, lat: 39.9 };
const HANGZHOU = { lng: 120.16, lat: 30.27 };
const HEFEI = { lng: 117.23, lat: 31.82 };

const card = (name: string) => ({ displayName: name, avatar: "roach", color: "red" }) as unknown as RoomMember["card"];
const member = (h: number, over: Partial<RoomMember> = {}): RoomMember => ({
  h,
  card: card(`p${h}`),
  open: true,
  friend: false,
  host: false,
  state: "in",
  ...over,
});
const room = (you: number, members: RoomMember[]) => ({ you, members }) as unknown as ListenRoom;
const friend = (id: string, roaches: (LngLat & { clone: boolean })[]) => ({ id, roaches }) as unknown as Friend;

/** Whether each place is seen within frame (less its edge) on a map size big showing view */
const seenIn = (view: { lng: number; lat: number; zoom: number }, frame: Rect, size: { w: number; h: number }, places: LngLat[]) => {
  const inner = innerOf(frame);
  return places.map((p) => {
    const at = onScreen(view, size, p);
    return at.x >= inner.left - 1 && at.x <= inner.right + 1 && at.y >= inner.top - 1 && at.y <= inner.bottom + 1;
  });
};

describe("who is drawn on 拉远", () => {
  it("you at your main roach, and each 触须之交 of yours in the room at TA's main roach as your list has it; nobody else", () => {
    const r = room(1, [
      member(1, { host: true }),
      member(2, { friend: true, friendId: "f2" }),
      member(3),
      member(4, { friend: true, friendId: "f4", state: "left" }),
      member(5, { friend: true, friendId: "unfriended" }),
      member(6, { state: "kicked" }),
    ]);
    const friends = [
      friend("f2", [
        { ...BEIJING, clone: true },
        { ...LOS_ANGELES, clone: false },
      ]),
      friend("f4", [{ ...HANGZHOU, clone: false }]),
    ];
    const { placed, others } = farPeople(r, SHANGHAI, friends);
    expect(placed.map((p) => [p.h, p.lng, p.lat, p.mine, p.friend, p.host])).toEqual([
      [1, SHANGHAI.lng, SHANGHAI.lat, true, false, true],
      [2, LOS_ANGELES.lng, LOS_ANGELES.lat, false, true, false],
    ]);
    expect(placed[1].name).toBe("p2");
    // 3 is nobody of yours, 5 no longer on your list: going round you; 4 and 6 are not in it
    expect(others).toBe(2);
  });

  it("never at a clone: a 触须之交 with only clones out is not drawn", () => {
    const r = room(1, [member(1), member(2, { friend: true, friendId: "f2" })]);
    const { placed, others } = farPeople(r, SHANGHAI, [friend("f2", [{ ...BEIJING, clone: true }])]);
    expect(placed.map((p) => p.h)).toEqual([1]);
    expect(others).toBe(1);
  });

  it("you with no main roach out: not drawn, and not one of the others either", () => {
    const r = room(2, [member(1, { host: true, friend: true, friendId: "f1" }), member(2)]);
    const { placed, others } = farPeople(r, null, [friend("f1", [{ ...BEIJING, clone: false }])]);
    expect(placed.map((p) => [p.h, p.mine, p.host])).toEqual([[1, false, true]]);
    expect(others).toBe(0);
  });
});

describe("the world as the maps draw it", () => {
  it("goes there and back", () => {
    expect(lngOf(mercX(LOS_ANGELES.lng))).toBeCloseTo(LOS_ANGELES.lng, 9);
    expect(lngOf(mercX(LOS_ANGELES.lng) + 1)).toBeCloseTo(LOS_ANGELES.lng, 9);
    expect(latOf(mercY(SHANGHAI.lat))).toBeCloseTo(SHANGHAI.lat, 9);
    expect(mercY(0)).toBeCloseTo(0.5, 12);
    expect(mercY(89)).toBeCloseTo(0, 6);
    expect(worldPx(1)).toBe(1024);
  });

  it("takes the narrowest way round: Shanghai to Los Angeles across the Pacific", () => {
    const [sh, la] = narrowest([mercX(SHANGHAI.lng), mercX(LOS_ANGELES.lng)]);
    expect(la - sh).toBeCloseTo((360 - 118.24 - 121.47) / 360, 9);
    const s = spanOf([SHANGHAI, LOS_ANGELES]);
    expect((s.x1 - s.x0) * 360).toBeCloseTo(120.29, 6);
    expect(s.y0).toBeCloseTo(mercY(LOS_ANGELES.lat), 12);
    expect(s.y1).toBeCloseTo(mercY(SHANGHAI.lat), 12);
  });

  it("leaves places as they are where the narrowest way does not cross the back of the world", () => {
    const xs = [mercX(SHANGHAI.lng), mercX(BEIJING.lng), mercX(HANGZHOU.lng)];
    expect(narrowest(xs)).toEqual(xs);
    expect(narrowest([0.3])).toEqual([0.3]);
    const s = spanOf([SHANGHAI, BEIJING]);
    expect((s.x1 - s.x0) * 360).toBeCloseTo(121.47 - 116.4, 9);
  });
});

describe("the parts of the map clear of the buttons", () => {
  // a phone's map: a bar along the top, a column of buttons down the right
  const box: Rect = { left: 0, top: 0, right: 400, bottom: 700 };
  const top: Rect = { left: 0, top: 0, right: 400, bottom: 60 };
  const column: Rect = { left: 340, top: 80, right: 400, bottom: 400 };
  const beside: Rect = { left: 0, top: 60, right: 340, bottom: 700 };
  const below: Rect = { left: 0, top: 400, right: 400, bottom: 700 };
  const size = { w: 400, h: 700 };

  it("are beside the buttons all the way down, and under them across the whole width", () => {
    expect(freeFrames(box, [top, column])).toEqual([beside, below]);
  });

  it("are all of it with nothing in the way, and none where nothing big enough is clear", () => {
    expect(freeFrames(box, [])).toEqual([box]);
    expect(freeFrames(box, [{ left: -10, top: -10, right: 410, bottom: 710 }])).toEqual([]);
  });

  it("frames places side by side across all the width under the buttons", () => {
    const got = farView([SHANGHAI, HEFEI], box, [top, column], size, [0, 18], 15)!;
    expect(got.frame).toEqual(below);
    expect(seenIn(got.view, got.frame, size, [SHANGHAI, HEFEI])).toEqual([true, true]);
  });

  it("frames places one over the other all the way down beside the buttons", () => {
    const got = farView([SHANGHAI, BEIJING], box, [top, column], size, [0, 18], 15)!;
    expect(got.frame).toEqual(beside);
    expect(seenIn(got.view, got.frame, size, [SHANGHAI, BEIJING])).toEqual([true, true]);
  });

  it("frames Shanghai and Los Angeles beside the buttons: under them, so far out, the map cannot put them", () => {
    // so far out the world is not much taller than the map, which shows nothing past its top or bottom
    expect(seenIn(fitView([SHANGHAI, LOS_ANGELES], below, size, [0, 18], 15)!, below, size, [SHANGHAI, LOS_ANGELES])).toEqual([false, false]);
    const got = farView([SHANGHAI, LOS_ANGELES], box, [top, column], size, [0, 18], 15, SHANGHAI)!;
    expect(got.frame).toEqual(beside);
    expect(seenIn(got.view, got.frame, size, [SHANGHAI, LOS_ANGELES])).toEqual([true, true]);
  });

  it("frames in all of it where nothing big enough is clear", () => {
    const got = farView([SHANGHAI, HEFEI], box, [{ left: -10, top: -10, right: 410, bottom: 710 }], size, [0, 18], 15)!;
    expect(got.frame).toEqual(box);
  });

  it("frames as many as it can where the map goes out no further (高德's on a phone), yours among them", () => {
    const phone = { w: 390, h: 844 };
    const got = farView([SHANGHAI, LOS_ANGELES], { left: 0, top: 0, right: 390, bottom: 700 }, [], phone, [1, 19], 15, SHANGHAI)!;
    expect(got.view.zoom).toBe(1);
    expect(seenIn(got.view, got.frame, phone, [SHANGHAI])).toEqual([true]);
  });

  it("frames nobody: nothing", () => {
    expect(farView([], box, [top, column], size, [0, 18], 15)).toBeNull();
  });
});

describe("the view framing them", () => {
  const size = { w: 400, h: 700 };
  const below: Rect = { left: 0, top: 400, right: 400, bottom: 700 };
  const beside: Rect = { left: 0, top: 60, right: 340, bottom: 700 };

  it("frames Shanghai and Los Angeles across the Pacific, edge to edge of the frame", () => {
    const v = fitView([SHANGHAI, LOS_ANGELES], beside, size, [0, 18], 15)!;
    const inner = innerOf(beside);
    expect(v.zoom).toBeCloseTo(Math.log2((inner.right - inner.left) / ((360 - 118.24 - 121.47) / 360) / 512), 6);
    const a = onScreen(v, size, SHANGHAI);
    const b = onScreen(v, size, LOS_ANGELES);
    expect(Math.min(a.x, b.x)).toBeCloseTo(inner.left, 3);
    expect(Math.max(a.x, b.x)).toBeCloseTo(inner.right, 3);
    // Shanghai on the left, Los Angeles on the right
    expect(a.x).toBeLessThan(b.x);
  });

  it("puts the middle of them in the middle of the frame, where the map can", () => {
    const v = fitView([SHANGHAI, HEFEI], below, size, [0, 18], 15)!;
    const inner = innerOf(below);
    const a = onScreen(v, size, SHANGHAI);
    const b = onScreen(v, size, HEFEI);
    expect((a.x + b.x) / 2).toBeCloseTo((inner.left + inner.right) / 2, 3);
    expect((a.y + b.y) / 2).toBeCloseTo((inner.top + inner.bottom) / 2, 3);
  });

  it("shows nothing past the world's top or bottom: far out, its middle kept half the map's height from them", () => {
    const v = fitView([SHANGHAI, LOS_ANGELES], below, size, [0, 18], 15)!;
    expect(mercY(v.lat) * worldPx(v.zoom)).toBeCloseTo(size.h / 2, 3);
  });

  it("goes out no further than the world as tall as the map", () => {
    const tall = { w: 400, h: 2000 };
    const v = fitView([SHANGHAI, LOS_ANGELES], { left: 0, top: 0, right: 400, bottom: 2000 }, tall, [0, 18], 15)!;
    expect(v.zoom).toBeCloseTo(Math.log2(2000 / 512), 9);
  });

  it("frames as many as fit where the map goes out no further, yours kept in the frame", () => {
    const v = fitView([SHANGHAI, LOS_ANGELES], below, size, [3, 18], 15, SHANGHAI)!;
    expect(v.zoom).toBe(3);
    const inner = innerOf(below);
    const you = onScreen(v, size, SHANGHAI);
    expect(you.x).toBeCloseTo(inner.left, 3);
    expect(you.y).toBeGreaterThanOrEqual(inner.top - 0.001);
    expect(you.y).toBeLessThanOrEqual(inner.bottom + 0.001);
  });

  it("goes in no closer than most for places close together, and at the map's own most where that is less", () => {
    const near = [SHANGHAI, { lng: SHANGHAI.lng + 0.0001, lat: SHANGHAI.lat }];
    expect(fitView(near, below, size, [0, 18], 15)!.zoom).toBe(15);
    expect(fitView(near, below, size, [0, 12], 15)!.zoom).toBe(12);
    expect(fitView([SHANGHAI], below, size, [0, 18], 15)!.zoom).toBe(15);
  });

  it("frames nobody: no view", () => {
    expect(fitView([], below, size, [0, 18], 15)).toBeNull();
  });
});

describe("whether the map was moved by hand", () => {
  const size = { w: 400, h: 700 };
  const aimed = { lng: 121.47, lat: 31.23, zoom: 6 };
  /** aimed moved dx px across */
  const across = (dx: number) => ({ ...aimed, lng: lngOf(mercX(aimed.lng) + dx / worldPx(aimed.zoom)) });

  it("not where it was sent to within a few px and a hair of zoom", () => {
    expect(sameView(aimed, aimed, size)).toBe(true);
    expect(sameView(across(3), aimed, size)).toBe(true);
    expect(sameView({ ...aimed, zoom: 6.01 }, aimed, size)).toBe(true);
  });

  it("moved: dragged, or zoomed", () => {
    expect(sameView(across(30), aimed, size)).toBe(false);
    expect(sameView({ ...aimed, zoom: 6.5 }, aimed, size)).toBe(false);
  });

  it("not moved for going round the back of the world", () => {
    expect(sameView({ lng: 179.9999, lat: 0, zoom: 2 }, { lng: -179.9999, lat: 0, zoom: 2 }, size)).toBe(true);
  });
});
