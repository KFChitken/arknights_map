import { expression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { usesPicture } from "@/lib/roachImages";
import { GLOW, roachSvg, shownAvatar, type RoachOpts } from "@/lib/roachSvg";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import { friendCloneLooks, friendLook } from "@/lib/world/friendLooks";
import type { Friend, PublicRoach } from "@/lib/world/types";
import { CARTOON_ICONS, massPointOf, styleIndex, styleSpecs } from "./massPoints";
import { ICON_ROOM } from "./roachGl";
import { imageSpec, neededImages, roachImage } from "./roachIcons";

const UUID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const roach = (more: Partial<PublicRoach> = {}): PublicRoach => ({
  id: "r1",
  lng: 121.47,
  lat: 31.23,
  clone: false,
  avatar: "hood",
  color: "cyan",
  friend: false,
  ...more,
});
const friendOf = (roaches: PublicRoach[], avatar = "endmin", color = "purple") =>
  ({ roaches, profile: { avatar, color } }) as unknown as Pick<Friend, "roaches" | "profile">;

describe("a 触须之交's clone, as drawn", () => {
  it("wears TA's look and lights, see-through, with the pink ring and heart; a stranger's keeps the plain white hood", () => {
    expect(shownAvatar({ avatar: "doctor", clone: true, friend: true })).toBe("doctor");
    expect(shownAvatar({ avatar: "doctor", clone: true })).toBe("hood");
    expect(shownAvatar({ avatar: "doctor", clone: true, mine: true })).toBe("doctor");
    expect(usesPicture({ avatar: "doctor", clone: true, friend: true })).toBe(true);
    expect(usesPicture({ avatar: "doctor", clone: true })).toBe(false);

    const friends = roachSvg("purple", { avatar: "hood", clone: true, friend: true });
    expect(friends).toContain(`fill="${GLOW.purple}"`);
    expect(friends).not.toContain(`fill="${GLOW.white}"`);
    expect(friends).toContain('<g opacity="0.62">');
    expect(friends).toContain('stroke-dasharray="4 3"');
    expect(friends).toContain('fill="#ff4f8b"');

    const strangers = roachSvg("purple", { avatar: "hood", clone: true });
    expect(strangers).toContain(`fill="${GLOW.white}"`);
    expect(strangers).not.toContain(`fill="${GLOW.purple}"`);
    expect(strangers).toContain('<g opacity="0.55">');
    expect(strangers).not.toContain('fill="#ff4f8b"');
    // TA's main roach and your own clones are as they were
    expect(roachSvg("purple", { avatar: "hood", friend: true })).toContain('<g opacity="1">');
    expect(roachSvg("purple", { avatar: "hood", clone: true, mine: true })).toContain('<g opacity="0.75">');
  });

  it("takes TA's look from TA's main roach, or from TA's own pick while it is not out, kept to the looks players have", () => {
    const main = roach({ id: UUID, avatar: "doctor", color: "gold", friend: true });
    expect(friendLook(friendOf([main]))).toEqual({ avatar: "doctor", color: "gold" });
    expect(friendLook(friendOf([]))).toEqual({ avatar: "endmin", color: "purple" });
    expect(friendLook(friendOf([], "amiya", "nope"))).toEqual({ avatar: "hood", color: "cyan" });
  });

  it("knows each 触须之交's clones by both ids the feed may give them, and nothing else", () => {
    const clone = roach({ id: UUID, clone: true, avatar: "hood", color: "white", friend: true });
    const main = roach({ id: "a0000000-0000-4000-8000-000000000000", avatar: "imp", color: "red", friend: true });
    const looks = friendCloneLooks([friendOf([main, clone]), friendOf([roach({ id: "b0000000-0000-4000-8000-000000000000", friend: true })])]);
    expect([...looks.keys()].sort()).toEqual([UUID, UUID.slice(0, 8)].sort());
    expect(looks.get(UUID.slice(0, 8))).toEqual({ avatar: "imp", color: "red" });
  });
});

describe("the 高德 map's icons", () => {
  /** What an icon looks like where it matters: the figure, its lights, and the marks around it */
  const seen = ([color, o]: [RoachColor, RoachOpts]) => ({
    avatar: shownAvatar(o),
    glow: o.clone && !o.mine && !o.friend ? "white" : color,
    friend: Boolean(o.friend),
    clone: Boolean(o.clone),
    asleep: Boolean(o.asleep),
  });
  const every = ROACH_AVATARS.flatMap((avatar: RoachAvatar) =>
    ROACH_COLORS.flatMap((color: RoachColor) =>
      [false, true].flatMap((friend) =>
        [
          { clone: false, asleep: false },
          { clone: true, asleep: false },
          { clone: false, asleep: true },
        ].map((k) => roach({ id: `${avatar}-${color}-${friend}-${k.clone}-${k.asleep}`, avatar, color, friend, clone: k.clone, ...(k.asleep ? { asleep: true as const } : {}) })),
      ),
    ),
  );

  it("give each roach its own look: TA's for a 触须之交's clone, the plain one for a stranger's", () => {
    const specs = styleSpecs("cartoon");
    for (const r of every) {
      const i = styleIndex(massPointOf(r), "cartoon", 0);
      expect(i, r.id).toBeLessThan(specs.length);
      const want = {
        avatar: r.clone && !r.friend ? "hood" : r.avatar,
        glow: r.clone && !r.friend ? "white" : r.color,
        friend: r.friend,
        clone: r.clone,
        asleep: Boolean(r.asleep),
      };
      expect(seen(specs[i]), r.id).toEqual(want);
    }
  });

  it("keep the numbers of before, the 触须之交's clones after them all, and fit beside the hearts", () => {
    const specs = styleSpecs("cartoon");
    expect(specs).toHaveLength(CARTOON_ICONS);
    expect(CARTOON_ICONS).toBe(162 + ROACH_AVATARS.length * ROACH_COLORS.length);
    expect(CARTOON_ICONS).toBeLessThanOrEqual(ICON_ROOM);
    // a stranger's clone, and a 触须之交's main roach, are where they were
    expect(styleIndex(massPointOf(roach({ clone: true })), "cartoon", 0)).toBe(40);
    expect(styleIndex(massPointOf(roach({ friend: true, avatar: "doctor", color: "pink" })), "cartoon", 0)).toBe(41 + 8 + 1);
    expect(styleIndex(massPointOf(roach({ friend: true, clone: true, avatar: "doctor", color: "pink" })), "cartoon", 0)).toBe(162 + 8 + 1);
    // the realistic look is as it was: no icons of its own for them
    expect(styleSpecs("real").every(([, o]) => !(o.clone && o.friend && o.avatar))).toBe(true);
    for (const r of every) {
      const i = styleIndex(massPointOf(r), "real", 0);
      expect(i).toBeLessThan(styleSpecs("real").length);
    }
  });
});

describe("the overseas map's icons", () => {
  const image = expression.createExpression(roachImage("cartoon"));
  if (image.result !== "success") throw new Error("roachImage");
  const iconOf = (r: PublicRoach) => image.value.evaluate({ zoom: 14 }, { type: 1, properties: { ...r } } as never) as string;
  const mine = { mine: [], mineAsleep: false, ghost: null, myAvatar: "hood", myColor: "cyan", look: "cartoon" } as unknown as Parameters<typeof neededImages>[0];

  it("name a 触须之交's clone by TA's look, and draw it so; a stranger's are all the one plain clone", () => {
    const theirs = roach({ clone: true, friend: true, avatar: "doctor", color: "pink" });
    expect(iconOf(theirs)).toBe("friendclone-doctor-pink");
    expect(imageSpec("friendclone-doctor-pink")).toEqual(["pink", { avatar: "doctor", mine: false, clone: true, friend: true }]);
    expect(neededImages(mine, [theirs])).toEqual(new Set(["friendclone-doctor-pink"]));

    const strangers = roach({ clone: true, avatar: "hood", color: "white" });
    expect(iconOf(strangers)).toBe("clone");
    expect(imageSpec("clone")).toEqual(["white", { clone: true, friend: false }]);
  });

  it("have every icon a roach is drawn with among those made for it, read back as that roach", () => {
    for (const avatar of ROACH_AVATARS) {
      for (const color of ROACH_COLORS) {
        for (const r of [
          roach({ avatar, color }),
          roach({ avatar, color, friend: true }),
          roach({ avatar, color, friend: true, clone: true }),
          roach({ avatar: "hood", color: "white", clone: true }),
        ]) {
          const id = iconOf(r);
          expect(neededImages(mine, [r]).has(id), id).toBe(true);
          const [c, o] = imageSpec(id);
          expect({ avatar: shownAvatar(o), color: o.clone && !o.friend ? r.color : c, friend: Boolean(o.friend), clone: Boolean(o.clone) }, id).toEqual({
            avatar: r.clone && !r.friend ? "hood" : r.avatar,
            color: r.color,
            friend: r.friend,
            clone: r.clone,
          });
        }
      }
    }
    // your own are as they were
    expect(imageSpec("mineclone-doctor-pink")).toEqual(["pink", { avatar: "doctor", mine: true, clone: true, friend: false }]);
    expect(imageSpec("friend-doctor-pink")).toEqual(["pink", { avatar: "doctor", mine: false, clone: false, friend: true }]);
  });
});
