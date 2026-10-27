import { FOODS, type Declaration } from "../declarations";
import { findLine } from "../events";
import { distanceKm } from "../geo";
import { GAMES, isGame, type Game } from "../games";
import { isOperator } from "../operators";
import { displayName, EMPTY_PROFILE, type Profile, type PublicProfile } from "../profile";
import { DECLARATION_RADIUS_KM, MAX_FAVOURITES, NAME_MAX, RADAR_RADIUS_KM, UID_MAX } from "../rules";
import { titlesFor } from "../titles";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
import type { Move } from "./cast";
import { WorldError, type PlayerId, type RadarScan, type RadarWindow } from "./types";

/** Pure rules the server world applies, kept apart so they are easy to test and reuse. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Check and tidy a profile a player wants to save. */
export function normalizeProfile(input: Profile): Profile {
  const name = String(input.name ?? "")
    .trim()
    .slice(0, NAME_MAX);
  const games = GAMES.filter((g) => input.games?.includes(g));
  const favourites = { arknights: [] as string[], endfield: [] as string[] };
  const uid = { arknights: "", endfield: "" };
  for (const g of games) {
    favourites[g] = [...new Set(input.favourites?.[g] ?? [])]
      .filter((n) => isOperator(g, n))
      .slice(0, MAX_FAVOURITES);
    const u = String(input.uid?.[g] ?? "").trim();
    if (u.length > UID_MAX || !/^[0-9A-Za-z#_-]*$/.test(u)) {
      throw new WorldError("UID 只能填数字、字母和 #，最多 20 个字符。");
    }
    uid[g] = u;
  }
  const anonymous = Boolean(input.anonymous);
  if (!anonymous && !name) throw new WorldError("想显示名字的话，先填一个名字吧。");
  return {
    anonymous,
    name,
    drPrefix: Boolean(input.drPrefix),
    games,
    favourites,
    uid,
    shareUid: Boolean(input.shareUid),
    avatar: ROACH_AVATARS.includes(input.avatar) ? input.avatar : EMPTY_PROFILE.avatar,
    color: ROACH_COLORS.includes(input.color) ? input.color : EMPTY_PROFILE.color,
  };
}

/** What a player shows of themselves when they touch someone boldly or befriend them. */
export function publicProfileOf(p: Profile): PublicProfile {
  const uid: Partial<Record<Game, string>> = {};
  if (p.shareUid) for (const g of p.games) if (p.uid[g]) uid[g] = p.uid[g];
  return {
    displayName: displayName(p),
    games: p.games,
    favourites: {
      arknights: p.games.includes("arknights") ? p.favourites.arknights : [],
      endfield: p.games.includes("endfield") ? p.favourites.endfield : [],
    },
    uid: Object.keys(uid).length ? uid : undefined,
    avatar: p.avatar,
    color: p.color,
  };
}

/**
 * A declaration may only use the sender's own favourites, the listed titles
 * and foods, their own name, and limited-time lines that are on.
 */
export function checkDeclaration(profile: Profile, d: Declaration, now = Date.now()): Declaration {
  const favourite = (character: unknown) => {
    const name = String(character ?? "");
    const game = GAMES.find((g) => profile.games.includes(g) && profile.favourites[g].includes(name));
    if (!game) throw new WorldError("只能选你资料里的厨力角色。");
    return { game, character: name };
  };
  switch (d?.template) {
    case "launch":
    case "welcome":
      if (isGame(d.game)) return { template: d.template, game: d.game };
      break;
    case "myname":
      if (!isGame(d.game)) break;
      if (profile.anonymous || !profile.name.trim()) throw new WorldError("这句要先在资料里填名字，并且不选匿名。");
      return { template: "myname", game: d.game, name: displayName(profile) };
    case "iam": {
      const { game, character } = favourite(d.character);
      if (!titlesFor(game).includes(d.title)) throw new WorldError("这个称呼不在列表里。");
      return { template: "iam", character, title: d.title };
    }
    case "love":
    case "buff":
    case "canyou":
      return { template: d.template, character: favourite(d.character).character };
    case "eat": {
      const { character } = favourite(d.character);
      if (!FOODS.includes(d.food)) throw new WorldError("这个吃的不在列表里。");
      return { template: "eat", character, food: d.food };
    }
    case "birthday":
      return { template: "birthday" };
    case "event": {
      const found = findLine(String(d.line ?? ""));
      if (!found) break;
      if (now < Date.parse(found.line.start)) throw new WorldError("这句限定宣言还没开始。");
      if (now >= Date.parse(found.line.end)) throw new WorldError("这句限定宣言已经结束啦。");
      return { template: "event", line: found.line.id };
    }
  }
  throw new WorldError("选一句宣言吧。");
}

export function checkSpot(spot: LngLat): LngLat {
  const at = { lng: Number(spot?.lng), lat: Number(spot?.lat) };
  if (!Number.isFinite(at.lng) || !Number.isFinite(at.lat) || Math.abs(at.lat) > 85 || Math.abs(at.lng) > 180) {
    throw new WorldError("这个位置放不了蟑螂。");
  }
  return at;
}

export function reachText(n: number) {
  const km = `${DECLARATION_RADIUS_KM} 公里内`;
  if (n === 0) return `${km}暂时没有别的舟P，宣言飘向了远方……`;
  if (n < 5) return `${km}有不到 5 只舟P收到了你的宣言。`;
  for (const [lo, hi] of [
    [5, 10],
    [10, 20],
    [20, 50],
  ]) {
    if (n < hi) return `${km}有 ${lo}–${hi} 只舟P收到了你的宣言。`;
  }
  return `${km}有 50 多只舟P收到了你的宣言！`;
}

/** Inputs for the radar: everything is already limited to other players. */
export type RadarInput = {
  center: LngLat;
  now: number;
  /** Other players' roaches at their public positions */
  roaches: { owner: PlayerId; slot: number; at: LngLat }[];
  /** Other players' placements, moves and removals in the last week */
  moves: Move[];
  /** Receivers of touches and senders of declarations in the last 24 hours */
  touchedPlayers: PlayerId[];
  declaringPlayers: PlayerId[];
  friends: Set<PlayerId>;
  demo: boolean;
};

export function buildRadar(r: RadarInput): RadarScan {
  const inside = (p: LngLat | null) => Boolean(p && distanceKm(r.center, p) <= RADAR_RADIUS_KM);
  const near = r.roaches.filter((x) => inside(x.at));
  const nearOwners = new Set(near.map((x) => x.owner));

  // Arrivals and departures across the circle's edge
  const crossings = r.moves.flatMap((m) => {
    const wasIn = inside(m.from);
    const isIn = inside(m.to);
    if (wasIn === isIn) return [];
    return [{ at: m.at, arrived: isIn, newcomer: isIn && !m.from && m.slot === 0, clone: m.slot > 0 }];
  });
  const tally = (since: number): RadarWindow => {
    const w = crossings.filter((c) => c.at > since);
    return {
      arrived: w.filter((c) => c.arrived).length,
      left: w.filter((c) => !c.arrived).length,
      newcomers: w.filter((c) => c.newcomer).length,
      clones: w.filter((c) => c.arrived && c.clone).length,
    };
  };
  const midnight = new Date(r.now);
  midnight.setHours(0, 0, 0, 0);
  const daily = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(midnight);
    start.setDate(start.getDate() - (6 - i));
    const from = start.getTime();
    const to = i === 6 ? Infinity : from + DAY;
    const w = crossings.filter((c) => c.at >= from && c.at < to);
    return { start: from, arrived: w.filter((c) => c.arrived).length, left: w.filter((c) => !c.arrived).length };
  });
  // a loop, not Math.max(...): spreading a hundred thousand arguments overflows the stack
  let lastArrivalAt: number | null = null;
  for (const c of crossings) if (c.arrived && (lastArrivalAt === null || c.at > lastArrivalAt)) lastArrivalAt = c.at;

  return {
    radiusKm: RADAR_RADIUS_KM,
    roaches: near.length,
    clones: near.filter((x) => x.slot > 0).length,
    players: nearOwners.size,
    day: tally(r.now - DAY),
    week: tally(r.now - 7 * DAY),
    daily,
    touches: r.touchedPlayers.filter((p) => nearOwners.has(p)).length,
    declarations: r.declaringPlayers.filter((p) => nearOwners.has(p)).length,
    friendsNearby: [...r.friends].filter((f) => nearOwners.has(f)).length,
    lastArrivalAt,
    demo: r.demo,
  };
}
