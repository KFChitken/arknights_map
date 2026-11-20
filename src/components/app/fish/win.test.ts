import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { FishIcon } from "../chrome/parts";
import { pondFlags } from "../squad/SquadPond";
import FishWin from "./FishWin";
import WinScene from "./WinScene";
import { boxOf, dragOf, dropOf, goesOnLeaving, NO_PLACE, PHONE, sceneOf } from "./winPlace";
import { dropFishWin, fishMenuNote, fishWinNow, forgetFishWin, hideFishWin, openFishWin, setFishLine, smallFishWin } from "./winStore";

const PC_VP = { w: 1280, h: 800 };
const PHONE_VP = { w: 390, h: 844 };
const pc = { wide: true, small: false, inRoom: false };
const phone = { wide: false, small: false, inRoom: false };
const drawn = () =>
  renderToStaticMarkup(
    createElement(FishWin, { look: { color: "brown", avatar: "classic" }, holder: "test", fishOk: true, onRefused: () => {}, onPasses: () => {} }),
  );

beforeEach(() => forgetFishWin());

describe("钓鳞's small window", () => {
  it("hangs a flag on 卫戍池塘's wall for each strategy picked, not each core alliance: its operator's picture, else the first character of their name", () => {
    const art = { arknights: { 老鲤: "aaaa000011112222.webp" }, endfield: {} };
    // 18 老鲤 (of no alliance), 45 望 (炎's), 25 “变形者集群” (its quotes left off); one twice, and one with none: a flag each
    const flags = pondFlags([{ strategy: 18 }, { strategy: 45 }, { strategy: 18 }, { strategy: null }, { strategy: 25 }], art);
    expect(flags).toEqual([
      { text: "老", pic: "/operator-art/aaaa000011112222.webp", bg: "#38383e", fg: "#d9b36a" },
      { text: "望", pic: null, bg: "#b3312a", fg: "#f4c040" },
      { text: "变", pic: null, bg: "#38383e", fg: "#d9b36a" },
    ]);
    // the pictures not known yet, or off: the characters alone; nobody with one, or one the season has no more: no flag
    expect(pondFlags([{ strategy: 18 }], null)).toEqual([{ text: "老", pic: null, bg: "#38383e", fg: "#d9b36a" }]);
    expect(pondFlags([{ strategy: null }, { strategy: 9999 }], art)).toEqual([]);
    const svg = renderToStaticMarkup(
      createElement(WinScene, { pond: true, phase: "idle", ms: 0, shadow: null, ringDelay: 0, catchPic: null, roach: null, label: "", zhi: false, flags }),
    );
    expect(svg).toContain('href="/operator-art/aaaa000011112222.webp"');
    expect(svg).toContain('clip-path="url(#pflag)"');
    expect(svg).toContain(">望</text>");
    expect(svg).toContain(">变</text>");
    expect(svg).not.toContain(">老</text>");
  });

  it("opens first at a computer's bottom right, and stays inside the page however far it is dragged", () => {
    const first = boxOf(PC_VP, NO_PLACE, pc);
    expect(first).toMatchObject({ left: 1280 - 360 - 24, top: 800 - 308 - 24, w: 360, h: 308 });
    const far = dragOf(PC_VP, NO_PLACE, pc, { x: first.left, y: first.top }, 5000, 5000);
    expect(boxOf(PC_VP, far.place, pc)).toMatchObject({ left: 1280 - 360, top: 800 - 308 });
    const up = dragOf(PC_VP, NO_PLACE, pc, { x: first.left, y: first.top }, -5000, -5000);
    expect(boxOf(PC_VP, up.place, pc)).toMatchObject({ left: 0, top: 0 });
    // a page smaller than the window: its top left kept in
    expect(boxOf({ w: 300, h: 200 }, far.place, pc)).toMatchObject({ left: 0, top: 0 });
    // let go: kept, and the first-open hint gone
    expect(dropOf(PC_VP, far.place, pc, boxOf(PC_VP, far.place, pc))).toMatchObject({ pc: { x: 920, y: 492 }, dragged: true });
  });

  it("goes against a phone's nearer edge once let go, between the search bar and the bars at the foot, 卫戍's too in a room", () => {
    const first = boxOf(PHONE_VP, NO_PLACE, phone);
    expect(first).toMatchObject({ left: 390 - 264 - 8, top: 460, atLeft: false });
    // dragged left and up past where it may go, and let go: against the left edge, under the search bar
    const moved = dragOf(PHONE_VP, NO_PLACE, phone, { x: first.left, y: first.top }, -200, -1000);
    expect(moved.dragX).toBe(0);
    const during = boxOf(PHONE_VP, moved.place, phone, moved.dragX);
    expect(during).toMatchObject({ left: 0, top: PHONE.top });
    const put = dropOf(PHONE_VP, moved.place, phone, during);
    expect(put).toMatchObject({ phone: { side: "left", y: PHONE.top }, dragged: true });
    expect(boxOf(PHONE_VP, put, phone)).toMatchObject({ left: 8, top: 100, atLeft: true });
    // down as far as it goes: over the bars at the foot, and over 卫戍's bar as well in a room
    const down = dragOf(PHONE_VP, put, phone, { x: 8, y: 100 }, 0, 5000).place;
    expect(boxOf(PHONE_VP, down, phone).top).toBe(844 - 70 - 8 - 248);
    expect(boxOf(PHONE_VP, down, { ...phone, inRoom: true }).top).toBe(844 - 70 - 58 - 8 - 248);
    // past the middle the other way: against the right edge again
    const back = dragOf(PHONE_VP, put, phone, { x: 8, y: 100 }, 100, 0);
    expect(dropOf(PHONE_VP, back.place, phone, boxOf(PHONE_VP, back.place, phone, back.dragX)).phone?.side).toBe("right");
  });

  it("goes small where it was, a strip or a ball, and opens again there, never out of the page", () => {
    // a computer's: the strip in the middle of where its foot was
    const open = boxOf(PC_VP, NO_PLACE, pc);
    const strip = boxOf(PC_VP, NO_PLACE, { ...pc, small: true });
    expect(strip).toMatchObject({ left: open.left + 50, top: open.top + 308 - 42, w: 260, h: 42 });
    // the strip dragged into the corner: open again, the whole window inside the page
    const corner = dragOf(PC_VP, NO_PLACE, { ...pc, small: true }, { x: strip.left, y: strip.top }, 5000, 5000).place;
    expect(boxOf(PC_VP, corner, { ...pc, small: true })).toMatchObject({ left: 1280 - 260, top: 800 - 42 });
    expect(boxOf(PC_VP, corner, pc)).toMatchObject({ left: 1280 - 360, top: 800 - 308 });
    // a phone's: the ball against the same edge, and opened from as low as it goes, the window over the bars
    const ball = boxOf(PHONE_VP, NO_PLACE, { ...phone, small: true });
    expect(ball).toMatchObject({ left: 390 - 58 - 8, top: 460 + 90, w: 58, h: 58 });
    const low = dragOf(PHONE_VP, NO_PLACE, { ...phone, small: true }, { x: ball.left, y: ball.top }, 0, 5000).place;
    expect(boxOf(PHONE_VP, low, { ...phone, small: true }).top).toBe(844 - 70 - 8 - 58);
    expect(boxOf(PHONE_VP, low, phone).top).toBe(844 - 70 - 8 - 248);
  });

  it("shows the line's scene while one is in the water, else the room's or the bank's, and goes out of a room with no 钓鳞 of one's own", () => {
    expect(sceneOf(null, false)).toEqual({ scene: "pier", pending: null });
    expect(sceneOf(null, true)).toEqual({ scene: "pond", pending: null });
    // a room joined or left with a line in the water: that line's scene till it is done
    expect(sceneOf("pier", true)).toEqual({ scene: "pier", pending: "pond" });
    expect(sceneOf("pond", false)).toEqual({ scene: "pond", pending: "pier" });
    expect(sceneOf("pond", true)).toEqual({ scene: "pond", pending: null });
    // out of the room, the bank not open to them: once the line is done
    expect(goesOnLeaving({ kept: true, fishOk: false, inRoom: false, line: "pond" })).toBe(false);
    expect(goesOnLeaving({ kept: true, fishOk: false, inRoom: false, line: null })).toBe(true);
    expect(goesOnLeaving({ kept: true, fishOk: true, inRoom: false, line: null })).toBe(false);
    expect(goesOnLeaving({ kept: true, fishOk: false, inRoom: true, line: null })).toBe(false);
  });

  it("says by 钓鳞 in the menu whether it is open or small; hidden, a dot for a line in the water, orange at the bite", () => {
    expect(fishMenuNote(fishWinNow())).toBeNull();
    openFishWin();
    expect(fishMenuNote(fishWinNow())).toEqual({ text: "开着", dot: false, bite: false });
    smallFishWin();
    setFishLine("pier", true, 12);
    expect(fishMenuNote(fishWinNow())).toEqual({ text: "收起着", dot: false, bite: true });
    hideFishWin();
    const bitten = fishMenuNote(fishWinNow());
    expect(bitten).toEqual({ text: "咬钩了", dot: true, bite: true });
    expect(renderToStaticMarkup(createElement(FishIcon, { note: bitten }))).toContain('class="dot bite"');
    setFishLine("pier", false, 12);
    const waiting = fishMenuNote(fishWinNow());
    expect(waiting).toEqual({ text: "浮漂在水里", dot: true, bite: false });
    expect(renderToStaticMarkup(createElement(FishIcon, { note: waiting }))).toContain('class="dot"');
    setFishLine(null, false, 13);
    expect(fishMenuNote(fishWinNow())).toBeNull();
    expect(renderToStaticMarkup(createElement(FishIcon, { note: null }))).not.toContain("dot");
    // gone (out of 卫戍 with no 钓鳞 of one's own): nothing to say till opened again
    openFishWin();
    dropFishWin();
    expect(fishMenuNote(fishWinNow())).toBeNull();
  });

  it("floats over the map with nothing over the rest of the page: its title bar, – and ✕; small, a strip; ✕, hidden", () => {
    expect(drawn()).toBe("");
    openFishWin();
    setFishLine(null, false, 37);
    const open = drawn();
    expect(open).toContain('class="fish-root fish-win pc"');
    expect(open).toContain('style="left:896px;top:468px;width:360px"');
    expect(open).toContain("<b>钓鳞</b><small>龙门外环 · 河堤</small>");
    expect(open).toContain(">37 / 100<");
    expect(open).toContain('aria-label="收起"');
    expect(open).toContain('aria-label="关上"');
    expect(open).toContain("按住标题栏，拖到哪里都行");
    expect(open).toContain("正在去河堤…");
    expect(open).not.toContain("backdrop");
    expect(open.match(/class="fish-root/g)).toHaveLength(1);
    smallFishWin();
    const strip = drawn();
    expect(strip).toContain('class="fish-root fish-win pc strip"');
    expect(strip).toContain('style="left:946px;top:734px;width:260px"');
    expect(strip).toContain("钓鳞 · 浮漂在手里");
    expect(strip).not.toContain("fw-bar");
    hideFishWin();
    expect(drawn()).toContain(" hidden=\"\"");
  });
});
