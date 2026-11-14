import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PassArtList } from "@/lib/passArt";
import { passChar, passCharNamed, PASS_CATALOG } from "@/lib/passCatalog";
import type { PassOnCard } from "@/lib/passes";
import type { Art } from "../OperatorNames";
import { artUrl, charOfCard, FullPass, inkOf, issued, MiniPass, PassArtProvider, picOf, picOfCard, printedEn, SamplePass, smallUrl } from "./PassCard";

const amiya = passCharNamed("arknights", "阿米娅")!;
const admin = passCharNamed("endfield", "管理员")!;
const ART: Art = { arknights: { 阿米娅: "0123456789abcdef.webp" }, endfield: {} };

const mini = (props: Partial<Parameters<typeof MiniPass>[0]> & Pick<Parameters<typeof MiniPass>[0], "c">) =>
  renderToStaticMarkup(createElement(MiniPass, { no: 1, fancy: false, art: null, ...props }));

describe("a small pass", () => {
  it("draws ① for 明日方舟 and ③ for 终末地, ② and ④ when fancy", () => {
    expect(mini({ c: amiya })).toContain('class="mpc ra"');
    expect(mini({ c: amiya, fancy: true })).toContain('class="mpc ra rax"');
    expect(mini({ c: admin })).toContain('class="mpc tag"');
    expect(mini({ c: admin, fancy: true })).toContain('class="mpc tag tagx"');
  });

  it("is 5:9, the picture over a slim bar: for 明日方舟 a line of their colour along its top, no block of colour", () => {
    for (const fancy of [false, true]) {
      const ra = mini({ c: amiya, fancy });
      expect(ra).toMatch(/<i class="mra-l"><\/i><i class="mra-p"><\/i><i class="mra-x"><\/i><b>0001<\/b>/);
      // the number's colour comes from the look alone, not from theirs
      expect(ra).not.toContain("--pk");
    }
    const tag = mini({ c: admin });
    expect(tag).toContain('<i class="mtg-f"></i><b>0001</b>');
    expect(tag).not.toContain("mra-x");
  });

  it("adds only a gold corner for the first hundred and 靓号, and leaves the number off a wish not drawn yet", () => {
    expect(mini({ c: amiya, no: 1 })).toContain('class="mfo"');
    expect(mini({ c: amiya, no: 100 })).toContain('class="mfo"');
    expect(mini({ c: amiya, no: 1325 })).toContain('class="mfo"');
    expect(mini({ c: amiya, no: 111 })).not.toContain("mfo");
    expect(mini({ c: amiya, no: 112 })).not.toContain("mfo");
    expect(mini({ c: amiya, no: 112 })).toContain("<b>0112</b>");
    expect(mini({ c: admin, no: 12345 })).toContain("<b>12345</b>");
    const wish = mini({ c: amiya, no: null });
    expect(wish).not.toContain("<b>");
    expect(wish).not.toContain("mfo");
  });

  it("shows the character's small picture where there is one, else a figure in their colour", () => {
    expect(artUrl(amiya, ART)).toBe("/operator-art/0123456789abcdef.webp");
    expect(artUrl(admin, ART)).toBeNull();
    expect(artUrl(amiya, null)).toBeNull();
    expect(mini({ c: amiya, art: ART })).toContain('src="/operator-art/0123456789abcdef.webp"');
    const drawn = mini({ c: admin, art: ART });
    expect(drawn).toContain('class="art drawn"');
    expect(drawn).not.toContain("<img");
    expect(mini({ c: amiya })).toContain(`--pc:${amiya.color}`);
  });

  it("writes dark on a light block of colour and white on a dark one", () => {
    expect(inkOf("#ffffff")).toBe("#15181d");
    expect(inkOf("#f2e21a")).toBe("#15181d");
    expect(inkOf("#000000")).toBe("#ffffff");
    expect(inkOf("#7d338a")).toBe("#ffffff");
    expect(inkOf("not a colour")).toBe("#ffffff");
    // every character's own colour gets one of the two
    for (const c of PASS_CATALOG) expect(["#15181d", "#ffffff"], c.name).toContain(inkOf(c.color));
    // on the whole 明日方舟 pass; the fancy one is pale whatever their colour
    expect(renderToStaticMarkup(createElement(FullPass, { c: amiya, no: 1, fancy: false, holder: "", at: 0, w: 178 }))).toContain(
      `--pk:${inkOf(amiya.color)}`,
    );
    expect(renderToStaticMarkup(createElement(FullPass, { c: amiya, no: 1, fancy: true, holder: "", at: 0, w: 178 }))).toContain("--pk:#1b2330");
  });
});

const LH = "a1b2c3d4e5f60718";
const LIST: PassArtList = { [amiya.id]: [LH, "#336699"] };
const within = (list: PassArtList | null, el: ReactElement) => renderToStaticMarkup(createElement(PassArtProvider, { value: list }, el));

describe("a pass's picture", () => {
  it("is the character's 立绘 where there is one: its blur first, the picture over it, in the colour picked from it", () => {
    const html = within(LIST, createElement(MiniPass, { c: amiya, no: 7, fancy: false, art: ART }));
    expect(html).toContain('class="art lh"');
    expect(html).toContain(`src="/operator-art/pass/${LH}.b.webp"`);
    expect(html).toContain(`src="/operator-art/pass/${LH}.s.webp"`);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("/operator-art/0123456789abcdef.webp");
    expect(html).toContain("--pc:#336699");
    // no 立绘: the small picture, the catalogue's colour
    const other = within(LIST, createElement(MiniPass, { c: admin, no: 7, fancy: false, art: ART }));
    expect(other).toContain('class="art drawn"');
    expect(other).toContain(`--pc:${admin.color}`);
  });

  it("is fetched ahead at its small size, or its blur alone to save data", () => {
    expect(picOf(amiya, LIST, ART)).toEqual({ file: LH, avatar: "/operator-art/0123456789abcdef.webp" });
    expect(smallUrl(picOf(amiya, LIST, ART), false)).toBe(`/operator-art/pass/${LH}.s.webp`);
    expect(smallUrl(picOf(amiya, LIST, ART), true)).toBe(`/operator-art/pass/${LH}.b.webp`);
    expect(smallUrl(picOf(amiya, null, ART), false)).toBe("/operator-art/0123456789abcdef.webp");
    expect(smallUrl(picOf(admin, LIST, null), true)).toBeNull();
  });

  it("on a whole pass, is the big one, AVIF where the browser takes it", () => {
    const html = within(LIST, createElement(FullPass, { c: amiya, no: 7, fancy: false, holder: "某人", at: 0, w: 178 }));
    expect(html).toContain(`<source type="image/avif" srcSet="/operator-art/pass/${LH}.avif"/>`);
    expect(html).toContain(`src="/operator-art/pass/${LH}.webp"`);
    expect(html).toContain(`src="/operator-art/pass/${LH}.b.webp"`);
  });
});

const whole = (props: Partial<Parameters<typeof FullPass>[0]> & Pick<Parameters<typeof FullPass>[0], "c">) =>
  renderToStaticMarkup(createElement(FullPass, { no: 7, fancy: false, holder: "Dr. 某人", at: Date.parse("2026-11-20T09:00:00+08:00"), w: 178, ...props }));
const exu = passCharNamed("arknights", "能天使")!;

describe("a whole pass", () => {
  it("draws ① 通行认证 for 明日方舟 and ③ 长条挂牌 (narrower, as tall) for 终末地, ② and ④ when fancy", () => {
    expect(whole({ c: exu })).toContain('class="zc ra"');
    expect(whole({ c: exu, fancy: true })).toContain('class="zc ra rax"');
    expect(whole({ c: admin })).toContain('class="zc tag"');
    expect(whole({ c: admin, fancy: true })).toContain('class="zc tag tagx"');
    expect(whole({ c: admin })).toMatch(/^<div class="zp s-tag"/);
    expect(whole({ c: exu })).toMatch(/^<div class="zp"/);
    expect(whole({ c: exu, fancy: true })).toContain("ra-holo holo");
    expect(whole({ c: admin, fancy: true })).toContain("tg-holo holo");
    expect(whole({ c: exu })).toContain("--w:178px");
  });

  it("hangs from its strap or clip only when it pops up, and leans only when asked", () => {
    expect(whole({ c: exu })).not.toContain("hwr");
    expect(whole({ c: exu, hang: true })).toContain('class="hwr ra"');
    expect(whole({ c: admin, hang: true })).toContain('class="hwr tag"');
    expect(whole({ c: exu, hang: true, tilt: true })).toMatch(/^<div class="zp hang tilt"/);
  });

  it("prints the English name big, the Chinese one, the stars, the number, the holder and the day drawn", () => {
    const html = whole({ c: exu });
    expect(html).toContain(">EXUSIAI</b>");
    expect(html).toContain("能天使<i>★★★★★★</i>");
    expect(html).toContain("<small>No.</small>0007");
    expect(html).toContain("持证 Dr. 某人");
    expect(html).toContain("2026.11.20");
    expect(html).toContain(`ZHOUP MAP - AK${String(exu.id).padStart(3, "0")} · OPERATOR`);
    expect(html).toContain("ZHOUP MAP · AK-0007");
    const tag = whole({ c: admin, no: 12345 });
    expect(tag).toContain("<small>No.</small>12345");
    expect(tag).toContain(`>${printedEn(admin)}</span>`);
  });

  it("stacks a Chinese name with no English one block by block on a 长条挂牌, and prints it big on a 通行认证", () => {
    const zhOnly = { ...admin, en: null, name: "维娜·维多利亚" };
    const tag = whole({ c: zhOnly });
    expect(tag).toContain('class="tg-name cn"');
    expect(tag).toContain("<i>维</i><i>娜</i><i>·</i><i>维</i><i>多</i><i>利</i><i>亚</i>");
    expect(tag).not.toContain("writing-mode");
    const ra = whole({ c: { ...exu, en: null, name: "维娜·维多利亚" } });
    expect(ra).toContain('class="ra-cn big"');
    expect(ra).not.toContain("ra-en");
  });

  it("makes a long name smaller to fit, and uses a name in Latin letters as its English", () => {
    const font = (html: string, v: string) => Number(new RegExp(`${v}:([0-9.]+)cqw`).exec(html)?.[1]);
    const skadi = passCharNamed("arknights", "浊心斯卡蒂")!;
    expect(font(whole({ c: exu }), "--ef")).toBeLessThanOrEqual(10.5);
    expect(font(whole({ c: skadi }), "--ef")).toBeLessThan(font(whole({ c: exu }), "--ef"));
    expect(font(whole({ c: skadi }), "--ef") * skadi.en!.length * 0.47).toBeLessThanOrEqual(60.01);
    expect(printedEn({ en: null, name: "Miss.Christine" })).toBe("MISS.CHRISTINE");
    expect(printedEn({ en: null, name: "能天使" })).toBe("");
    expect(printedEn({ en: "Exusiai", name: "能天使" })).toBe("EXUSIAI");
    const tags = PASS_CATALOG.filter((c) => c.game === "ef");
    for (const c of tags) expect(font(whole({ c }), "--tn"), c.name).toBeLessThanOrEqual(21);
  });

  it("adds only a gold chip for the first hundred (前 100) and 靓号, and keeps the look", () => {
    expect(whole({ c: exu, no: 1 })).toContain('<span class="zfoil">前 100</span>');
    expect(whole({ c: exu, no: 100 })).toContain('<span class="zfoil">前 100</span>');
    expect(whole({ c: exu, no: 799 })).toContain('<span class="zfoil">靓号</span>');
    expect(whole({ c: admin, no: 13258 })).toContain('<span class="zfoil">靓号</span>');
    for (const no of [101, 112, 8888, 3000]) expect(whole({ c: exu, no }), String(no)).not.toContain("zfoil");
    expect(whole({ c: exu, no: 1 })).toContain('class="zc ra"');
  });

  it("is dated in Beijing time, as the site's days are", () => {
    expect(issued(Date.parse("2026-11-20T00:30:00+08:00"))).toBe("2026.11.20");
    expect(issued(Date.parse("2026-11-19T23:59:00+08:00"))).toBe("2026.11.19");
  });

  it("on a profile card, comes whole from what the card carries", () => {
    const card: PassOnCard = {
      game: "ak",
      charId: exu.id,
      name: "能天使",
      en: "Exusiai",
      rarity: 6,
      no: 7,
      copies: 2,
      fancy: true,
      color: "#aa3344",
      art: LH,
      avatar: "0123456789abcdef.webp",
      drawnAt: 0,
    };
    expect(charOfCard(card)).toEqual({ ...passChar(exu.id), color: "#aa3344" });
    expect(picOfCard(card)).toEqual({ file: LH, avatar: "/operator-art/0123456789abcdef.webp" });
    expect(picOfCard({ ...card, art: null, avatar: null })).toEqual({ file: null, avatar: null });
    const html = renderToStaticMarkup(
      createElement(FullPass, { c: charOfCard(card), no: card.no, fancy: card.fancy, pic: picOfCard(card), color: card.color, holder: "x", at: 0, w: 178 }),
    );
    expect(html).toContain('class="zc ra rax"');
    expect(html).toContain("--pc:#aa3344");
    expect(html).toContain(`/operator-art/pass/${LH}.avif`);
  });
});

describe("a 样张", () => {
  it("prints ???? for the number, —— for the holder and the day, never gold, and a stamp across it, in every look", () => {
    for (const [c, fancy, look] of [
      [amiya, false, "ra"],
      [amiya, true, "ra rax"],
      [admin, false, "tag"],
      [admin, true, "tag tagx"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(SamplePass, { c, fancy, w: 118 }));
      expect(html).toContain(`<div class="zc ${look}"`);
      expect(html).toContain("<small>No.</small>????");
      expect(html).not.toContain("zfoil");
      expect(html).toContain('<span class="zsmp" aria-hidden="true">样张<small>SAMPLE</small></span>');
      expect(html).toContain(c.game === "ak" ? "持证 ——<br/>——" : "持证 —— · ——");
      if (c.game === "ak") expect(html).toContain("ZHOUP MAP · AK-????");
    }
    // a pass of their own has none of it
    const own = renderToStaticMarkup(createElement(FullPass, { c: amiya, no: 1, fancy: false, holder: "柚子", at: 0, w: 118 }));
    expect(own).not.toContain("zsmp");
    expect(own).toContain('<span class="zfoil">前 100</span>');
  });
});
