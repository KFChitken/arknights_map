import type { BadgeCount, EarnedBadge } from "../badges";
import type { Declaration, Reaction } from "../declarations";
import type { GuideId } from "../guides";
import type { Profile, PublicProfile } from "../profile";
import type { ReportReason } from "../safety";
import type { DrawnAvatar, LngLat, RoachColor } from "../types";

/**
 * The data layer the UI talks to: ./server.ts calls the API, whose rules live
 * in src/lib/server/world.ts.
 */
export interface World {
  /** The signed-in player with their own roaches, or null when signed out. Sends the device's time zone for 阿米娅向导's greeting. */
  me(): Promise<Me | null>;
  /**
   * 「还在」 for 佩丽卡监督's 离开计时: the page is open and looked at. When the player was
   * away long enough, her report of how long; null otherwise, for visitors, and while the timer is off.
   */
  here(): Promise<PerlicaItem | null>;
  /** 「走了」: the page goes out of sight or closes. Sent on its way and never answered. */
  leave(): void;
  /** Her 离开计时 on or off, from her card or 资料; off forgets the time kept and her reports of it. */
  setPerlicaTimer(on: boolean): Promise<void>;
  /**
   * Everyone's roaches, your own included, as one feed shared by every viewer.
   * Pass the version you hold to get only what changed since (see RoachFeedUpdate).
   */
  roachFeed(since: string | null): Promise<RoachFeedUpdate>;
  saveProfile(profile: Profile): Promise<Profile>;
  /** Place or move a roach. Returns the owner's roaches afterwards. A new one needs acceptPublicPlace first. */
  placeRoach(target: PlaceTarget, at: LngLat): Promise<OwnRoach[]>;
  /** Agree, once, that everyone sees exactly where your roaches are. */
  acceptPublicPlace(): Promise<void>;
  /** 摄入酒精: your main roach falls asleep drunk until the next morning where it is. */
  drink(): Promise<{ until: number }>;
  /** 醒酒: your main roach stands up at once. */
  sober(): Promise<void>;
  /** Taking back the main roach takes back the clones too. */
  removeRoach(roachId: string): Promise<OwnRoach[]>;
  /** Touch someone else's roach by its public id. Sends the device's time zone for 佩丽卡监督's count of the day. */
  touch(publicId: string, bold: boolean): Promise<TouchResult>;
  /** Touch back whoever sent an inbox item. */
  reply(itemId: string, bold: boolean): Promise<TouchResult>;
  /** 戳一戳 a 触须之交's sleeping main roach by its public id. It sleeps on; returns when you may poke TA again. */
  poke(publicId: string): Promise<{ againAt: number }>;
  inbox(): Promise<InboxItem[]>;
  markSeen(itemIds: string[]): Promise<void>;
  /** Shout to every player with a roach within the radius of your main roach. */
  /** Shout from the main roach, or from the roaches listed by id. */
  declare(d: Declaration, from?: string[]): Promise<{ reach: string }>;
  /** Crawl away from a touch in your inbox without answering it. */
  ignore(itemId: string): Promise<void>;
  /** Leave a reaction on a declaration in your inbox. */
  react(itemId: string, reaction: Reaction): Promise<void>;
  /** 触须之交: players you and they have both touched boldly. */
  friends(): Promise<Friend[]>;
  unfriend(friendId: string): Promise<void>;
  /** 方舟雷达 around your main roach: counts only, never distances or directions. Null without a main roach. */
  radar(): Promise<Radar | null>;
  /**
   * Block whoever sent an inbox item, or a 触须之交 ("friend:<id>"). Nothing
   * passes between you any more; they are not told.
   */
  block(target: string): Promise<void>;
  unblock(blockId: string): Promise<void>;
  blocks(): Promise<BlockedPlayer[]>;
  /** Report them to the admin, which also blocks them. They never learn who reported them. */
  report(target: string, reason: ReportReason, note: string): Promise<void>;
  /** Wear one of your badges under your name on profile cards, or none (null). */
  wearBadge(badge: string | null): Promise<void>;
  /** You have been shown these badges, so they no longer pop up. */
  seeBadges(badges: string[]): Promise<void>;

  // Local testing only: step into other players' shoes on one device
  identities(): Promise<Identity[]>;
  become(id: PlayerId): Promise<void>;
  reset(): Promise<void>;
  /**
   * 假装过了一天 (阿米娅向导 greets again), 假装离开两天 (欢迎回家), 假装离开 for
   * seconds (佩丽卡监督 says how long), or 让佩丽卡重新问一次 (ask)
   */
  pretend(what: "day" | "away" | "left" | "ask", seconds?: number): Promise<void>;
}

export type PlayerId = string;

export type PlaceTarget = { kind: "main" } | { kind: "clone" } | { kind: "move"; roachId: string };

/** One of your own roaches at its true position. publicId is how it appears in the shared feed. Only its owner ever gets this. */
export type OwnRoach = LngLat & { id: string; slot: number; publicId: string };

/** A roach as everyone sees it in the shared feed: where it is and how it looks, never whose. */
export type MapRoach = LngLat & {
  id: string;
  clone: boolean;
  avatar: DrawnAvatar;
  color: RoachColor;
  /** A show roach that belongs to nobody (see world/bots.ts); it cannot be touched */
  bot?: true;
  /** A main roach lying belly up asleep; never says why (drunk, or away a long time) */
  asleep?: true;
};

/**
 * Someone else's roach as you see it. friend: it belongs to one of your 触须之交.
 * guide: one of the site's guides (src/lib/guides.ts), whom every page draws for itself.
 */
export type PublicRoach = MapRoach & { friend: boolean; guide?: true };

/**
 * The shared roach feed at version v. With no version to start from it holds
 * every roach; otherwise only those added or changed since, and the ids gone.
 * Nothing in it says when or in which order things changed.
 */
export type RoachFeedUpdate = { v: string; roaches?: MapRoach[]; changed?: MapRoach[]; removed?: string[] };

/**
 * newFriend: the other player's name when this touch made you 触须之交.
 * guide: when you touched one of the guides (src/lib/guides.ts), her touch back,
 * which she gives at once: "friend" when it made you 触须之交 (佩丽卡监督 only),
 * and for 佩丽卡监督's bold touch back the how-manieth touch of yours today.
 */
export type TouchResult = {
  newFriend: string | null;
  guide?: { id: GuideId; itemId: string; bold: boolean; kind: "touch" | "friend"; times: number | null };
};

export type Friend = {
  /** Opaque; only good for unfriending */
  id: string;
  since: number;
  profile: PublicProfile;
  /** Their main roach and clones */
  roaches: PublicRoach[];
  /** Declarations in the last INBOX_DAYS */
  declarations: number;
  /** Their recent activity, newest first. Other players in it stay anonymous unless it is you. */
  history: FriendEvent[];
  /** You poked TA lately: when you may again. Null when you may now */
  pokeAgainAt: number | null;
};

export type FriendEvent =
  | { kind: "touched" | "touchedBy"; at: number; bold: boolean; you: boolean }
  | { kind: "declared"; at: number; text: string }
  | { kind: "befriended"; at: number; you: boolean }
  /** 换了助战: only the latest change */
  | { kind: "support"; at: number };

/**
 * movesLeft: how many more times a roach may be moved in the next 24 hours.
 * isNew, hasDeclared and hasTouched drive the newcomer tutorial.
 */
export type Me = {
  id: PlayerId;
  profile: Profile;
  roaches: OwnRoach[];
  movesLeft: number;
  /** Signed up within NEWCOMER_DAYS */
  isNew: boolean;
  hasDeclared: boolean;
  hasTouched: boolean;
  badges: EarnedBadge[];
  wornBadge: string | null;
  /** The counts badges are earned by: 触须之交 ever made, different players who reacted to their declarations, times drunk */
  counts: Record<BadgeCount, number>;
  /** 摄入酒精: their main roach sleeps until then, unless they sober up first; null when awake */
  drunkUntil: number | null;
  /** Back for the first time since their main roach flipped over for their staying away: it stands up again (鲤鱼打挺) */
  wokeFromAway: boolean;
  /** Only on the first visit of a day that comes after at least one whole day away */
  homecoming: Homecoming | null;
  /** Agreed to an older privacy policy: 「隐私说明更新了」 comes first, and nothing others see works until they agree */
  mustReconsent: boolean;
  /** Agreed that everyone sees exactly where their roaches are; asked before the first one goes down */
  agreedPublicPlace: boolean;
  /** 阿米娅向导: whether you are 触须之交, and today's greeting while you have not seen it */
  amiya: { friend: boolean; greeting: Extract<InboxItem, { kind: "amiya" }> | null };
  /** 佩丽卡监督: whether you are 触须之交, and her 离开计时: on, off, or null while she has not asked yet */
  perlica: { friend: boolean; timer: "on" | "off" | null };
};

/** 欢迎回家: what changed while the player was away, beyond what their inbox says */
export type Homecoming = {
  daysAway: number;
  /** Roaches others put down or moved within the radar's radius of their main roach since their last visit */
  arrivals: number;
};

/** Someone on your block list. name is null when you never saw who it was. */
export type BlockedPlayer = { id: string; name: string | null; at: number };

export type InboxItem =
  | {
      kind: "touch";
      id: string;
      at: number;
      seen: boolean;
      bold: boolean;
      /** What of yours it answers: a roach, or your own earlier touch, declaration or reaction */
      target: "main" | "clone" | "touch" | "declaration" | "reaction";
      /** Only for bold touches */
      from: PublicProfile | null;
      replied: boolean;
      /** You crawled away from it (默默爬走) */
      ignored: boolean;
    }
  | {
      kind: "declaration";
      id: string;
      at: number;
      seen: boolean;
      text: string;
      replied: boolean;
      /** The reaction you left, and the ones you may choose from */
      reaction: Reaction | null;
      options: Reaction[];
    }
  /** Someone nearby reacted to your declaration; they stay anonymous */
  | { kind: "reaction"; id: string; at: number; seen: boolean; text: string; reaction: Reaction; replied: boolean }
  | { kind: "friend"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** A 触须之交 poked your main roach while it slept; shown once you are awake */
  | { kind: "poke"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** A 触须之交 you poked is up again, as the 04:00 batch found */
  | { kind: "pokeWoke"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** 阿米娅向导 touching you: back after your touch, or her daily greeting (greet) */
  | { kind: "amiya"; id: string; at: number; seen: boolean; bold: boolean; greet: boolean; replied: boolean; ignored: boolean }
  | PerlicaItem;

/**
 * 佩丽卡监督 touching you: back after your touch (what "touch", or "friend" when it
 * made you 触须之交; times: your how-manieth touch that day, on her bold ones), or
 * telling you how long you were away (what "away": seconds, and which of that
 * band's lines she said). Her reports are seen as soon as they are made.
 */
export type PerlicaItem = {
  kind: "perlica";
  id: string;
  at: number;
  seen: boolean;
  what: "touch" | "friend" | "away";
  bold: boolean;
  seconds: number | null;
  line: number | null;
  times: number | null;
  replied: boolean;
  ignored: boolean;
};

export type Identity = {
  id: PlayerId;
  label: string;
  note: string;
  unseen: number;
  current: boolean;
  group: "me" | "tester" | "passerby";
};

/** A refusal whose message can be shown to the player as is. */
export class WorldError extends Error {}

/** The action needs a signed-in player. */
export class SignInNeeded extends WorldError {}

/** The player has to agree to the updated privacy policy first. */
export class ConsentNeeded extends WorldError {}

/** The server is busy right now; try again after retryAfterS seconds. */
export class TooBusy extends WorldError {
  constructor(
    message: string,
    public retryAfterS: number,
  ) {
    super(message);
  }
}

/** Roaches that moved into or out of the radar circle in a time window. */
export type RadarWindow = {
  arrived: number;
  left: number;
  /** Arrivals that were a player's first roach */
  newcomers: number;
  /** Arrivals that were clones */
  clones: number;
};

/** One radar scan: counts only, never distances or directions. */
export type RadarScan = {
  radiusKm: number;
  /** Other players' roaches inside the circle right now */
  roaches: number;
  clones: number;
  players: number;
  day: RadarWindow;
  week: RadarWindow;
  /** The last 7 days, oldest first; start is the local midnight of that day */
  daily: { start: number; arrived: number; left: number }[];
  /** In the last 24 hours, among players with a roach inside the circle */
  touches: number;
  declarations: number;
  friendsNearby: number;
  lastArrivalAt: number | null;
  /** Part of the movement is made-up demo data */
  demo: boolean;
};

/** A scan as shown: maybe an earlier one, once the day's scans are used up. */
export type Radar = RadarScan & {
  scannedAt: number;
  scansLeft: number;
  /** Set when this is an earlier scan shown again because none are left: when the next one frees up */
  nextScanAt: number | null;
};
