import { fmt, T } from "@/i18n";
import { GUIDES } from "./guides";
import { FRIEND, HEART } from "./roachSvg";
import type { LngLat } from "./types";
import type { HaimaoItem, PublicRoach } from "./world/types";

/**
 * 香艳制作人: the sixth guide (src/lib/guides.ts), a players' joke come to the map. She stands by the
 * road outside a tower in 漕河泾, Shanghai, with a black-tailed gull (海猫) on her head and purple
 * tentacles under her. She is nobody real and speaks for nobody: her card and her introduction say
 * so in so many words. Only those HAIMAO lets her show to see her (src/lib/server/haimao.ts).
 *
 * She keeps a 好感度 for each player, from 0 to HAIMAO_LOVE_MAX, which only ever goes up: their first
 * bold touch of a day raises it by HAIMAO_BOLD_LOVE. Touch her and she answers as every guide does,
 * once a day, and always the touch that makes you 触须之交 and the day's first bold one. She never
 * reaches out on her own.
 *
 * Everything she says is word for word as Breeze approved it.
 */

export const HAIMAO = GUIDES.haimao;
export const HAIMAO_ID = HAIMAO.id;

export const isHaimaoItem = (id: string) => id.startsWith(HAIMAO.prefix);

/**
 * Where she stands: on the footpath two metres off the west wall of 漕河泾中心 A栋 (古美路 1520 号), between it
 * and B1栋, some 45 m north of exit 7 of Hongmei Road station, line 12. Read off Amap at levels 19–20 as
 * GCJ-02 121.398759, 31.161832 and checked against the building outlines; WGS84 here.
 */
export const HAIMAO_AT: LngLat = { lng: 121.394115, lat: 31.163701 };
/** Flying to her stops here (MapLibre levels), close enough to tell her from the roaches round her */
export const HAIMAO_ZOOM = 17;

/**
 * Her Q figure (Breeze's, 11/18) in five layers, back to front, each picture's box on the 64 grid of HAIMAO_VIEWBOX,
 * measured from her original (1254 px square: grid = px × 0.04798 + (2.51, −2.38)). The tentacles and the gull turn
 * about pivots globals.css gives as shares of the layer's own box (.hm-tl, .hm-tr, .hm-gl).
 */
export const HAIMAO_LAYERS = [
  { part: "shadow", x: 19.4, y: 52.27, w: 25.43, h: 4.17 },
  { part: "tl", x: 14.46, y: 40.71, w: 10.22, h: 8.01 },
  { part: "tr", x: 39.37, y: 40.66, w: 10.46, h: 11.28 },
  { part: "body", x: 12.69, y: 6.73, w: 38.63, h: 48.85 },
  { part: "gull", x: 26.55, y: -0.94, w: 12.81, h: 10.27 },
] as const;
export type HaimaoPart = (typeof HAIMAO_LAYERS)[number]["part"];
/** Her figure's frame: the 64 grid a little lower, for her gull's head; her feet are then where a roach's are */
export const HAIMAO_VIEWBOX = "0 -3 64 64";
/** A layer's picture, served from the server's own folder (src/app/guide-art) like the other guides' */
export const haimaoLayerUrl = (part: HaimaoPart) => `/guide-art/haimao-${part}.webp?v=1`;

/** Which of her layers move: the classes globals.css turns them by */
const MOVES: Partial<Record<HaimaoPart, string>> = { tl: "hm-l hm-tl", tr: "hm-l hm-tr", gull: "hm-l hm-gl" };
/** A layer's class: the tentacles and the gull move, the shadow and the body stay */
export const haimaoLayerClass = (part: HaimaoPart) => MOVES[part] ?? `hm-${part}`;

/**
 * The silver microphone in her hand as she sings dame dame (the design's #hm-sing, drawn in code): over her body,
 * under her gull, shown under .singing (globals.css). Fixed markup.
 */
export const HAIMAO_MIC = `<g class="hm-mic" transform="translate(19.6 23.6) rotate(27) scale(1.3)"><rect x="-.6" y="-.95" width="8.2" height="1.9" rx=".9" fill="#7b3fe0" stroke="#0d0e10" stroke-width=".5"/><rect x="5.5" y="-1.15" width="1.3" height="2.3" rx=".3" fill="#f4f2f7" stroke="#0d0e10" stroke-width=".4"/><circle cx="9.4" cy="0" r="2.3" fill="#cfccd8" stroke="#0d0e10" stroke-width=".55"/><path d="M7.6 -1.2 Q9.4 -.4 11.2 -1.2 M7.3 0 H11.5 M7.6 1.2 Q9.4 .4 11.2 1.2 M9.4 -2.2 V2.2" stroke="#8a8596" stroke-width=".3" fill="none"/><circle cx="8.6" cy="-1" r=".6" fill="#ffffff" opacity=".9"/></g>`;

/**
 * Her figure as SVG markup, for her map marker: her shadow, then the other four layers with her microphone between
 * her body and her gull, in a group that sways as she sings (.hm-sway: inside the figure, which is painted on its own),
 * a pink ground in place of her shadow and a heart over her for a 触须之交 (shown under .friend, globals.css). Fixed
 * markup, nothing a player wrote in it.
 */
export function haimaoFigureSvg() {
  const layer = (l: (typeof HAIMAO_LAYERS)[number]) =>
    `${l.part === "gull" ? HAIMAO_MIC : ""}<image class="${haimaoLayerClass(l.part)}" href="${haimaoLayerUrl(l.part)}" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" preserveAspectRatio="none"/>`;
  const shadow = HAIMAO_LAYERS.filter((l) => l.part === "shadow").map(layer).join("");
  const her = HAIMAO_LAYERS.filter((l) => l.part !== "shadow").map(layer).join("");
  const ground = `<ellipse class="hm-ground" cx="32" cy="54.4" rx="15" ry="3.2" fill="${FRIEND}" stroke="#1b1d22" stroke-width="1.2"/>`;
  return `<svg class="hm-fig" viewBox="${HAIMAO_VIEWBOX}" aria-hidden="true">${ground}${shadow}<g class="hm-sway">${her}</g><g class="hm-heart">${HEART}</g></svg>`;
}

/** Her 好感度 never goes past this */
export const HAIMAO_LOVE_MAX = 100;
/** What the first bold touch of a player's day adds to it */
export const HAIMAO_BOLD_LOVE = 1;
/** Past this 好感度, now and then (one answer in HAIMAO_LIFT_ONE_IN), her answer to a sneaky touch is her line about the lift */
export const HAIMAO_LIFT_FROM = 50;
export const HAIMAO_LIFT_ONE_IN = 3;

/** Her 好感度 after adding some, never past the top */
export const addLove = (love: number, more: number) => Math.min(HAIMAO_LOVE_MAX, Math.max(0, love) + Math.max(0, more));

/** Her lines, word for word as Breeze approved them */
export const HAIMAO_LINES = {
  get sneaky() {
    return T.lib.haimao.line.sneaky;
  },
  get friend() {
    return T.lib.haimao.line.friend;
  },
  get plus() {
    return T.lib.haimao.line.plus;
  },
  get lift() {
    return T.lib.haimao.line.lift;
  },
  get tooMany() {
    return T.lib.guides.haimao.tooMany;
  },
  /** On her card and her introduction, word for word */
  get disclaimer() {
    return T.lib.haimao.disclaimer;
  },
  get signature() {
    return T.lib.haimao.signature;
  },
  get introCard() {
    return T.lib.haimao.introCard;
  },
  /** What her gull says when tapped */
  get meow() {
    return T.lib.haimao.meow;
  },
};

/** Her kinds of answer (haimao_touches.kind, src/lib/server/schema.ts) */
export type HaimaoAnswer = HaimaoItem["line"];

/** What she says back to a touch, by the kind of answer the server gave */
export function haimaoTouchLine(what: HaimaoAnswer) {
  switch (what) {
    case "friend":
      return HAIMAO_LINES.friend;
    case "plus":
      return HAIMAO_LINES.plus;
    case "lift":
      return HAIMAO_LINES.lift;
    default:
      return HAIMAO_LINES.sneaky;
  }
}

/** One of hers in the inbox, in her own words. */
export function haimaoText(item: Pick<HaimaoItem, "line">) {
  return fmt(T.lib.guides.answered, { name: HAIMAO.name, line: haimaoTouchLine(item.line) });
}

export function haimaoRoach(friend: boolean): PublicRoach {
  return { id: HAIMAO_ID, clone: false, avatar: HAIMAO.avatar, color: HAIMAO.color, friend, guide: true, ...HAIMAO_AT };
}
