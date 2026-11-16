import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmt, T } from "@/i18n";
import { BADGES, quoteOf } from "@/lib/badges";
import { GLOW } from "@/lib/roachSvg";
import { siteName } from "@/lib/rules";
import type { SponsorView } from "@/lib/sponsor";
import type { RoachColor } from "@/lib/types";
import { SponsorCard } from "./SponsorSheet";

const LINK = "https://ifdian.net/a/someone";
const BILL = 290000;

/** This month, with so much (fen) come in against its bill */
const month = (received: number): SponsorView["month"] => ({
  month: "2026-11",
  spent: BILL,
  received,
  note: "",
  carried: 0,
  balance: received - BILL,
  repaid: 0,
  current: true,
});
const view = (more: Partial<SponsorView> = {}): SponsorView => ({
  afdian: LINK,
  kofi: null,
  month: month(32050),
  repaying: false,
  looks: [],
  email: "me@example.com",
  ...more,
});
const card = (v: SponsorView, more: { color?: RoachColor; grayFirst?: boolean } = {}) =>
  renderToStaticMarkup(createElement(SponsorCard, { view: v, ...more }));

/** The text a piece of markup shows, without its tags */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("支持舟P地图's card", () => {
  it("has the player's roach throw three hearts into the server above its words, lit in their colour, again when tapped", () => {
    const html = card(view(), { color: "pink" });
    expect(html).toContain('<div class="sf-stage">');
    expect(html.match(new RegExp(`fill="${GLOW.pink}"`, "g"))).toHaveLength(2);
    expect(html.match(/class="sf-fly f\d"/g)).toHaveLength(3);
    expect(html).toContain(`<button type="button" class="sf-hop" aria-label="${T.sponsor.hop}">`);
    expect(html.indexOf("sf-stage")).toBeLessThan(html.indexOf(fmt(T.sponsor.askTitle, { site: siteName() })));
    // a roach whose colour is not known (a visitor on /support) has a new roach's
    expect(card(view({ email: null }))).toContain(`fill="${GLOW.cyan}"`);
  });

  it("keeps the server beaming, with stars round it, in a month paid for", () => {
    expect(card(view())).not.toContain("sf-stage full");
    expect(card(view({ month: month(BILL + 22050) }))).toContain('<div class="sf-stage full">');
  });

  it("shows the thanks as their two badges under the copy button, each turning over to the line it has", () => {
    const html = card(view());
    const thanks = BADGES.filter((b) => b.sponsor);
    expect(thanks.map((b) => b.id)).toEqual(["feeder", "volt"]);
    for (const b of thanks) {
      expect(html).toContain(`src="/badges/${b.id}.svg"`);
      expect(html).toContain(`aria-label="${fmt(T.sponsor.badgeTurn, { name: b.name })}"`);
      expect(text(html)).toContain(quoteOf(b));
    }
    expect(html.indexOf(T.sponsor.copy)).toBeLessThan(html.indexOf("sf-badges"));
    expect(html.indexOf("sf-badges")).toBeLessThan(html.indexOf(T.sponsor.thanksTail));
  });

  it("lists the looks kept for sponsors only as the server lists them to the player, first", () => {
    const looksLine = fmt(T.sponsor.giftLooks, { looks: fmt(T.sponsor.badgeName, { name: T.profile.avatar.duck }) });
    expect(text(card(view()))).not.toContain(looksLine);
    expect(card(view())).toContain('<ol class="one">');
    const html = text(card(view({ looks: ["duck"] })));
    expect(html).toContain(looksLine);
    expect(html.indexOf(looksLine)).toBeLessThan(html.indexOf(T.sponsor.giftBadges.split("{")[0]));
    expect(card(view({ looks: ["duck"] }))).toContain("<ol><li>");
  });

  it("shows 鸭爵 between the badges where the card names him, his moves a tap away, standing still while the site is gray", () => {
    const duck = T.profile.avatar.duck;
    expect(card(view())).not.toContain("sf-duck");
    expect(card(view())).toContain('<div class="sf-badges">');
    const html = card(view({ looks: ["duck"] }));
    expect(html).toContain('<div class="sf-badges three">');
    expect(html.indexOf('src="/badges/feeder.svg"')).toBeLessThan(html.indexOf("sf-duck"));
    expect(html.indexOf("sf-duck")).toBeLessThan(html.indexOf('src="/badges/volt.svg"'));
    // his own picture, in the three parts that move apart, and the coins of his shout, waiting for the row to be seen
    for (const part of ["bcase", "body", "hat"]) expect(html).toContain(`href="/avatars/duck-${part}.webp"`);
    expect(html).toContain('<div class="sf-dk">');
    expect(html.match(/class="dk-coin"/g)).toHaveLength(7);
    expect(html).toContain(`<div class="sf-dk-name">${duck}</div>`);
    expect(html).toContain(`<button type="button" class="sf-dk-tap" aria-label="${fmt(T.sponsor.duckPlay, { name: duck })}">`);

    const gray = card(view({ looks: ["duck"] }), { grayFirst: true });
    expect(gray).toContain(`<div class="sf-gift sf-duck calm" role="img" aria-label="${duck}">`);
    expect(gray).not.toContain("sf-dk-tap");
  });

  it("asks a visitor to sign in instead, with no badges to turn", () => {
    const html = card(view({ email: null }));
    expect(text(html)).toContain(T.sponsor.signIn);
    expect(html).not.toContain("sf-badges");
  });

  it("goes to 爱发电 alone, with a heart before its words", () => {
    const html = card(view());
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual([LINK, "/support"]);
    expect(html).toContain(`<a class="sponsor-button sf-afdian" href="${LINK}" target="_blank" rel="noreferrer"><span class="sf-beat" aria-hidden="true">`);
    expect(text(html)).toContain(T.sponsor.afdian);
  });

  it("has no roach while the site is gray, and keeps the thanks", () => {
    const html = card(view(), { grayFirst: true });
    expect(html).not.toContain("sf-stage");
    expect(html).toContain("sf-badges");
    expect(text(html)).toContain(T.sponsor.afdian);
  });
});
