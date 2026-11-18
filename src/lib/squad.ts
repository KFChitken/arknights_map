import season from "@/data/squad-season.json";
import { SERVERS } from "./games";
import type { QueueChange, RoomSchedule } from "./listen";
import type { PublicProfile } from "./profile";

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

/** 随机应变: a core alliance chosen as none in particular (the card needs one or this) */
export const NO_CORE = 0;

const byId = <T extends { id: number; gone?: boolean }>(list: readonly T[]) => new Map(list.filter((x) => !x.gone).map((x) => [x.id, x]));
const coreById = byId(CORES);
const extraById = byId(EXTRAS);
const strategyById = byId(STRATEGIES);

export const coreOf = (id: number) => coreById.get(id) ?? null;
export const extraOf = (id: number) => extraById.get(id) ?? null;
export const strategyOf = (id: number) => strategyById.get(id) ?? null;

/** What a seat shows, on the list and in a room: a core alliance (or NO_CORE) and a strategy or none (无偏好), by id */
export type SquadPicks = { core: number; strategy: number | null };
/** 卫戍名片: the picks a player takes into the rooms they open or go in at, and a 难度 or none (无偏好) */
export type SquadCard = SquadPicks & { level: number | null };

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 32_767;

/** Picks as a request gives them, or null when they are not this season's; anything else in it is ignored */
export function readPicks(v: unknown): SquadPicks | null {
  if (!v || typeof v !== "object") return null;
  const { core, strategy } = v as Record<string, unknown>;
  if (!isId(core) || (core !== NO_CORE && !coreOf(core))) return null;
  if (strategy !== null && strategy !== undefined && (!isId(strategy) || !strategyOf(strategy))) return null;
  return { core, strategy: (strategy as number | null | undefined) ?? null };
}

/** A card as a request gives it, or null when it is not one of this season's (the extras a card of before had are ignored) */
export function readCard(v: unknown): SquadCard | null {
  const picks = readPicks(v);
  if (!picks) return null;
  const { level } = v as Record<string, unknown>;
  if (level !== null && level !== undefined && !isLevel(level)) return null;
  return { ...picks, level: (level as number | null | undefined) ?? null };
}

/** Picks as kept, read against this season: what it no longer has reads as none */
export const picksNow = (core: number, strategy: number | null): SquadPicks => ({
  core: core === NO_CORE || coreOf(core) ? core : NO_CORE,
  strategy: strategy !== null && strategyOf(strategy) ? strategy : null,
});

/**
 * What one plays a round with (这局), marked in the room while it plays: the picks, and the 附加盟约 (extras) chosen in
 * the game, ROUND_EXTRAS_MAX at most. Only the room has it: the card stays as it is.
 */
export type SquadRound = SquadPicks & { extras: number[] };
export const ROUND_EXTRAS_MAX = 4;

/** A round as a request gives it (extras missing: none), or null when it is not this season's, or its extras too many or one twice */
export function readRound(v: unknown): SquadRound | null {
  const picks = readPicks(v);
  if (!picks) return null;
  const extras = (v as Record<string, unknown>).extras ?? [];
  if (!Array.isArray(extras) || extras.length > ROUND_EXTRAS_MAX || new Set(extras).size !== extras.length) return null;
  if (!extras.every((x) => isId(x) && extraOf(x))) return null;
  return { ...picks, extras: [...(extras as number[])] };
}

/** Extras as kept, read against this season: those it no longer has are left out */
export const extrasNow = (extras: readonly number[]) => extras.filter((x) => extraOf(x) !== null);

/** A card as kept (null: never filled in), read against this season */
export function cardNow(core: number | null, strategy: number | null, level: number | null): SquadCard | null {
  if (core === null) return null;
  return { ...picksNow(core, strategy), level: level !== null && isLevel(level) ? level : null };
}

/**
 * Two picks clash when they name the same strategy (a strategy's operator joins one player a round); none (无偏好)
 * never does, nor one core alliance taken twice. The one rule, for the page and the server alike.
 */
export const sameStrategy = (a: number | null, b: number | null) => a !== null && a === b;

/** Every pair in a room whose strategies clash (sameStrategy), each once */
export function squadClash<T extends { strategy: number | null }>(members: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  members.forEach((a, i) => members.slice(i + 1).forEach((b) => sameStrategy(a.strategy, b.strategy) && pairs.push([a, b])));
  return pairs;
}

/**
 * What keeps a room from starting its round (开始游戏): nobody in it but the host (alone), those not ready (准备, the
 * host needs not), and strategies that clash. The one rule, for the page and the server alike.
 */
export function notYet<T extends { host: boolean; inGame: boolean; strategy: number | null }>(members: readonly T[]) {
  return { alone: members.length < 2, notReady: members.filter((m) => !m.host && !m.inGame), clashes: squadClash(members) };
}
export const mayStart = (y: ReturnType<typeof notYet>) => !y.alone && y.notReady.length === 0 && y.clashes.length === 0;

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
/** Why a room ended: its host (销毁房间, or leaving), nothing happened (idle), played on too long (go), open too long (life), the 管理台 (admin) */
export type SquadEnd = "host" | "idle" | "go" | "life" | "admin";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/**
 * Waiting this long with nothing happening, the room ends: someone coming in or going, readying (准备) or changing
 * their picks, the host pasting a new key or ending a round (结束这局) starts it over. As long as the game's alliance
 * lasts (KEY_OLD_MS), so the list holds few rooms whose key is gone.
 */
export const WAIT_IDLE_MS = KEY_OLD_MS;
/** Playing this long since its round started (开始游戏), the room ends */
export const GO_MAX_MS = 3 * HOUR;
/** Open this long, a room ends whatever it does */
export const LIFE_MS = 6 * HOUR;
/** An ended room, who was in it and what they chose there, is deleted this long after */
export const KEEP_MS = 24 * HOUR;
/** The host starts a round (开始游戏) or ends it (结束这局) this often at most */
export const STATE_EVERY_MS = 10_000;
/** One's picks in a room (and the round's extras) changed this often at most; the page sends the last of a few taps */
export const PREFS_EVERY_MS = 1_000;

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

// ---- the host's songs ----

/** What the host does to the room's songs: as 一起听's (src/lib/listen.ts), and 停 (stop: nothing plays until they start it again) */
export type SquadSongChange = QueueChange | "stop";
/** How the songs changed, as told to the room */
export type SquadSongHow = "start" | "next" | "restart" | "add" | "seek" | "stop";
/** Songs asked for (点歌): so many waiting from each at most, and one every REQUEST_EVERY_MS */
export const REQUESTS_EACH = 3;
export const REQUEST_EVERY_MS = 20_000;

// ---- what is said in a room ----

/** The set lines (T.squad.say), by row; each is sent by its number */
export const PHRASE_ROWS = [
  ["team", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  /** 开局, as a round starts: numbers go on from the last, those of before never change */
  ["open", [25, 26, 27, 28, 29, 30, 31]],
  /** 28 is in this row too: one line, one number */
  ["fight", [10, 11, 12, 13, 14, 15, 16, 32, 33, 34, 35, 28]],
  ["after", [17, 18, 19, 20, 21]],
  /** only while the host's song plays */
  ["music", [22, 23, 24]],
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
/** A line said shows over its roach (a bubble) this long, and under it (刚才) this long */
export const BUBBLE_MS = 4_000;
export const LAST_LINE_MS = 60_000;

// ---- what the roaches do in a room ----

/** What one's roach keeps doing in the room until changed (动作): 0 stands, 1 dances (蹦迪), 2 lies asleep (醉倒睡觉) */
export const POSES = [0, 1, 2] as const;
export type SquadPose = (typeof POSES)[number];
export const isPose = (v: unknown): v is SquadPose => POSES.includes(v as SquadPose);
/** A pose changed once every POSE_EVERY_MS and POSES_PER_HOUR an hour at most, each player */
export const POSE_EVERY_MS = 2_000;
export const POSES_PER_HOUR = 120;
/**
 * What one's roach does once and is done with: 挥手 (wave, the look's own move), 击掌 (five) and 贴贴 (hug) with a
 * teammate (to). Never written down: told to the room as the lines are, and counted with them (SAY_PER_HOUR).
 */
export const MOVES = ["wave", "five", "hug"] as const;
export type SquadMove = (typeof MOVES)[number];
export const isMove = (v: unknown): v is SquadMove => MOVES.includes(v as SquadMove);
/** The moves done with a teammate */
export const movesTo = (m: SquadMove) => m !== "wave";
/** One move every MOVE_EVERY_MS, each player */
export const MOVE_EVERY_MS = 3_000;

// ---- the fight on the map while a round plays (step 5: the page alone, nothing sent) ----

/**
 * The fight drawn over the map while the room plays: 0 slugs crawl in from both sides (A), 1 one big monster in the
 * middle (B), 2 a cartoon brawl cloud (C). One a round, picked from the room and the round's start, so everyone in it
 * sees the same one, a reload too, and the next round picks again.
 */
export const SCENES = 3;
export function sceneOf(roomId: string, wentAt: number): number {
  // FNV-1a, enough to spread rooms and rounds over three
  let h = 0x811c9dc5;
  for (const c of `${roomId}:${wentAt}`) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SCENES;
}

/** What a set line does to the fight besides its bubble (by its number, PHRASE_ROWS): the one table of them */
export type SceneEgg = "boss" | "slip" | "push" | "cheer" | "glitch" | "ring" | "frenzy" | "wave";
export const SCENE_EGGS: Readonly<Record<number, SceneEgg>> = {
  14: "boss", // 大的来了
  10: "slip", // 我是漏勺我是区
  32: "push", // 我全防出去了啊
  33: "cheer", // 这波神了
  15: "cheer", // 这把稳了
  12: "glitch", // 信号影响了我的操作
  30: "ring", // 卫卫卫，能听到吗？！
  35: "frenzy", // 剩下的交给我吧
  25: "wave", // 四区车队，启动！
  31: "wave", // 喂鼠协议，启动！
};

// ---- what the page gets ----

/** How a roach looks, for a seat or a member */
export type SquadLook = { avatar: string; color: string };

/** A seat on the list: the host; the viewer; one of the viewer's 触须之交, named; or a teammate, never named */
export type SquadSeat = { role: "host" | "you" | "friend" | "mate"; name?: string } & SquadLook & SquadPicks;

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
  /** A song of the host's plays in it now (♪ 在放歌) */
  music: boolean;
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
  /** 准备 (in the game's alliance and ready): ticked by them; the host needs none */
  inGame: boolean;
  pose: SquadPose;
} & SquadLook &
  SquadRound;

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
  /** When its round started (开始游戏, ms), while it plays; null while it waits */
  wentAt: number | null;
  /** When it ends by itself unless something happens (ms), and why it would */
  endsAt: number;
  endsWhy: Exclude<SquadEnd, "host" | "admin">;
  /** Its 宣言招人 was sent (once a room) */
  declared: boolean;
  /** Your own invitations to it, to those not in it: still good (waiting), or not come (missed: ran out or 下次吧, never told apart) */
  invited: SquadInvited[];
  /**
   * The host's songs (src/lib/listen.ts RoomSchedule), whether this player may hear them (听歌 open to them and not
   * paused in the 管理台, the site not gray: dj), the songs asked for (the host's: all, oldest first, with who asked;
   * anyone else's: their own still waiting), and, to the host alone, how many in it follow the songs now
   */
  dj: boolean;
  requests: { id: number; song: string; name?: string }[];
  listening: number | null;
  now: number;
} & RoomSchedule;

/** What a room's phones are told (the event stream's "squad"): look again, with what changed; lines said; it ended; you are out */
export type SquadTell =
  | {
      t: "room";
      room: string;
      /** round, pose: one's as it is now, which a page of now takes as it is, without asking again */
      what?: { kind: "in" | "game" | "key" | "state" | "ask" | "round" | "pose"; h?: number; to?: SquadState; round?: SquadRound; pose?: SquadPose };
    }
  /** The host changed the songs: how, and the songs as they are now */
  | ({ t: "songs"; room: string; how: SquadSongHow } & RoomSchedule)
  | { t: "say"; room: string; items: { h: number; p: number }[] }
  /** Moves done (动作), batched as the lines are; a page of before skips them */
  | { t: "move"; room: string; items: { h: number; move: SquadMove; to?: number }[] }
  | { t: "end"; room: string; why: SquadEnd }
  | { t: "you"; room: string; why: "kicked" | "left" };

/** What me() carries, to a player 一起卫戍 is open to (SQUAD) who plays 明日方舟 or no game yet */
export type SquadMe = {
  card: SquadCard | null;
  /** 列表上显示我的名字: named on the list as a teammate, to everyone (else to their own 触须之交 alone) */
  showName: boolean;
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
  /** Songs its hosts started */
  plays: number;
  /** Invitations sent, and players who went in at a 宣言招人 */
  invites: number;
  called: number;
};

// ---- calling others in ----

/**
 * A room as a 宣言招人 to it (or an invitation) is now, to one who got it: open to go in at, full, playing (开打),
 * they are in it, closed to them (asked to leave it, someone they blocked or who blocked them in it), or over; with
 * its server and 难度, and how many are in it
 */
export type SquadCall = { state: "open" | "full" | "playing" | "in" | "shut" | "over"; n: number; server: string; level: number };

/**
 * One of your 触须之交 to invite: their key (friendKey), card, the server of their 明日方舟 UID ("" when not given),
 * whether they are in your room already, and whether an invitation of yours to it is still good
 */
export type SquadFriend = { id: string; card: PublicProfile; server: string; inRoom: boolean; waiting: boolean };
/** One you invited to the room you are in, as you see TA there */
export type SquadInvited = { card: PublicProfile; state: "waiting" | "missed" };
/** What each invitation came to: sent (or there already), or why not */
export type SquadInviteSent = { id: string; ok: boolean; why?: string };

// ---- refusals the page acts on (HttpError codes) ----

export const SQUAD_CLOSED = "squadClosed";
export const NEED_CARD = "squadCard";
export const ROOM_GONE = "squadGone";
export const ROOM_FULL = "squadFull";
export const ROOM_SHUT = "squadShut";
export const ROOM_PLAYING = "squadPlaying";
/** 开始游戏 refused: someone is not ready, strategies clash, or nobody is in it but the host */
export const NOT_READY = "squadNotReady";
export const NOT_IN_ROOM = "squadNotIn";
/** A strategy marked for the round (这局) that a teammate plays it with already */
export const STRATEGY_TAKEN = "squadStrategyTaken";
