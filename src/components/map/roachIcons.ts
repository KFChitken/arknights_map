import type { RoachOpts } from "@/lib/roachSvg";
import { LEG_PHASES } from "@/lib/swarm";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { PublicRoach } from "@/lib/world/types";
import type { MapViewProps } from "./types";

// The overseas map's roach icons (MaplibreView.tsx): which icon each roach shows, as a style expression on its
// feature (features.ts roachFeature), and how each icon is drawn. The cartoon roach faces the viewer and only
// tilts; the real one is top-down and can face any way. Strangers' clones share one see-through look whatever
// their owner's; a 触须之交's wear TA's look (MapApp gives it them); 触须之交 get a pink ground and a heart.

export function roachImage(look: RoachStyle) {
  if (look === "real") {
    // the walking icons come in LEG_PHASES out-of-step copies, picked per roach
    return [
      "concat",
      [
        "case",
        ["get", "friend"],
        ["case", ["get", "clone"], "friendclone-real", "friend-real"],
        ["case", ["get", "clone"], "clone-real", "real"],
      ],
      "-p",
      ["to-string", ["get", "lp"]],
    ];
  }
  const icon = (kind: unknown) => ["concat", kind, "-", ["get", "avatar"], "-", ["get", "color"]];
  return [
    "case",
    ["get", "friend"],
    icon(["case", ["get", "clone"], "friendclone", "friend"]),
    ["case", ["get", "clone"], "clone", icon("roach")],
  ];
}
export function roachRotate(look: RoachStyle) {
  return look === "real" ? ["get", "heading"] : ["get", "rot"];
}
/** A sleeping main roach (never a clone): sleep-<roach|friend>-<avatar>-<color>, or sleep-real / sleep-friend-real */
export function sleepImage(look: RoachStyle) {
  return look === "real"
    ? ["case", ["get", "friend"], "sleep-friend-real", "sleep-real"]
    : ["concat", ["case", ["get", "friend"], "sleep-friend-", "sleep-roach-"], ["get", "avatar"], "-", ["get", "color"]];
}
/** The cartoon one lies already tilted; the realistic one keeps facing its own way. */
export function sleepRotate(look: RoachStyle) {
  return look === "real" ? ["get", "heading"] : 0;
}
export function mineImage(look: RoachStyle) {
  const awake =
    look === "real"
      ? ["case", [">", ["get", "slot"], 0], "mineclone-real", "mine-real"]
      : ["concat", ["case", [">", ["get", "slot"], 0], "mineclone-", "mine-"], ["get", "avatar"], "-", ["get", "color"]];
  const asleep = look === "real" ? "sleep-mine-real" : ["concat", "sleep-mine-", ["get", "avatar"], "-", ["get", "color"]];
  return ["case", ["get", "asleep"], asleep, awake];
}

/**
 * Icon ids: real-p<n> / clone-real-p<n> / ... for the walking realistic roach,
 * mine-real and mineclone-real for your own (which keep still), clone for
 * strangers' clones, and <roach|friend|friendclone|mine|mineclone>-<avatar>-<color>
 * for everything else (a 触须之交's clones in TA's look).
 */
export const WALKING = /^(.*real)-p(\d+)$/;

export function imageSpec(id: string): [RoachColor, RoachOpts] {
  if (id.startsWith("sleep-")) {
    const [color, opts] = imageSpec(id.slice("sleep-".length));
    return [color, { ...opts, asleep: true }];
  }
  const walking = WALKING.exec(id);
  if (walking) return imageSpec(walking[1]);
  if (id.endsWith("real")) {
    const kind = id.slice(0, -"real".length);
    const flags = { mine: kind.startsWith("mine"), friend: kind.startsWith("friend"), clone: kind.includes("clone") };
    return ["cyan", { look: "real", ...flags }];
  }
  if (id === "clone" || id === "friendclone") return ["white", { clone: true, friend: id === "friendclone" }];
  const [kind, avatar, color] = id.split("-") as [string, RoachAvatar, RoachColor];
  return [color, { avatar, mine: kind.startsWith("mine"), clone: kind.endsWith("clone"), friend: kind.startsWith("friend") }];
}

/**
 * The icons the current data needs, so only those get drawn: those of your own roaches, and of the crowd
 * given (all of it, or only its roaches new since the map last had it, whose icons may be new).
 */
export function neededImages(
  p: Pick<MapViewProps, "mine" | "mineAsleep" | "ghost" | "myAvatar" | "myColor" | "look">,
  crowd: readonly PublicRoach[],
) {
  const ids = new Set<string>();
  if (p.look === "real") {
    for (const id of ["real", "clone-real", "friend-real", "friendclone-real"]) {
      for (let n = 0; n < LEG_PHASES; n++) ids.add(`${id}-p${n}`);
    }
    ids.add("mine-real");
    ids.add("mineclone-real");
    for (const id of ["sleep-real", "sleep-friend-real", "sleep-mine-real"]) ids.add(id);
    return ids;
  }
  for (const r of crowd) {
    if (r.clone) ids.add(r.friend ? `friendclone-${r.avatar}-${r.color}` : "clone");
    else ids.add(`${r.asleep ? "sleep-" : ""}${r.friend ? "friend" : "roach"}-${r.avatar}-${r.color}`);
  }
  for (const r of p.mine) {
    const sleeps = r.slot === 0 && p.mineAsleep;
    ids.add(`${sleeps ? "sleep-" : ""}${r.slot > 0 ? "mineclone" : "mine"}-${p.myAvatar}-${p.myColor}`);
  }
  if (p.ghost) ids.add(`mine-${p.myAvatar}-${p.myColor}`);
  return ids;
}
