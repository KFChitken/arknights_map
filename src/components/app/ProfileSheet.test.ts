import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PassesMe } from "@/lib/passes";
import { EMPTY_PROFILE } from "@/lib/profile";
import ProfileSheet from "./ProfileSheet";

const sheet = (passes?: PassesMe) =>
  renderToStaticMarkup(
    createElement(ProfileSheet, {
      profile: EMPTY_PROFILE,
      badges: [],
      wornBadge: null,
      blocked: [],
      passes,
      onUnblock: () => {},
      onSave: async () => true,
      onSignOut: () => {},
      onDelete: () => {},
      onClose: () => {},
    }),
  );

/** The label of a box in 我的资料, with its box, as the sheet draws it */
const box = (html: string, label: string) => new RegExp(`<label class="check"><input type="checkbox"( checked="")?/>${label}</label>`).exec(html);

describe("我的资料's 通行证", () => {
  it("switches 地图卡片上显示立绘 as the player left it, above 省流量", () => {
    const on = sheet({ tickets: 3, dot: false, worn: null, onMap: true });
    const off = sheet({ tickets: 3, dot: false, worn: null, onMap: false });
    expect(box(on, "地图卡片上显示立绘")?.[1]).toBe(' checked=""');
    expect(box(off, "地图卡片上显示立绘")).not.toBeNull();
    expect(box(off, "地图卡片上显示立绘")?.[1]).toBeUndefined();
    expect(on).toContain("地图上点开你的本体时，卡片上露出你戴的通行证的立绘，不显示编号；克隆体不显示。");
    expect(on.indexOf("地图卡片上显示立绘")).toBeLessThan(on.indexOf("省流量：不加载立绘"));
  });

  it("is not there for a player 寻访 is not open to", () => {
    const html = sheet();
    expect(html).not.toContain("地图卡片上显示立绘");
    expect(html).not.toContain("省流量：不加载立绘");
  });
});
