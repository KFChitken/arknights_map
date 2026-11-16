import season from "@/data/squad-season.json";
import { SERVERS } from "./games";

/**
 * 一起卫戍: rooms where players of 卫戍协议 find each other for its 联合模拟 (four at most, the host one of them), switched
 * by SQUAD (src/lib/server/env.ts). A host opens one with the 同盟密钥 they made in the game, its server and 难度, at
 * most TAGS_MAX words for how they want to play, and whether anyone may come or only their 触须之交; the list shows the
 * rooms waiting for players and those playing, each with every seat's 卫戍名片, and only the host by name (a 触须之交 of
 * the one looking too). Those in a room see the key, each other's names and cards, and can say a few set lines
 * (PHRASE_ROWS); nobody writes anything of their own but the key. A room is never on the map, and is deleted KEEP_MS
 * after it ends (src/lib/server/squad.ts).
 *
 * The season's alliances and strategies are in src/data/squad-season.json, by id: what a card or a room keeps is ids
 * alone, and an id a later season drops reads as none (cardNow). Their names are the game's own, in Chinese, as the
 * operators' are.
 */

// ---- the season ----

export type SquadNamed = { id: number; name: string; gone?: boolean };
/** A starting strategy: the operator who offers it and its name; core, the core alliance it belongs to (盟约型) */
export type SquadStrategy = { id: number; op: string; name: string; core?: number; gone?: boolean };

/** The season's name, as the game has it */
export const SEASON_NAME: string = season.season.name;
export const CORES: readonly SquadNamed[] = season.cores;
export const EXTRAS: readonly SquadNamed[] = season.extras;
export const STRATEGIES: readonly SquadStrategy[] = season.strategies;

/** 无偏好: a core alliance chosen as none in particular (the card needs one or this) */
export const NO_CORE = 0;
/** A card's extra alliances, at most */
export const EXTRAS_MAX = 2;

const byId = <T extends { id: number; gone?: boolean }>(list: readonly T[]) => new Map(list.filter((x) => !x.gone).map((x) => [x.id, x]));
const coreById = byId(CORES);
const extraById = byId(EXTRAS);
const strategyById = byId(STRATEGIES);

export const coreOf = (id: number) => coreById.get(id) ?? null;
export const extraOf = (id: number) => extraById.get(id) ?? null;
export const strategyOf = (id: number) => strategyById.get(id) ?? null;

/** 卫戍名片: a core alliance (or NO_CORE), a strategy or none, and up to EXTRAS_MAX extra alliances, all by id */
export type SquadCard = { core: number; strategy: number | null; extras: number[] };

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 32_767;

/** A card as a request gives it, or null when it is not one of this season's */
export function readCard(v: unknown): SquadCard | null {
  if (!v || typeof v !== "object") return null;
  const { core, strategy, extras } = v as Record<string, unknown>;
  if (!isId(core) || (core !== NO_CORE && !coreOf(core))) return null;
  if (strategy !== null && strategy !== undefined && (!isId(strategy) || !strategyOf(strategy))) return null;
  if (extras !== undefined && !Array.isArray(extras)) return null;
  const list = (extras ?? []) as unknown[];
  if (list.length > EXTRAS_MAX || !list.every((e) => isId(e) && extraOf(e)) || new Set(list).size !== list.length) return null;
  return { core, strategy: (strategy as number | null | undefined) ?? null, extras: list as number[] };
}

/** A card as kept (null: never filled in), read against this season: what it no longer has reads as none */
export function cardNow(core: number | null, strategy: number | null, extras: readonly number[]): SquadCard | null {
  if (core === null) return null;
  return {
    core: core === NO_CORE || coreOf(core) ? core : NO_CORE,
    strategy: strategy !== null && strategyOf(strategy) ? strategy : null,
    extras: extras.filter((e) => extraOf(e)).slice(0, EXTRAS_MAX),
  };
}

// ---- a room ----

export const SQUAD_MAX = 4;
/** 难度, by id: 入门协议, 标准模拟, 险境模拟, 绝境模拟, 终极模拟 (T.squad.levels) */
export const LEVELS = [1, 2, 3, 4, 5] as const;
/** How the host wants to play, by id (T.squad.tags), at most TAGS_MAX of them */
export const TAGS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const TAGS_MAX = 2;
/** The game's servers (src/lib/games.ts), each its own rooms */
export const SQUAD_SERVERS: readonly string[] = SERVERS.arknights.map((s) => s.id);
export const DEFAULT_SERVER = "cn";

export const isLevel = (v: unknown): v is number => LEVELS.includes(v as (typeof LEVELS)[number]);
export const isTag = (v: unknown): v is number => TAGS.includes(v as (typeof TAGS)[number]);
export const isSquadServer = (v: unknown): v is string => typeof v === "string" && SQUAD_SERVERS.includes(v);

/**
 * The game's 同盟密钥, and its alliance's short life: the one place both are written down (only one key has been seen,
 * and the game's countdown not checked; either may change). A key is KEY_LEN lowercase letters and digits. What is
 * pasted may carry other words around it (the game's 复制), so the key is the first run of exactly KEY_LEN letters and
 * digits standing alone in it (or, failing that, once spaces are taken out), kept in lowercase.
 */
export const KEY_LEN = 14;
const KEY_FORM = /^[a-z0-9]{14}$/;
const KEY_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z0-9]{14}(?![A-Za-z0-9])/;
export const isKey = (s: string) => KEY_FORM.test(s);
/** The key in what was pasted, or null when there is none */
export function findKey(text: string): string | null {
  const found = KEY_IN_TEXT.exec(text) ?? KEY_IN_TEXT.exec(text.replace(/\s+/g, ""));
  return found ? found[0].toLowerCase() : null;
}
/** The game's alliance destroys itself about this long after it is made: a key this old may be gone */
export const KEY_OLD_MS = 15 * 60_000;
/** A host still waiting is reminded this long after the key was pasted to make the alliance again and paste the new one */
export const KEY_WARN_MS = 13 * 60_000;
/** A room's key changed by its host this often at most, and so many times in all */
export const KEY_EVERY_MS = 60_000;
export const KEY_CHANGES = 30;

/** wait: on the list, open to come in; go: playing, at the bottom of the list, closed */
export type SquadState = "wait" | "go";
/** Why a room ended: its host (结束, leaving), nobody came or went (idle), played on too long (go), open too long (life), the 管理台 (admin) */
export type SquadEnd = "host" | "idle" | "go" | "life" | "admin";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/**
 * Waiting this long with nothing happening, the room ends: someone coming in or going, the host pasting a new key or
 * tapping 等人 again starts it over. As long as the game's alliance lasts (KEY_OLD_MS), so the list holds few rooms
 * whose key is gone.
 */
export const WAIT_IDLE_MS = KEY_OLD_MS;
/** 等人 tapped again, to start the wait over, this often at most */
export const REWAIT_MS = 10 * MINUTE;
/** Playing (开打) this long since it was last tapped, the room ends */
export const GO_MAX_MS = 3 * HOUR;
/** Open this long, a room ends whatever it does */
export const LIFE_MS = 6 * HOUR;
/** An ended room, who was in it and what they chose there, is deleted this long after */
export const KEEP_MS = 24 * HOUR;
/** The host switches between 等人 and 开打 this often at most */
export const STATE_EVERY_MS = 10_000;
/** A room's own card changed this often at most */
export const PREFS_EVERY_MS = 10_000;

/** Opening rooms: this often at most, and so many a site day (04:00 Beijing) */
export const OPEN_EVERY_MS = 2 * MINUTE;
export const OPENS_PER_DAY = 6;
/** Going in at rooms (not one's own): so many an hour at most */
export const JOINS_PER_HOUR = 20;

/** The list asks again this often while it is in sight, and stops after LIST_IDLE_MS untouched */
export const LIST_EVERY_MS = 30_000;
export const LIST_IDLE_MS = 5 * MINUTE;
/** Rooms on the list at most */
export const LIST_MAX = 30;

// ---- what is said in a room ----

/** The set lines (T.squad.say), by row; each is sent by its number */
export const PHRASE_ROWS = [
  ["team", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ["fight", [10, 11, 12, 13, 14, 15, 16]],
  ["after", [17, 18, 19, 20, 21]],
] as const;
export type PhraseRow = (typeof PHRASE_ROWS)[number][0];
const PHRASES = new Set<number>(PHRASE_ROWS.flatMap(([, ids]) => ids));
export const isPhrase = (v: unknown): v is number => Number.isInteger(v) && PHRASES.has(v as number);
/** One line every SAY_EVERY_MS, and SAY_PER_HOUR an hour, each player */
export const SAY_EVERY_MS = 3_000;
export const SAY_PER_HOUR = 60;
/** The same line said by several within this long shows once, ×N */
export const SAY_MERGE_MS = 1_500;
/** A line, or what the site says there, floats this long */
export const SAY_SHOW_MS = 3_000;

// ---- what the page gets ----

/** How a roach looks, for a seat or a member */
export type SquadLook = { avatar: string; color: string };

/** A seat on the list: the host; the viewer; one of the viewer's 触须之交, named; or a teammate, never named */
export type SquadSeat = { role: "host" | "you" | "friend" | "mate"; name?: string } & SquadCard;

export type SquadListRoom = {
  id: string;
  host: { name: string; friend: boolean } & SquadLook;
  server: string;
  level: number;
  tags: number[];
  state: SquadState;
  friendsOnly: boolean;
  seats: SquadSeat[];
  /** When it was opened (ms) */
  at: number;
  /** When its key was pasted (ms): one KEY_OLD_MS old may be gone */
  keyAt: number;
  /** Its host or one in it is a 触须之交 of the viewer's */
  friend: boolean;
  /** The viewer is in it */
  mine: boolean;
};

/** GET /api/squad/list: rooms waiting first (those with 触须之交 first, then those missing fewest, the freshest key first), then those playing */
export type SquadList = {
  rooms: SquadListRoom[];
  /** The server the list is of: as asked, or the viewer's own */
  server: string;
  /** 一起卫戍 is closed for now from the 管理台, with the 站长's line (null: open) */
  closed: string | null;
  now: number;
};

export type SquadMember = {
  h: number;
  name: string;
  host: boolean;
  you: boolean;
  friend: boolean;
  /** 我进同盟了: ticked by them */
  inGame: boolean;
} & SquadLook &
  SquadCard;

/** The room as one in it sees it */
export type SquadRoom = {
  id: string;
  server: string;
  level: number;
  tags: number[];
  state: SquadState;
  friendsOnly: boolean;
  key: string;
  /** When it was pasted (ms) */
  keyAt: number;
  /** Changes of the key left to the host */
  keyLeft: number;
  /** Your number in it */
  you: number;
  host: boolean;
  members: SquadMember[];
  /** When it ends by itself unless something happens (ms), and why it would */
  endsAt: number;
  endsWhy: Exclude<SquadEnd, "host" | "admin">;
  /** The host: when 等人 may start the wait over again (ms) */
  rewaitAt: number;
  now: number;
};

/** What a room's phones are told (the event stream's "squad"): look again, with what changed; lines said; it ended; you are out */
export type SquadTell =
  | { t: "room"; room: string; what?: { kind: "in" | "game" | "key" | "state"; h?: number; to?: SquadState } }
  | { t: "say"; room: string; items: { h: number; p: number }[] }
  | { t: "end"; room: string; why: SquadEnd }
  | { t: "you"; room: string; why: "kicked" | "left" };

/** What me() carries, to a player 一起卫戍 is open to (SQUAD) who plays 明日方舟 or no game yet */
export type SquadMe = {
  card: SquadCard | null;
  /** In a room now */
  room: boolean;
  /** Closed for now, with the 站长's line */
  closed: string | null;
};

/** The 管理台's 一起卫戍 (the owner's): the switch, closed for now with the line, rooms now, and today's numbers (Beijing time) */
export type SquadDesk = {
  mode: "on" | "admins" | "off";
  closed: boolean;
  note: string;
  waiting: number;
  playing: number;
  opened: number;
  joins: number;
  says: number;
};

// ---- refusals the page acts on (HttpError codes) ----

export const SQUAD_CLOSED = "squadClosed";
export const NEED_CARD = "squadCard";
export const ROOM_GONE = "squadGone";
export const ROOM_FULL = "squadFull";
export const ROOM_SHUT = "squadShut";
export const ROOM_PLAYING = "squadPlaying";
export const NOT_IN_ROOM = "squadNotIn";
