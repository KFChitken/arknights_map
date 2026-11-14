import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoachPass } from "@/lib/passes";
import { TOUCHES_PER_DAY } from "@/lib/rules";
import type { PublicRoach } from "@/lib/world/types";
import { OtherInkCard, OtherRoachCard } from "./RoachCards";
import { turnsAtText } from "./dayTurns";

const HOUR = 3_600_000;
const roach = (more: Partial<PublicRoach> = {}): PublicRoach => ({
  id: "r1",
  lng: 121.47,
  lat: 31.23,
  clone: false,
  avatar: "doctor",
  color: "red",
  friend: false,
  ...more,
});

type Touches = { left: number; at: number; friendLeft?: number };

const card = (
  touches: Touches | undefined,
  more: { roach?: Partial<PublicRoach>; friendName?: string; touched?: "sneaky" | "bold"; pass?: RoachPass | null } = {},
) =>
  renderToStaticMarkup(
    createElement(OtherRoachCard, {
      roach: roach(more.roach),
      look: "cartoon",
      signedIn: true,
      sharesUid: false,
      friendName: more.friendName,
      pokeAgainAt: null,
      touched: more.touched,
      touches,
      busy: false,
      pass: more.pass,
      onSignIn: () => {},
      onTouch: () => {},
      onPoke: () => {},
      onClose: () => {},
    }),
  );

/** The text a piece of markup shows, without its tags */
const text = (html: string) => html.replace(/<[^>]*>/g, "");
const disabled = (html: string) => (html.match(/<button[^>]*disabled=""/g) ?? []).length;

describe("a card's touches for today", () => {
  it("says under the buttons how many are left and when the day turns, the number in bold", () => {
    const at = Date.now() + 5 * HOUR;
    const html = card({ left: 57, at });
    expect(html).toContain("<b>57</b>");
    expect(text(html)).toContain(`今天总共还能碰 57 次 · ${turnsAtText(at)}刷新`);
    expect(disabled(html)).toBe(0);
  });

  it("never says how many are left on a stranger, whose roaches would tell they are one player's", () => {
    const at = Date.now() + 5 * HOUR;
    for (const html of [card({ left: 57, at }), card({ left: 57, at }, { roach: { clone: true } })]) {
      expect(text(html)).not.toContain("还能碰 TA");
      expect(text(html)).not.toContain("触须之交");
    }
  });

  it("tells a 触须之交 how many are left on TA today", () => {
    const at = Date.now() + 5 * HOUR;
    const html = card({ left: 57, at, friendLeft: 2 }, { friendName: "小满", roach: { friend: true } });
    expect(text(html)).toContain("你们是触须之交，今天还能碰 TA 2 次。");
    expect(html).toContain("<b>2</b>");
    expect(disabled(html)).toBe(0);
  });

  it("greys both touches with none left today, and counts down to when they come back", () => {
    const at = Date.now() + 2 * HOUR + 40 * 60_000 - 1_000;
    const html = card({ left: 0, at });
    expect(text(html)).toContain(`今天的 ${TOUCHES_PER_DAY} 次触须用完啦。`);
    expect(disabled(html)).toBe(2);
    expect(text(html).match(/今天用完了/g)).toHaveLength(2);
    expect(text(html)).toContain(`${turnsAtText(at)}刷新 · 还有 2 小时 40 分`);
  });

  it("greys them too with none left on this 触须之交, the day's other touches still there", () => {
    const at = Date.now() + 5 * HOUR;
    const html = card({ left: 50, at, friendLeft: 0 }, { friendName: "小满", roach: { friend: true } });
    expect(text(html)).toContain("你们是触须之交，今天还能碰 TA 0 次。");
    expect(disabled(html)).toBe(2);
    expect(text(html)).toContain("今天总共还能碰 50 次");
  });

  it("is a new day's once the day has turned with the card open", () => {
    const html = card({ left: 0, at: Date.now() - 1_000, friendLeft: 0 }, { friendName: "小满", roach: { friend: true } });
    expect(disabled(html)).toBe(0);
    expect(text(html)).toContain(`今天总共还能碰 ${TOUCHES_PER_DAY} 次`);
    expect(text(html)).toContain("今天还能碰 TA 3 次");
  });

  it("says nothing of them on a guide's card, who counts her own", () => {
    const html = card({ left: 0, at: Date.now() + HOUR }, { roach: { id: "amiya", guide: true } });
    expect(text(html)).not.toContain("今天总共还能碰");
    expect(text(html)).not.toContain("用完");
  });

  it("is on an ink roach's card too", () => {
    const at = Date.now() + 5 * HOUR;
    const ink = (touches: Touches, friendName?: string) =>
      renderToStaticMarkup(
        createElement(OtherInkCard, {
          look: "doctor",
          state: "stay",
          friendName,
          gone: false,
          asking: false,
          signedIn: true,
          sharesUid: false,
          touches,
          onSignIn: () => {},
          onTouch: () => {},
          onClose: () => {},
        }),
      );
    expect(text(ink({ left: 12, at }))).toContain("今天总共还能碰 12 次");
    expect(text(ink({ left: 12, at }))).not.toContain("还能碰 TA");
    expect(text(ink({ left: 12, at, friendLeft: 1 }, "小满"))).toContain("今天还能碰 TA 1 次");
    expect(disabled(ink({ left: 0, at }))).toBe(2);
  });
});

describe("the pass the owner of a main roach wears, on its card", () => {
  const pass: RoachPass = { charId: 1, name: "能天使", rarity: 6, color: "#d63829", art: "0123456789abcdef" };
  const at = Date.now() + 5 * 3_600_000;

  it("has its 立绘 peek out of the card, and the character's name on the card's edge: no number", () => {
    const html = card({ left: 57, at }, { pass });
    expect(html).toContain('class="card stack with-pass"');
    expect(text(html)).toContain("通行证 · 能天使");
    expect(html).toContain('<source type="image/avif" srcSet="/operator-art/pass/0123456789abcdef.avif"/>');
    expect(html).toContain('src="/operator-art/pass/0123456789abcdef.webp"');
    // the picture is the card's decoration, its name is in the words
    expect(html).toMatch(/<span class="rp-art" aria-hidden="true">/);
    expect(html).toContain("--pc:#d63829");
    expect(text(html)).not.toMatch(/No\.|潜能|\d{4}/);
    // a card with nothing worn, or nothing heard yet, is as it was
    for (const none of [card({ left: 57, at }), card({ left: 57, at }, { pass: null })]) {
      expect(none).toContain('class="card stack"');
      expect(none).not.toContain("rp-");
    }
  });

  it("is the name alone where there is no 立绘", () => {
    const html = card({ left: 57, at }, { pass: { ...pass, art: null } });
    expect(text(html)).toContain("通行证 · 能天使");
    expect(html).toContain("rp-glow");
    expect(html).not.toContain("<picture>");
  });

  it("is never on a clone's card or a guide's", () => {
    for (const html of [card({ left: 57, at }, { pass, roach: { clone: true } }), card(undefined, { pass, roach: { guide: true, id: "amiya" } })]) {
      expect(html).not.toContain("rp-");
      expect(text(html)).not.toContain("通行证");
    }
  });
});
