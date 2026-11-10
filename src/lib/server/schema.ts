import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RadarScan } from "../world/types";

/** PostGIS geography; only ever written through the generated column below. */
const geography = customType<{ data: string }>({ dataType: () => "geography" });

const at = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => at("created_at").notNull().defaultNow();
const emptyArray = sql`'{}'::text[]`;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null for demo players */
  email: text("email").unique(),
  createdAt: createdAt(),
  // Only when each tick was given (src/lib/consent.ts); no birth date is asked for
  ageConfirmedAt: at("age_confirmed_at"),
  policyAcceptedAt: at("policy_accepted_at"),
  /** Agreed to storage on Tencent Cloud in Hong Kong and login mail sent by Resend */
  crossBorderAcceptedAt: at("cross_border_accepted_at"),
  /** Agreed that everyone, visitors too, sees exactly where their roaches are; asked before the first one */
  publicPlaceAcceptedAt: at("public_place_accepted_at"),

  anonymous: boolean("anonymous").notNull().default(true),
  name: text("name").notNull().default(""),
  drPrefix: boolean("dr_prefix").notNull().default(false),
  games: text("games").array().notNull().default(emptyArray),
  favArknights: text("fav_arknights").array().notNull().default(emptyArray),
  favEndfield: text("fav_endfield").array().notNull().default(emptyArray),
  uidArknights: text("uid_arknights").notNull().default(""),
  uidEndfield: text("uid_endfield").notNull().default(""),
  /** The server each UID is on (games.ts SERVERS); "" until picked */
  uidServerArknights: text("uid_server_arknights").notNull().default(""),
  uidServerEndfield: text("uid_server_endfield").notNull().default(""),
  shareUid: boolean("share_uid").notNull().default(false),
  avatar: text("avatar").notNull().default("hood"),
  color: text("color").notNull().default("cyan"),
  /** 我的助战: Arknights operator names */
  support: text("support").array().notNull().default(emptyArray),
  /** The last change to it, which 触须之交 see in their history */
  supportChangedAt: at("support_changed_at"),
  /**
   * 先藏起来: enough players reported what they wrote about themselves (src/lib/server/safety.ts holdProfile),
   * so their name and UIDs are hidden and locked until the admin looks; null when not held. While held,
   * anonymous and shareUid are forced on and off, and these keep what the player had chosen.
   */
  profileHeldAt: at("profile_held_at"),
  heldAnonymous: boolean("held_anonymous"),
  heldShareUid: boolean("held_share_uid"),
  /** 暂停互动: until when they may not touch, declare, react, poke or visit; auto when the reports did it, before the admin looked */
  suspendedUntil: at("suspended_until"),
  suspendedAuto: boolean("suspended_auto").notNull().default(false),
  /** The admin asked them to say again that they are 18 or older; null once they did (ageConfirmedAt moves on) */
  ageCheckAt: at("age_check_at"),
  /** Cases they reported that the admin upheld, and that the admin found nothing in: only counted, to tell a reliable reporter */
  reportsUpheld: integer("reports_upheld").notNull().default(0),
  reportsDismissed: integer("reports_dismissed").notNull().default(0),
  /** When the admin last looked at their being blocked by many (src/lib/server/admin.ts); blocks before it no longer count */
  blocksReviewedAt: at("blocks_reviewed_at"),

  /** The Beijing date of the player's latest visit; only the day, never the time */
  lastSeenOn: date("last_seen_on", { mode: "string" }),
  /** The badge shown under their name, if they wear one */
  wornBadge: text("worn_badge"),
  /** Different players they have ever become 触须之交 with; never goes down, so badge progress never does */
  friendsEver: integer("friends_ever").notNull().default(0),
  /** 摄入酒精: the main roach sleeps until then (the next 8:00 where it is), unless sobered up first */
  drunkUntil: at("drunk_until"),
  /** Times they really got drunk; never goes down, for the 酒神 badges */
  drinksTotal: integer("drinks_total").notNull().default(0),
  /**
   * The 宣言 and 回应 badges: Beijing days they declared, and responded to a declaration, on (twenty in
   * a day count once, and they never go down, as the records themselves go after 90 days), the day
   * last counted, and the everyday sentences (FLUENT_TEMPLATES) they ever sent
   */
  declareDays: integer("declare_days").notNull().default(0),
  declaredOn: date("declared_on", { mode: "string" }),
  declaredLines: text("declared_lines").array().notNull().default(emptyArray),
  reactDays: integer("react_days").notNull().default(0),
  reactedOn: date("reacted_on", { mode: "string" }),
  /** Beijing days they touched 阿米娅向导 and 佩丽卡监督 on, for the 30-day badges, and the day last counted */
  amiyaDays: integer("amiya_days").notNull().default(0),
  amiyaTouchedOn: date("amiya_touched_on", { mode: "string" }),
  perlicaDays: integer("perlica_days").notNull().default(0),
  perlicaTouchedOn: date("perlica_touched_on", { mode: "string" }),
  /** 好久没来时，蟑螂翻肚皮睡觉: their main roach may flip over while they stay away */
  flipWhenAway: boolean("flip_when_away").notNull().default(true),
  /** The Beijing day the 04:00 batch flipped their main roach over for staying away; null while it stands */
  sleptAwayOn: date("slept_away_on", { mode: "string" }),
  /** 让触须之交来串门 (src/lib/server/friendly.ts): on unless they switched it off */
  welcomeGuests: boolean("welcome_guests").notNull().default(true),
  /** They were told once, with their first guest, not to keep the main roach by their door */
  visitTipShown: boolean("visit_tip_shown").notNull().default(false),
  /** 求助 (src/lib/server/help.ts): when they last looked at their 触须之交's requests, for the dot on the 触须之交 card */
  helpSeenAt: at("help_seen_at"),
  /** 阿米娅向导 (src/lib/amiya.ts): when they became 触须之交, and the day (by their device, from 04:00) she last greeted them */
  amiyaFriendSince: at("amiya_friend_since"),
  amiyaGreetedOn: date("amiya_greeted_on", { mode: "string" }),
  /** 佩丽卡监督 (src/lib/perlica.ts): when they became 触须之交 */
  perlicaFriendSince: at("perlica_friend_since"),
  /** Her 离开计时: "on" or "off" once they answered her or changed it in 资料, null while never asked; and when that was, as consent */
  perlicaTimer: text("perlica_timer"),
  perlicaTimerAt: at("perlica_timer_at"),
  /** The last moment they were looking at the site, to the second, overwritten each time; kept only while perlicaTimer is "on". No index: it changes every minute */
  lastActiveAt: at("last_active_at"),
  /** 塔露拉干员 (src/lib/talulah.ts): when they became 触须之交, when a roach of theirs first sat by her fire, and when she last answered their birthday declaration */
  talulahFriendSince: at("talulah_friend_since"),
  talulahWelcomedAt: at("talulah_welcomed_at"),
  talulahBirthdayAt: at("talulah_birthday_at"),
  /** 明河都尉 (src/lib/minghe.ts): when they became 触须之交 */
  mingheFriendSince: at("minghe_friend_since"),

  /** Demo players seeded in development: "t1".."t5" for testers, "n<index>" for passers-by */
  demoKey: text("demo_key").unique(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the cookie token, so a database leak does not leak live sessions
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginCodes = pgTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  sentAt: at("sent_at").notNull().defaultNow(),
  expiresAt: at("expires_at").notNull(),
  attempts: smallint("attempts").notNull().default(0),
  /** Codes sent to this address since dayStart, for the daily cap */
  dayStart: at("day_start").notNull().defaultNow(),
  sentToday: smallint("sent_today").notNull().default(1),
});

/** One row per email handed to the mail provider in the last day, for the sitewide cap. No address is kept. */
export const mailSends = pgTable("mail_sends", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sentAt: at("sent_at").notNull().defaultNow(),
  /**
   * "login" for a code and "login-slow" for one to a slow mail service (MAIL_SLOW_DOMAINS), the only
   * kinds counted against MAIL_DAILY_LIMIT; "report" for the admin's daily
   * report reminder and "report-urgent" for one about URGENT_REASONS (src/lib/server/safety.ts)
   */
  kind: text("kind").notNull().default("login"),
});

/**
 * The site's own checks (src/lib/server/watch.ts): each problem seen and not yet over, and
 * when it was last emailed about, so a restart neither forgets nor repeats them.
 */
/**
 * What the site's own checks found (src/lib/server/watch.ts), one row per problem from the moment it
 * counted until it was over: urgent ones are emailed at once and again when over, daily ones go into
 * the morning's digest, quiet ones are only kept for the admin page. The same problem back within an
 * hour of its end opens its row again (times). Kept 90 days after they end.
 */
export const watchIncidents = pgTable(
  "watch_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** <check>.<key>, as machine.memory */
    key: text("key").notNull(),
    /** "urgent", "daily" or "quiet": the highest it reached */
    level: text("level").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    advice: text("advice").notNull().default(""),
    /** The worst it got, in words (「最少剩 423 MB」), and the figure that orders it */
    worst: text("worst"),
    worstScore: doublePrecision("worst_score"),
    startedAt: at("started_at").notNull(),
    lastSeenAt: at("last_seen_at").notNull(),
    endedAt: at("ended_at"),
    times: integer("times").notNull().default(1),
    mailedAt: at("mailed_at"),
    recoveredMailedAt: at("recovered_mailed_at"),
    /** An email about it was due when the day's were used up (WATCH_MAILS_PER_DAY): it is never sent later */
    skippedAt: at("skipped_at"),
    /** The admin's 「知道了」: no more emails about it */
    ackedAt: at("acked_at"),
  },
  (t) => [index("watch_incidents_key_idx").on(t.key, t.endedAt), index("watch_incidents_started_idx").on(t.startedAt)],
);

/** Emails the checks sent (urgent, recovered, digest), urgent ones not sent for the day's cap (skipped), and urgent report reminders (report), for the admin page. Kept 90 days. */
export const watchMails = pgTable(
  "watch_mails",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: at("at").notNull(),
    subject: text("subject").notNull(),
    kind: text("kind").notNull(),
  },
  (t) => [index("watch_mails_at_idx").on(t.at)],
);

/** The checks' open problems before watch_incidents (2026-11); read once into it, and no longer written. */
export const watchAlerts = pgTable("watch_alerts", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  since: at("since").notNull(),
  mailedAt: at("mailed_at"),
});

/**
 * Small facts for the same checks: the build last seen running, when the checks began, and the
 * nightly backup's result, which scripts/backup.sh writes here itself.
 */
export const watchState = pgTable("watch_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/**
 * slot 0 is the main roach, 1..MAX_CLONES are clones. Everyone sees a roach
 * where it was placed, but never its owner. publicId is regenerated on every
 * move so a roach cannot be followed from one spot to the next.
 */
export const roaches = pgTable(
  "roaches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geography("geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(lng, lat), 4326))::geography`),
    publicId: uuid("public_id").notNull().unique().defaultRandom(),
    placedAt: at("placed_at").notNull().defaultNow(),
    /**
     * A clone riding with 明河都尉 (src/lib/minghe.ts), and only while it rides: since when,
     * the day of his journey it got on and the day whose station it stands at (so the 04:00
     * batch moves it once a day), and where it stood before (empty for a clone put down to ride).
     */
    rideSince: at("ride_since"),
    rideStartDay: integer("ride_start_day"),
    rideDay: integer("ride_day"),
    rideFromLng: doublePrecision("ride_from_lng"),
    rideFromLat: doublePrecision("ride_from_lat"),
  },
  (t) => [
    uniqueIndex("roaches_user_slot_idx").on(t.userId, t.slot),
    index("roaches_geog_idx").using("gist", t.geog),
    // the 04:00 batch reads only the riders
    index("roaches_ride_idx").on(t.rideSince).where(sql`${t.rideSince} is not null`),
  ],
);

export const touches = pgTable(
  "touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bold: boolean("bold").notNull(),
    // Receiver's roach slot; null for a touch back
    toSlot: smallint("to_slot"),
    // The public id that was touched, for the once-a-day rule
    toPublicId: uuid("to_public_id"),
    // "t:<id>", "d:<id>" or "x:<id>" when this answers an inbox item
    replyTo: text("reply_to"),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
    /** The receiver crawled away from it (默默爬走); the toucher is never told */
    ignoredAt: at("ignored_at"),
    /** Sent between two players when one had blocked the other: kept for the sender, never shown to the receiver */
    withheld: boolean("withheld").notNull().default(false),
  },
  (t) => [
    index("touches_to_idx").on(t.toUserId, t.createdAt),
    index("touches_from_idx").on(t.fromUserId, t.createdAt),
    uniqueIndex("touches_reply_idx").on(t.fromUserId, t.replyTo),
  ],
);

export const declarations = pgTable(
  "declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    template: text("template").notNull(),
    game: text("game"),
    character: text("character"),
    title: text("title"),
    food: text("food"),
    /** The sender's name as it was when they declared it, for 「我是<名字>…」 */
    name: text("name"),
    /** While the sender's profile is held: the name the declaration had, put back if the admin finds nothing wrong */
    heldName: text("held_name"),
    /** For a limited-time declaration, the id of its line in events.ts */
    line: text("line"),
    recipients: integer("recipients").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("declarations_sender_idx").on(t.senderId, t.createdAt)],
);

export const deliveries = pgTable(
  "declaration_deliveries",
  {
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => declarations.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: at("seen_at"),
    /** Sent to a 触须之交 of the sender as one (a 「祝我生日快乐」, however far): both sides see who */
    toFriend: boolean("to_friend").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.declarationId, t.recipientId] }), index("deliveries_recipient_idx").on(t.recipientId)],
);

/** A recipient's one fixed reply to a declaration; the sender sees it without learning who. */
export const reactions = pgTable(
  "declaration_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => declarations.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    createdAt: createdAt(),
    /** When the declaration's sender saw it */
    seenAt: at("seen_at"),
    /** As for touches: one of the two had blocked the other, so the sender never sees it */
    withheld: boolean("withheld").notNull().default(false),
  },
  (t) => [uniqueIndex("reactions_once_idx").on(t.declarationId, t.fromUserId)],
);

/** 触须之交. The pair is stored with a < b. */
export const friendships = pgTable(
  "friendships",
  {
    a: uuid("a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    b: uuid("b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    seenByA: boolean("seen_by_a").notNull().default(false),
    seenByB: boolean("seen_by_b").notNull().default(false),
    /** The latest 触须之交纪念日 (its day number) each of them has seen */
    anniversarySeenA: integer("anniversary_seen_a").notNull().default(0),
    anniversarySeenB: integer("anniversary_seen_b").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] }), index("friendships_b_idx").on(t.b)],
);

/**
 * What 触须之交 do for each other (src/lib/server/friendly.ts): 催理智 ("sanity"), the
 * gestures ("hug", "highfive", "luck"; "blanket", "water" while the other sleeps), news of a
 * visiting clone ("visit", "sentHome", "hostMoved", "hostRemoved", "closed"), and adding each
 * other in a game ("gameAsk", "gameWant"). period makes each once per its day (a Beijing date),
 * sleep, game or visit; the unique index keeps two pages tapping at once to one.
 */
export const friendNotes = pgTable(
  "friend_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    period: text("period").notNull(),
    /** For gameAsk and gameWant */
    game: text("game"),
    /** Sent while the other slept: hidden from them while they are drunk */
    asleep: boolean("asleep").notNull().default(false),
    /** A gesture sent back: the note it answers */
    replyTo: uuid("reply_to"),
    /** How the other answered: "done" or "ok" (sanity), "back" (a gesture returned), "added" (gameAsk) */
    answer: text("answer"),
    answeredAt: at("answered_at"),
    /** When the sender saw the answer ("done", "added") */
    answerSeenAt: at("answer_seen_at"),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
  },
  (t) => [
    uniqueIndex("friend_notes_once_idx").on(t.fromUserId, t.toUserId, t.kind, t.period),
    index("friend_notes_to_idx").on(t.toUserId, t.createdAt),
    index("friend_notes_from_idx").on(t.fromUserId, t.createdAt),
  ],
);

/**
 * 串门: a clone of the guest sitting by a roach of a 触须之交 (the host), at most one per
 * guest and host. hostRoachId is the host roach's row id, which stays through moves; from:
 * where the clone stood before (empty when it was put down for the visit). leftAt: the host
 * moved or took back that roach, and the guest stayed where it was.
 */
export const visits = pgTable(
  "visits",
  {
    roachId: uuid("roach_id")
      .primaryKey()
      .references(() => roaches.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostRoachId: uuid("host_roach_id").notNull(),
    since: at("since").notNull().defaultNow(),
    fromLng: doublePrecision("from_lng"),
    fromLat: doublePrecision("from_lat"),
    leftAt: at("left_at"),
  },
  (t) => [uniqueIndex("visits_guest_host_idx").on(t.guestId, t.hostId), index("visits_host_idx").on(t.hostId), index("visits_host_roach_idx").on(t.hostRoachId)],
);

/** 请 TA 回家: the guest may not visit this host again until VISIT_BAN_DAYS after at */
export const visitBans = pgTable(
  "visit_bans",
  {
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: at("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hostId, t.guestId] })],
);

/**
 * 特别关注: the 触须之交 a player keeps at the front of their list. Only they know: nothing
 * reaches the other. other is the other player's id, or a guide's id; gone with the friendship.
 */
export const friendStars = pgTable(
  "friend_stars",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    other: text("other").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.other] })],
);

/**
 * 求助 among 触须之交 (src/lib/server/help.ts): 缺线索 (clues: which, 1–7), 来线索交流
 * (exchange) or 借助战 (support: an operator, and its skill, 0 for any). Seen only by the
 * asker's 触须之交 who play that game; up for HELP_HOURS unless closed; kept HELP_KEEP_DAYS.
 */
export const helpRequests = pgTable(
  "help_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    game: text("game").notNull(),
    clues: smallint("clues").array(),
    operator: text("operator"),
    skill: smallint("skill"),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
    closedAt: at("closed_at"),
  },
  (t) => [index("help_requests_user_idx").on(t.userId, t.createdAt), index("help_requests_expires_idx").on(t.expiresAt)],
);

/** A 触须之交's answer to a request (送了哪几号, 去拜访了, 我挂上了), once each; seenAt: when the asker saw it */
export const helpAnswers = pgTable(
  "help_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => helpRequests.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clues: smallint("clues").array(),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
  },
  (t) => [uniqueIndex("help_answers_once_idx").on(t.requestId, t.fromUserId), index("help_answers_from_idx").on(t.fromUserId)],
);

/**
 * 戳一戳: a 触须之交 poked someone's sleeping main roach. It never wakes it. The
 * poked player sees who once they are awake; the poker is told 「醒啦」 by the
 * first 04:00 batch that finds it standing again.
 */
export const pokes = pgTable(
  "pokes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The Beijing day; one a day per pair even if two pokes race (the rule is one a week) */
    day: date("day", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    /** When the poked player saw it */
    seenAt: at("seen_at"),
    /** When the batch told the poker it was up again, and when they saw that */
    wokeToldAt: at("woke_told_at"),
    wokeSeenAt: at("woke_seen_at"),
  },
  (t) => [
    uniqueIndex("pokes_pair_day_idx").on(t.fromUserId, t.toUserId, t.day),
    index("pokes_to_idx").on(t.toUserId, t.createdAt),
    index("pokes_from_idx").on(t.fromUserId, t.createdAt),
  ],
);

/**
 * A guide (src/lib/guides.ts) and one player: their touches both ways, and
 * whatever else she sends them. Only that player ever sees these; she is no
 * account. Every guide's table starts with these columns, so the code she
 * shares with the others works on any of them (src/lib/server/guides.ts).
 */
const guideTouchColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** "to_<guide>": the player touched her; "from_<guide>": she touched them */
  direction: text("direction").notNull(),
  /** "touch", or what else of hers it is */
  kind: text("kind").notNull().default("touch"),
  bold: boolean("bold").notNull(),
  /** On the player's touch: which of hers it answers, once each */
  replyTo: uuid("reply_to"),
  createdAt: createdAt(),
  seenAt: at("seen_at"),
  /** The player crawled away from it (默默爬走) */
  ignoredAt: at("ignored_at"),
});

/** 阿米娅向导 (src/lib/amiya.ts); kind "greet" is her greeting of the day */
export const amiyaTouches = pgTable("amiya_touches", guideTouchColumns(), (t) => [
  index("amiya_touches_user_idx").on(t.userId, t.createdAt),
  uniqueIndex("amiya_touches_reply_idx").on(t.replyTo),
]);

/**
 * 佩丽卡监督 (src/lib/perlica.ts). kind "friend" is her touch back as a new
 * 触须之交, "jealous", "aside" and "birthday" her other ways of touching back,
 * "away" her report of how long the player was gone (only the latest AWAY_KEPT
 * stay) and "week" her weekly report; both go when the 离开计时 is switched off.
 */
export const perlicaTouches = pgTable(
  "perlica_touches",
  {
    ...guideTouchColumns(),
    /** "away": how many seconds they were gone, and which of the band's lines she said */
    awaySeconds: integer("away_seconds"),
    line: smallint("line"),
    /** Her bold touch back: the how-manieth touch of theirs today (from 04:00 on their device); "week": her touches last week */
    times: smallint("times"),
    /** "jealous": others touched that day before her; "week": others touched last week */
    others: smallint("others"),
  },
  (t) => [
    index("perlica_touches_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("perlica_touches_reply_idx").on(t.replyTo),
    // one weekly report a player, however many pages ask at once; it is dated the start of its week
    uniqueIndex("perlica_touches_week_idx").on(t.userId, t.createdAt).where(sql`${t.kind} = 'week'`),
  ],
);

/**
 * 塔露拉干员 (src/lib/talulah.ts). Her kinds: "touch" (her answer), "handshake"
 * (her answer that made them 触须之交), "welcome" (their first roach at her fire)
 * and "birthday" (her answer to their birthday declaration).
 */
export const talulahTouches = pgTable("talulah_touches", guideTouchColumns(), (t) => [
  index("talulah_touches_user_idx").on(t.userId, t.createdAt),
  uniqueIndex("talulah_touches_reply_idx").on(t.replyTo),
]);

/**
 * 明河都尉 (src/lib/minghe.ts). His kinds: "touch" (his answer), "friend" (his answer
 * that made them 触须之交), "ride" and "dismount" (a clone of theirs got on or off), and
 * "trip" (he saw it home after 7 stations).
 */
export const mingheTouches = pgTable(
  "minghe_touches",
  {
    ...guideTouchColumns(),
    /** The station (0–29) the line is about: where it got on or off, or where the trip set out from */
    stop: smallint("stop"),
    /** "trip": how many times the clone was touched on the way */
    times: smallint("times"),
  },
  (t) => [index("minghe_touches_user_idx").on(t.userId, t.createdAt), uniqueIndex("minghe_touches_reply_idx").on(t.replyTo)],
);

/** When a pair last stopped being 触须之交; only touches after it count towards a new friendship. */
export const friendCuts = pgTable(
  "friend_cuts",
  {
    a: uuid("a").notNull(),
    b: uuid("b").notNull(),
    cutAt: at("cut_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] })],
);

/**
 * One player blocked another. From then on nothing new passes between them in
 * either direction, and the blocker no longer sees anything the other sent
 * before. The blocked player is never told.
 */
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The blocker had seen who it was (a bold touch or a 触须之交); the block list names only those */
    known: boolean("known").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("blocks_pair_idx").on(t.blockerId, t.blockedId), index("blocks_blocked_idx").on(t.blockedId)],
);

/** A report for the admin. The reported player never learns who sent it. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    /** What the reporter was looking at, and the target's name at the time */
    context: text("context").notNull(),
    targetName: text("target_name").notNull(),
    createdAt: createdAt(),
    /** When the admin was emailed about it */
    notifiedAt: at("notified_at"),
    resolvedAt: at("resolved_at"),
    /** "dismissed", "name_cleared", "uid_cleared" or "both_cleared"; a ban deletes the reports with the account */
    resolution: text("resolution"),
  },
  (t) => [index("reports_target_idx").on(t.targetId), index("reports_reporter_idx").on(t.reporterId, t.createdAt)],
);

/**
 * What the admin did about a player (src/lib/server/admin.ts settleCase), or what the reports did by
 * themselves (auto): never who reported them. A warning is a yellow card. Kept a year
 * (KEEP_MOD_ACTION_DAYS) and deleted with the account; a ban is kept with the banned address instead.
 * The appeal columns are for the player's one appeal.
 */
export const modActions = pgTable(
  "mod_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** dismiss, clearName, clearUid, clearBoth, warn, suspend or ageCheck */
    action: text("action").notNull(),
    /** The community rule it was for (src/lib/safety.ts RULES) */
    rule: text("rule"),
    yellow: boolean("yellow").notNull().default(false),
    /** A suspension's end */
    until: at("until"),
    auto: boolean("auto").notNull().default(false),
    createdAt: createdAt(),
    appeal: text("appeal"),
    appealedAt: at("appealed_at"),
    /** "kept" or "reverted" */
    appealResult: text("appeal_result"),
    answeredAt: at("answered_at"),
  },
  (t) => [index("mod_actions_user_idx").on(t.userId, t.createdAt)],
);

/**
 * 站长通知 in a player's 消息 (src/lib/server/staffNotes.ts): what came of a report they made, or what
 * was done about them and under which rule. Never who reported, nor how many. Deleted after
 * KEEP_ACTIVITY_DAYS, and with the account.
 */
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** reportUpheld, reportDismissed, action, held, released, autoSuspended, unsuspended, appealKept or appealReverted */
    kind: text("kind").notNull(),
    actionId: uuid("action_id").references(() => modActions.id, { onDelete: "cascade" }),
    /** For a reporter: the reason they gave, and the Beijing day they reported */
    reason: text("reason"),
    rule: text("rule"),
    reportedOn: date("reported_on", { mode: "string" }),
    until: at("until"),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
  },
  (t) => [index("staff_notes_user_idx").on(t.userId, t.createdAt)],
);

/** Addresses of banned accounts, kept only as an HMAC so the list holds nobody's email. */
export const bannedEmails = pgTable("banned_emails", {
  emailHash: text("email_hash").primaryKey(),
  createdAt: createdAt(),
});

/**
 * Names and UIDs the admin cleared from an account, which that account may not take again (others may).
 * A name is kept as cleaned by bare(), a UID trimmed; deleting the account deletes them.
 */
export const clearedValues = pgTable(
  "cleared_values",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "name" or "uid" */
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.value] })],
);

/** Words no name may contain (or be, when whole), kept on the admin page and never in the repository (src/lib/nameRules.ts). */
export const nameWords = pgTable("name_words", {
  /** As cleaned by bare() */
  word: text("word").primaryKey(),
  whole: boolean("whole").notNull().default(false),
  createdAt: createdAt(),
});

/** A player's radar scans of the last day (counts only), to cap them and show the last one again. */
export const radarScans = pgTable(
  "radar_scans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    result: jsonb("result").$type<RadarScan>().notNull(),
    /** Where the main roach was, so a scan is only shown again for the same spot */
    lng: doublePrecision("lng"),
    lat: doublePrecision("lat"),
    createdAt: createdAt(),
  },
  (t) => [index("radar_scans_user_idx").on(t.userId, t.createdAt)],
);

/** 首批蟑螂 numbers; a number is never given out again, even after its owner leaves */
export const firstBatchSerial = pgSequence("first_batch_serial");

/**
 * Badges a player has earned. They are written the moment they are earned and
 * kept even after what earned them is gone, such as a declaration past the
 * 90-day clean-up.
 */
export const userBadges = pgTable(
  "user_badges",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badge: text("badge").notNull(),
    earnedAt: at("earned_at").notNull().defaultNow(),
    /** Only for 首批蟑螂: the player's number, never given to anyone else */
    serial: smallint("serial"),
    /** When the player was shown they had earned it */
    seenAt: at("seen_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badge] })],
);

/**
 * Sitewide totals, one row per Beijing day, for the admin's retention numbers.
 * Only counts: nothing in it points at any player.
 */
export const dailyTotals = pgTable("daily_totals", {
  day: date("day", { mode: "string" }).primaryKey(),
  /** Players who came on any of the 7 days up to and including this one */
  activeWeek: integer("active_week").notNull(),
  /** Accounts made that day */
  signups: integer("signups").notNull(),
  /** Pairs who became 触须之交 that day */
  friendships: integer("friendships").notNull(),
});

/** Placements, moves and removals, for the radar. */
export const moves = pgTable(
  "moves",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    fromLng: doublePrecision("from_lng"),
    fromLat: doublePrecision("from_lat"),
    toLng: doublePrecision("to_lng"),
    toLat: doublePrecision("to_lat"),
    at: at("at").notNull().defaultNow(),
    // so the radar reads only moves that start or end near it; null where there is no point
    fromGeog: geography("from_geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326))::geography`),
    toGeog: geography("to_geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326))::geography`),
  },
  (t) => [
    index("moves_at_idx").on(t.at),
    index("moves_from_geog_idx").using("gist", t.fromGeog),
    index("moves_to_geog_idx").using("gist", t.toGeog),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type RoachRow = typeof roaches.$inferSelect;
