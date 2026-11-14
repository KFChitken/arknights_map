import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { drinkCup, hoodLamps } from "@/lib/lookArt";
import { pictureSvg } from "@/lib/roachImages";
import { GLOW, hoodBody } from "@/lib/roachSvg";
import { feelers } from "@/lib/touchArt";
import { ROACH_AVATARS, type DrawnAvatar, type RoachAvatar, type RoachColor, type RoachStyle } from "@/lib/types";
import { DockFx, type DockAt, type DockKind } from "./DockFx";
import { touchedOn } from "./LookMoves";
import RoachActor from "./RoachActor";
import TouchStage, { ShoutStage, type TouchCast } from "./TouchStage";

const scene = (kind: "sneaky" | "bold" | "friend", cast: TouchCast) =>
  renderToStaticMarkup(createElement(TouchStage, { kind, cast, place: { s: 1, left: 0, top: 0, end: 1 }, onDone: () => {} }));
const you = (avatar: RoachAvatar, color: RoachColor = "cyan") => ({ avatar, color, name: "x" });
const them = (avatar: DrawnAvatar, color: RoachColor, clone = false, friend = false) => ({ avatar, color, clone, friend });
/** The stage's classes, which say whose moves play */
const looks = (html: string) => html.match(/class="ta-stage ([^"]*)"/)![1].split(" ");
/** What one of the pieces laid over a roach draws */
const piece = (html: string, cls: string) => html.match(new RegExp(`class="ta-lay ${cls}"[^>]*>([\\s\\S]*?)</div>`))?.[1];

const at: DockAt = {
  av: { x: 10, y: 600, w: 34, h: 38 },
  icon: { x: 12, y: 602, w: 30, h: 30 },
  mail: { x: 60, y: 600, w: 40, h: 38 },
  top: 40,
};
const dock = (kind: DockKind, avatar: RoachAvatar, color: RoachColor) =>
  renderToStaticMarkup(
    createElement(DockFx, { kind, from: { name: "TA", avatar: "hood", color: "pink" }, at, me: { avatar, color }, onDone: () => {} }),
  );
const shout = (avatar: RoachAvatar) =>
  renderToStaticMarkup(
    createElement(ShoutStage, {
      me: { avatar, color: "cyan" },
      text: "x",
      limited: false,
      place: { s: 1, left: 0, top: 0, end: 1, R: 56 },
      onToast: () => {},
      onDone: () => {},
    }),
  );
const drink = (avatar: RoachAvatar, look: RoachStyle = "cartoon", scene: "drink" | "wake" = "drink") =>
  renderToStaticMarkup(createElement(RoachActor, { scene, avatar, color: "cyan", look, onDone: () => {} }));

describe("each look's own moves", () => {
  it("draws the hood as it always has, with the sleeve that waves in a group of its own when asked", () => {
    const sleeve = `<rect x="40" y="33" width="15" height="25" rx="5" fill="#33363d" stroke="#0d0e10" stroke-width="2"/>`;
    const plain = hoodBody(GLOW.cyan);
    expect(plain).toContain(sleeve);
    expect(plain).not.toContain("<g class=");
    expect(hoodBody(GLOW.cyan, { sleeveClass: "hd-sleeve" })).toBe(plain.replace(sleeve, `<g class="hd-sleeve">${sleeve}</g>`));
  });

  it("says on the stage whose moves play, and sneaking up you are a shadow with no look", () => {
    expect(looks(scene("bold", { you: you("hood"), them: them("doctor", "orange") }))).toEqual(["ta-bold", "you-hood", "them-doctor"]);
    expect(looks(scene("friend", { you: you("imp"), them: them("gugu", "pink") }))).toEqual(["ta-friend", "you-imp", "them-gugu"]);
    expect(looks(scene("sneaky", { you: you("hood"), them: them("endmin", "red") }))).toEqual(["ta-sneaky", "them-endmin"]);
  });

  it("waves your hood's sleeve in your own colour when you touch boldly, and leaves the other looks as they are", () => {
    const html = scene("bold", { you: you("hood", "green"), them: them("doctor", "orange") });
    expect(piece(html, "hd-wave")).toContain('class="hd-sleeve"');
    expect(piece(html, "hd-glow")).toBe(hoodLamps(GLOW.green));
    // sneaking up there is only the shadow
    expect(scene("sneaky", { you: you("hood", "green"), them: them("doctor", "orange") })).not.toContain("hd-wave");
    expect(scene("bold", { you: you("doctor"), them: them("doctor", "orange") })).not.toContain("hd-wave");
  });

  it("makes the touched hood flash its lamps in its colour and open round eyes", () => {
    for (const kind of ["bold", "sneaky"] as const) {
      const html = scene(kind, { you: you("doctor"), them: them("hood", "pink") });
      expect(piece(html, "hd-flash")).toBe(hoodLamps(GLOW.pink));
      expect(piece(html, "hd-eyes")).toContain("<ellipse");
    }
    // a 触须之交 becoming one plays as it did
    expect(scene("friend", { you: you("doctor"), them: them("hood", "pink") })).not.toContain("hd-eyes");
  });

  it("plays only the look the map draws: a stranger's clone reacts as the plain hood, whoever's it is", () => {
    // the plain hood with white lamps, never the owner's look or colour
    for (const kind of ["bold", "sneaky"] as const) {
      const html = scene(kind, { you: you("hood"), them: them("doctor", "orange", true) });
      expect(looks(html)).toContain("them-hood");
      expect(looks(html)).not.toContain("them-doctor");
      expect(piece(html, "hd-flash")).toBe(hoodLamps(GLOW.white));
      expect(html).not.toContain(GLOW.orange);
    }
    // a 触须之交's clone is drawn in TA's look, so it reacts as that look
    const friendClone = scene("bold", { you: you("hood"), them: them("doctor", "orange", true, true) });
    expect(looks(friendClone)).toContain("them-doctor");
    expect(friendClone).not.toContain("hd-eyes");
  });

  it("has your own avatar on the dock react as your look, over its picture, when you are touched", () => {
    const bold = dock("bold", "hood", "green");
    expect(bold).toContain('class="dock-fx dock-look dock-bold ta-dhop"');
    expect(bold).toContain("left:12px;top:602px;width:30px;height:30px");
    expect(piece(bold, "hd-flash")).toBe(hoodLamps(GLOW.green));
    expect(dock("sneaky", "hood", "purple")).toContain('class="dock-fx dock-look dock-sneaky ta-dshiver"');
    // the other scenes on the dock, and the looks without a reaction yet, are as they were
    for (const kind of ["friend", "knock", "hug", "luck"] as const) expect(dock(kind, "hood", "green")).not.toContain("dock-look");
    for (const look of ROACH_AVATARS) if (!touchedOn(look, GLOW.green)) expect(dock("bold", look, "green")).not.toContain("dock-look");
  });

  it("has 博士 deploy them when it touches boldly: a tile under them, three crystals from where its feeler lands, 部署！", () => {
    const html = scene("bold", { you: you("doctor"), them: them("hood", "orange") });
    const [x, y] = feelers("doctor", "hood").boldEnd;
    expect(html).toContain('class="dc-tile"');
    expect(html).toContain('class="dc-beam"');
    expect(html.match(/class="dc-drop"/g)).toHaveLength(3);
    expect(html).toContain(`style="left:${x}px;top:${y}px;--dx:20px;--dy:66px"`);
    expect(html).toContain(`<div class="dc-word">${T.fx.deploy}</div>`);
    // its 啵! gives way to 部署！ in globals.css; the others touch as before
    expect(looks(html)).toContain("you-doctor");
    expect(scene("bold", { you: you("hood"), them: them("doctor", "orange") })).not.toContain("dc-tile");
    expect(scene("sneaky", { you: you("doctor"), them: them("hood", "orange") })).not.toContain("dc-tile");
  });

  it("has 博士 touched doze with a snot bubble that pops, as the map draws it, and on your own dock avatar", () => {
    for (const kind of ["bold", "sneaky"] as const) {
      const doze = piece(scene(kind, { you: you("hood"), them: them("doctor", "orange") }), "dc-doze");
      for (const part of ["dc-snot", "dc-pop", "dc-zz"]) expect(doze).toContain(`class="${part}"`);
    }
    // a 触须之交's clone is drawn as 博士 and dozes; a stranger's never does
    expect(scene("bold", { you: you("hood"), them: them("doctor", "orange", true, true) })).toContain("dc-doze");
    expect(scene("bold", { you: you("hood"), them: them("doctor", "orange", true) })).not.toContain("dc-doze");
    expect(dock("bold", "doctor", "green")).toContain('class="dock-fx dock-look dock-bold ta-dhop"');
    expect(piece(dock("sneaky", "doctor", "green"), "dc-doze")).toContain('class="dc-snot"');
  });

  it("has 博士 hold up its terminal as it shouts, and says on the stage whose shout it is", () => {
    const html = shout("doctor");
    expect(looks(html)).toEqual(["ta-shout", "me-doctor", "ta-pic"]);
    expect(html).toContain('<div class="dc-tablet">');
    expect(looks(shout("hood"))).toEqual(["ta-shout", "me-hood"]);
    expect(shout("hood")).not.toContain("dc-tablet");
  });

  it("has 博士 drink from its mug over its own ground, which stays as it tips over and sleeps", () => {
    const cup = drinkCup("doctor")!;
    expect(cup.origin).toBe("64% 55%");
    expect(cup.svg.startsWith('<g transform="translate(40.96 35.2) scale(1.35) translate(-40.96 -35.2)">')).toBe(true);
    const html = drink("doctor");
    expect(html).toContain('<div class="actor pic" data-state="drinking" aria-hidden="true">');
    expect(html).toContain('class="lay cup" style="transform-origin:64% 55%"');
    expect(html).toContain(`<span class="glug">${T.fx.gulp}</span>`);
    expect(html).toContain(`<span class="hic">${T.fx.hic}</span>`);
    // the picture alone, standing and asleep: the ground is a layer of its own
    expect(pictureSvg("doctor")).toBe('<image href="/avatars/doctor.webp" x="4" y="4" width="56" height="56"/>');
    const asleep = pictureSvg("doctor", { asleep: true });
    expect(asleep).toContain('<image href="/avatars/doctor.webp"');
    expect(asleep).not.toContain("#ffd23f");
    expect(pictureSvg("hood")).toBe("");
  });

  it("leaves the drinks without a cup as they were: the hood's bottle, the realistic roach, waking up", () => {
    expect(drinkCup("hood")).toBeNull();
    expect(drink("hood")).toContain('<div class="actor " data-state="drinking"');
    expect(drink("doctor", "real")).toContain('<div class="actor plain" data-state="drinking"');
    expect(drink("doctor", "cartoon", "wake")).toContain('<div class="actor plain" data-state="waking"');
    for (const html of [drink("hood"), drink("doctor", "real"), drink("doctor", "cartoon", "wake")]) expect(html).not.toContain("lay cup");
  });
});
