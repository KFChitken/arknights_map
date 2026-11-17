import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import type { PassesMe } from "@/lib/passes";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import ProfileSheet from "./ProfileSheet";

const sheet = (passes?: PassesMe, more: { listen?: boolean; profile?: Profile } = {}) =>
  renderToStaticMarkup(
    createElement(ProfileSheet, {
      profile: more.profile ?? EMPTY_PROFILE,
      listen: more.listen,
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
  it("switches 地图卡片上挂出通行证 as the player left it, above 省流量", () => {
    const on = sheet({ tickets: 3, dot: false, worn: null, onMap: true });
    const off = sheet({ tickets: 3, dot: false, worn: null, onMap: false });
    expect(box(on, "地图卡片上挂出通行证")?.[1]).toBe(' checked=""');
    expect(box(off, "地图卡片上挂出通行证")).not.toBeNull();
    expect(box(off, "地图卡片上挂出通行证")?.[1]).toBeUndefined();
    expect(on).toContain("地图上点开你的本体时，卡片上挂出你戴的通行证，编号和日期照印，不印你的名字；克隆体不挂。");
    expect(on.indexOf("地图卡片上挂出通行证")).toBeLessThan(on.indexOf("省流量：不加载立绘"));
  });

  it("is not there for a player 寻访 is not open to", () => {
    const html = sheet();
    expect(html).not.toContain("地图卡片上挂出通行证");
    expect(html).not.toContain("省流量：不加载立绘");
  });
});

describe("我的资料's 听歌", () => {
  it("lets 触须之交 see the song by default, and keeps it off once switched off", () => {
    expect(box(sheet(undefined, { listen: true }), T.profile.hearing.label)?.[1]).toBe(' checked=""');
    const off = sheet(undefined, { listen: true, profile: { ...EMPTY_PROFILE, showListening: false } });
    expect(box(off, T.profile.hearing.label)).not.toBeNull();
    expect(box(off, T.profile.hearing.label)?.[1]).toBeUndefined();
    expect(off).toContain(T.profile.hearing.note);
  });

  it("is not there for a player 听歌 is not open to", () => {
    expect(sheet()).not.toContain(T.profile.hearing.label);
  });
});
