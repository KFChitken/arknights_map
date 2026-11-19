import { describe, expect, it } from "vitest";
import { stageBox } from "./SquadStage";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("where the fight on the map stands", () => {
  // a computer's window, 1200 × 590: the top bar down to 73, the bottom bar from 510, buttons down both sides
  const tops = [rect(430, 22, 700, 51)];
  const lows = [rect(470, 510, 640, 60)];
  const sides = [rect(8, 60, 60, 300), rect(1146, 60, 46, 470)];
  const box = { left: 74, right: 356, top: 83, bottom: 90 };

  it("stands between the top and bottom bars on a computer, left of the column beside 卫戍, however few are in the round", () => {
    // two in the room: the column is wider than it is tall
    expect(stageBox(1200, 590, tops, lows, { ...rect(860, 80, 280, 150), column: true }, sides)).toEqual(box);
    expect(stageBox(1200, 590, tops, lows, { ...rect(860, 80, 280, 330), column: true }, sides)).toEqual(box);
  });

  it("stands above the row of the round along the bottom on a phone", () => {
    expect(stageBox(375, 667, [rect(8, 8, 359, 60)], [rect(8, 600, 359, 60)], { ...rect(8, 430, 359, 150), column: false }, [])).toEqual({
      left: 8,
      right: 8,
      top: 78,
      bottom: 247,
    });
  });
});
