import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { devilBits, drinkCup, flaps, hoodLamps, speedLines, standingApart } from "@/lib/lookArt";
import { pictureSvg } from "@/lib/roachImages";
import { GLOW, hoodBody } from "@/lib/roachSvg";
import { boop, burst, feelers } from "@/lib/touchArt";
import { ROACH_AVATARS, type DrawnAvatar, type RoachAvatar, type RoachColor, type RoachStyle } from "@/lib/types";
import { DockFx, dockAnimFor, type DockAt, type DockKind } from "./DockFx";
import { touchedAround, touchedOn } from "./LookMoves";
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
    for (const look of ROACH_AVATARS) if (!touchedOn(look, GLOW.green) && !touchedAround(look)) expect(dock("bold", look, "green")).not.toContain("dock-look");
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

  it("has 管理员 touch boldly with a conveyor belt for a feeler, a crate riding over on it, landing with 咚", () => {
    const html = scene("bold", { you: you("endmin"), them: them("hood", "orange") });
    const f = feelers("endmin", "hood");
    const [x, y] = f.boldEnd;
    expect(html).toContain(`<path class="em-belt" d="${f.bold}" pathLength="1"></path><path class="em-dash" d="${f.bold}" pathLength="30"></path>`);
    expect(html).toContain(`<div class="em-crateway" style="offset-path:path(&#x27;${f.bold}&#x27;)"><svg`);
    expect(html).toContain(`<div class="ta-fx em-dong" style="left:${x + 3}px;top:${y - 15}px">${burst(T.fx.dong)}</div>`);
    // its feeler, 啵! and the name card give way to these in globals.css; the others touch as before
    expect(looks(html)).toContain("you-endmin");
    expect(scene("bold", { you: you("hood"), them: them("endmin", "orange") })).not.toContain("em-belt");
    expect(scene("sneaky", { you: you("endmin"), them: them("hood", "orange") })).not.toContain("em-crateway");
  });

  it("has 管理员 touched sound the alarm round itself: a warning sign in place of !, a yellow ring at its feet", () => {
    const html = scene("bold", { you: you("hood"), them: them("endmin", "orange") });
    const alarm = piece(html, "em-alarm");
    expect(alarm).toContain('<g class="em-warn">');
    expect(alarm).toContain('<g class="em-ring">');
    // over the scene where the roach is, not in what jumps: the sign and the ring stay where they are as it shrinks back
    expect(html).toMatch(/<div class="ta-around"><div class="ta-lay em-alarm">[\s\S]*<\/svg><\/div><\/div><\/div><\/div>$/);
    expect(html.match(/<div class="ta-jump">[\s\S]*?<div class="ta-around">/)![0]).not.toContain("em-alarm");
    expect(html).not.toContain('class="ta-mark"');
    // touched on the sly it gets ? as anyone does (the sign stays hidden there in globals.css)
    const sneaky = scene("sneaky", { you: you("hood"), them: them("endmin", "orange") });
    expect(sneaky).toContain("em-alarm");
    expect(sneaky).toContain('class="ta-mark"');
    // as the map draws it: a stranger's clone is the hood and gets !, a 触须之交's is 管理员
    const stranger = scene("bold", { you: you("hood"), them: them("endmin", "orange", true) });
    expect(stranger).not.toContain("em-alarm");
    expect(stranger).toContain('class="ta-mark"');
    expect(scene("bold", { you: you("hood"), them: them("endmin", "orange", true, true) })).toContain("em-alarm");
    expect(scene("bold", { you: you("endmin"), them: them("doctor", "orange") })).toContain('class="ta-mark"');
  });

  it("has 管理员 sound the alarm on your own dock avatar too, with no ! besides its sign", () => {
    const bold = dock("bold", "endmin", "green");
    expect(bold).toContain('class="dock-fx dock-look dock-bold ta-dhop"');
    expect(piece(bold, "em-alarm")).toContain('<g class="em-warn">');
    expect(bold).not.toContain("ta-dmark");
    const sneaky = dock("sneaky", "endmin", "green");
    expect(sneaky).toContain("em-alarm");
    expect(sneaky).toContain("ta-dmark");
    for (const look of ["hood", "doctor"] as const) expect(dock("bold", look, "green")).toContain("ta-dmark");
  });

  it("has 管理员 put up a loudspeaker on a pole beside it as it shouts", () => {
    const html = shout("endmin");
    expect(looks(html)).toEqual(["ta-shout", "me-endmin", "ta-pic"]);
    expect(html).toMatch(/<div class="ta-bubble">x<\/div><div class="em-pole"><svg/);
    expect(html.match(/<path class="arc( a2)?"/g)).toHaveLength(2);
    expect(shout("doctor")).not.toContain("em-pole");
    expect(shout("hood")).not.toContain("em-pole");
  });

  it("has 管理员 drink from its canteen", () => {
    const cup = drinkCup("endmin")!;
    expect(cup.origin).toBe("66% 64%");
    expect(cup.fall).toBeUndefined();
    expect(cup.svg.startsWith('<g transform="translate(42.24 40.96) scale(1.35) translate(-42.24 -40.96)">')).toBe(true);
    const html = drink("endmin");
    expect(html).toContain('<div class="actor pic" data-state="drinking" aria-hidden="true">');
    expect(html).toContain('class="lay cup" style="transform-origin:66% 64%"');
  });

  it("has 绝对主角 tease them with 略～, then throw a paper plane along her feeler that lands with 啵! as her name card", () => {
    const html = scene("bold", { you: you("imp"), them: them("hood", "orange") });
    const f = feelers("imp", "hood");
    const [x, y] = f.boldEnd;
    expect(html).toContain(`<div class="im-plane" style="offset-path:path(&#x27;${f.bold}&#x27;)"><svg`);
    expect(html).toContain(`<div class="im-tease">${T.fx.tease}</div>`);
    expect(html).toContain(`<div class="ta-fx im-pa" style="left:${x + 3}px;top:${y - 15}px">${boop()}</div>`);
    // the name card itself still goes over: globals.css only has it come out where the plane lands
    expect(html).toContain('class="ta-cardway"');
    expect(looks(html)).toContain("you-imp");
    expect(scene("bold", { you: you("hood"), them: them("imp", "orange") })).not.toContain("im-plane");
    expect(scene("sneaky", { you: you("imp"), them: them("hood", "orange") })).not.toContain("im-tease");
  });

  it("has 绝对主角 touched twirl round and say 略略略～ in place of !, as the map draws her", () => {
    const html = scene("bold", { you: you("hood"), them: them("imp", "orange") });
    expect(html).toContain(`<div class="ta-around"><div class="im-lue">${T.fx.lue}</div></div>`);
    expect(html).not.toContain('class="ta-mark"');
    // on the sly: ? as anyone gets (略略略～ stays hidden there in globals.css)
    expect(scene("sneaky", { you: you("hood"), them: them("imp", "orange") })).toContain('class="ta-mark"');
    const stranger = scene("bold", { you: you("hood"), them: them("imp", "orange", true) });
    expect(stranger).not.toContain("im-lue");
    expect(stranger).toContain('class="ta-mark"');
    expect(scene("bold", { you: you("hood"), them: them("imp", "orange", true, true) })).toContain("im-lue");
  });

  it("has your own dock avatar twirl round when you are 绝对主角, saying 略略略～ when touched boldly", () => {
    expect(dockAnimFor("bold", "imp")).toBe("im-dspin");
    expect(dockAnimFor("sneaky", "imp")).toBe("im-dspin-q");
    expect(dockAnimFor("friend", "imp")).toBe("ta-dhop");
    // the others hop and shiver as they always have
    expect(dockAnimFor("bold", "hood")).toBe("ta-dhop");
    expect(dockAnimFor("sneaky", "endmin")).toBe("ta-dshiver");
    const bold = dock("bold", "imp", "green");
    expect(bold).toContain('class="dock-fx dock-look dock-bold im-dspin"');
    expect(bold).toContain(`<div class="im-lue">${T.fx.lue}</div>`);
    expect(bold).not.toContain("ta-dmark");
    expect(dock("sneaky", "imp", "green")).toContain("ta-dmark");
  });

  it("has 绝对主角 twirl round over her own ground as she shouts, her bubble with devil horns and a tail", () => {
    const html = shout("imp");
    const { ground, figure } = standingApart("imp");
    expect(figure).toContain(pictureSvg("imp"));
    expect(html).toContain(`<div class="ta-calm"><div class="ta-lay">${ground}</div><div class="ta-lay im-fig">${figure}</div></div>`);
    expect(html).toContain(`<span class="im-devil">${devilBits()}</span></div>`);
    expect(devilBits().match(/class="im-(horn l|horn r|tail)"/g)).toHaveLength(3);
    // the others shout as before, the roach whole
    for (const look of ["hood", "doctor", "endmin"] as const) {
      expect(shout(look)).not.toContain("im-fig");
      expect(shout(look)).not.toContain("im-devil");
    }
  });

  it("has 绝对主角 drink a glass of red wine", () => {
    const cup = drinkCup("imp")!;
    expect(cup.origin).toBe("66% 66%");
    expect(cup.svg.startsWith('<g transform="translate(42.24 42.24) scale(1.35) translate(-42.24 -42.24)">')).toBe(true);
    expect(drink("imp")).toContain('class="lay cup" style="transform-origin:66% 66%"');
  });

  it("has 咕咕嘎嘎 slide in on its belly with speed lines behind it, its ground waiting for it, and 嘎! where its feeler lands", () => {
    const html = scene("bold", { you: you("gugu"), them: them("hood", "orange") });
    const f = feelers("gugu", "hood");
    const [x, y] = f.boldEnd;
    const { ground, figure } = standingApart("gugu");
    // the picture alone slides in; its ground stays where it gets up
    expect(html).toContain(`<div class="ta-you"><div class="ta-lay gg-gnd">${ground}</div><div class="ta-body"><div class="ta-lay">${figure}</div></div></div>`);
    expect(html).toContain(`<div class="gg-speed">${speedLines()}</div>`);
    expect(html).toContain(`<div class="ta-fx gg-ga" style="left:${x + 3}px;top:${y - 15}px">${burst(T.fx.quack)}</div>`);
    // 啵! is still there for globals.css to hide, and the name card still goes over
    expect(html).toContain('class="ta-fx ta-boop"');
    expect(html).toContain('class="ta-cardway"');
    expect(looks(html)).toContain("you-gugu");
    // the others come in whole as they always have, and sneaking up you are a shadow
    expect(scene("bold", { you: you("doctor"), them: them("hood", "orange") })).toMatch(/<div class="ta-you"><div class="ta-body"><span/);
    const touched = scene("bold", { you: you("hood"), them: them("gugu", "orange") });
    expect(touched).not.toContain("gg-gnd");
    expect(touched).not.toContain("gg-speed");
    expect(scene("sneaky", { you: you("gugu"), them: them("hood", "orange") })).not.toContain("gg-");
  });

  it("has 咕咕嘎嘎 touched flap its wings and say 嘎！ in place of !, as the map draws it", () => {
    const html = scene("bold", { you: you("hood"), them: them("gugu", "orange") });
    expect(piece(html, "gg-flap")).toBe(flaps());
    // the flap lines flap with it, in what jumps; 嘎！ stays where it is, over the scene
    expect(html).toMatch(/<div class="ta-jump"><div class="ta-a"><span[\s\S]*?<\/span><\/div><div class="ta-lay gg-flap">/);
    expect(html).toContain(`<div class="ta-around"><div class="gg-quack">${T.fx.quackBack}</div></div>`);
    expect(html).not.toContain('class="ta-mark"');
    // on the sly: a smaller flap, and ? as anyone gets (嘎！ stays hidden there in globals.css)
    const sneaky = scene("sneaky", { you: you("hood"), them: them("gugu", "orange") });
    expect(sneaky).toContain('class="ta-lay gg-flap"');
    expect(sneaky).toContain('class="ta-mark"');
    // as the map draws it: a stranger's clone is the hood and gets !, a 触须之交's is 咕咕嘎嘎
    const stranger = scene("bold", { you: you("hood"), them: them("gugu", "orange", true) });
    expect(stranger).not.toContain("gg-flap");
    expect(stranger).not.toContain("gg-quack");
    expect(stranger).toContain('class="ta-mark"');
    expect(scene("bold", { you: you("hood"), them: them("gugu", "orange", true, true) })).toContain("gg-quack");
  });

  it("has your own dock avatar flap when you are 咕咕嘎嘎, saying 嘎！ when touched boldly", () => {
    expect(dockAnimFor("bold", "gugu")).toBe("gg-dflap");
    expect(dockAnimFor("sneaky", "gugu")).toBe("gg-dflap-q");
    expect(dockAnimFor("friend", "gugu")).toBe("ta-dhop");
    const bold = dock("bold", "gugu", "green");
    expect(bold).toContain(`<div class="dock-fx dock-look dock-bold gg-dflap"`);
    expect(bold).toContain(`<div class="ta-lay gg-flap">${flaps()}</div><div class="gg-quack">${T.fx.quackBack}</div>`);
    expect(bold).not.toContain("ta-dmark");
    const sneaky = dock("sneaky", "gugu", "green");
    expect(sneaky).toContain('class="dock-fx dock-look dock-sneaky gg-dflap-q"');
    expect(sneaky).toContain("ta-dmark");
  });

  it("has 咕咕嘎嘎 waddle over its own ground as it shouts, 咕咕嘎嘎～ beside it", () => {
    const html = shout("gugu");
    const { ground, figure } = standingApart("gugu");
    expect(looks(html)).toEqual(["ta-shout", "me-gugu", "ta-pic"]);
    expect(html).toContain(`<div class="ta-calm"><div class="ta-lay">${ground}</div><div class="ta-lay gg-fig">${figure}</div></div>`);
    expect(html).toContain(`<div class="ta-bubble">x</div><div class="gg-sound">${T.fx.guguGaga}</div>`);
    // its bubble is the plain one
    expect(html).not.toContain("im-devil");
    for (const look of ["hood", "doctor", "endmin", "imp"] as const) expect(shout(look)).not.toContain("gg-");
  });

  it("has 咕咕嘎嘎 drink from a little fish bottle and fall flat on its face", () => {
    const cup = drinkCup("gugu")!;
    expect(cup.origin).toBe("66% 63%");
    expect(cup.fall).toBe("-92deg");
    expect(cup.svg.startsWith('<g transform="translate(42.24 40.32) scale(1.35) translate(-42.24 -40.32)">')).toBe(true);
    const html = drink("gugu");
    expect(html).toContain('<div class="actor pic" data-state="drinking" style="--fall:-92deg" aria-hidden="true">');
    expect(html).toContain('class="lay cup" style="transform-origin:66% 63%"');
    // the others tip over to their right as before
    expect(drink("imp")).toContain('<div class="actor pic" data-state="drinking" aria-hidden="true">');
  });
});
