import { generateFakeRoaches } from "../fakeRoaches";
import type { Game } from "../games";
import { isOperator, OPERATORS } from "../operators";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { mulberry32 } from "../prng";
import type { LngLat, RoachAvatar, RoachColor } from "../types";
import type { PlayerId } from "./types";

/**
 * Stand-in players for trying the social features before real players exist:
 * a few named testers with clones, and thousands of passers-by (the demo swarm),
 * each a player with one roach and a generated profile.
 */

export type Passerby = LngLat & { id: PlayerId; index: number; color: RoachColor; city: string };

let passers: Passerby[] | null = null;
export function passersby(): Passerby[] {
  passers ??= generateFakeRoaches().map((r, index) => ({
    id: `n${index}`,
    index,
    lng: r.lng,
    lat: r.lat,
    color: r.color,
    city: r.city,
  }));
  return passers;
}

/** A roach arriving somewhere (from null: newly placed) or leaving (to null: taken back). */
export type Move = { owner: PlayerId; slot: number; from: LngLat | null; to: LngLat | null; at: number };

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

/**
 * Made-up recent history for the demo swarm, so the radar has something to
 * show: about a quarter of the passers-by arrived in the last week, most of
 * them new players and the rest moved over from where another passer-by is.
 * Times hang off the current hour, so the demo stays fresh but stable.
 */
export function passerbyMoves(now: number): Move[] {
  const anchor = Math.floor(now / HOUR) * HOUR;
  const all = passersby();
  const moves: Move[] = [];
  for (const p of all) {
    const rand = mulberry32(0xbeef + p.index * 7919);
    if (rand() > 0.25) continue;
    const at = anchor - Math.floor(rand() * WEEK);
    const from = rand() < 0.6 ? null : all[Math.floor(rand() * all.length)];
    moves.push({ owner: p.id, slot: 0, from: from && { lng: from.lng, lat: from.lat }, to: { lng: p.lng, lat: p.lat }, at });
  }
  return moves;
}

export function passerbyIndex(id: PlayerId) {
  const m = /^n(\d+)$/.exec(id);
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < passersby().length ? i : -1;
}

const NICKNAMES = [
  "摸鱼博士",
  "理智清零",
  "今天也在刷1-7",
  "基建狂魔",
  "寻访必出六星",
  "合约十八级",
  "咸鱼舟p",
  "罗德岛保洁",
  "抽卡非酋",
  "欧皇本皇",
  "剿灭三百",
  "塔卫二打工人",
  "终末地开荒中",
  "源石虫饲养员",
  "龙门近卫局",
  "炎国小吃部",
];

export function passerbyProfile(p: Passerby): Profile {
  const rand = mulberry32(0x5eed + p.index * 7919);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const r = rand();
  const games: Game[] = r < 0.65 ? ["arknights"] : r < 0.8 ? ["endfield"] : ["arknights", "endfield"];
  const favs = (g: Game) =>
    games.includes(g) ? [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(OPERATORS[g])))] : [];
  const anonymous = rand() < 0.4;
  const a = rand();
  const avatar: RoachAvatar = a < 0.4 ? "hood" : a < 0.6 ? "doctor" : a < 0.8 ? "endmin" : "imp";
  return {
    ...EMPTY_PROFILE,
    avatar,
    anonymous,
    name: pick(NICKNAMES),
    drPrefix: rand() < 0.5,
    games,
    favourites: { arknights: favs("arknights"), endfield: favs("endfield") },
    color: p.color,
  };
}

type Tester = { id: PlayerId; note: string; profile: Profile; roaches: LngLat[] };

function tester(
  id: PlayerId,
  note: string,
  roaches: LngLat[],
  p: Partial<Omit<Profile, "favourites" | "uid">> & {
    favourites?: Partial<Record<Game, string[]>>;
    uid?: Partial<Record<Game, string>>;
  },
): Tester {
  const fav = (g: Game) => (p.favourites?.[g] ?? []).filter((n) => isOperator(g, n));
  return {
    id,
    note,
    roaches,
    profile: {
      ...EMPTY_PROFILE,
      ...p,
      favourites: { arknights: fav("arknights"), endfield: fav("endfield") },
      uid: { arknights: p.uid?.arknights ?? "", endfield: p.uid?.endfield ?? "" },
    },
  };
}

/** Named test players. The first roach is the main one; the Shanghai ones sit within 10 km of each other. */
export const TESTERS: Tester[] = [
  tester(
    "t1",
    "本体在上海人民广场附近，克隆体在东京",
    [
      { lng: 121.4752, lat: 31.2329 },
      { lng: 139.7731, lat: 35.6984 },
    ],
    {
      anonymous: false,
      name: "阿白",
      drPrefix: true,
      games: ["arknights", "endfield"],
      favourites: { arknights: ["能天使", "德克萨斯"], endfield: ["佩丽卡"] },
      avatar: "doctor",
      color: "pink",
    },
  ),
  tester("t2", "上海徐家汇附近，匿名", [{ lng: 121.4378, lat: 31.1951 }], {
    name: "小林",
    games: ["endfield"],
    favourites: { endfield: ["陈千语", "管理员"] },
    avatar: "endmin",
    color: "green",
  }),
  tester(
    "t3",
    "本体在上海陆家嘴附近，克隆体在北京和纽约，愿意分享 UID",
    [
      { lng: 121.5019, lat: 31.2397 },
      { lng: 116.4551, lat: 39.9339 },
      { lng: -73.9857, lat: 40.7484 },
    ],
    {
      anonymous: false,
      name: "Kal",
      games: ["arknights"],
      favourites: { arknights: ["银灰", "史尔特尔", "W"] },
      uid: { arknights: "12345678" },
      shareUid: true,
      avatar: "imp",
      color: "gold",
    },
  ),
  tester("t4", "北京", [{ lng: 116.3912, lat: 39.9065 }], {
    anonymous: false,
    name: "夜莺厨",
    drPrefix: true,
    games: ["arknights"],
    favourites: { arknights: ["夜莺", "闪灵"] },
    color: "purple",
  }),
  tester(
    "t5",
    "本体在伦敦，克隆体在上海五角场",
    [
      { lng: -0.1246, lat: 51.5007 },
      { lng: 121.5137, lat: 31.3015 },
    ],
    {
      anonymous: false,
      name: "Lumi",
      games: ["arknights", "endfield"],
      favourites: { arknights: ["阿米娅"], endfield: ["艾尔黛拉", "莱万汀"] },
      avatar: "endmin",
      color: "gold",
    },
  ),
];
