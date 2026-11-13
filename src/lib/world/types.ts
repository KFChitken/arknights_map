import type { BadgeCount, EarnedBadge } from "../badges";
import type { Declaration, Reply } from "../declarations";
import type { BatchAct, Gesture, SleepGesture } from "../friendly";
import type { Game } from "../games";
import type { GuideId } from "../guides";
import type { Profile, PublicProfile } from "../profile";
import type { ReportCounts, ReportReason, RoachReportReason } from "../safety";
import type { DrawnAvatar, LngLat, RoachAvatar, RoachColor } from "../types";
import type { HelpAsk } from "../help";
import type { Area, Box } from "./area";
import type { PackedRoaches } from "./packed";

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
   * Everyone's roaches, your own included, as one feed shared by every signed-in viewer.
   * Pass the version you hold to get only what changed since (see RoachFeedUpdate).
   * Not signed in: no roaches, only how many there are (VisitorFeed).
   */
  roachFeed(since: string | null): Promise<RoachFeedUpdate | VisitorFeed>;
  /**
   * 只发看得到的 (world/area.ts): the roaches of an area only, a box or the overview, at a version; pass
   * the version of the same box held to get only what changed in it. Not signed in: as roachFeed.
   */
  roachArea(area: Area | "counts", since: string | null): Promise<AreaUpdate | VisitorFeed>;
  /** Exactly how many roaches there are in a view (west, south, east, north), for a map showing the overview */
  roachesInView(view: Box): Promise<{ n: number } | VisitorFeed | { whole: true }>;
  /** For a visitor who has not signed in: about how many roaches are near a spot (counts.ts rough), counted by the server */
  around(spot: LngLat, signal?: AbortSignal): Promise<{ near: number; far: number }>;
  saveProfile(profile: Profile): Promise<Profile>;
  /** Place or move a roach. Returns the owner's roaches afterwards. A new one needs acceptPublicPlace first. */
  placeRoach(target: PlaceTarget, at: LngLat): Promise<OwnRoach[]>;
  /**
   * 派一只克隆体去烤火: put a roach down (or move one) on a free seat by 塔露拉干员's fire, which the
   * server picks, one at a time across the site. Returns the owner's roaches afterwards and the seat.
   */
  sitByFire(target: PlaceTarget): Promise<{ roaches: OwnRoach[]; seat: LngLat }>;
  /** Agree, once, that everyone sees exactly where your roaches are. */
  acceptPublicPlace(): Promise<void>;
  /** 摄入酒精: your main roach falls asleep drunk until the next morning where it is. */
  drink(): Promise<{ until: number }>;
  /** 醒酒: your main roach stands up at once. */
  sober(): Promise<void>;
  /** ⚡舟友的酒⚡ opened while your main roach lies drunk, for 将进酒 (the server checks it does). */
  partied(): Promise<void>;
  /** Taking back the main roach takes back the clones too. */
  removeRoach(roachId: string): Promise<OwnRoach[]>;
  /** Touch someone else's roach by its public id. Sends the device's time zone for 佩丽卡监督's count of the day. */
  touch(publicId: string, bold: boolean): Promise<TouchResult>;
  /** Touch back whoever sent an inbox item. */
  reply(itemId: string, bold: boolean): Promise<TouchResult>;
  /** 戳一戳 a 触须之交's sleeping main roach by its public id. It sleeps on; returns when you may poke TA again. */
  poke(publicId: string): Promise<{ againAt: number }>;
  /** 催理智: once a day per 触须之交 (friendId: Friend.id) */
  remindSanity(friendId: string): Promise<void>;
  /** Answer a 催理智: 「清完了！」 ("done", which they hear about) or 「知道啦」 ("ok") */
  answerSanity(itemId: string, answer: "done" | "ok"): Promise<void>;
  /** A gesture for a 触须之交, once a day each (blanket and water once a sleep); replyTo: the inbox item it returns */
  gesture(friendId: string, gesture: Gesture, replyTo?: string): Promise<void>;
  /**
   * 串门: a clone to sit by one of a 触须之交's roaches (by its public id): a new one, or cloneId (one of yours)
   * moved there. Resolves to your roaches and where it sits.
   */
  visit(friendId: string, publicId: string, cloneId?: string): Promise<{ roaches: OwnRoach[]; seat: LngLat }>;
  /** A visiting clone of yours goes back where it was (or is taken back if it was new); no move is counted */
  goHome(cloneId: string): Promise<OwnRoach[]>;
  /** Your clone left behind when its host moved: to a seat by that roach again (a move) */
  followHost(cloneId: string): Promise<{ roaches: OwnRoach[]; seat: LngLat }>;
  /** 请 TA 回家: the clone of this 触须之交 visiting you goes home, and may not come back for VISIT_BAN_DAYS */
  sendHome(friendId: string): Promise<void>;
  /** 我在游戏里申请了 (ask), and 我也加了 on one of theirs (gameAdded) */
  gameAsk(friendId: string, game: Game): Promise<void>;
  gameAdded(itemId: string): Promise<void>;
  /** 想在游戏里加 TA, when they share no UID for the game */
  gameWant(friendId: string, game: Game): Promise<void>;
  /** 一键: one act for many 触须之交 at once; how it went for each */
  friendsAct(act: BatchAct, friendIds: string[]): Promise<{ id: string; ok: boolean; why?: string }[]>;
  /** 特别关注 a 触须之交, or not; only you know */
  starFriend(friendId: string, on: boolean): Promise<void>;
  /** 求助: what is up, yours and your 触须之交's */
  helpBoard(): Promise<HelpBoard>;
  /** You looked at 求助: the dot on 触须之交 goes */
  seeHelp(): Promise<void>;
  askHelp(ask: HelpAsk): Promise<void>;
  closeHelp(requestId: string): Promise<void>;
  /** clues: for 缺线索, which of them you sent */
  answerHelp(requestId: string, clues?: number[]): Promise<void>;
  inbox(): Promise<InboxItem[]>;
  /** Only the declarations that came after `after` (the newest declaration's `at` in the inbox held) */
  newDeclarations(after: number): Promise<InboxItem[]>;
  markSeen(itemIds: string[]): Promise<void>;
  /** Shout to every player with a roach within the radius of your main roach. */
  /** Shout from the main roach, or from the roaches listed by id. */
  declare(d: Declaration, from?: string[]): Promise<{ reach: string }>;
  /** Crawl away from a touch in your inbox without answering it. */
  ignore(itemId: string): Promise<void>;
  /** Leave a reaction on a declaration in your inbox. */
  react(itemId: string, reaction: string): Promise<void>;
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
  /** 举报这只蟑螂: where someone's roach was put, by its id on the map. Blocks nobody, and its owner is never told who. */
  reportRoach(roachId: string, reason: RoachReportReason, note: string): Promise<void>;
  /** 我觉得处理错了: the one appeal of an action told in 站长通知 */
  appeal(actionId: string, text: string): Promise<void>;
  /** Wear one of your badges under your name on profile cards, or none (null). */
  wearBadge(badge: string | null): Promise<void>;
  /** You have been shown these badges, so they no longer pop up. */
  seeBadges(badges: string[]): Promise<void>;

  // Local testing only: step into other players' shoes on one device
  identities(): Promise<Identity[]>;
  become(id: PlayerId): Promise<void>;
  reset(): Promise<void>;
  /**
   * 派一只克隆体跟他走: a new clone (a placement) or one already out (a move) joins
   * 明河都尉's riders at today's station. Returns the owner's roaches afterwards and his answer.
   */
  rideMinghe(target: RideTarget): Promise<{ roaches: OwnRoach[]; item: MingheItem }>;
  /** 在这一站下马: the riding clone stays where it is; his answer */
  dismountMinghe(): Promise<{ roaches: OwnRoach[]; item: MingheItem }>;
  /** 祀掌柜 handed over her own portrait by mistake: 还给她 (return) or 就不还 (keep); her line about it */
  siPortrait(choice: "return" | "keep"): Promise<{ line: string }>;
  /** An ink roach of 缘缘庄 tapped on the map, by what its tile says of it (src/lib/siTiles.ts InkPoint) */
  tapInk(ink: { x: number; y: number; tap: number; fx: number; fy: number }): Promise<InkTap>;
  /** 收回 your ink roach: off the map, held till you touch 祀掌柜 again (src/lib/server/si.ts recallInk) */
  recallInk(): Promise<void>;
  /**
   * 假装过了一天 (阿米娅向导 greets again), 假装离开两天 (欢迎回家), 假装离开 for
   * seconds (佩丽卡监督 says how long), 让佩丽卡重新问一次 (ask), 清掉我和塔露拉的记录 (talulah),
   * 明河快进一天 (mingheDay), 清掉我和明河的记录 (minghe), 假装触须之交第 30 天 (perlicaDays),
   * 假装今天是佩丽卡生日 (perlicaBirthday) or 假装过了一周 (perlicaWeek); and 祀掌柜's (src/lib/si.ts):
   * 祀快进半天 / 一天 / 21 天 (siHalfDay, siDay, si21), 假装今天来了 n 人 (siToday, n in seconds),
   * 假装已经有 n 人碰过她 (siCrowd), 清掉缘缘庄 (siClearInn), 下次一定拿错 (siWrong) and
   * 清掉我和祀的记录 (si)
   */
  pretend(what: PretendWhat, seconds?: number): Promise<void>;
  /** 「我已满 18 岁」 on the card the admin asked for */
  confirmAge(): Promise<void>;
}

export type PretendWhat =
  | "day"
  | "away"
  | "left"
  | "ask"
  | "talulah"
  | "mingheDay"
  | "minghe"
  | "perlicaDays"
  | "perlicaBirthday"
  | "perlicaWeek"
  | "siHalfDay"
  | "siDay"
  | "si21"
  | "siToday"
  | "siCrowd"
  | "siClearInn"
  | "siWrong"
  | "si";

export type PlayerId = string;

export type PlaceTarget = { kind: "main" } | { kind: "clone" } | { kind: "move"; roachId: string };

/** Who rides with 明河都尉: a new clone, or a clone already out; never the main roach */
export type RideTarget = Exclude<PlaceTarget, { kind: "main" }>;

/**
 * One of your own roaches at its true position. publicId is how it appears in the shared feed. Only its owner ever gets this.
 * guests: 触须之交 whose clones visit this roach (串门); visit: this clone visiting a 触须之交, who may have moved away
 * from it ("moved") or taken that roach back ("removed").
 */
export type OwnRoach = LngLat & {
  id: string;
  slot: number;
  publicId: string;
  guests?: { friendId: string; name: string }[];
  visit?: { friendId: string; name: string; left: "moved" | "removed" | null };
};

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
  /** A clone riding along with 明河都尉 (src/lib/minghe.ts), for counting them; never whose */
  ride?: true;
  /** In the overview (world/area.ts): how many roaches it stands for, itself included; 1 when left out */
  n?: number;
};

/**
 * Someone else's roach as you see it. friend: it belongs to one of your 触须之交.
 * guide: one of the site's guides (src/lib/guides.ts), whom every page draws for itself.
 */
export type PublicRoach = MapRoach & { friend: boolean; guide?: true };

/**
 * The shared roach feed at version v. With no version to start from it holds
 * every roach (as a list, or packed: world/packed.ts); otherwise only those
 * added or changed since, and the ids gone. Nothing in it says when or in
 * which order things changed.
 */
export type RoachFeedUpdate = { v: string; roaches?: MapRoach[]; packed?: PackedRoaches; changed?: MapRoach[]; removed?: string[] };

/**
 * An area of the feed (world/area.ts): whole (packed, with the box or overview it is of), or what changed
 * in the box held since its version; t: how many roaches there are in all, by the fire, riding with
 * 明河都尉, and how many players they belong to (their main roaches; none from a server from before it
 * said so). Just {v} where the server has nothing to say yet (just after a start).
 */
export type AreaUpdate = {
  /** Areas switched off on the server (AREA_FEED=off): ask for the whole list (roachFeed) instead */
  whole?: true;
  v: string;
  t?: [number, number, number, number?];
  box?: Box;
  overview?: true;
  packed?: PackedRoaches;
  changed?: MapRoach[];
  removed?: string[];
};

/**
 * What the feed gives someone not signed in, whose map is 全员隐匿: how many roaches there are in all, by
 * 塔露拉干员's fire, riding with 明河都尉, and how many players they belong to (none from a server from
 * before it said so), at version v. No roaches at all.
 */
export type VisitorFeed = { v: string; hidden: true; total: number; fire: number; riders: number; players?: number };

/**
 * newFriend: the other player's name when this touch made you 触须之交.
 * guide: when you touched one of the guides (src/lib/guides.ts), her touch back,
 * which she gives at once: "friend" when it made you 触须之交 (佩丽卡监督's and
 * 塔露拉干员's own answer to that), and for 佩丽卡监督's bold touch back the
 * how-manieth touch of yours today.
 */
export type TouchResult = {
  newFriend: string | null;
  guide?: {
    id: GuideId;
    /** Her touch back; null when she has touched back once already today (src/lib/server/guides.ts) */
    itemId: string | null;
    bold: boolean;
    /** 佩丽卡监督 also answers jealous, visiting (aside) or on her birthday */
    kind: "touch" | "friend" | "jealous" | "aside" | "birthday";
    times: number | null;
    /** 佩丽卡监督's jealous answer: how many others you touched today first, and which of her lines */
    others: number | null;
    line: number | null;
  };
  /** Touching 阿米娅向导 got 佩丽卡监督 to say something too (her 「罗德岛那位……」), a new item of hers */
  aside?: { id: "perlica"; itemId: string };
  /** Touching 祀掌柜 (src/lib/si.ts): what else came of it */
  si?: SiTouch;
};

/**
 * What came of a touch of 祀掌柜 besides her answer: the stamp she put in your 集章本 (which of STAMPS,
 * and how many you have now), the portrait she gave as you became 触须之交 (wrong: her own, by mistake),
 * and what happened at 缘缘庄: she drew your ink roach just now, and it went straight into a room (in),
 * queued at the door for the first time (queued) or again after a stay (again), or nothing changed.
 */
export type SiTouch = {
  /** How she answered (her line's kind; which of the three is guide.line), null when she had answered today already */
  answer: SiItem["line"] | null;
  stamp: { stamp: number; stamps: number } | null;
  portrait: "right" | "wrong" | null;
  /**
   * full: your clones were five, so the ink roach is held (drawn just now, or one held already); resting: you recalled
   * it less than RECALL_REST_MS ago (src/lib/si.ts), so it is not back in the queue yet
   */
  inn: { drawn: boolean; event: "in" | "queued" | "again" | "none" | "full" | "resting"; room: number | null; place: number | null };
  /** Her line in 消息 about the room it went straight into, said over her head at the same time */
  innItemId: string | null;
  you: SiInk | null;
};

/**
 * Your ink roach (墨小强, src/lib/siInn.ts) as of the moment asked: queuing at 缘缘庄's door (place: how many
 * are ahead of it, itself included; checkinAt: when it gets its room), staying in room `room` till checkoutAt,
 * lying in the fields outside the village, or held off the map (recalledAt: when you recalled it, or null while it
 * waits for room among your clones, never having queued). n: its latest ticket; inkNo: the how-manieth she drew.
 * On the map it is one of your MAX_CLONES clones.
 */
export type SiInk = (
  | { state: "queue"; n: number; place: number; checkinAt: number }
  | { state: "stay"; n: number; room: number; checkoutAt: number }
  | { state: "out" }
  | {
      state: "held";
      recalledAt: number | null;
      /**
       * Always 0: a page from before "held", still open after the site is updated, takes any state but queue and out
       * for a stay, and so draws it lying at home (a stay over long ago), not at no place at all
       */
      checkoutAt: 0;
    }
) & {
  inkNo: number;
  look: RoachAvatar;
  /** Where it lies once its stay is over (the page works out the queue's and the rooms' spots itself) */
  home: LngLat;
  /** The number its tiles tap it by (src/lib/siTiles.ts tapOf), so the page draws it once, its own way */
  tap: number;
  /** Her red 「祀」 seal on its back, since the 集章本 was first full */
  sealed: boolean;
};

/**
 * 缘缘庄 as everyone sees it (GET /api/si, src/lib/siInn.ts): ink roaches drawn (D), tickets given (N), those
 * that had their room by now (C) and had left it (O), how many queued at the door a day ago, and the players
 * who touched her today (今天的画); how far from the middle of the village the homes of those drawn reach (metres).
 * held: ink roaches off the map (recalled, or never queued while their owner had no room for them among their
 * clones); empty: the places at the door and the rooms their recalled tickets leave empty now (every check-in
 * stands as it was given).
 * at: her clock as this was worked out; shift: 祀快进 in development, else 0.
 */
export type SiState = {
  drawn: number;
  tickets: number;
  checkedIn: number;
  checkedOut: number;
  held: number;
  empty: { queue: number; rooms: number };
  queueDayAgo: number;
  today: number;
  homesReach: number;
  at: number;
  shift: number;
};

/** 祀掌柜 as me() tells it (src/lib/server/si.ts) */
export type SiMe = {
  friend: boolean;
  /** The portrait she gave as you first became 触须之交: when, and whether it is the right one */
  portrait: { at: number; state: "right" | "wrong" | "returned" | "kept" } | null;
  /** Stamps in your 集章本, and whether today's (by your device's day) is in already */
  stamps: number;
  stampedToday: boolean;
  inn: SiInk | null;
  /** Your ink roach has had a room at 缘缘庄, so her two declarations are yours */
  stayed: boolean;
  /** 祀快进 (development only): ms added to her clock, the page's too; 0 on the live site */
  shift: number;
};

/**
 * An ink roach tapped on the map (World.tapInk), as the server tells it: where it is, whether it is yours, a
 * 触须之交's (their id in your list, and name), whether its owner closed their account (gone: nobody's now, and
 * not to be touched), and what touching it takes (World.touch; null when gone). Nothing else of whose it is.
 */
export type InkTap = {
  state: "queue" | "stay" | "out";
  mine: boolean;
  friend: { id: string; name: string } | null;
  gone: boolean;
  id: string | null;
};

export type Friend = {
  /** Opaque; good for unfriending and everything 触须之交 do for each other */
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
  /** What you two can do for each other (src/lib/friendly.ts); none with the guides */
  between?: FriendBetween;
  /** 特别关注: when you starred TA, or null. Only you know; the starred come first, in that order */
  star: number | null;
};

/** Between you and one 触须之交 (src/lib/friendly.ts) */
export type FriendBetween = {
  /** Their main roach's public id, for 戳一戳 from any card of theirs; null without one */
  mainId: string | null;
  /** Their main roach sleeps, drunk or away: the gestures change, and 戳一戳 comes in */
  asleep: boolean;
  /** How many more of 催理智 and the gestures you may do for TA today (FRIEND_ACTS_PER_DAY, Beijing date) */
  actsLeft: number;
  /** Used today (催理智), or for this sleep of theirs (blanket, water) */
  done: Record<"sanity" | SleepGesture, boolean>;
  /** They welcome guests (让触须之交来串门) */
  welcome: boolean;
  /** They sent your clone home (请 TA 回家): when you may visit again */
  visitAgainAt: number | null;
  /** Your clone visiting them: its id, and whether they moved away from it */
  visiting: { cloneId: string; left: boolean } | null;
  /** 游戏里也加个好友, for each game they play: also friends there, or when you may say 「我在游戏里申请了」 again */
  games: Partial<Record<Game, { added: boolean; askAgainAt: number | null }>>;
  /** 想在游戏里加 TA: when you may again */
  wantAgainAt: number | null;
  /** Today's day of being 触须之交, on one of the anniversaries (7, 30, 100, every year) */
  anniversary: number | null;
};

/**
 * 求助 (src/lib/help.ts) as you see it. Theirs: from a 触须之交 in a game you play, with what you
 * answered. Yours: who answered what. fresh: theirs came since you last looked; yours has answers
 * you have not seen.
 */
export type HelpItem = HelpAsk & {
  id: string;
  at: number;
  /** When it comes down by itself */
  until: number;
  fresh: boolean;
  from?: PublicProfile;
  friendId?: string;
  answered?: { clues?: number[] } | null;
  answers?: { friendId: string; name: string; clues?: number[]; at: number; fresh: boolean }[];
};
export type HelpBoard = { mine: HelpItem[]; theirs: HelpItem[] };

/** What happened with a visiting clone (串门), as the inbox tells it */
export type VisitEvent = "came" | "sentHome" | "hostMoved" | "hostRemoved" | "closed";

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
  /**
   * 佩丽卡监督: whether you are 触须之交, her 离开计时: on, off, or null while she has not asked yet,
   * and her weekly report, only from the visit that made it
   */
  perlica: { friend: boolean; timer: "on" | "off" | null; week: PerlicaItem | null };
  /** 塔露拉干员: whether you are 触须之交, and whether a roach of yours ever sat by her fire */
  talulah: { friend: boolean; visited: boolean };
  /**
   * 明河都尉: whether you are 触须之交, and your clone riding with him, if any (stops: the
   * how-manieth station it is at, 1–7). dayShift: days added by 明河快进一天, 0 but in development.
   */
  minghe: { friend: boolean; riding: { roachId: string; since: number; stops: number } | null; dayShift: number };
  /** 祀掌柜: 触须之交, her portrait, your 集章本 and your ink roach at 缘缘庄 */
  si: SiMe;
  /** 求助: your 触须之交's requests up since you last looked, and answers to yours you have not seen (the dot on 触须之交) */
  help: { asks: number; answers: number };
  /** Reports held their name and UIDs until the admin looks: hidden from others, and locked in 资料 */
  profileHeld: boolean;
  /** 暂停互动 until then: the map and 消息 stay open, touching, declaring, reacting, poking and visiting do not */
  suspendedUntil: number | null;
  /** The admin asked them to say again they are 18 or older: a card stands in front of the map until they do */
  ageCheck: boolean;
  /**
   * No password, at a mail service our codes may not reach just now (Gmail), and no admin: the map asks
   * once to set one (it goes without a code, src/lib/server/passwords.ts firstWithoutCode)
   */
  passwordNudge: boolean;
  /** Only for the admin: reports waiting, shown in a corner of the map */
  admin?: ReportCounts;
  /** Only for a moderator: the map shows them 看被举报的蟑螂 (where roaches were reported), without the owner's counts */
  mod?: true;
};

/** 欢迎回家: what changed while the player was away, beyond what their inbox says */
export type Homecoming = {
  daysAway: number;
  /** Roaches others put down or moved within the radar's radius of their main roach since their last visit */
  arrivals: number;
};

/** Someone on your block list. name is null when you never saw who it was. */
export type BlockedPlayer = { id: string; name: string | null; at: number };

/**
 * You touched whoever sent this in the last day, so touching TA back waits till tomorrow: "all"; or only
 * the sneaky touch back waits, as a bold one still goes: "sneaky" since it makes you 触须之交, "reveal"
 * since you touched TA only sneakily so far, and it says who that was.
 */
export type TouchBackWaits = "all" | "sneaky" | "reveal";

/** Whether only a bold touch back goes now, with nothing for a sneaky one till tomorrow */
export const boldOnly = (waits: TouchBackWaits | undefined) => waits === "sneaky" || waits === "reveal";

/** 我觉得处理错了: open to send, sent and waiting for the admin, or answered (in a note of its own) */
export type StaffAppeal = { actionId: string; state: "open" | "sent" | "answered" };

export type InboxItem =
  /**
   * 站长通知: what came of a report, or what the admin did about the player and why, worded on the server.
   * appeal: on a note about an action the player may appeal (once, within INBOX_DAYS), how far it went
   */
  | {
      kind: "staff";
      id: string;
      at: number;
      seen: boolean;
      text: string;
      appeal?: StaffAppeal;
      replied: true;
    }
  | {
      kind: "touch";
      id: string;
      at: number;
      seen: boolean;
      bold: boolean;
      /** What of yours it answers: a roach (your ink roach at 缘缘庄 too), or your own earlier touch, declaration or reaction */
      target: "main" | "clone" | "ink" | "touch" | "declaration" | "reaction";
      /** Only for bold touches */
      from: PublicProfile | null;
      replied: boolean;
      /** You crawled away from it (默默爬走) */
      ignored: boolean;
      waits?: TouchBackWaits;
    }
  | {
      kind: "declaration";
      id: string;
      at: number;
      seen: boolean;
      text: string;
      replied: boolean;
      /** The reply you left, and the ones you may choose from: its own four first, then the five every one has */
      reaction: Reply | null;
      options: Reply[];
      /** A 触须之交's 「祝我生日快乐」, sent to you as one: who, and how to open them (they see who reacts) */
      from?: PublicProfile;
      friendId?: string;
      waits?: TouchBackWaits;
    }
  /** Someone nearby reacted to your declaration; they stay anonymous, unless a 触须之交 reacting to your birthday */
  | {
      kind: "reaction";
      id: string;
      at: number;
      seen: boolean;
      text: string;
      reaction: Reply;
      replied: boolean;
      from?: PublicProfile;
      friendId?: string;
      waits?: TouchBackWaits;
    }
  | { kind: "friend"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** A 触须之交 poked your main roach while it slept; shown once you are awake */
  | { kind: "poke"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** A 触须之交 you poked is up again, as the 04:00 batch found */
  | { kind: "pokeWoke"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** 催理智 from a 触须之交 (asleep: sent while you slept), and how you answered */
  | {
      kind: "sanity";
      id: string;
      at: number;
      seen: boolean;
      from: PublicProfile;
      friendId: string;
      asleep: boolean;
      answer: "done" | "ok" | null;
      replied: boolean;
    }
  /** The one you reminded says 「清完了！」 */
  | { kind: "sanityThanks"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean }
  /** A gesture from a 触须之交; returned: you sent one back */
  | { kind: "gesture"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; gesture: Gesture; returned: boolean; replied: boolean }
  /**
   * 串门 news. To the host: a guest came ("came"; tip: the first time, with a word about the main roach; spot:
   * where the guest sits while it still does). To the guest: sent home, the host moved or took the roach back, or
   * stopped taking guests (cloneId: your clone still left where it was, for 跟过去 or 回家)
   */
  | {
      kind: "visit";
      id: string;
      at: number;
      seen: boolean;
      from: PublicProfile;
      friendId: string;
      event: VisitEvent;
      tip: boolean;
      spot: LngLat | null;
      cloneId: string | null;
      replied: boolean;
    }
  /**
   * 游戏里也加个好友: they asked you in the game ("ask", on server: your server there), want to add you
   * ("want"), or said they added you back ("added"); answered: you said 「我也加了」
   */
  | {
      kind: "game";
      id: string;
      at: number;
      seen: boolean;
      from: PublicProfile;
      friendId: string;
      event: "ask" | "want" | "added";
      game: Game;
      server: string;
      answered: boolean;
      replied: boolean;
    }
  /** 触须之交纪念日: the day-th day of being 触须之交 (at: the start of that day) */
  | { kind: "anniversary"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; day: number; replied: boolean }
  /** 阿米娅向导 touching you: back after your touch, or her daily greeting (greet) */
  | { kind: "amiya"; id: string; at: number; seen: boolean; bold: boolean; greet: boolean; replied: boolean; ignored: boolean }
  | PerlicaItem
  | TalulahItem
  | MingheItem
  | SiItem;

/**
 * 祀掌柜 answering your touch (line "touch", variant: which of her three for how you touched her; or
 * "away" and "longaway" for a 触须之交 back after 3 or 14 days, "night" between midnight and five), as you
 * became 触须之交 ("friend"); with the stamp she put in your 集章本 that day (stamp, and stamps: how many
 * now). Or 缘缘庄: your ink roach got its room ("checkin", waited minutes in the queue; "again" for a
 * returning guest) or left it after half a day ("checkout").
 */
export type SiItem = {
  kind: "si";
  id: string;
  at: number;
  seen: boolean;
  line: "touch" | "away" | "longaway" | "night" | "friend" | "checkin" | "again" | "checkout";
  bold: boolean;
  variant: number | null;
  stamp: number | null;
  stamps: number | null;
  room: number | null;
  waited: number | null;
  replied: boolean;
  ignored: boolean;
};

/**
 * 明河都尉 answering your touch ("touch"; bold: how you touched him), as you became
 * 触须之交 ("friend"), as your clone got on ("ride") or off ("dismount") at a station
 * (stop, 0–29), or seeing it home after 7 stations ("trip": from stop, touched times on the way).
 */
export type MingheItem = {
  kind: "minghe";
  id: string;
  at: number;
  seen: boolean;
  line: "touch" | "friend" | "ride" | "dismount" | "trip";
  bold: boolean;
  stop: number | null;
  times: number | null;
  replied: boolean;
  ignored: boolean;
};

/**
 * 塔露拉干员 answering your touch ("touch"; bold: how you touched her, which picks
 * her line), shaking hands as you became 触须之交 ("handshake"), welcoming your
 * first roach at her fire ("welcome"), or answering your birthday declaration ("birthday").
 */
export type TalulahItem = {
  kind: "talulah";
  id: string;
  at: number;
  seen: boolean;
  line: "touch" | "handshake" | "welcome" | "birthday";
  bold: boolean;
  replied: boolean;
  ignored: boolean;
};

/**
 * 佩丽卡监督 touching you: back after your touch (what "touch", or "friend" when it
 * made you 触须之交; times: your how-manieth touch that day, on her bold ones),
 * jealous ("jealous": others, how many you touched first that day; line 1 when that
 * was only 阿米娅向导), visiting ("aside": line 0 as she touched back, 1 as you
 * touched 阿米娅向导) or on her birthday ("birthday"); telling you how long you were
 * away ("away": seconds, and which of that band's lines she said); or her weekly
 * report ("week": others and times for last week, line for how it ends). Her
 * reports, weekly ones and asides are seen as soon as they are made.
 */
export type PerlicaItem = {
  kind: "perlica";
  id: string;
  at: number;
  seen: boolean;
  what: "touch" | "friend" | "away" | "jealous" | "aside" | "birthday" | "week";
  bold: boolean;
  seconds: number | null;
  line: number | null;
  times: number | null;
  others: number | null;
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
/** The admin asked the player to say again they are 18 or older */
export class AgeCheckNeeded extends WorldError {}

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
