import { describe, expect, it } from "vitest";
import { boop, feelers, screenDelta, STAGE, stagePlace, tap, TOUCH_MS } from "./touchArt";

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

  it("draws 啵! and 嗒 in their pictures, character for character as it always has", () => {
    expect(boop()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 30" width="44" height="30" overflow="visible" aria-hidden="true"><path d="M22 1 L27.2 5.3 L35.2 4.3 L35.1 9.8 L42.2 12.6 L36.9 16.8 L39.8 22 L31.8 22.9 L29 28.2 L22 25.4 L15 28.2 L12.2 22.9 L4.2 22 L7.1 16.8 L1.8 12.6 L8.9 9.8 L8.8 4.3 L16.8 5.3 Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="1.8" stroke-linejoin="round"/>
<text x="22" y="19.4" text-anchor="middle" font-size="12" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" fill="#1b1d22">啵!</text></svg>`,
    );
    expect(tap()).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="30" height="20" overflow="visible" aria-hidden="true"><g stroke="#1b1d22" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 10 L6.5 11.5 M4.6 3.6 L8 7.4 M10.6 1.2 L11 5.8"/></g>
<text x="20.5" y="16.5" text-anchor="middle" font-size="12" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" fill="#1b1d22" stroke="#fff" stroke-width="3" paint-order="stroke">嗒</text></svg>`,
    );
  });

  it("measures map distances in screen pixels", () => {
    const d = screenDelta({ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, 0);
    expect(d.x).toBeCloseTo(512 / 360);
    expect(d.y).toBeCloseTo(0);
    // north is up the screen
    expect(screenDelta({ lng: 0, lat: 0 }, { lng: 0, lat: 1 }, 10).y).toBeLessThan(0);
  });
});
