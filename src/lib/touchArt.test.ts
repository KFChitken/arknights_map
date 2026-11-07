import { describe, expect, it } from "vitest";
import { feelers, screenDelta, STAGE, stagePlace, TOUCH_MS } from "./touchArt";

describe("touch scenes", () => {
  it("puts the stage so they stand where their icon is, and your side stays on a small phone", () => {
    // a 375-wide phone, them in the middle: the stage shrinks a little so you fit on the left
    const p = stagePlace(375, 812, 30);
    expect(p.s).toBeCloseTo((375 / 2 - 8) / STAGE.anchor[0]);
    expect(p.left + STAGE.anchor[0] * p.s).toBeCloseTo(375 / 2);
    expect(p.top + STAGE.anchor[1] * p.s).toBeCloseTo(812 / 2);
    expect(p.left).toBeGreaterThanOrEqual(8 - 1e-9);
    // at the end they shrink to their icon
    expect(p.end * STAGE.box * p.s).toBeCloseTo(30);
    // a guide drawn left of her spot (塔露拉干员 by her fire): still all on screen
    const left = stagePlace(375, 812, 30, [-29, -16]);
    expect(left.left).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(left.left + STAGE.anchor[0] * left.s).toBeCloseTo(375 / 2 - 29);
    // a wide screen: full size
    expect(stagePlace(1280, 800, 30).s).toBe(1);
  });

  it("reaches from your feeler to theirs", () => {
    const f = feelers("hood", "doctor");
    expect(f.bold.startsWith(`M${Math.round((51 * STAGE.box * 10) / 64) / 10} `)).toBe(true);
    expect(f.boldEnd[0]).toBeGreaterThan(STAGE.them[0]);
    // the meeting point is between the two
    expect(f.meet[0]).toBeGreaterThan(STAGE.box);
    expect(f.meet[0]).toBeLessThan(STAGE.them[0] + STAGE.box);
    expect(TOUCH_MS.friend).toBeGreaterThan(TOUCH_MS.bold);
  });

  it("measures map distances in screen pixels", () => {
    const d = screenDelta({ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, 0);
    expect(d.x).toBeCloseTo(512 / 360);
    expect(d.y).toBeCloseTo(0);
    // north is up the screen
    expect(screenDelta({ lng: 0, lat: 0 }, { lng: 0, lat: 1 }, 10).y).toBeLessThan(0);
  });
});
