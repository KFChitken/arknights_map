import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoachPass } from "@/lib/passes";
import { passesApi } from "@/lib/passesClient";
import { SI_ID } from "@/lib/si";
import { askRoachPass, forgetRoachPassesHere, hangFor, heardRoachPass, passCardRoach, RoachPassOn, RoachPassPeek } from "./RoachPass";
import RoachPassHang from "./RoachPassHang";

const PASS: RoachPass = {
  game: "ak",
  charId: 1,
  name: "能天使",
  en: "Exusiai",
  rarity: 6,
  no: 1799,
  fancy: false,
  color: "#d63829",
  art: null,
  avatar: null,
  drawnAt: Date.parse("2026-11-16T21:30:00+08:00"),
};

beforeEach(() => forgetRoachPassesHere());
afterEach(() => vi.restoreAllMocks());

describe("the pass on a roach's card, as the page asks for it", () => {
  it("is asked once for a roach while its card opens and opens again, and kept a minute", async () => {
    const roach = vi.spyOn(passesApi, "roach").mockResolvedValue({ pass: PASS });
    expect(heardRoachPass("abcd1234")).toBeNull();
    // the card opened twice at once (and React's second go at an effect)
    await Promise.all([askRoachPass("abcd1234"), askRoachPass("abcd1234")]);
    expect(roach).toHaveBeenCalledTimes(1);
    expect(roach).toHaveBeenCalledWith("abcd1234");
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
    await askRoachPass("abcd1234", Date.now() + 59_000);
    expect(roach).toHaveBeenCalledTimes(1);
    // a minute on, asked again; what was heard shows meanwhile
    roach.mockResolvedValue({ pass: null });
    const again = askRoachPass("abcd1234", Date.now() + 61_000);
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
    await again;
    expect(roach).toHaveBeenCalledTimes(2);
    expect(heardRoachPass("abcd1234")).toBeNull();
    // each roach its own
    await askRoachPass("ffff0000");
    expect(roach).toHaveBeenLastCalledWith("ffff0000");
  });

  it("is asked only by a player 寻访 is open to, and only for another player's main roach", () => {
    const main = { id: "abcd1234", clone: false };
    expect(passCardRoach(true, main)).toBe("abcd1234");
    // while PASSES is admins, anyone else has no 寻访 (me.passes): they ask nothing, so see nothing
    expect(passCardRoach(false, main)).toBeNull();
    for (const not of [{ ...main, clone: true }, { ...main, guide: true as const }, { ...main, bot: true as const }, { id: SI_ID, clone: false }]) {
      expect(passCardRoach(true, not)).toBeNull();
    }
    // no card open, or the player's own roach
    expect(passCardRoach(true, null)).toBeNull();
    expect(passCardRoach(true, undefined)).toBeNull();
  });

  it("is nothing when it could not be had, and asked again the next time", async () => {
    const roach = vi.spyOn(passesApi, "roach").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ pass: PASS });
    await expect(askRoachPass("abcd1234")).resolves.toBeUndefined();
    expect(heardRoachPass("abcd1234")).toBeNull();
    await askRoachPass("abcd1234");
    expect(roach).toHaveBeenCalledTimes(2);
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
  });
});

/** The text a piece of markup shows, without its tags */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("where the pass hangs over a roach's card", () => {
  // a card 420 wide at the foot of the screen, its top 190 above its foot
  const card = (left: number, bottom: number, width = 420) => ({ top: bottom - 190, right: left + width, bottom });

  it("hangs over the card's top right on a phone, 116 wide, or three tenths of a narrow screen", () => {
    expect(hangFor(card(12, 714, 366), 390, false)).toEqual({ w: 116, beside: false });
    expect(hangFor(card(12, 704, 336), 360, false)).toEqual({ w: 108, beside: false });
    // a 长条挂牌 as tall, so as wide a box
    expect(hangFor(card(12, 714, 366), 390, true)).toEqual({ w: 116, beside: false });
  });

  it("hangs beside the card where the window has room for it 150 to 178 wide, its foot by the card's", () => {
    // the card in the middle of a computer's window, and of one just wide enough
    expect(hangFor(card(430, 704), 1280, false)).toEqual({ w: 178, beside: true });
    expect(hangFor(card(210, 704), 840, false)).toEqual({ w: 178, beside: true });
    expect(hangFor(card(190, 704), 800, false)).toEqual({ w: 160, beside: true });
    // narrower, over the card as on a phone; a 长条挂牌, narrower itself, still beside it
    expect(hangFor(card(170, 704), 760, false)).toEqual({ w: 116, beside: false });
    expect(hangFor(card(170, 704), 760, true)).toEqual({ w: 178, beside: true });
    // the card beside a panel on the left (抽屉界面), the window not much wider: over it
    expect(hangFor(card(352, 860), 900, false)).toEqual({ w: 116, beside: false });
  });

  it("stays clear of the bars along the top, smaller where it must, and is not hung where it would be too small", () => {
    // a short phone (667 tall): over the card, smaller; a short window: beside the card, smaller
    expect(hangFor(card(12, 571, 351), 375, false)).toEqual({ w: 103, beside: false });
    expect(hangFor(card(430, 520), 1280, false)).toEqual({ w: 156, beside: true });
    // shorter still: nowhere (it peeks out of the card instead)
    expect(hangFor(card(430, 470), 1280, false)).toBeNull();
    expect(hangFor(card(12, 450, 351), 375, false)).toBeNull();
  });
});

describe("the pass hung over a roach's card", () => {
  const hung = (pass: RoachPass, beside = false) =>
    renderToStaticMarkup(createElement(RoachPassHang, { pass, hang: { w: beside ? 178 : 116, beside }, onFold: () => {} }));

  it("is the whole pass on its strap, w wide, its number, day and gold printed, and nobody's name", () => {
    const html = hung(PASS);
    expect(html).toMatch(/^<div class="rp-hang"><div class="zp hang" style="--w:116px" role="img" aria-label="能天使的通行证 No.001799">/);
    expect(html).toContain('class="hwr ra"');
    expect(html).toContain("<small>No.</small>001799");
    expect(html).toContain('<span class="zfoil">靓号</span>');
    expect(html).toContain("持证 ——<br/>2026.11.16");
    expect(html).not.toContain("zsmp");
    // the special look, and 终末地's 长条挂牌 on its clip
    expect(hung({ ...PASS, fancy: true })).toContain('class="zc ra rax"');
    const tag = hung({ ...PASS, game: "ef", charId: 2001, name: "管理员", en: "Endministrator", no: 42 });
    expect(tag).toContain('class="hwr tag"');
    expect(tag).toContain("持证 —— · 2026.11.16");
    expect(tag).toContain('<span class="zfoil">前 100</span>');
  });

  it("has 收起 beside it on the card's edge, or under it beside the card", () => {
    const over = hung(PASS);
    expect(over).toContain('<button type="button" class="rp-fold" style="--hw:116px" aria-label="收起通行证">收起</button>');
    const beside = hung(PASS, true);
    expect(beside).toMatch(/^<div class="rp-hang beside">/);
    expect(beside).toContain('<button type="button" class="rp-fold beside" style="--hw:178px" aria-label="收起通行证">收起</button>');
    // as wide as a 长条挂牌 shows
    expect(hung({ ...PASS, game: "ef" })).toContain('style="--hw:75px"');
  });

  it("folded, peeks out of the card as before, its tag hanging it out again", () => {
    const peek = renderToStaticMarkup(createElement(RoachPassPeek, { pass: PASS, onUnfold: () => {} }));
    expect(peek).toContain('<button type="button" class="rp-tag" aria-label="挂出能天使的通行证">通行证 · 能天使</button>');
    expect(text(peek)).not.toMatch(/No\.|001799|——/);
    // with no room to hang it, the tag is only a name
    expect(renderToStaticMarkup(createElement(RoachPassPeek, { pass: PASS }))).toContain('<span class="rp-tag">通行证 · 能天使</span>');
  });

  it("peeks out of the card until the card is measured, where it hangs unless folded on this device", () => {
    const html = renderToStaticMarkup(createElement(RoachPassOn, { pass: PASS }));
    expect(html).toContain('<i class="rp-at" hidden=""></i>');
    expect(html).toContain('<span class="rp-tag">通行证 · 能天使</span>');
    expect(html).not.toContain("rp-hang");
  });
});
