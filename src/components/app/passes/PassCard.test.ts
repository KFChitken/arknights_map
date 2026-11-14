import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { passCharNamed, PASS_CATALOG } from "@/lib/passCatalog";
import type { Art } from "../OperatorNames";
import { artUrl, inkOf, MiniPass } from "./PassCard";

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

  it("adds only a gold corner for No.1 and 靓号, and leaves the number off a wish not drawn yet", () => {
    expect(mini({ c: amiya, no: 1 })).toContain('class="mfo"');
    expect(mini({ c: amiya, no: 111 })).toContain('class="mfo"');
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
    // the fancy 明日方舟 pass is pale whatever their colour
    expect(mini({ c: amiya, fancy: true })).toContain("--pk:#1b2330");
  });
});
